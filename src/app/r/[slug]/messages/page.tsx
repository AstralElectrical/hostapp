import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { messages } from "@/db/schema";
import { requireRestaurant } from "@/lib/auth";
import { prettyPhone } from "@/lib/phone";
import { REASONS } from "@/lib/services/messages";
import { setMessageStatus } from "../actions";

// Recados y callbacks: lo que Casia tomó cuando no se pudo (o no se debía) transferir. Nadie se queda sin respuesta.
export default async function Messages({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ all?: string }> }) {
  const { slug } = await params;
  const all = (await searchParams).all === "1";
  const r = await requireRestaurant(slug);
  const rows = await getDb().select().from(messages).where(all ? eq(messages.restaurantId, r.id) : and(eq(messages.restaurantId, r.id), eq(messages.status, "open"))).orderBy(desc(messages.createdAt)).limit(200);
  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>Recados {all ? "" : "pendientes"}</h1>
        <div className="row"><a className="btn" href={`/r/${slug}/messages${all ? "" : "?all=1"}`}>{all ? "Solo pendientes" : "Ver todos"}</a><a className="btn" href={`/api/r/${slug}/export?type=messages&days=90`}>CSV</a></div>
      </div>
      <div className="stack">
        {rows.map((m) => (
          <div key={m.id} className="card row" style={{ justifyContent: "space-between" }}>
            <div>
              <div><b>{m.name ?? "Cliente"}</b> · <a href={`tel:${m.phone}`}>{prettyPhone(m.phone)}</a> · <span className="chip">{REASONS[m.reason] ?? m.reason}</span></div>
              <div>{m.body}</div>
              <div className="small muted">{new Intl.DateTimeFormat("es-MX", { timeZone: r.timezone, dateStyle: "short", timeStyle: "short" }).format(m.createdAt)} {m.notifiedAt ? "· te avisamos por SMS" : ""}</div>
            </div>
            <form action={setMessageStatus}>
              <input type="hidden" name="slug" value={slug} /><input type="hidden" name="id" value={m.id} /><input type="hidden" name="status" value={m.status === "open" ? "done" : "open"} />
              <button className={m.status === "open" ? "primary" : ""}>{m.status === "open" ? "Ya le llamé" : "Reabrir"}</button>
            </form>
          </div>
        ))}
        {!rows.length && <p className="muted">No hay recados pendientes. 🎉</p>}
      </div>
    </>
  );
}
