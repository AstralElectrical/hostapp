import Link from "next/link";
import { login } from "./actions";

export default async function Login({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const { e } = await searchParams;
  return (
    <main className="main" style={{ maxWidth: 380, margin: "10vh auto" }}>
      <h1>HostApp</h1>
      <form action={login} className="card stack">
        <label>Correo<input name="email" type="email" required autoComplete="email" /></label>
        <label>Contraseña<input name="password" type="password" required autoComplete="current-password" /></label>
        {e && <p className="chip bad">Correo o contraseña incorrectos.</p>}
        <button className="primary">Entrar</button>
      </form>
      <p className="small muted">¿Restaurante nuevo? <Link href="/signup">Crea tu cuenta</Link></p>
    </main>
  );
}
