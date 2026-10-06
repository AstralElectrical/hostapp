import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { calls, guests } from "@/db/schema";
import { requireRestaurant } from "@/lib/auth";
import { prettyPhone } from "@/lib/phone";
import { OUTCOME } from "@/lib/labels";

const fmt = (d: Date, tz: string) => new Intl.DateTimeFormat("es-MX", { timeZone: tz, dateStyle: "short", timeStyle: "short" }).format(d);

export default async function Calls({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const r = await requireRestaurant(slug);
  const rows = await getDb().select({ c: calls, name: guests.name }).from(calls).leftJoin(guests, eq(guests.id, calls.guestId))
    .where(and(eq(calls.restaurantId, r.id), eq(calls.test, false))).orderBy(desc(calls.startedAt)).limit(200);
  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}><h1>Llamadas</h1><a className="btn" href={`/api/r/${slug}/export?type=calls&days=90`}>Descargar CSV</a></div>
      <table>
        <thead><tr><th>Cuándo</th><th>Quién</th><th>Resumen</th><th>Tema</th><th>Resultado</th></tr></thead>
        <tbody>
          {rows.map(({ c, name }) => (
            <tr key={c.id}>
              <td className="small"><Link href={`/r/${slug}/calls/${c.id}`}>{fmt(c.startedAt, r.timezone)}</Link>{c.afterHours && <div className="chip">fuera de horario</div>}</td>
              <td>{name ?? "—"}<div className="small muted">{prettyPhone(c.fromPhone)}</div></td>
              <td className="small">{c.summary ?? <span className="muted">—</span>}</td>
              <td className="small">{c.topic ?? "—"} {c.language && <span className="chip">{c.language}</span>}</td>
              <td><span className={`chip ${OUTCOME[c.outcome ?? ""]?.[1] ?? ""}`}>{OUTCOME[c.outcome ?? ""]?.[0] ?? c.outcome}</span></td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={5} className="muted">Todavía no hay llamadas.</td></tr>}
        </tbody>
      </table>
    </>
  );
}
