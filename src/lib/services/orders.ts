import { and, desc, eq, gte } from "drizzle-orm";
import type { Db } from "@/db";
import { orders, type MenuItem, type Modifier, type Order, type OrderLine, type Restaurant } from "@/db/schema";
import { shortCode, taxOf } from "@/lib/money";
import { toE164 } from "@/lib/phone";

// PEDIDOS POR TELÉFONO. Los precios SIEMPRE salen de la base (nunca de lo que "dijo" la IA).
// Pago: link de Stripe por SMS, o pago al recoger si el restaurante lo permite. Jamás tarjeta por voz.

export type RequestedLine = { menu_item_id: string; qty: number; modifiers?: string[]; notes?: string };

export type Priced =
  | { ok: true; lines: OrderLine[]; subtotalCents: number }
  | { ok: false; errors: string[] };

/** PURA: valida y precia un pedido contra el menú. */
export function priceOrder(menu: MenuItem[], req: RequestedLine[]): Priced {
  const errors: string[] = [];
  const lines: OrderLine[] = [];
  if (!Array.isArray(req) || !req.length) return { ok: false, errors: ["The order is empty."] };
  for (const r of req) {
    const item = menu.find((m) => m.id === r.menu_item_id);
    const qty = Math.floor(Number(r.qty));
    if (!item) { errors.push(`Unknown menu item id ${r.menu_item_id}.`); continue; }
    if (!item.available) { errors.push(`${item.name} is not available right now.`); continue; }
    if (!(qty >= 1 && qty <= 50)) { errors.push(`Invalid quantity for ${item.name}.`); continue; }
    const mods: Modifier[] = [];
    for (const name of r.modifiers ?? []) {
      const mod = item.modifiers.find((m) => m.name.toLowerCase() === String(name).toLowerCase().trim());
      if (!mod) errors.push(`"${name}" is not an option for ${item.name}. Options: ${item.modifiers.map((m) => m.name).join(", ") || "none"}.`);
      else mods.push(mod);
    }
    const unit = item.priceCents + mods.reduce((a, m) => a + m.priceCents, 0);
    lines.push({ menuItemId: item.id, name: item.name, qty, unitCents: unit, modifiers: mods, ...(r.notes ? { notes: String(r.notes).slice(0, 200) } : {}) });
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, lines, subtotalCents: lines.reduce((a, l) => a + l.unitCents * l.qty, 0) };
}

export function totals(r: Restaurant, subtotalCents: number, kind: "pickup" | "delivery") {
  const taxCents = taxOf(subtotalCents, r.taxRateBps);
  const feeCents = kind === "delivery" ? r.deliveryFeeCents : 0;
  return { subtotalCents, taxCents, feeCents, totalCents: subtotalCents + taxCents + feeCents };
}

export async function createOrder(db: Db, r: Restaurant, input: {
  lines: OrderLine[]; kind: "pickup" | "delivery"; name: string; phone: string | null; address?: string | null; notes?: string | null;
  readyAt: Date; payment: "link" | "at_pickup"; guestId?: string | null; callId?: string | null;
}): Promise<Order> {
  const t = totals(r, input.lines.reduce((a, l) => a + l.unitCents * l.qty, 0), input.kind);
  const [row] = await db.insert(orders).values({
    restaurantId: r.id, guestId: input.guestId ?? null, callId: input.callId ?? null,
    code: shortCode("A"), kind: input.kind, lines: input.lines, ...t,
    customerName: input.name, customerPhone: toE164(input.phone ?? ""), address: input.address ?? null, notes: input.notes ?? null,
    readyAt: input.readyAt, payment: input.payment,
    // Pago al recoger entra directo a cocina; con link espera a que Stripe confirme.
    status: input.payment === "at_pickup" ? "new" : "awaiting_payment",
  }).returning();
  return row;
}

export async function recentOrdersFor(db: Db, restaurantId: string, phone: string | null, now = new Date()): Promise<Order[]> {
  const e = toE164(phone ?? "");
  if (!e) return [];
  return db.select().from(orders)
    .where(and(eq(orders.restaurantId, restaurantId), eq(orders.customerPhone, e), gte(orders.createdAt, new Date(now.getTime() - 12 * 3600_000))))
    .orderBy(desc(orders.createdAt)).limit(3);
}

export const ORDER_FLOW = ["awaiting_payment", "new", "preparing", "ready", "completed"] as const;
