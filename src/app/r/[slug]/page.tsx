import Link from "next/link";
import { getDb } from "@/db";
import { requireRestaurant } from "@/lib/auth";
import { usd } from "@/lib/money";
import { alertsFor, insights } from "@/lib/services/metrics";
import { goLiveChecklist, loadBundle } from "@/lib/services/restaurant";

const TOPIC: Record<string, string> = { order: "Pedidos", reservation: "Reservas", menu: "Menú", hours: "Horario", directions: "Cómo llegar", catering: "Catering", employment: "Empleo", other: "Otros" };
const LANG: Record<string, string> = { es: "Español", en: "Inglés", other: "Otro", "?": "Sin dato" };
const pct = (x: number | null) => (x == null ? "—" : `${Math.round(x * 100)}%`);

function Delta({ cur, prev, isPct }: { cur: number | null; prev: number | null; isPct?: boolean }) {
  if (cur == null || prev == null || (!isPct && prev === 0)) return null;
  const d = isPct ? Math.round((cur - prev) * 100) : Math.round(((cur - prev) / prev) * 100);
  if (!d) return <span className="d muted">igual que antes</span>;
  return <span className={`d ${d > 0 ? "up" : "down"}`}>{d > 0 ? "▲" : "▼"} {Math.abs(d)}{isPct ? " pts" : "%"}</span>;
}

function Stat({ n, l, cur, prev, isPct }: { n: string | number; l: string; cur?: number | null; prev?: number | null; isPct?: boolean }) {
  return <div className="card stat"><div className="n">{n}</div><div className="l">{l}</div>{cur !== undefined && <Delta cur={cur ?? null} prev={prev ?? null} isPct={isPct} />}</div>;
}

function Breakdown({ data, names }: { data: Record<string, number>; names: Record<string, string> }) {
  const total = Object.values(data).reduce((a, b) => a + b, 0) || 1;
  const rows = Object.entries(data).sort((a, b) => b[1] - a[1]);
  if (!rows.length) return <p className="muted small">Sin llamadas todavía.</p>;
  return <div className="stack">{rows.map(([k, v]) => (
    <div key={k}><div className="row small" style={{ justifyContent: "space-between" }}><span>{names[k] ?? k}</span><span className="muted">{v}</span></div><div className="hbar" style={{ width: `${(v / total) * 100}%` }} /></div>
  ))}</div>;
}

export default async function Dashboard({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ d?: string }> }) {
  const { slug } = await params;
  const days = (await searchParams).d === "30" ? 30 : 7;
  const r = await requireRestaurant(slug);
  const db = getDb();
  const now = new Date();
  const [cur, prev, bundle] = await Promise.all([
    insights(db, r.id, r.timezone, days, now),
    insights(db, r.id, r.timezone, days, new Date(now.getTime() - days * 86_400_000)),
    loadBundle(db, r),
  ]);
  const alerts = alertsFor(cur, prev);
  const checklist = goLiveChecklist(bundle);
  const pending = checklist.filter((c) => !c.done);
  const maxHour = Math.max(1, ...cur.byHour);
  // Sin llamadas en el periodo anterior no hay con qué comparar.
  const had = prev.totalCalls > 0;
  const saved = cur.minutesSaved < 60 ? `${cur.minutesSaved} min` : `${Math.round(cur.minutesSaved / 6) / 10} h`;
  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>Inicio</h1>
        <div className="row small">
          <Link className="btn" href={`/r/${slug}?d=7`}>7 días</Link><Link className="btn" href={`/r/${slug}?d=30`}>30 días</Link>
          <a className="btn" href={`/api/r/${slug}/export?type=calls&days=${days}`}>Descargar llamadas (CSV)</a>
        </div>
      </div>

      {pending.length > 0 && (
        <div className="card alert warn" style={{ marginBottom: 16 }}>
          <h3>Para que Casia conteste en vivo te falta:</h3>
          <ul className="small">{pending.map((c) => <li key={c.key}>{c.label}</li>)}</ul>
          <Link href={`/r/${slug}/settings`}>Ir a Ajustes</Link> · <Link href={`/r/${slug}/menu`}>Cargar menú</Link>
        </div>
      )}
      {alerts.map((a) => <div key={a.text} className={`card alert ${a.level === "warn" ? "warn" : ""}`} style={{ marginBottom: 12 }}>{a.text}</div>)}

      <div className="grid">
        <Stat n={cur.totalCalls} l="Llamadas" cur={cur.totalCalls} prev={prev.totalCalls} />
        <Stat n={pct(cur.answerRate)} l="Contestadas" cur={cur.answerRate} prev={had ? prev.answerRate : null} isPct />
        <Stat n={cur.totalCalls - cur.answered} l="Colgaron sin hablar" />
        <Stat n={pct(cur.satisfaction)} l="Satisfacción" cur={cur.satisfaction} prev={had ? prev.satisfaction : null} isPct />
        <Stat n={pct(cur.automationRate)} l="Resueltas solo por Casia" cur={cur.automationRate} prev={had ? prev.automationRate : null} isPct />
        <Stat n={saved} l="Tiempo liberado al staff" />
        <Stat n={usd(cur.ordersRevenueCents)} l={`Ventas por teléfono (${cur.ordersCount} pedidos)`} cur={cur.ordersRevenueCents} prev={prev.ordersRevenueCents} />
        <Stat n={cur.reservationsCount} l={`Reservas por teléfono (${cur.covers} personas)`} cur={cur.reservationsCount} prev={prev.reservationsCount} />
        <Stat n={cur.afterHours} l="Atendidas fuera de horario" />
        <Stat n={`${cur.transferred} / ${cur.messages}`} l="Transferidas / recados" />
        <Stat n={`${cur.newCallers} / ${cur.returningCallers}`} l="Nuevos / recurrentes" />
      </div>

      <div className="grid2" style={{ marginTop: 16 }}>
        <div className="card"><h3>Temas de llamada</h3><Breakdown data={cur.byTopic} names={TOPIC} /></div>
        <div className="card"><h3>Idiomas</h3><Breakdown data={cur.byLanguage} names={LANG} /></div>
        <div className="card">
          <h3>Llamadas por hora</h3>
          <div className="bars">{cur.byHour.map((v, h) => <div key={h} title={`${h}:00 · ${v} llamadas · ${cur.transfersByHour[h]} transferidas`} style={{ height: `${(v / maxHour) * 100}%` }} />)}</div>
          <div className="row small muted" style={{ justifyContent: "space-between" }}><span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>11pm</span></div>
        </div>
      </div>
    </>
  );
}
