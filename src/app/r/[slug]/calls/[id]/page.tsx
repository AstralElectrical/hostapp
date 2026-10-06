import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { calls, guests, orders, reservations, messages } from "@/db/schema";
import { requireRestaurant } from "@/lib/auth";
import { prettyPhone } from "@/lib/phone";
import { usd } from "@/lib/money";
import { OUTCOME } from "@/lib/labels";

export default async function CallDetail({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const r = await requireRestaurant(slug);
  const db = getDb();
  const [c] = await db.select().from(calls).where(and(eq(calls.id, id), eq(calls.restaurantId, r.id))).limit(1);
  if (!c) notFound();
  const [g] = c.guestId ? await db.select().from(guests).where(eq(guests.id, c.guestId)) : [];
  const [os, rs, ms] = await Promise.all([
    db.select().from(orders).where(eq(orders.callId, c.id)),
    db.select().from(reservations).where(eq(reservations.callId, c.id)),
    db.select().from(messages).where(eq(messages.callId, c.id)),
  ]);
  return (
    <>
      <p><Link href={`/r/${slug}/calls`}>← Llamadas</Link></p>
      <h1>{g?.name ?? prettyPhone(c.fromPhone)}</h1>
      <div className="grid2">
        <div className="card stack">
          <div><span className={`chip ${OUTCOME[c.outcome ?? ""]?.[1] ?? ""}`}>{OUTCOME[c.outcome ?? ""]?.[0] ?? c.outcome}</span> <span className="chip">{c.topic ?? "—"}</span> {c.language && <span className="chip">{c.language}</span>} {c.sentiment && <span className="chip">{c.sentiment}</span>}</div>
          <div>{c.summary ?? <span className="muted">Sin resumen todavía.</span>}</div>
          <div className="small muted">{prettyPhone(c.fromPhone)} · {c.durationSec ? `${Math.round(c.durationSec / 6) / 10} min` : ""} {c.endedReason ? `· ${c.endedReason}` : ""}</div>
          {c.recordingUrl && <audio controls src={c.recordingUrl} style={{ width: "100%" }} />}
          {os.map((o) => <div key={o.id} className="small">Pedido <b>{o.code}</b> · {usd(o.totalCents)} · {o.status}</div>)}
          {rs.map((x) => <div key={x.id} className="small">Reserva <b>{x.code}</b> · {x.partySize} personas · {x.status}</div>)}
          {ms.map((m) => <div key={m.id} className="small">Recado: {m.body} · {m.status}</div>)}
          {g && <Link className="small" href={`/r/${slug}/guests?q=${encodeURIComponent(g.phone)}`}>Ver historial del cliente ({g.callCount} llamadas)</Link>}
        </div>
        <div className="card chat">
          {(c.transcript ?? []).map((t, i) => <div key={i} className={`bubble ${t.role}`}>{t.text}</div>)}
          {!c.transcript?.length && <p className="muted">La transcripción llega al terminar la llamada.</p>}
        </div>
      </div>
    </>
  );
}
