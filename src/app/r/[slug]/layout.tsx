import Link from "next/link";
import { requireRestaurant } from "@/lib/auth";
import { logout } from "@/app/login/actions";

const NAV = [
  ["", "Inicio"], ["calls", "Llamadas"], ["guests", "Clientes"], ["orders", "Pedidos"], ["kitchen", "Cocina"],
  ["reservations", "Reservas"], ["messages", "Recados"], ["menu", "Menú"], ["test", "Probar a Casia"], ["settings", "Ajustes"],
] as const;

export default async function RestaurantLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const r = await requireRestaurant(slug);
  return (
    <div className="shell">
      <nav className="side">
        <div className="brand">HostApp</div>
        <div className="loc">{r.name} · {r.live ? <span className="chip ok">en vivo</span> : <span className="chip warn">configurando</span>}</div>
        {NAV.map(([p, label]) => <Link key={p} href={`/r/${slug}${p ? `/${p}` : ""}`}>{label}</Link>)}
        <form action={logout} style={{ marginTop: "auto" }}><button className="small">Salir</button></form>
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}
