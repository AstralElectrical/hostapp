import "server-only";
import Stripe from "stripe";

// Stripe Connect: cada restaurante tiene su cuenta conectada; el cobro va DIRECTO a esa cuenta.
// La IA NUNCA toma la tarjeta por teléfono: siempre manda un link de Stripe Checkout por SMS.
let client: Stripe | null = null;
export function stripe(): Stripe | null {
  const key = (process.env.STRIPE_SECRET_KEY ?? "").trim();
  if (!key) return null;
  client ??= new Stripe(key);
  return client;
}

export function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export type CheckoutLine = { name: string; unitCents: number; qty: number };

/** Crea un link de pago (Checkout) en la cuenta conectada. Devuelve null si Stripe no está configurado. */
export async function createCheckout(opts: {
  accountId: string | null;
  lines: CheckoutLine[];
  metadata: Record<string, string>;
  successPath: string;
  phone?: string | null;
}): Promise<{ id: string; url: string } | null> {
  const s = stripe();
  if (!s) return null;
  const fee = Number(process.env.PLATFORM_FEE_BPS ?? "0");
  const total = opts.lines.reduce((a, l) => a + l.unitCents * l.qty, 0);
  const session = await s.checkout.sessions.create(
    {
      mode: "payment",
      line_items: opts.lines.map((l) => ({ quantity: l.qty, price_data: { currency: "usd", unit_amount: l.unitCents, product_data: { name: l.name } } })),
      metadata: opts.metadata,
      payment_intent_data: {
        metadata: opts.metadata,
        ...(opts.accountId && fee > 0 ? { application_fee_amount: Math.round((total * fee) / 10_000) } : {}),
      },
      success_url: `${appUrl()}${opts.successPath}`,
      cancel_url: `${appUrl()}${opts.successPath}?cancelled=1`,
      expires_at: Math.floor(Date.now() / 1000) + 60 * 60 * 2,
    },
    opts.accountId ? { stripeAccount: opts.accountId } : undefined,
  );
  return session.url ? { id: session.id, url: session.url } : null;
}
