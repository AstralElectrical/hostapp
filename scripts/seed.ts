// Crea el restaurante DEMO (correo demo@hostapp.local / contraseña demo1234). Uso: DATABASE_URL=… npm run db:seed
import { getDb } from "../src/db";
import { seedDemo } from "../src/lib/seed";

const r = await seedDemo(getDb(), { slug: process.argv[2] ?? "demo" });
console.log(`Listo: /r/${r.slug} · demo@hostapp.local / demo1234`);
process.exit(0);
