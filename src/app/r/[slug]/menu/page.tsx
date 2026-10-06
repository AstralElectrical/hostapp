import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { menuItems, type MenuItem } from "@/db/schema";
import { requireRestaurant } from "@/lib/auth";
import { usd } from "@/lib/money";
import { deleteMenuItem, saveMenuItem, toggleMenuItem } from "../actions";
import MenuImport from "./import";

function ItemForm({ slug, item }: { slug: string; item?: MenuItem }) {
  return (
    <form action={saveMenuItem} className="row small">
      <input type="hidden" name="slug" value={slug} />
      {item && <input type="hidden" name="id" value={item.id} />}
      <input name="category" placeholder="Categoría" defaultValue={item?.category} style={{ width: 110 }} />
      <input name="name" placeholder="Nombre" defaultValue={item?.name} required />
      <input name="nameEs" placeholder="Nombre en español" defaultValue={item?.nameEs ?? ""} />
      <input name="price" placeholder="Precio" defaultValue={item ? (item.priceCents / 100).toFixed(2) : ""} required style={{ width: 80 }} />
      <input name="description" placeholder="Descripción" defaultValue={item?.description ?? ""} style={{ minWidth: 200 }} />
      <input name="tags" placeholder="vegetarian, spicy" defaultValue={item?.tags.join(", ")} />
      <input name="allergens" placeholder="dairy, nuts" defaultValue={item?.allergens.join(", ")} />
      <input name="modifiers" placeholder="Add cheese +0.75; Extra salsa" defaultValue={item?.modifiers.map((m) => `${m.name}${m.priceCents ? ` +${(m.priceCents / 100).toFixed(2)}` : ""}`).join("; ")} style={{ minWidth: 200 }} />
      <button className={item ? "" : "primary"}>{item ? "Guardar" : "Agregar"}</button>
    </form>
  );
}

// Menú inteligente: OBLIGATORIO para salir en vivo. Casia responde platillos, ingredientes y precios desde aquí.
export default async function Menu({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const r = await requireRestaurant(slug);
  const items = await getDb().select().from(menuItems).where(eq(menuItems.restaurantId, r.id)).orderBy(asc(menuItems.category), asc(menuItems.sort), asc(menuItems.name));
  const cats = [...new Set(items.map((i) => i.category))];
  return (
    <>
      <h1>Menú</h1>
      <MenuImport slug={slug} hasItems={items.length > 0} />
      <h2>Agregar platillo</h2>
      <div className="card"><ItemForm slug={slug} /></div>
      {cats.map((c) => (
        <div key={c}>
          <h2>{c}</h2>
          <div className="stack">
            {items.filter((i) => i.category === c).map((i) => (
              <details key={i.id} className="card">
                <summary className="row" style={{ justifyContent: "space-between", cursor: "pointer" }}>
                  <span><b>{i.name}</b>{i.nameEs && <span className="muted"> / {i.nameEs}</span>} · {usd(i.priceCents)} {i.tags.map((t) => <span key={t} className="chip">{t}</span>)} {!i.available && <span className="chip bad">agotado</span>}</span>
                </summary>
                <div className="stack" style={{ marginTop: 10 }}>
                  <ItemForm slug={slug} item={i} />
                  <div className="row">
                    <form action={toggleMenuItem}><input type="hidden" name="slug" value={slug} /><input type="hidden" name="id" value={i.id} /><input type="hidden" name="available" value={i.available ? "0" : "1"} /><button>{i.available ? "Marcar agotado" : "Disponible otra vez"}</button></form>
                    <form action={deleteMenuItem}><input type="hidden" name="slug" value={slug} /><input type="hidden" name="id" value={i.id} /><button className="danger">Borrar</button></form>
                  </div>
                </div>
              </details>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
