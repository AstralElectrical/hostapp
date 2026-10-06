"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Order } from "@/db/schema";

const NEXT: Record<string, [string, string]> = { new: ["preparing", "Empezar"], preparing: ["ready", "Listo"], ready: ["completed", "Entregado"] };

// Pantalla de cocina: se actualiza sola cada 5 s y suena cuando entra un pedido nuevo (ya pagado o pago al recoger).
export default function Kitchen({ slug, tz }: { slug: string; tz: string }) {
  const [list, setList] = useState<Order[]>([]);
  const seen = useRef<Set<string> | null>(null);
  const load = useCallback(async () => {
    const res = await fetch(`/api/r/${slug}/orders`, { cache: "no-store" });
    if (!res.ok) return;
    const { orders } = (await res.json()) as { orders: Order[] };
    if (seen.current && orders.some((o) => !seen.current!.has(o.id))) {
      try { const a = new AudioContext(); const o = a.createOscillator(); o.connect(a.destination); o.start(); o.stop(a.currentTime + 0.25); } catch { /* sin audio */ }
    }
    seen.current = new Set(orders.map((o) => o.id));
    setList(orders);
  }, [slug]);
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [load]);
  async function advance(id: string, status: string) {
    await fetch(`/api/r/${slug}/orders`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, status }) });
    load();
  }
  const time = (d: string | Date | null) => (d ? new Intl.DateTimeFormat("es-MX", { timeZone: tz, timeStyle: "short" }).format(new Date(d)) : "");
  if (!list.length) return <p className="muted">Sin pedidos activos. Esta pantalla se actualiza sola.</p>;
  return (
    <div className="kitchen">
      {list.map((o) => (
        <div key={o.id} className="card stack">
          <div className="row" style={{ justifyContent: "space-between" }}><b style={{ fontSize: 20 }}>{o.code}</b><span className="chip">{o.status === "new" ? "NUEVO" : o.status === "preparing" ? "Preparando" : "Listo"}</span></div>
          <div className="small">{o.customerName} · {o.kind === "delivery" ? "Entrega" : "Recoger"} {time(o.readyAt)} · {o.payment === "at_pickup" ? "cobrar al recoger" : "pagado"}</div>
          <div>{o.lines.map((l, i) => <div key={i}><b>{l.qty}×</b> {l.name}{l.modifiers.length ? ` (${l.modifiers.map((m) => m.name).join(", ")})` : ""}{l.notes && <div className="small">↳ {l.notes}</div>}</div>)}</div>
          {o.notes && <div className="small">Nota: {o.notes}</div>}
          {NEXT[o.status] && <button className="primary" onClick={() => advance(o.id, NEXT[o.status][0])}>{NEXT[o.status][1]}</button>}
        </div>
      ))}
    </div>
  );
}
