import { and, eq, lt } from "drizzle-orm";
import { getDb } from "@/db";
import { messages, restaurants } from "@/db/schema";
import { alertsFor, insights } from "@/lib/services/metrics";
import { sendSms } from "@/lib/sms";

// Diario: alertas al dueño si bajan satisfacción / tasa de respuesta, y recordatorio de recados sin atender.
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getDb();
  const all = await db.select().from(restaurants);
  const sent: string[] = [];
  for (const r of all) {
    if (!r.ownerPhone) continue;
    const now = new Date();
    const cur = await insights(db, r.id, r.timezone, 7, now);
    const prev = await insights(db, r.id, r.timezone, 7, new Date(now.getTime() - 7 * 86_400_000));
    const alerts = alertsFor(cur, prev);
    const stale = await db.select({ id: messages.id }).from(messages)
      .where(and(eq(messages.restaurantId, r.id), eq(messages.status, "open"), lt(messages.createdAt, new Date(now.getTime() - 2 * 3600_000))));
    const lines = [...alerts.map((a) => a.text), ...(stale.length ? [`Tienes ${stale.length} recado(s) sin devolver la llamada.`] : [])];
    if (!lines.length) continue;
    await sendSms({ to: r.ownerPhone, body: `HostApp · ${r.name}: ${lines.join(" ")} Revisa el panel.` });
    sent.push(r.slug);
  }
  return Response.json({ ok: true, notified: sent });
}
