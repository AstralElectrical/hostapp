import { getDb } from "@/db";
import { hoursExceptions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireRestaurant } from "@/lib/auth";
import { REASONS } from "@/lib/services/messages";
import { goLiveChecklist, loadBundle } from "@/lib/services/restaurant";
import { firstMessage } from "@/lib/casia/prompt";
import { appUrl } from "@/lib/stripe";
import { addException, addKnowledge, deleteException, deleteKnowledge, saveHours, saveProfile, saveRules, saveTransfer, setLive } from "../actions";

const DAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const hhmm = (m: number) => { const x = m % 1440; return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`; };

export default async function Settings({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ welcome?: string; e?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const r = await requireRestaurant(slug);
  const db = getDb();
  const b = await loadBundle(db, r);
  const ex = await db.select().from(hoursExceptions).where(eq(hoursExceptions.restaurantId, r.id));
  const checklist = goLiveChecklist(b);
  const ready = checklist.every((c) => c.done);
  const H = <input type="hidden" name="slug" value={slug} />;
  const links = Object.entries(r.links ?? {}).map(([k, v]) => `${k}: ${v}`).join("\n");
  return (
    <>
      <h1>Ajustes</h1>
      {sp.welcome && <div className="card" style={{ marginBottom: 16 }}>¡Bienvenido! Completa estos pasos y carga tu menú; luego activa a Casia.</div>}

      <div className="card stack">
        <h3>Lista para salir en vivo</h3>
        {checklist.map((c) => <div key={c.key} className="small">{c.done ? "✅" : "⬜️"} {c.label}</div>)}
        {sp.e === "checklist" && <p className="chip bad">Termina la lista antes de activar.</p>}
        <form action={setLive} className="row">{H}<input type="hidden" name="live" value={r.live ? "0" : "1"} />
          <button className={r.live ? "danger" : "primary"} disabled={!r.live && !ready}>{r.live ? "Pausar a Casia" : "Activar a Casia"}</button>
          <span className="small muted">Saludo: “{firstMessage(b)}”</span>
        </form>
      </div>

      <h2>Restaurante, voz y avisos</h2>
      <form action={saveProfile} className="card grid2">{H}
        <label>Nombre<input name="name" defaultValue={r.name} /></label>
        <label>Teléfono del restaurante<input name="phone" defaultValue={r.phone ?? ""} /></label>
        <label>Dirección<input name="address" defaultValue={r.address ?? ""} /></label>
        <label>Zona horaria<select name="timezone" defaultValue={r.timezone}>{["America/Los_Angeles", "America/Denver", "America/Phoenix", "America/Chicago", "America/New_York"].map((z) => <option key={z}>{z}</option>)}</select></label>
        <label>Nombre de la voz (sale en el saludo)<input name="voiceName" defaultValue={r.voiceName} /></label>
        <label>Saludo en inglés (debe decir el nombre de la voz)<input name="greetingEn" defaultValue={r.greetingEn ?? ""} placeholder={`Thanks for calling ${r.name}, this is ${r.voiceName}. How can I help you?`} /></label>
        <label>Frase en español<input name="greetingEs" defaultValue={r.greetingEs ?? ""} placeholder="Para español, solo hable en español." /></label>
        <label>Nombre del dueño<input name="ownerName" defaultValue={r.ownerName ?? ""} /></label>
        <label>Celular del dueño (recados por SMS)<input name="ownerPhone" defaultValue={r.ownerPhone ?? ""} /></label>
        <label>Correo del dueño<input name="ownerEmail" defaultValue={r.ownerEmail ?? ""} /></label>
        <label>Cuenta de Stripe conectada (acct_…)<input name="stripeAccountId" defaultValue={r.stripeAccountId ?? ""} /></label>
        <label>Enlaces que Casia puede mandar por SMS (uno por línea: menu: https://…)<textarea name="links" defaultValue={links} /></label>
        <div><button className="primary">Guardar</button></div>
      </form>

      <h2>Horario (la única fuente de verdad)</h2>
      <form action={saveHours} className="card stack">{H}
        <p className="small muted">Ejemplos: 11:00-21:00 · 11:00-15:00, 17:00-22:00 · 17:00-02:00 · vacío = cerrado</p>
        {DAYS.map((d, wd) => (
          <label key={wd} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}><span style={{ width: 90 }}>{d}</span>
            <input name={`d${wd}`} defaultValue={b.hours.filter((h) => h.weekday === wd).map((h) => `${hhmm(h.opens)}-${hhmm(h.closes)}`).join(", ")} /></label>
        ))}
        <div><button className="primary">Guardar horario</button></div>
      </form>
      <div className="card stack" style={{ marginTop: 12 }}>
        <h3>Días cerrados especiales</h3>
        {ex.map((e) => <form key={e.id} action={deleteException} className="row small">{H}<input type="hidden" name="id" value={e.id} />{String(e.day)} {e.note} <button className="danger">Quitar</button></form>)}
        <form action={addException} className="row">{H}<input type="date" name="day" required /><input name="note" placeholder="Navidad" /><button>Agregar</button></form>
      </div>

      <h2>Info del restaurante (lo que Casia contesta)</h2>
      <div className="card stack">
        {b.knowledge.length === 0 && <p className="small muted">Agrega: parking, accesibilidad, formas de pago, catering, gift cards, política de mascotas, happy hour…</p>}
        {(await db.query.knowledgeItems.findMany({ where: (k, { eq }) => eq(k.restaurantId, r.id) })).map((k) => (
          <form key={k.id} action={deleteKnowledge} className="row small">{H}<input type="hidden" name="id" value={k.id} /><b>{k.topic}:</b> {k.answer} <button className="danger">Quitar</button></form>
        ))}
        <form action={addKnowledge} className="row">{H}<input name="topic" placeholder="Tema (Parking)" required /><input name="answer" placeholder="Respuesta" required style={{ flex: 1 }} /><button>Agregar</button></form>
      </div>

      <h2>Transferencias y recados</h2>
      <div className="card stack">
        <p className="small muted">Casia SIEMPRE toma el recado primero y te manda SMS. Si está abierto y hay número, además transfiere la llamada en vivo.</p>
        {Object.entries(REASONS).filter(([k]) => k !== "large_party").map(([reason, label]) => {
          const t = b.transfers.find((x) => x.reason === reason);
          return (
            <form key={reason} action={saveTransfer} className="row small">{H}<input type="hidden" name="reason" value={reason} />
              <span style={{ width: 190 }}>{label}</span>
              <input name="label" defaultValue={t?.label ?? "the manager"} placeholder="Cómo lo dice Casia (the manager)" />
              <input name="targetPhone" defaultValue={t?.targetPhone ?? ""} placeholder="Teléfono" />
              <input name="targetEmail" defaultValue={t?.targetEmail ?? ""} placeholder="Correo" />
              <button>Guardar</button>
            </form>
          );
        })}
      </div>

      <h2>Pedidos y reservas</h2>
      <form action={saveRules} className="card grid2">{H}
        <div className="stack">
          <h3>Pedidos</h3>
          <label style={{ flexDirection: "row" }}><input type="checkbox" name="ordersEnabled" defaultChecked={r.ordersEnabled} /> Tomar pedidos por teléfono</label>
          <label style={{ flexDirection: "row" }}><input type="checkbox" name="pickupEnabled" defaultChecked={r.pickupEnabled} /> Para recoger</label>
          <label style={{ flexDirection: "row" }}><input type="checkbox" name="deliveryEnabled" defaultChecked={r.deliveryEnabled} /> A domicilio</label>
          <label>Cargo por entrega ($)<input name="deliveryFee" defaultValue={(r.deliveryFeeCents / 100).toFixed(2)} /></label>
          <label style={{ flexDirection: "row" }}><input type="checkbox" name="payAtPickupAllowed" defaultChecked={r.payAtPickupAllowed} /> Permitir pagar al recoger</label>
          <label>Minutos de preparación<input name="prepMinutes" type="number" defaultValue={r.prepMinutes} /></label>
          <label>Impuesto (%)<input name="taxRate" defaultValue={(r.taxRateBps / 100).toFixed(2)} /></label>
        </div>
        <div className="stack">
          <h3>Reservas</h3>
          <label style={{ flexDirection: "row" }}><input type="checkbox" name="reservationsEnabled" defaultChecked={r.reservationsEnabled} /> Tomar reservas por teléfono</label>
          <label>Personas sentadas a la vez (capacidad)<input name="capacityCovers" type="number" defaultValue={r.capacityCovers} /></label>
          <label>Minutos que dura una mesa<input name="turnMinutes" type="number" defaultValue={r.turnMinutes} /></label>
          <label>Ofrecer horarios cada (min)<input name="slotMinutes" type="number" defaultValue={r.slotMinutes} /></label>
          <label>Última reserva antes de cerrar (min)<input name="lastSeatingMinutes" type="number" defaultValue={r.lastSeatingMinutes} /></label>
          <label>Grupo máximo sin aprobación<input name="maxPartyAuto" type="number" defaultValue={r.maxPartyAuto} /></label>
          <label>Pedir depósito desde (personas)<input name="depositPartyMin" type="number" defaultValue={r.depositPartyMin} /></label>
          <label>Depósito por persona ($, 0 = sin depósito)<input name="depositPerPerson" defaultValue={(r.depositPerPersonCents / 100).toFixed(2)} /></label>
          <label>Tolerancia por llegar tarde (min)<input name="lateGraceMinutes" type="number" defaultValue={r.lateGraceMinutes} /></label>
        </div>
        <div><button className="primary">Guardar reglas</button></div>
      </form>

      <h2>Conexión con Vapi (técnico)</h2>
      <div className="card small stack">
        <div>Custom LLM URL: <code>{appUrl()}/api/voice/{slug}/&lt;VOICE_WEBHOOK_SECRET&gt;/chat/completions</code></div>
        <div>Server URL (fin de llamada): <code>{appUrl()}/api/voice/{slug}/&lt;VOICE_WEBHOOK_SECRET&gt;/events</code></div>
        <div className="muted">Lo configura el script <code>npm run vapi:setup</code> (ver README).</div>
      </div>
    </>
  );
}
