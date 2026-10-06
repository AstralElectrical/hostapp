import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { messages, type Message, type Restaurant, type TransferRule } from "@/db/schema";
import { prettyPhone, toE164 } from "@/lib/phone";
import { sendSms } from "@/lib/sms";

// RECADOS. La regla de oro de HostApp: NADIE se queda colgado. Antes de cualquier transferencia se guarda el
// recado y el dueño (o el destino de la regla) recibe un SMS al instante. Si la transferencia falla o nadie
// contesta, el recado ya está en el panel con el número para devolver la llamada.

export const REASONS: Record<string, string> = {
  human: "Quiere hablar con una persona",
  order_problem: "Problema con un pedido",
  catering: "Catering / eventos",
  large_party: "Grupo grande",
  employment: "Busca empleo",
  other: "Otro",
};

export async function takeMessage(db: Db, r: Restaurant, rule: TransferRule | undefined, input: {
  reason: string; name?: string | null; phone: string; body: string; guestId?: string | null; callId?: string | null;
}): Promise<Message> {
  const phone = toE164(input.phone) ?? input.phone;
  const [row] = await db.insert(messages).values({
    restaurantId: r.id, guestId: input.guestId ?? null, callId: input.callId ?? null,
    reason: REASONS[input.reason] ? input.reason : "other", name: input.name ?? null, phone, body: input.body.slice(0, 1000),
    callbackBy: new Date(Date.now() + 2 * 3600_000),
  }).returning();
  await notifyOwner(db, r, rule, row);
  return row;
}

export async function notifyOwner(db: Db, r: Restaurant, rule: TransferRule | undefined, m: Message): Promise<void> {
  const to = rule?.targetPhone || r.ownerPhone;
  if (!to) return;
  const text = `HostApp · ${r.name}: ${REASONS[m.reason] ?? m.reason}. ${m.name ?? "Cliente"} ${prettyPhone(m.phone)} — "${m.body.slice(0, 220)}" Devuelve la llamada.`;
  const res = await sendSms({ to, body: text });
  if (res.ok || res.skipped) await db.update(messages).set({ notifiedAt: new Date() }).where(eq(messages.id, m.id));
}

/**
 * Transferencia en vivo con el "Live Call Control" de Vapi (monitorPlan.controlEnabled=true en el assistant).
 * Devuelve false si no se puede (sin controlUrl / sin número): el recado ya quedó, así que el llamante igual queda atendido.
 */
export async function liveTransfer(controlUrl: string | null, toPhone: string | null, sayFirst: string): Promise<boolean> {
  const number = toE164(toPhone ?? "");
  if (!controlUrl || !number) return false;
  try {
    const res = await fetch(controlUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "transfer", destination: { type: "number", number }, ...(sayFirst ? { content: sayFirst } : {}) }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
