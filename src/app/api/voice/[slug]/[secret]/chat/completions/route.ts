import { after } from "next/server";
import { getDb } from "@/db";
import { FALLBACK_EN } from "@/lib/casia/brain";
import { getRestaurantBySlug } from "@/lib/services/restaurant";
import { voiceTurn } from "@/lib/services/voice";
import { openAiResponse, readCall, secretOk, toTurns } from "@/lib/vapi";

// Vapi "Custom LLM" → Casia. URL en Vapi: https://<app>/api/voice/<slug>/<VOICE_WEBHOOK_SECRET>/chat/completions
// (el secreto va en la URL porque la UI de Custom LLM de Vapi no tiene campo de API key — igual que Ana).
export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request, { params }: { params: Promise<{ slug: string; secret: string }> }) {
  const { slug, secret } = await params;
  if (!secretOk(secret)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { messages?: unknown; stream?: boolean; model?: string };
  const model = typeof body.model === "string" ? body.model : "hostapp-casia";
  const stream = body.stream !== false;
  const db = getDb();
  const restaurant = await getRestaurantBySlug(db, slug);
  if (!restaurant) return openAiResponse(FALLBACK_EN, { stream, model });
  const call = readCall(body);
  const { text } = await voiceTurn(db, restaurant, {
    turns: toTurns(body.messages), vapiCallId: call.id, callerPhone: call.customerNumber, controlUrl: call.controlUrl,
    defer: (fn) => after(() => fn().catch((e) => console.error("[defer]", e))),
  }).catch((e) => { console.error("[voice]", e); return { text: FALLBACK_EN }; });
  return openAiResponse(text, { stream, model });
}
