import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { jwtVerify, SignJWT } from "jose";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { restaurants, users, type Restaurant } from "@/db/schema";

// Sesión del dueño: cookie firmada (JWT) con el usuario y su restaurante. Sin terceros.
const COOKIE = "hostapp_session";
const key = () => {
  const secret = process.env.AUTH_SECRET;
  if (!secret && process.env.NODE_ENV === "production") throw new Error("Falta AUTH_SECRET");
  return new TextEncoder().encode(secret || "dev-only-secret-change-me");
};

export async function startSession(userId: string, restaurantId: string) {
  const token = await new SignJWT({ rid: restaurantId }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setExpirationTime("30d").sign(key());
  (await cookies()).set(COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
}

export async function endSession() {
  (await cookies()).delete(COOKIE);
}

export async function session(): Promise<{ userId: string; restaurantId: string } | null> {
  const t = (await cookies()).get(COOKIE)?.value;
  if (!t) return null;
  try {
    const { payload } = await jwtVerify(t, key());
    return payload.sub && typeof payload.rid === "string" ? { userId: payload.sub, restaurantId: payload.rid } : null;
  } catch {
    return null;
  }
}

/** Para páginas y acciones: el restaurante del slug, solo si es del usuario. */
export async function requireRestaurant(slug: string): Promise<Restaurant> {
  const s = await session();
  if (!s) redirect("/login");
  const db = getDb();
  const [r] = await db.select().from(restaurants).where(eq(restaurants.slug, slug)).limit(1);
  if (!r || r.id !== s.restaurantId) redirect("/login");
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, s.userId)).limit(1);
  if (!u) redirect("/login");
  return r;
}

/** Para rutas API: null si no hay acceso. */
export async function apiRestaurant(slug: string): Promise<Restaurant | null> {
  const s = await session();
  if (!s) return null;
  const [r] = await getDb().select().from(restaurants).where(eq(restaurants.slug, slug)).limit(1);
  return r && r.id === s.restaurantId ? r : null;
}
