import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import * as schema from "@/db/schema";
import type { Db } from "@/db";

/** Postgres real en memoria (PGlite) con las migraciones del repo aplicadas. */
export async function testDb(): Promise<Db> {
  const pg = new PGlite();
  const dir = path.resolve(import.meta.dirname, "../drizzle");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    for (const stmt of readFileSync(path.join(dir, f), "utf8").split("--> statement-breakpoint")) {
      if (stmt.trim()) await pg.exec(stmt);
    }
  }
  return drizzle(pg, { schema, casing: "snake_case" }) as unknown as Db;
}

/** Martes 6 oct 2026, 12:00 PM hora de California. */
export const NOON_TUE = new Date("2026-10-06T19:00:00Z");
