import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { calls, guests, type Call, type Guest, type Restaurant } from "@/db/schema";
import { toE164 } from "@/lib/phone";
import { isOpenAt, type ExceptionRow, type HoursRow } from "@/lib/time";

// CRM de llamantes + log de llamadas. Una ficha por teléfono por restaurante.

export async function upsertGuest(db: Db, restaurantId: string, phone: string, patch: { name?: string | null; email?: string | null; language?: string | null } = {}): Promise<Guest | null> {
  const e164 = toE164(phone);
  if (!e164) return null;
  const set: Record<string, unknown> = { lastSeenAt: new Date() };
  if (patch.name) set.name = patch.name;
  if (patch.email) set.email = patch.email;
  if (patch.language) set.language = patch.language;
  const [g] = await db.insert(guests)
    .values({ restaurantId, phone: e164, name: patch.name ?? null, email: patch.email ?? null, language: patch.language ?? null })
    .onConflictDoUpdate({ target: [guests.restaurantId, guests.phone], set })
    .returning();
  return g ?? null;
}

/** Crea (o recupera) la fila de la llamada en el primer turno. Idempotente por vapi_call_id. */
export async function ensureCall(db: Db, opts: {
  restaurant: Restaurant; hours: HoursRow[]; exceptions: ExceptionRow[];
  vapiCallId: string | null; fromPhone: string | null; test?: boolean;
}): Promise<Call> {
  if (opts.vapiCallId) {
    const [existing] = await db.select().from(calls).where(eq(calls.vapiCallId, opts.vapiCallId)).limit(1);
    if (existing) return existing;
  }
  const now = new Date();
  const guest = opts.fromPhone ? await upsertGuest(db, opts.restaurant.id, opts.fromPhone) : null;
  if (guest) await db.update(guests).set({ callCount: sql`${guests.callCount} + 1` }).where(eq(guests.id, guest.id));
  const [row] = await db.insert(calls).values({
    restaurantId: opts.restaurant.id,
    guestId: guest?.id ?? null,
    vapiCallId: opts.vapiCallId,
    fromPhone: toE164(opts.fromPhone ?? "") ?? opts.fromPhone,
    startedAt: now,
    afterHours: !isOpenAt(now, opts.restaurant.timezone, opts.hours, opts.exceptions),
    outcome: "automated",
    test: !!opts.test,
  }).onConflictDoNothing({ target: calls.vapiCallId }).returning();
  if (row) return row;
  // Carrera: dos turnos simultáneos crearon la misma llamada → devuelve la existente.
  const [again] = await db.select().from(calls).where(eq(calls.vapiCallId, opts.vapiCallId!)).limit(1);
  return again;
}

const OUTCOME_RANK: Record<string, number> = { abandoned: 0, automated: 1, message: 2, transferred: 3 };

/** Marca tema / resultado. El resultado solo "sube" (automated → message → transferred), nunca baja. */
export async function noteCall(db: Db, callId: string | null, patch: { topic?: string; outcome?: string; language?: string; guestId?: string }) {
  if (!callId) return;
  const [c] = await db.select({ topic: calls.topic, outcome: calls.outcome, guestId: calls.guestId }).from(calls).where(eq(calls.id, callId)).limit(1);
  if (!c) return;
  const set: Record<string, unknown> = {};
  if (patch.topic && (!c.topic || c.topic === "other" || c.topic === "menu" || c.topic === "hours")) set.topic = patch.topic;
  if (patch.outcome && (OUTCOME_RANK[patch.outcome] ?? 0) > (OUTCOME_RANK[c.outcome ?? "automated"] ?? 0)) set.outcome = patch.outcome;
  if (patch.language) set.language = patch.language;
  if (patch.guestId && !c.guestId) set.guestId = patch.guestId;
  if (Object.keys(set).length) await db.update(calls).set(set).where(eq(calls.id, callId));
}
