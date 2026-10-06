import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { orders } from "@/db/schema";
import { apiRestaurant } from "@/lib/auth";

// Pantalla de cocina: pedidos activos (se refresca solo cada pocos segundos).
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const r = await apiRestaurant((await params).slug);
  if (!r) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await getDb().select().from(orders)
    .where(and(eq(orders.restaurantId, r.id), inArray(orders.status, ["new", "preparing", "ready"]), gte(orders.createdAt, new Date(Date.now() - 24 * 3600_000))))
    .orderBy(desc(orders.createdAt));
  return Response.json({ orders: rows });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const r = await apiRestaurant((await params).slug);
  if (!r) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id, status } = (await req.json().catch(() => ({}))) as { id?: string; status?: string };
  if (!id || !["preparing", "ready", "completed", "cancelled"].includes(status ?? "")) return Response.json({ error: "bad-input" }, { status: 400 });
  await getDb().update(orders).set({ status: status! }).where(and(eq(orders.id, id), eq(orders.restaurantId, r.id)));
  return Response.json({ ok: true });
}
