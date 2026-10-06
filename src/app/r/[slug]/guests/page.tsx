import Link from "next/link";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import { getDb } from "@/db";
import { calls, guests } from "@/db/schema";
import { requireRestaurant } from "@/lib/auth";
import { prettyPhone } from "@/lib/phone";

// CRM de llamantes: una ficha por teléfono con el historial de llamadas y su resumen.
export default async function Guests({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ q?: string }> }) {
  const { slug } = await params;
  const q = ((await searchParams).q ?? "").trim();
  const r = await requireRestaurant(slug);
  const db = getDb();
  const where = q ? and(eq(guests.restaurantId, r.id), or(ilike(guests.name, `%${q}%`), ilike(guests.phone, `%${q.replace(/\D/g, "") || q}%`))) : eq(guests.restaurantId, r.id);
  const list = await db.select().from(guests).where(where).orderBy(desc(guests.lastSeenAt)).limit(100);
  const history = q && list.length === 1 ? await db.select().from(calls).where(eq(calls.guestId, list[0].id)).orderBy(desc(calls.startedAt)).limit(50) : [];
  return (
    <>
      <h1>Clientes</h1>
      <form className="row" style={{ marginBottom: 12 }}><input name="q" defaultValue={q} placeholder="Nombre o teléfono" /><button>Buscar</button></form>
      <table>
        <thead><tr><th>Cliente</th><th>Teléfono</th><th>Llamadas</th><th>Idioma</th><th>Última vez</th></tr></thead>
        <tbody>{list.map((g) => (
          <tr key={g.id}>
            <td><Link href={`/r/${slug}/guests?q=${encodeURIComponent(g.phone)}`}>{g.name ?? "Sin nombre"}</Link></td>
            <td>{prettyPhone(g.phone)}</td><td>{g.callCount}</td><td>{g.language ?? "—"}</td>
            <td className="small">{new Intl.DateTimeFormat("es-MX", { timeZone: r.timezone, dateStyle: "medium" }).format(g.lastSeenAt)}</td>
          </tr>))}
          {!list.length && <tr><td colSpan={5} className="muted">Sin clientes todavía.</td></tr>}
        </tbody>
      </table>
      {history.length > 0 && (<>
        <h2>Historial</h2>
        <div className="stack">{history.map((c) => (
          <div key={c.id} className="card small"><Link href={`/r/${slug}/calls/${c.id}`}>{new Intl.DateTimeFormat("es-MX", { timeZone: r.timezone, dateStyle: "medium", timeStyle: "short" }).format(c.startedAt)}</Link> · {c.topic ?? "—"} · {c.outcome}<div>{c.summary}</div></div>
        ))}</div>
      </>)}
    </>
  );
}
