"use server";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { restaurants, users } from "@/db/schema";
import { endSession, startSession } from "@/lib/auth";

export async function login(form: FormData) {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const db = getDb();
  const [u] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!u || !(await bcrypt.compare(password, u.passwordHash))) redirect("/login?e=1");
  const [r] = await db.select({ slug: restaurants.slug }).from(restaurants).where(eq(restaurants.id, u.restaurantId)).limit(1);
  await startSession(u.id, u.restaurantId);
  redirect(`/r/${r.slug}`);
}

export async function logout() {
  await endSession();
  redirect("/login");
}
