import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { calls, guests, type Restaurant, type TranscriptLine } from "@/db/schema";
import { callClaude, textOf, VOICE_MODEL } from "@/lib/anthropic";
import { casiaReply, type Turn } from "@/lib/casia/brain";
import { ensureCall } from "./calls";
import { loadBundle } from "./restaurant";

// Un turno de llamada: carga el restaurante, registra la llamada y deja que Casia responda.
export async function voiceTurn(db: Db, restaurant: Restaurant, opts: {
  turns: Turn[]; vapiCallId: string | null; callerPhone: string | null; controlUrl: string | null;
  test?: boolean; defer: (fn: () => Promise<void>) => void; now?: Date;
}): Promise<{ text: string; tools: string[] }> {
  const bundle = await loadBundle(db, restaurant);
  const now = opts.now ?? new Date();
  const call = opts.test ? null : await ensureCall(db, { restaurant, hours: bundle.hours, exceptions: bundle.exceptions, vapiCallId: opts.vapiCallId, fromPhone: opts.callerPhone });
  let guestName: string | null = null;
  if (call?.guestId) {
    const [g] = await db.select({ name: guests.name }).from(guests).where(eq(guests.id, call.guestId)).limit(1);
    guestName = g?.name ?? null;
  }
  return casiaReply(opts.turns, {
    db, bundle, callId: call?.id ?? null, callerPhone: opts.callerPhone, controlUrl: opts.controlUrl,
    test: !!opts.test, now, defer: opts.defer, guestName,
  });
}

type Report = {
  callId: string | null; customerNumber: string | null; endedReason?: string; startedAt?: string; endedAt?: string;
  durationSeconds?: number; recordingUrl?: string; transcript: TranscriptLine[];
};

/** Lee el "end-of-call-report" de Vapi (formato tolerante: varía entre versiones). */
export function readReport(body: any): Report | null {
  const m = body?.message ?? body;
  if (m?.type !== "end-of-call-report") return null;
  const raw = (m.artifact?.messages ?? m.messages ?? []) as any[];
  const transcript: TranscriptLine[] = raw
    .filter((x) => x && (x.role === "user" || x.role === "bot" || x.role === "assistant") && (x.message || x.content))
    .map((x) => ({ role: x.role === "user" ? "user" : "assistant", text: String(x.message ?? x.content) }));
  return {
    callId: m.call?.id ?? null,
    customerNumber: m.call?.customer?.number ?? m.customer?.number ?? null,
    endedReason: m.endedReason,
    startedAt: m.startedAt ?? m.call?.startedAt,
    endedAt: m.endedAt ?? m.call?.endedAt,
    durationSeconds: typeof m.durationSeconds === "number" ? Math.round(m.durationSeconds) : undefined,
    recordingUrl: m.recordingUrl ?? m.artifact?.recordingUrl,
    transcript,
  };
}

const TOPICS = ["order", "reservation", "menu", "hours", "directions", "catering", "employment", "other"];

export async function summarize(transcript: TranscriptLine[]): Promise<{ summary: string; topic: string; language: string; sentiment: string } | null> {
  if (!transcript.some((t) => t.role === "user")) return null;
  const convo = transcript.map((t) => `${t.role === "user" ? "Cliente" : "Casia"}: ${t.text}`).join("\n").slice(0, 12000);
  const res = await callClaude({
    model: VOICE_MODEL(), max_tokens: 300,
    system: `Resume llamadas de un restaurante para el dueño. Responde SOLO JSON: {"summary": "1-2 frases en español: motivo + qué pasó", "topic": one of ${JSON.stringify(TOPICS)}, "language": "es"|"en"|"other", "sentiment": "positive"|"neutral"|"negative"}`,
    messages: [{ role: "user", content: convo }],
  });
  if (!res) return null;
  try {
    const j = JSON.parse(textOf(res.content).replace(/^```(json)?|```$/g, "").trim());
    return { summary: String(j.summary ?? "").slice(0, 500), topic: TOPICS.includes(j.topic) ? j.topic : "other", language: ["es", "en"].includes(j.language) ? j.language : "other", sentiment: ["positive", "neutral", "negative"].includes(j.sentiment) ? j.sentiment : "neutral" };
  } catch {
    return null;
  }
}

/** Cierra la llamada con el reporte de Vapi; si nunca hubo turnos, la crea (cuenta como no contestada/abandonada). */
export async function closeCall(db: Db, restaurant: Restaurant, rep: Report, ai: typeof summarize = summarize): Promise<void> {
  const bundle = await loadBundle(db, restaurant);
  const call = await ensureCall(db, { restaurant, hours: bundle.hours, exceptions: bundle.exceptions, vapiCallId: rep.callId, fromPhone: rep.customerNumber });
  const spoke = rep.transcript.some((t) => t.role === "user");
  const s = spoke ? await ai(rep.transcript).catch(() => null) : null;
  await db.update(calls).set({
    endedAt: rep.endedAt ? new Date(rep.endedAt) : new Date(),
    ...(rep.startedAt ? { startedAt: new Date(rep.startedAt) } : {}),
    durationSec: rep.durationSeconds ?? null,
    endedReason: rep.endedReason ?? null,
    recordingUrl: rep.recordingUrl ?? null,
    transcript: rep.transcript,
    ...(spoke ? {} : { outcome: "abandoned" }),
    ...(s ? { summary: s.summary, language: s.language, sentiment: s.sentiment, ...(call.topic ? {} : { topic: s.topic }) } : {}),
  }).where(eq(calls.id, call.id));
}
