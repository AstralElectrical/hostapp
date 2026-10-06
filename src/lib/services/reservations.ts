import { and, asc, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { messages, reservations, waitlist, type Reservation, type Restaurant } from "@/db/schema";
import { shortCode } from "@/lib/money";
import { toE164 } from "@/lib/phone";
import { addDays, localParts, speakable, windowsForDay, zonedToUtc, type ExceptionRow, type HoursRow } from "@/lib/time";

// LIBRO DE RESERVAS PROPIO (piloto). Capacidad por cubiertos: una reserva ocupa `turnMinutes`.
// Mismas reglas que Slang (crear/cambiar/cancelar, grupos grandes, waitlist, running late) + depósito con link de Stripe.
// Más adelante: adaptador OpenTable/Resy que implemente estas mismas funciones.

export const ACTIVE = ["confirmed", "awaiting_deposit", "needs_approval", "seated"] as const;

export type Slot = { iso: string; local: string; minutes: number };
type Booked = { startsAt: Date; partySize: number };

export type Rules = Pick<Restaurant, "capacityCovers" | "turnMinutes" | "slotMinutes" | "lastSeatingMinutes" | "timezone">;

/** Cubiertos ocupados en [t, t+turn). */
function coversAt(t: number, turnMs: number, booked: Booked[]): number {
  return booked.reduce((sum, b) => {
    const s = b.startsAt.getTime();
    return s < t + turnMs && s + turnMs > t ? sum + b.partySize : sum;
  }, 0);
}

/** PURA: horarios libres de un día para un grupo. Probada en test/reservations.test.ts. */
export function computeSlots(opts: {
  ymd: string; party: number; rules: Rules; hours: HoursRow[]; exceptions: ExceptionRow[]; booked: Booked[]; now: Date; leadMinutes?: number;
}): Slot[] {
  const { ymd, party, rules } = opts;
  const turnMs = rules.turnMinutes * 60_000;
  const earliest = opts.now.getTime() + (opts.leadMinutes ?? 30) * 60_000;
  const out: Slot[] = [];
  for (const w of windowsForDay(ymd, opts.hours, opts.exceptions)) {
    for (let m = w.opens; m <= w.closes - rules.lastSeatingMinutes; m += rules.slotMinutes) {
      const at = zonedToUtc(ymd, m, rules.timezone);
      if (at.getTime() < earliest) continue;
      if (coversAt(at.getTime(), turnMs, opts.booked) + party > rules.capacityCovers) continue;
      out.push({ iso: at.toISOString(), local: speakable(at, rules.timezone), minutes: m });
    }
  }
  return out;
}

async function bookedForDay(db: Db, r: Restaurant, ymd: string, excludeId?: string): Promise<Booked[]> {
  // Ventana amplia (día anterior → día siguiente) para cubrir turnos que cruzan medianoche.
  const from = zonedToUtc(addDays(ymd, -1), 0, r.timezone);
  const to = zonedToUtc(addDays(ymd, 2), 0, r.timezone);
  const conds = [eq(reservations.restaurantId, r.id), gte(reservations.startsAt, from), lt(reservations.startsAt, to), inArray(reservations.status, [...ACTIVE])];
  if (excludeId) conds.push(ne(reservations.id, excludeId));
  return db.select({ startsAt: reservations.startsAt, partySize: reservations.partySize }).from(reservations).where(and(...conds));
}

export async function availability(db: Db, ctx: { restaurant: Restaurant; hours: HoursRow[]; exceptions: ExceptionRow[] }, ymd: string, party: number, excludeId?: string, now = new Date()): Promise<Slot[]> {
  const booked = await bookedForDay(db, ctx.restaurant, ymd, excludeId);
  return computeSlots({ ymd, party, rules: ctx.restaurant, hours: ctx.hours, exceptions: ctx.exceptions, booked, now });
}

/** Elige hasta `n` horarios más cercanos a la hora pedida (minutos locales). */
export function nearest(slots: Slot[], wantedMinutes: number | null, n = 4): Slot[] {
  if (wantedMinutes == null) return slots.slice(0, n);
  return [...slots].sort((a, b) => Math.abs(a.minutes - wantedMinutes) - Math.abs(b.minutes - wantedMinutes)).slice(0, n)
    .sort((a, b) => a.minutes - b.minutes);
}

export type BookResult =
  | { ok: true; reservation: Reservation; kind: "confirmed" | "awaiting_deposit" | "needs_approval" }
  | { ok: false; error: "closed_or_full" | "bad_input"; alternatives?: Slot[] };

/**
 * Reserva con candado por restaurante (dos llamadas no pueden tomar el último lugar a la vez).
 * Grupo > max_party_auto → queda "needs_approval" y el dueño recibe recado. Grupo ≥ deposit_party_min con
 * depósito configurado → "awaiting_deposit" (el link de Stripe lo genera quien llama a esta función).
 */
export async function book(db: Db, ctx: { restaurant: Restaurant; hours: HoursRow[]; exceptions: ExceptionRow[] }, input: {
  ymd: string; minutes: number; party: number; name: string; phone: string | null; notes?: string | null;
  guestId?: string | null; callId?: string | null; source?: string; now?: Date;
}): Promise<BookResult> {
  const r = ctx.restaurant;
  if (!input.name.trim() || input.party < 1 || input.party > 100) return { ok: false, error: "bad_input" };
  const now = input.now ?? new Date();
  const startsAt = zonedToUtc(input.ymd, input.minutes, r.timezone);
  const large = input.party > r.maxPartyAuto;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${r.id}))`);
    const slots = await availability(tx as unknown as Db, ctx, input.ymd, input.party, undefined, now);
    if (!large && !slots.some((s) => s.iso === startsAt.toISOString())) {
      return { ok: false as const, error: "closed_or_full" as const, alternatives: nearest(slots, input.minutes) };
    }
    const needsDeposit = !large && r.depositPerPersonCents > 0 && input.party >= r.depositPartyMin;
    const kind = large ? "needs_approval" : needsDeposit ? "awaiting_deposit" : "confirmed";
    const [row] = await tx.insert(reservations).values({
      restaurantId: r.id, guestId: input.guestId ?? null, callId: input.callId ?? null,
      code: shortCode("R"), name: input.name.trim(), phone: toE164(input.phone ?? ""), partySize: input.party, startsAt,
      status: kind, notes: input.notes ?? null,
      depositCents: needsDeposit ? r.depositPerPersonCents * input.party : 0,
      source: input.source ?? "phone",
    }).returning();
    if (large) {
      await tx.insert(messages).values({
        restaurantId: r.id, guestId: input.guestId ?? null, callId: input.callId ?? null, reason: "large_party",
        name: input.name, phone: toE164(input.phone ?? "") ?? input.phone ?? "",
        body: `Grupo de ${input.party} pide ${speakable(startsAt, r.timezone, "es")}. Reserva ${row.code} espera tu aprobación.${input.notes ? ` Notas: ${input.notes}` : ""}`,
      });
    }
    return { ok: true as const, reservation: row, kind };
  });
}

/** Próximas reservas activas del llamante (por teléfono) o por código. */
export async function findUpcoming(db: Db, restaurantId: string, by: { phone?: string | null; code?: string | null }, now = new Date()): Promise<Reservation[]> {
  const conds = [eq(reservations.restaurantId, restaurantId), gte(reservations.startsAt, new Date(now.getTime() - 3 * 3600_000)), inArray(reservations.status, [...ACTIVE])];
  if (by.code) conds.push(eq(reservations.code, by.code.trim().toUpperCase()));
  else if (by.phone) {
    const e = toE164(by.phone);
    if (!e) return [];
    conds.push(eq(reservations.phone, e));
  } else return [];
  return db.select().from(reservations).where(and(...conds)).orderBy(asc(reservations.startsAt)).limit(5);
}

export async function change(db: Db, ctx: { restaurant: Restaurant; hours: HoursRow[]; exceptions: ExceptionRow[] }, resv: Reservation, next: { ymd?: string; minutes?: number; party?: number }, now = new Date()): Promise<BookResult> {
  const r = ctx.restaurant;
  const cur = localParts(resv.startsAt, r.timezone);
  const ymd = next.ymd ?? cur.ymd;
  const minutes = next.minutes ?? cur.minutes;
  const party = next.party ?? resv.partySize;
  const startsAt = zonedToUtc(ymd, minutes, r.timezone);
  if (party > r.maxPartyAuto && resv.partySize <= r.maxPartyAuto) return { ok: false, error: "bad_input" }; // lo maneja el dueño
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${r.id}))`);
    const slots = await availability(tx as unknown as Db, ctx, ymd, party, resv.id, now);
    if (!slots.some((s) => s.iso === startsAt.toISOString())) return { ok: false as const, error: "closed_or_full" as const, alternatives: nearest(slots, minutes) };
    const [row] = await tx.update(reservations).set({ startsAt, partySize: party }).where(eq(reservations.id, resv.id)).returning();
    return { ok: true as const, reservation: row, kind: row.status as "confirmed" };
  });
}

export async function cancel(db: Db, resv: Reservation): Promise<void> {
  await db.update(reservations).set({ status: "cancelled" }).where(eq(reservations.id, resv.id));
}

export async function runningLate(db: Db, resv: Reservation, minutes: number): Promise<Reservation> {
  const [row] = await db.update(reservations).set({ runningLateMinutes: Math.max(1, Math.round(minutes)) }).where(eq(reservations.id, resv.id)).returning();
  return row;
}

export async function joinWaitlist(db: Db, restaurantId: string, input: { name: string; phone: string; party: number; wantedAt: Date; guestId?: string | null }) {
  const [row] = await db.insert(waitlist).values({ restaurantId, guestId: input.guestId ?? null, name: input.name, phone: toE164(input.phone) ?? input.phone, partySize: input.party, wantedAt: input.wantedAt }).returning();
  return row;
}

/** Tras una cancelación: el primero en la lista de espera ese día (±90 min, grupo que cabe) que tenga lugar. */
export async function waitlistCandidates(db: Db, ctx: { restaurant: Restaurant; hours: HoursRow[]; exceptions: ExceptionRow[] }, freedAt: Date, now = new Date()) {
  const r = ctx.restaurant;
  const from = new Date(freedAt.getTime() - 90 * 60_000), to = new Date(freedAt.getTime() + 90 * 60_000);
  const waiting = await db.select().from(waitlist).where(and(eq(waitlist.restaurantId, r.id), eq(waitlist.status, "waiting"), gte(waitlist.wantedAt, from), lt(waitlist.wantedAt, to))).orderBy(asc(waitlist.createdAt));
  const ymd = localParts(freedAt, r.timezone).ymd;
  for (const w of waiting) {
    const slots = await availability(db, ctx, ymd, w.partySize, undefined, now);
    const wanted = localParts(w.wantedAt, r.timezone).minutes;
    const best = nearest(slots.filter((s) => Math.abs(s.minutes - wanted) <= 90), wanted, 1)[0];
    if (best) return { entry: w, slot: best };
  }
  return null;
}

export async function markWaitlist(db: Db, id: string, status: string) {
  await db.update(waitlist).set({ status }).where(eq(waitlist.id, id));
}
