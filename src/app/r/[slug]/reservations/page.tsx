import Link from "next/link";
import { and, asc, eq, gte, lt } from "drizzle-orm";
import { getDb } from "@/db";
import { reservations, waitlist } from "@/db/schema";
import { requireRestaurant } from "@/lib/auth";
import { RESV_STATUS } from "@/lib/labels";
import { usd } from "@/lib/money";
import { prettyPhone } from "@/lib/phone";
import { addDays, dayName, localParts, zonedToUtc, fmtMinutes } from "@/lib/time";
import { setReservationStatus, staffReservation } from "../actions";

// Libro de reservas del día: lo que reservó Casia + lo que agrega el staff. Aprobar grupos grandes, sentar, no-show.
export default async function Reservations({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ day?: string; e?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const r = await requireRestaurant(slug);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(sp.day ?? "") ? sp.day! : localParts(new Date(), r.timezone).ymd;
  const from = zonedToUtc(day, 0, r.timezone), to = zonedToUtc(addDays(day, 1), 0, r.timezone);
  const db = getDb();
  const [rows, wl] = await Promise.all([
    db.select().from(reservations).where(and(eq(reservations.restaurantId, r.id), gte(reservations.startsAt, from), lt(reservations.startsAt, to))).orderBy(asc(reservations.startsAt)),
    db.select().from(waitlist).where(and(eq(waitlist.restaurantId, r.id), gte(waitlist.wantedAt, from), lt(waitlist.wantedAt, to))).orderBy(asc(waitlist.wantedAt)),
  ]);
  const active = rows.filter((x) => !["cancelled", "no_show"].includes(x.status));
  const covers = active.reduce((a, x) => a + x.partySize, 0);
  const Btn = ({ id, status, label }: { id: string; status: string; label: string }) => (
    <form action={setReservationStatus}><input type="hidden" name="slug" value={slug} /><input type="hidden" name="id" value={id} /><input type="hidden" name="status" value={status} /><button className="small">{label}</button></form>
  );
  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>Reservas · {dayName(day, "es")} {day}</h1>
        <div className="row">
          <Link className="btn" href={`/r/${slug}/reservations?day=${addDays(day, -1)}`}>← Día anterior</Link>
          <Link className="btn" href={`/r/${slug}/reservations`}>Hoy</Link>
          <Link className="btn" href={`/r/${slug}/reservations?day=${addDays(day, 1)}`}>Día siguiente →</Link>
          <a className="btn" href={`/api/r/${slug}/export?type=reservations&days=90`}>CSV</a>
        </div>
      </div>
      <p className="muted">{active.length} reservas · {covers} personas · capacidad {r.capacityCovers} a la vez</p>
      {sp.e === "full" && <p className="chip bad">Ese horario está lleno o fuera de horario.</p>}
      <table>
        <thead><tr><th>Hora</th><th>Nombre</th><th>Personas</th><th>Estado</th><th>Notas</th><th></th></tr></thead>
        <tbody>{rows.map((x) => (
          <tr key={x.id}>
            <td><b>{fmtMinutes(localParts(x.startsAt, r.timezone).minutes)}</b><div className="small muted">{x.code}</div></td>
            <td>{x.name}<div className="small muted">{prettyPhone(x.phone)} · {x.source === "phone" ? "por Casia" : "staff"}</div></td>
            <td>{x.partySize}</td>
            <td><span className={`chip ${RESV_STATUS[x.status]?.[1] ?? ""}`}>{RESV_STATUS[x.status]?.[0] ?? x.status}</span>
              {x.depositCents > 0 && <div className="small">Depósito {usd(x.depositCents)} {x.depositPaidAt ? "pagado" : "pendiente"}</div>}
              {x.runningLateMinutes && <div className="small" style={{ color: "var(--warn)" }}>Llega {x.runningLateMinutes} min tarde</div>}</td>
            <td className="small">{x.notes}</td>
            <td><div className="row">
              {x.status === "needs_approval" && <Btn id={x.id} status="confirmed" label="Aprobar" />}
              {["confirmed", "awaiting_deposit"].includes(x.status) && <Btn id={x.id} status="seated" label="Sentar" />}
              {x.status === "seated" && <Btn id={x.id} status="completed" label="Terminó" />}
              {["confirmed", "awaiting_deposit"].includes(x.status) && <Btn id={x.id} status="no_show" label="No llegó" />}
              {!["cancelled", "completed", "no_show"].includes(x.status) && <Btn id={x.id} status="cancelled" label="Cancelar" />}
            </div></td>
          </tr>))}
          {!rows.length && <tr><td colSpan={6} className="muted">Sin reservas este día.</td></tr>}
        </tbody>
      </table>

      {wl.length > 0 && (<><h2>Lista de espera</h2>
        <table><tbody>{wl.map((w) => <tr key={w.id}><td>{fmtMinutes(localParts(w.wantedAt, r.timezone).minutes)}</td><td>{w.name}</td><td>{w.partySize} personas</td><td>{prettyPhone(w.phone)}</td><td><span className="chip">{w.status === "notified" ? "se le avisó" : "esperando"}</span></td></tr>)}</tbody></table>
      </>)}

      <h2>Agregar reserva</h2>
      <form action={staffReservation} className="card row">
        <input type="hidden" name="slug" value={slug} />
        <label>Fecha<input type="date" name="date" defaultValue={day} required /></label>
        <label>Hora<input type="time" name="time" required /></label>
        <label>Personas<input type="number" name="party" min={1} defaultValue={2} style={{ width: 80 }} /></label>
        <label>Nombre<input name="name" required /></label>
        <label>Teléfono<input name="phone" type="tel" /></label>
        <label>Notas<input name="notes" /></label>
        <button className="primary">Reservar</button>
      </form>
    </>
  );
}
