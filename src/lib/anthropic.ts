import "server-only";

// Llamada directa a la API de Claude (mismo patrón que Ana: fetch, 1 reintento rápido en errores transitorios).
export type ABlock = { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> };
export type AMessage = { role: "user" | "assistant"; content: unknown };

export async function callClaude(body: Record<string, unknown>): Promise<{ content: ABlock[]; stop_reason: string } | null> {
  const key = (process.env.ANTHROPIC_API_KEY ?? "").trim();
  if (!key) return null;
  const TRANSIENT = new Set([429, 500, 502, 503, 529]);
  const payload = JSON.stringify(body);
  let res: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 150));
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: payload,
    }).catch(() => null);
    if (res && res.ok) break;
    if (res && !TRANSIENT.has(res.status)) break;
  }
  if (!res || !res.ok) return null;
  const j = (await res.json().catch(() => ({}))) as { content?: ABlock[]; stop_reason?: string };
  return { content: j.content ?? [], stop_reason: j.stop_reason ?? "end_turn" };
}

export function textOf(content: ABlock[]): string {
  return content.filter((c) => c.type === "text" && typeof c.text === "string").map((c) => c.text as string).join(" ").trim();
}

/** Voz: rápido > profundo (Haiku). Tareas de fondo (resúmenes, importar menú): modelo más capaz. */
export const VOICE_MODEL = () => (process.env.VOICE_MODEL ?? "claude-haiku-4-5-20251001").trim();
export const WORK_MODEL = () => (process.env.WORK_MODEL ?? "claude-sonnet-5-5").trim();
