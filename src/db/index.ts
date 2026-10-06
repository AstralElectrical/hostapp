import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Conexión única a Postgres (Supabase). En Vercel usa el pooler de Supabase (puerto 6543) → prepare:false.
// Las pruebas inyectan una base en memoria (PGlite) con setDb().

export type Db = ReturnType<typeof drizzle<typeof schema>>;

let db: Db | null = null;

export function getDb(): Db {
  if (db) return db;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL");
  db = drizzle(postgres(url, { prepare: false, max: 5 }), { schema, casing: "snake_case" });
  return db;
}

export function setDb(next: Db | null) {
  db = next;
}

export { schema };
