import type { Turn } from "@/lib/casia/brain";

// Adaptador Vapi "Custom LLM" (OpenAI /chat/completions) — copiado del de Ana y extendido para leer la
// llamada (id, número del cliente, controlUrl para transferir en vivo).

export function secretOk(secret: string | undefined): boolean {
  const want = (process.env.VOICE_WEBHOOK_SECRET ?? "").trim();
  return want.length > 0 && (secret ?? "").trim() === want;
}

export function toTurns(messages: unknown): Turn[] {
  const arr = Array.isArray(messages) ? messages : [];
  return arr
    .map((m): Turn | null => {
      const o = (m ?? {}) as Record<string, unknown>;
      const role = o.role === "assistant" || o.role === "bot" ? "assistant" : o.role === "user" ? "user" : null;
      const content = typeof o.content === "string" ? o.content
        : typeof o.message === "string" ? o.message
        : Array.isArray(o.content) ? (o.content as { text?: string }[]).map((c) => c?.text ?? "").join(" ").trim()
        : "";
      return role && content ? { role, content } : null;
    })
    .filter((x): x is Turn => x !== null);
}

export type VapiCall = { id: string | null; customerNumber: string | null; controlUrl: string | null };

export function readCall(body: unknown): VapiCall {
  const b = (body ?? {}) as Record<string, any>;
  const c = (b.call ?? b.message?.call ?? {}) as Record<string, any>;
  return {
    id: typeof c.id === "string" ? c.id : null,
    customerNumber: typeof c.customer?.number === "string" ? c.customer.number : null,
    controlUrl: typeof c.monitor?.controlUrl === "string" ? c.monitor.controlUrl : null,
  };
}

const cid = () => `chatcmpl-host${Date.now()}`;

export function openAiResponse(reply: string, opts: { stream: boolean; model: string }): Response {
  const created = Math.floor(Date.now() / 1000);
  if (!opts.stream) {
    return Response.json({
      id: cid(), object: "chat.completion", created, model: opts.model,
      choices: [{ index: 0, message: { role: "assistant", content: reply }, finish_reason: "stop" }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
  }
  const id = cid();
  const chunk = (delta: Record<string, unknown>, finish: string | null) =>
    `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: opts.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(enc.encode(chunk({ role: "assistant", content: reply }, null)));
      controller.enqueue(enc.encode(chunk({}, "stop")));
      controller.enqueue(enc.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", connection: "keep-alive" } });
}
