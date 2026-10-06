import { and, eq, gte, lt } from "drizzle-orm";
import type { Db } from "@/db";
import { calls, guests, orders, reservations, type Call } from "@/db/schema";
import { localParts } from "@/lib/time";

// INSIGHTS (lo que Slang muestra en Inicio) + lo que le falta: dinero generado, comparación con el periodo
// anterior y alertas cuando baja la satisfacción o la tasa de respuesta.

export type Insights = {
  days: number;
  totalCalls: number;
  answered: number;
  answerRate: number; // 0..1
  automated: number;
  transferred: number;
  messages: number;
  automationRate: number;
  afterHours: number;
  satisfaction: number | null; // % de llamadas calificadas que no fueron negativas
  minutesSaved: number;
  newCallers: number;
  returningCallers: number;
  byTopic: Record<string, number>;
  byLanguage: Record<string, number>;
  byHour: number[]; // 24
  transfersByHour: number[];
  ordersCount: number;
  ordersRevenueCents: number;
  reservationsCount: number;
  covers: number;
};

export function computeInsights(rows: Call[], tz: string, days: number, newGuestIds: Set<string>): Omit<Insights, "ordersCount" | "ordersRevenueCents" | "reservationsCount" | "covers"> {
  const real = rows.filter((c) => !c.test);
  const answered = real.filter((c) => c.outcome !== "abandoned");
  const rated = answered.filter((c) => c.sentiment);
  const byTopic: Record<string, number> = {}, byLanguage: Record<string, number> = {};
  const byHour = Array(24).fill(0), transfersByHour = Array(24).fill(0);
  let newCallers = 0, returning = 0;
  const seen = new Set<string>();
  for (const c of answered) {
    byTopic[c.topic ?? "other"] = (byTopic[c.topic ?? "other"] ?? 0) + 1;
    byLanguage[c.language ?? "?"] = (byLanguage[c.language ?? "?"] ?? 0) + 1;
    const h = Math.floor(localParts(c.startedAt, tz).minutes / 60);
    byHour[h]++;
    if (c.outcome === "transferred") transfersByHour[h]++;
    if (c.guestId && !seen.has(c.guestId)) {
      seen.add(c.guestId);
      if (newGuestIds.has(c.guestId)) newCallers++; else returning++;
    }
  }
  const automated = answered.filter((c) => c.outcome === "automated").length;
  return {
    days,
    totalCalls: real.length,
    answered: answered.length,
    answerRate: real.length ? answered.length / real.length : 0,
    automated,
    transferred: answered.filter((c) => c.outcome === "transferred").length,
    messages: answered.filter((c) => c.outcome === "message").length,
    automationRate: answered.length ? automated / answered.length : 0,
    afterHours: answered.filter((c) => c.afterHours).length,
    satisfaction: rated.length ? rated.filter((c) => c.sentiment !== "negative").length / rated.length : null,
    minutesSaved: Math.round(answered.filter((c) => c.outcome === "automated").reduce((a, c) => a + (c.durationSec ?? 90), 0) / 60),
    newCallers,
    returningCallers: returning,
    byTopic, byLanguage, byHour, transfersByHour,
  };
}

export async function insights(db: Db, restaurantId: string, tz: string, days: number, end = new Date()): Promise<Insights> {
  const from = new Date(end.getTime() - days * 86_400_000);
  const [rows, newG, ords, resvs] = await Promise.all([
    db.select().from(calls).where(and(eq(calls.restaurantId, restaurantId), gte(calls.startedAt, from), lt(calls.startedAt, end))),
    db.select({ id: guests.id }).from(guests).where(and(eq(guests.restaurantId, restaurantId), gte(guests.firstSeenAt, from))),
    db.select({ total: orders.totalCents, status: orders.status }).from(orders).where(and(eq(orders.restaurantId, restaurantId), gte(orders.createdAt, from), lt(orders.createdAt, end))),
    db.select({ party: reservations.partySize, status: reservations.status, source: reservations.source }).from(reservations).where(and(eq(reservations.restaurantId, restaurantId), gte(reservations.createdAt, from), lt(reservations.createdAt, end))),
  ]);
  const base = computeInsights(rows, tz, days, new Set(newG.map((g) => g.id)));
  const goodOrders = ords.filter((o) => o.status !== "cancelled" && o.status !== "awaiting_payment");
  const phoneResv = resvs.filter((r) => r.source === "phone" && r.status !== "cancelled");
  return {
    ...base,
    ordersCount: goodOrders.length,
    ordersRevenueCents: goodOrders.reduce((a, o) => a + o.total, 0),
    reservationsCount: phoneResv.length,
    covers: phoneResv.reduce((a, r) => a + r.party, 0),
  };
}

export type Alert = { level: "warn" | "bad"; text: string };

/** Alertas por caída vs el periodo anterior (Slang no avisa: Altamirano bajó −20% satisfacción sin aviso). */
export function alertsFor(cur: Insights, prev: Insights): Alert[] {
  const out: Alert[] = [];
  if (cur.satisfaction != null && prev.satisfaction != null && prev.satisfaction - cur.satisfaction >= 0.1)
    out.push({ level: "bad", text: `La satisfacción bajó de ${Math.round(prev.satisfaction * 100)}% a ${Math.round(cur.satisfaction * 100)}%.` });
  if (prev.totalCalls >= 5 && prev.answerRate - cur.answerRate >= 0.1)
    out.push({ level: "bad", text: `La tasa de respuesta bajó de ${Math.round(prev.answerRate * 100)}% a ${Math.round(cur.answerRate * 100)}%.` });
  if (cur.answered >= 5 && cur.transferred / cur.answered > 0.3)
    out.push({ level: "warn", text: `Más del 30% de las llamadas se transfieren: revisa qué info le falta a Casia.` });
  return out;
}
