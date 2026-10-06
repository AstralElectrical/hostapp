import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { orders, reservations } from "@/db/schema";
import { stripe } from "@/lib/stripe";

// Stripe (Connect): cuando el cliente paga el link, el pedido entra a cocina o la reserva queda confirmada.
// En Stripe → Developers → Webhooks: escuchar "checkout.session.completed" de cuentas CONECTADAS.
export const runtime = "nodejs";

export async function POST(req: Request) {
  const s = stripe();
  const whsec = process.env.STRIPE_WEBHOOK_SECRET;
  if (!s || !whsec) return Response.json({ error: "not-configured" }, { status: 503 });
  const raw = await req.text();
  let event;
  try {
    event = s.webhooks.constructEvent(raw, req.headers.get("stripe-signature") ?? "", whsec);
  } catch {
    return Response.json({ error: "bad-signature" }, { status: 400 });
  }
  if (event.type !== "checkout.session.completed") return Response.json({ ok: true, ignored: event.type });
  const session = event.data.object;
  if (session.payment_status !== "paid") return Response.json({ ok: true, unpaid: true });
  const md = session.metadata ?? {};
  const db = getDb();
  if (md.kind === "order" && md.order_id) {
    await db.update(orders).set({ status: "new", paidAt: new Date() })
      .where(and(eq(orders.id, md.order_id), eq(orders.stripeSessionId, session.id), eq(orders.status, "awaiting_payment")));
  } else if (md.kind === "deposit" && md.reservation_id) {
    await db.update(reservations).set({ status: "confirmed", depositPaidAt: new Date() })
      .where(and(eq(reservations.id, md.reservation_id), eq(reservations.stripeSessionId, session.id)));
  }
  return Response.json({ ok: true });
}
