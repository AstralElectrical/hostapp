"use server";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { restaurants, transferRules, users } from "@/db/schema";
import { startSession } from "@/lib/auth";
import { toE164 } from "@/lib/phone";

// Alta de restaurante. Protegida con SIGNUP_INVITE_CODE mientras sea piloto.
export async function signup(form: FormData) {
  const invite = process.env.SIGNUP_INVITE_CODE;
  if (!invite || String(form.get("invite") ?? "").trim() !== invite) redirect("/signup?e=closed");
  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (password.length < 8) redirect("/signup?e=short");
  const phone = toE164(String(form.get("phone") ?? ""));
  const slug = name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "restaurante";
  const db = getDb();
  let ids: { uid: string; rid: string } | null = null;
  try {
    ids = await db.transaction(async (tx) => {
      const [r] = await tx.insert(restaurants).values({ slug, name, ownerName: String(form.get("owner") ?? ""), ownerPhone: phone, ownerEmail: email }).returning();
      await tx.insert(transferRules).values([
        { restaurantId: r.id, reason: "human", label: "the manager", targetPhone: phone },
        { restaurantId: r.id, reason: "order_problem", label: "the manager", targetPhone: phone },
        { restaurantId: r.id, reason: "catering", label: "the manager", targetPhone: phone },
        { restaurantId: r.id, reason: "employment", label: "the hiring manager", targetEmail: email },
      ]);
      const [u] = await tx.insert(users).values({ restaurantId: r.id, email, name: String(form.get("owner") ?? ""), passwordHash: await bcrypt.hash(password, 10) }).returning();
      return { uid: u.id, rid: r.id };
    });
  } catch {
    redirect("/signup?e=taken");
  }
  await startSession(ids!.uid, ids!.rid);
  redirect(`/r/${slug}/settings?welcome=1`);
}
