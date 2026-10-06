import { signup } from "./actions";

const ERR: Record<string, string> = { taken: "Ese correo o nombre de restaurante ya existe.", short: "La contraseña debe tener al menos 8 caracteres.", closed: "El registro está cerrado. Pide una invitación." };

export default async function Signup({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const { e } = await searchParams;
  return (
    <main className="main" style={{ maxWidth: 440, margin: "8vh auto" }}>
      <h1>Crea tu restaurante en HostApp</h1>
      <form action={signup} className="card stack">
        <label>Nombre del restaurante<input name="name" required /></label>
        <label>Tu nombre<input name="owner" required /></label>
        <label>Tu celular (para avisos y recados)<input name="phone" type="tel" required /></label>
        <label>Correo<input name="email" type="email" required /></label>
        <label>Contraseña<input name="password" type="password" minLength={8} required /></label>
        <label>Código de invitación<input name="invite" /></label>
        {e && <p className="chip bad">{ERR[e] ?? "Revisa los datos."}</p>}
        <button className="primary">Crear</button>
      </form>
    </main>
  );
}
