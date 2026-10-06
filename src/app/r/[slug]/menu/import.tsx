"use client";
import { useState } from "react";
import type { ImportedItem } from "@/lib/services/menu-import";
import { saveImportedMenu } from "../actions";

// Subir el PDF del menú (o pegar el texto) → Claude lo lee → el dueño revisa y guarda.
export default function MenuImport({ slug, hasItems }: { slug: string; hasItems: boolean }) {
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<ImportedItem[] | null>(null);
  const [msg, setMsg] = useState("");
  async function read(form: FormData) {
    setBusy(true); setMsg(""); setItems(null);
    const res = await fetch(`/api/r/${slug}/menu-import`, { method: "POST", body: form });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMsg(j.error ?? "No se pudo leer el menú.");
    setItems(j.items);
  }
  async function save(replace: boolean) {
    if (!items) return;
    setBusy(true);
    const { saved } = await saveImportedMenu(slug, items, replace);
    setBusy(false); setItems(null); setMsg(`Listo: ${saved} platillos guardados.`);
  }
  return (
    <div className="card stack">
      <h3>{hasItems ? "Volver a cargar el menú" : "Carga tu menú (obligatorio para salir en vivo)"}</h3>
      <form action={read} className="stack">
        <label>PDF del menú<input type="file" name="file" accept="application/pdf" /></label>
        <label>…o pega el texto del menú<textarea name="text" placeholder="Tacos de asada $4.00…" /></label>
        <button className="primary" disabled={busy}>{busy ? "Leyendo…" : "Leer menú"}</button>
      </form>
      {msg && <p className="chip">{msg}</p>}
      {items && (
        <div className="stack">
          <p>Encontré <b>{items.length}</b> platillos. Revisa precios antes de guardar:</p>
          <table><tbody>{items.map((i, n) => (
            <tr key={n}><td className="small muted">{i.category}</td><td>{i.name}{i.nameEs ? ` / ${i.nameEs}` : ""}</td>
              <td><input defaultValue={(i.priceCents / 100).toFixed(2)} style={{ width: 80 }} onChange={(e) => { const v = Math.round(Number(e.target.value) * 100); if (v > 0) items[n].priceCents = v; }} /></td>
              <td className="small">{i.description}</td></tr>))}</tbody></table>
          <div className="row">
            {hasItems && <button onClick={() => save(true)} disabled={busy}>Reemplazar el menú actual</button>}
            <button className="primary" onClick={() => save(false)} disabled={busy}>{hasItems ? "Agregar al menú" : "Guardar menú"}</button>
          </div>
        </div>
      )}
    </div>
  );
}
