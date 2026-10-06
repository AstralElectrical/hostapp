import { callClaude, textOf, VOICE_MODEL, type AMessage } from "@/lib/anthropic";
import { dynamicPrompt, staticPrompt } from "./prompt";
import { runTool, TOOLS, type ToolCtx } from "./tools";

// CEREBRO DE CASIA (mismo diseño que Ana): el proveedor de voz (Vapi) hace solo audio; cada turno llega aquí
// y Claude responde con herramientas reales (reservas, pedidos, recados). Bucle corto para no dejar silencio.

export type Turn = { role: "user" | "assistant"; content: string };

export const FALLBACK_EN = "Sorry, I didn't catch that. Could you say it again?";
export const FALLBACK_ES = "Perdón, no le escuché bien. ¿Me lo repite?";

function looksSpanish(s: string): boolean {
  return /[ñ¿¡áéíóú]|\b(hola|quiero|para|una|mesa|pedido|gracias|por favor|cuánto|tienen|buenas)\b/i.test(s);
}

export async function casiaReply(history: Turn[], ctx: ToolCtx & { guestName?: string | null }, opts: { maxSteps?: number; call?: typeof callClaude } = {}): Promise<{ text: string; tools: string[] }> {
  const call = opts.call ?? callClaude;
  const turns = history.filter((t) => (t.role === "user" || t.role === "assistant") && t.content?.trim()).slice(-60);
  while (turns.length && turns[0].role !== "user") turns.shift();
  const lastUser = [...turns].reverse().find((t) => t.role === "user")?.content ?? "";
  const fallback = looksSpanish(lastUser) ? FALLBACK_ES : FALLBACK_EN;
  if (!turns.length || turns[turns.length - 1].role !== "user") return { text: fallback, tools: [] };

  const system = [
    { type: "text", text: staticPrompt(ctx.bundle), cache_control: { type: "ephemeral" } },
    { type: "text", text: dynamicPrompt(ctx.bundle, { now: ctx.now, callerPhone: ctx.callerPhone, guestName: ctx.guestName ?? null, test: ctx.test }) },
  ];
  const msgs: AMessage[] = turns.map((t) => ({ role: t.role, content: [{ type: "text", text: t.content.slice(0, 1500) }] }));
  const used: string[] = [];
  const maxSteps = opts.maxSteps ?? 4;
  try {
    for (let step = 0; step < maxSteps; step++) {
      const res = await call({ model: VOICE_MODEL(), max_tokens: 300, system, tools: TOOLS, messages: msgs });
      if (!res) return { text: fallback, tools: used };
      if (res.stop_reason === "tool_use") {
        msgs.push({ role: "assistant", content: res.content });
        const results = [];
        for (const b of res.content) {
          if (b.type === "tool_use" && b.id && b.name) {
            used.push(b.name);
            results.push({ type: "tool_result", tool_use_id: b.id, content: await runTool(b.name, b.input ?? {}, ctx) });
          }
        }
        msgs.push({ role: "user", content: results });
        continue;
      }
      return { text: textOf(res.content) || fallback, tools: used };
    }
  } catch (e) {
    console.error("[casia]", e);
  }
  return { text: fallback, tools: used };
}
