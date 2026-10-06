import { and, desc, eq, gte } from "drizzle-orm";
import { getDb } from "@/db";
import { calls, messages, orders, reservations } from "@/db/schema";
import { apiRestaurant } from "@/lib/auth";
import { toCsv } from "@/lib/csv";
import { usd } from "@/lib/money";

// Reportes descargables (Slang no deja exportar). ?type=calls|orders|reservations|messages&days=30
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const r = await apiRestaurant((await params).slug);
  if (!r) return new Response("Unauthorized", { status: 401 });
  const url = new URL(req.url);
  const type = url.searchParams.get("type") ?? "calls";
  const days = Math.min(366, Math.max(1, Number(url.searchParams.get("days") ?? 30)));
  const from = new Date(Date.now() - days * 86_400_000);
  const db = getDb();
  let rows: Record<string, unknown>[] = [];
  if (type === "calls") {
    rows = (await db.select().from(calls).where(and(eq(calls.restaurantId, r.id), gte(calls.startedAt, from), eq(calls.test, false))).orderBy(desc(calls.startedAt)))
      .map((c) => ({ fecha: c.startedAt, telefono: c.fromPhone, duracion_seg: c.durationSec, idioma: c.language, tema: c.topic, resultado: c.outcome, fuera_de_horario: c.afterHours, satisfaccion: c.sentiment, resumen: c.summary }));
  } else if (type === "orders") {
    rows = (await db.select().from(orders).where(and(eq(orders.restaurantId, r.id), gte(orders.createdAt, from))).orderBy(desc(orders.createdAt)))
      .map((o) => ({ fecha: o.createdAt, codigo: o.code, cliente: o.customerName, telefono: o.customerPhone, tipo: o.kind, platillos: o.lines.map((l) => `${l.qty}x ${l.name}`).join("; "), subtotal: usd(o.subtotalCents), impuesto: usd(o.taxCents), total: usd(o.totalCents), pago: o.payment, estado: o.status }));
  } else if (type === "reservations") {
    rows = (await db.select().from(reservations).where(and(eq(reservations.restaurantId, r.id), gte(reservations.createdAt, from))).orderBy(desc(reservations.startsAt)))
      .map((x) => ({ fecha_reserva: x.startsAt, codigo: x.code, nombre: x.name, telefono: x.phone, personas: x.partySize, estado: x.status, deposito: usd(x.depositCents), notas: x.notes, origen: x.source }));
  } else if (type === "messages") {
    rows = (await db.select().from(messages).where(and(eq(messages.restaurantId, r.id), gte(messages.createdAt, from))).orderBy(desc(messages.createdAt)))
      .map((m) => ({ fecha: m.createdAt, motivo: m.reason, nombre: m.name, telefono: m.phone, recado: m.body, estado: m.status }));
  }
  return new Response(toCsv(rows), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${r.slug}-${type}-${days}d.csv"` } });
}
