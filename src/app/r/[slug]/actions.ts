"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { businessHours, hoursExceptions, knowledgeItems, menuItems, messages, reservations, restaurants, transferRules, type Modifier } from "@/db/schema";
import { requireRestaurant } from "@/lib/auth";
import { toE164 } from "@/lib/phone";
import { book } from "@/lib/services/reservations";
import { goLiveChecklist, loadBundle } from "@/lib/services/restaurant";
import type { ImportedItem } from "@/lib/services/menu-import";

// Acciones del panel del dueño. Cada una verifica que el restaurante sea del usuario (requireRestaurant).
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const int = (f: FormData, k: string, d = 0) => { const n = Math.round(Number(f.get(k))); return Number.isFinite(n) ? n : d; };
const cents = (f: FormData, k: string) => Math.max(0, Math.round(Number(String(f.get(k) ?? "0").replace(/[$,]/g, "")) * 100) || 0);
const bool = (f: FormData, k: string) => f.get(k) === "on";

async function ctx(form: FormData) {
  const slug = str(form, "slug");
  const r = await requireRestaurant(slug);
  return { r, db: getDb(), slug };
}

// ---------- Recados ----------
export async function setMessageStatus(form: FormData) {
  const { r, db, slug } = await ctx(form);
  await db.update(messages).set({ status: str(form, "status") === "open" ? "open" : "done" }).where(and(eq(messages.id, str(form, "id")), eq(messages.restaurantId, r.id)));
  revalidatePath(`/r/${slug}/messages`);
}

// ---------- Reservas ----------
export async function staffReservation(form: FormData) {
  const { r, db, slug } = await ctx(form);
  const bundle = await loadBundle(db, r);
  const [h, m] = str(form, "time").split(":").map(Number);
  const res = await book(db, { restaurant: r, hours: bundle.hours, exceptions: bundle.exceptions }, {
    ymd: str(form, "date"), minutes: h * 60 + m, party: int(form, "party", 2), name: str(form, "name"), phone: str(form, "phone") || null, notes: str(form, "notes") || null, source: "staff",
  });
  redirect(`/r/${slug}/reservations?day=${str(form, "date")}${res.ok ? "" : "&e=full"}`);
}

export async function setReservationStatus(form: FormData) {
  const { r, db, slug } = await ctx(form);
  const status = str(form, "status");
  if (!["confirmed", "seated", "completed", "no_show", "cancelled"].includes(status)) return;
  await db.update(reservations).set({ status }).where(and(eq(reservations.id, str(form, "id")), eq(reservations.restaurantId, r.id)));
  revalidatePath(`/r/${slug}/reservations`);
}

// ---------- Menú ----------
function parseMods(s: string): Modifier[] {
  // "Add cheese +0.75; Extra salsa" → [{name, priceCents}]
  return s.split(";").map((x) => x.trim()).filter(Boolean).map((x) => {
    const m = /^(.*?)(?:\s*\+\s*\$?([\d.]+))?$/.exec(x)!;
    return { name: m[1].trim(), priceCents: m[2] ? Math.round(Number(m[2]) * 100) : 0 };
  });
}
const list = (s: string) => s.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);

export async function saveMenuItem(form: FormData) {
  const { r, db, slug } = await ctx(form);
  const id = str(form, "id");
  const values = {
    category: str(form, "category") || "Menu", name: str(form, "name"), nameEs: str(form, "nameEs") || null, description: str(form, "description") || null,
    priceCents: cents(form, "price"), tags: list(str(form, "tags")), allergens: list(str(form, "allergens")), modifiers: parseMods(str(form, "modifiers")),
  };
  if (!values.name || !values.priceCents) return;
  if (id) await db.update(menuItems).set(values).where(and(eq(menuItems.id, id), eq(menuItems.restaurantId, r.id)));
  else await db.insert(menuItems).values({ ...values, restaurantId: r.id });
  revalidatePath(`/r/${slug}/menu`);
}

export async function toggleMenuItem(form: FormData) {
  const { r, db, slug } = await ctx(form);
  await db.update(menuItems).set({ available: str(form, "available") === "1" }).where(and(eq(menuItems.id, str(form, "id")), eq(menuItems.restaurantId, r.id)));
  revalidatePath(`/r/${slug}/menu`);
}

export async function deleteMenuItem(form: FormData) {
  const { r, db, slug } = await ctx(form);
  await db.delete(menuItems).where(and(eq(menuItems.id, str(form, "id")), eq(menuItems.restaurantId, r.id)));
  revalidatePath(`/r/${slug}/menu`);
}

export async function saveImportedMenu(slug: string, items: ImportedItem[], replace: boolean) {
  const r = await requireRestaurant(slug);
  const db = getDb();
  const clean = items.filter((i) => i.name && i.priceCents > 0).slice(0, 500);
  await db.transaction(async (tx) => {
    if (replace) await tx.delete(menuItems).where(eq(menuItems.restaurantId, r.id));
    if (clean.length) await tx.insert(menuItems).values(clean.map((i, n) => ({
      restaurantId: r.id, category: i.category || "Menu", name: i.name, nameEs: i.nameEs ?? null, description: i.description ?? null, priceCents: Math.round(i.priceCents),
      tags: i.tags ?? [], allergens: i.allergens ?? [], modifiers: i.modifiers ?? [], sort: n,
    })));
  });
  revalidatePath(`/r/${slug}/menu`);
  return { saved: clean.length };
}

// ---------- Ajustes ----------
export async function saveProfile(form: FormData) {
  const { r, db, slug } = await ctx(form);
  const links: Record<string, string> = {};
  for (const line of str(form, "links").split("\n")) {
    const m = /^\s*([\w -]+?)\s*[:=]\s*(https?:\/\/\S+)\s*$/.exec(line);
    if (m) links[m[1].toLowerCase().replace(/\s+/g, "_")] = m[2];
  }
  await db.update(restaurants).set({
    name: str(form, "name") || r.name, phone: str(form, "phone") || null, address: str(form, "address") || null, timezone: str(form, "timezone") || r.timezone,
    voiceName: str(form, "voiceName") || "Casia", greetingEn: str(form, "greetingEn") || null, greetingEs: str(form, "greetingEs") || null,
    ownerName: str(form, "ownerName") || null, ownerPhone: toE164(str(form, "ownerPhone")), ownerEmail: str(form, "ownerEmail") || null,
    links, stripeAccountId: str(form, "stripeAccountId") || null,
  }).where(eq(restaurants.id, r.id));
  revalidatePath(`/r/${slug}`, "layout");
}

export async function saveRules(form: FormData) {
  const { r, db, slug } = await ctx(form);
  await db.update(restaurants).set({
    ordersEnabled: bool(form, "ordersEnabled"), pickupEnabled: bool(form, "pickupEnabled"), deliveryEnabled: bool(form, "deliveryEnabled"),
    deliveryFeeCents: cents(form, "deliveryFee"), payAtPickupAllowed: bool(form, "payAtPickupAllowed"), prepMinutes: int(form, "prepMinutes", 20), taxRateBps: Math.round(Number(form.get("taxRate")) * 100) || 0,
    reservationsEnabled: bool(form, "reservationsEnabled"), capacityCovers: int(form, "capacityCovers", 40), turnMinutes: int(form, "turnMinutes", 90), slotMinutes: int(form, "slotMinutes", 30),
    maxPartyAuto: int(form, "maxPartyAuto", 8), depositPartyMin: int(form, "depositPartyMin", 6), depositPerPersonCents: cents(form, "depositPerPerson"),
    lastSeatingMinutes: int(form, "lastSeatingMinutes", 60), lateGraceMinutes: int(form, "lateGraceMinutes", 15),
  }).where(eq(restaurants.id, r.id));
  revalidatePath(`/r/${slug}/settings`);
}

/** Horario: una línea por día, "11:00-21:00" o "11:00-15:00, 17:00-22:00" o "cerrado". Cruce de medianoche: "17:00-02:00". */
export async function saveHours(form: FormData) {
  const { r, db, slug } = await ctx(form);
  const rows: { restaurantId: string; weekday: number; opens: number; closes: number }[] = [];
  const toMin = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + (m || 0); };
  for (let wd = 0; wd < 7; wd++) {
    for (const part of str(form, `d${wd}`).split(",")) {
      const m = /^(\d{1,2}(?::\d{2})?)\s*-\s*(\d{1,2}(?::\d{2})?)$/.exec(part.trim());
      if (!m) continue;
      const opens = toMin(m[1]); let closes = toMin(m[2]);
      if (closes <= opens) closes += 1440;
      rows.push({ restaurantId: r.id, weekday: wd, opens, closes });
    }
  }
  await db.transaction(async (tx) => {
    await tx.delete(businessHours).where(eq(businessHours.restaurantId, r.id));
    if (rows.length) await tx.insert(businessHours).values(rows);
  });
  revalidatePath(`/r/${slug}/settings`);
}

export async function addException(form: FormData) {
  const { r, db, slug } = await ctx(form);
  const day = str(form, "day");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
  await db.insert(hoursExceptions).values({ restaurantId: r.id, day, closed: true, note: str(form, "note") || null }).onConflictDoNothing();
  revalidatePath(`/r/${slug}/settings`);
}

export async function deleteException(form: FormData) {
  const { r, db, slug } = await ctx(form);
  await db.delete(hoursExceptions).where(and(eq(hoursExceptions.id, str(form, "id")), eq(hoursExceptions.restaurantId, r.id)));
  revalidatePath(`/r/${slug}/settings`);
}

export async function addKnowledge(form: FormData) {
  const { r, db, slug } = await ctx(form);
  if (!str(form, "topic") || !str(form, "answer")) return;
  await db.insert(knowledgeItems).values({ restaurantId: r.id, topic: str(form, "topic"), answer: str(form, "answer") });
  revalidatePath(`/r/${slug}/settings`);
}

export async function deleteKnowledge(form: FormData) {
  const { r, db, slug } = await ctx(form);
  await db.delete(knowledgeItems).where(and(eq(knowledgeItems.id, str(form, "id")), eq(knowledgeItems.restaurantId, r.id)));
  revalidatePath(`/r/${slug}/settings`);
}

export async function saveTransfer(form: FormData) {
  const { r, db, slug } = await ctx(form);
  const reason = str(form, "reason");
  const values = { label: str(form, "label") || "the manager", targetPhone: toE164(str(form, "targetPhone")), targetEmail: str(form, "targetEmail") || null };
  await db.insert(transferRules).values({ restaurantId: r.id, reason, ...values }).onConflictDoUpdate({ target: [transferRules.restaurantId, transferRules.reason], set: values });
  revalidatePath(`/r/${slug}/settings`);
}

export async function setLive(form: FormData) {
  const { r, db, slug } = await ctx(form);
  const want = str(form, "live") === "1";
  if (want && goLiveChecklist(await loadBundle(db, r)).some((c) => !c.done)) redirect(`/r/${slug}/settings?e=checklist`);
  await db.update(restaurants).set({ live: want }).where(eq(restaurants.id, r.id));
  revalidatePath(`/r/${slug}`, "layout");
}
