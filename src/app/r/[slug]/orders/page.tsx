import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { orders } from "@/db/schema";
import { requireRestaurant } from "@/lib/auth";
import { usd } from "@/lib/money";
import { prettyPhone } from "@/lib/phone";
import { ORDER_STATUS } from "@/lib/labels";


export default async function Orders({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const r = await requireRestaurant(slug);
  const rows = await getDb().select().from(orders).where(eq(orders.restaurantId, r.id)).orderBy(desc(orders.createdAt)).limit(200);
  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>Pedidos</h1>
        <div className="row"><Link className="btn primary" href={`/r/${slug}/kitchen`}>Abrir pantalla de cocina</Link><a className="btn" href={`/api/r/${slug}/export?type=orders&days=90`}>Descargar CSV</a></div>
      </div>
      <table>
        <thead><tr><th>Código</th><th>Cliente</th><th>Platillos</th><th>Total</th><th>Pago</th><th>Estado</th></tr></thead>
        <tbody>{rows.map((o) => (
          <tr key={o.id}>
            <td><b>{o.code}</b><div className="small muted">{new Intl.DateTimeFormat("es-MX", { timeZone: r.timezone, dateStyle: "short", timeStyle: "short" }).format(o.createdAt)}</div></td>
            <td>{o.customerName}<div className="small muted">{prettyPhone(o.customerPhone)}</div>{o.kind === "delivery" && <div className="small">🚗 {o.address}</div>}</td>
            <td className="small">{o.lines.map((l, i) => <div key={i}>{l.qty}× {l.name}{l.modifiers.length ? ` (${l.modifiers.map((m) => m.name).join(", ")})` : ""}{l.notes ? ` — ${l.notes}` : ""}</div>)}</td>
            <td>{usd(o.totalCents)}</td>
            <td className="small">{o.payment === "link" ? (o.paidAt ? "Pagado con link" : "Link enviado") : "Al recoger"}</td>
            <td><span className={`chip ${ORDER_STATUS[o.status]?.[1] ?? ""}`}>{ORDER_STATUS[o.status]?.[0] ?? o.status}</span></td>
          </tr>))}
          {!rows.length && <tr><td colSpan={6} className="muted">Todavía no hay pedidos.</td></tr>}
        </tbody>
      </table>
    </>
  );
}
