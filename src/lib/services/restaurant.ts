import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import {
  businessHours, hoursExceptions, knowledgeItems, menuItems, restaurants, transferRules,
  type MenuItem, type Restaurant, type TransferRule,
} from "@/db/schema";
import type { ExceptionRow, HoursRow } from "@/lib/time";

// Todo lo que Casia necesita saber de un restaurante, cargado de una vez por turno.
export type Bundle = {
  restaurant: Restaurant;
  hours: HoursRow[];
  exceptions: ExceptionRow[];
  knowledge: { topic: string; answer: string }[];
  menu: MenuItem[];
  transfers: TransferRule[];
};

export async function getRestaurantBySlug(db: Db, slug: string): Promise<Restaurant | null> {
  const [r] = await db.select().from(restaurants).where(eq(restaurants.slug, slug)).limit(1);
  return r ?? null;
}

export async function loadBundle(db: Db, restaurant: Restaurant): Promise<Bundle> {
  const rid = restaurant.id;
  const [hours, exceptions, knowledge, menu, transfers] = await Promise.all([
    db.select().from(businessHours).where(eq(businessHours.restaurantId, rid)),
    db.select().from(hoursExceptions).where(eq(hoursExceptions.restaurantId, rid)),
    db.select().from(knowledgeItems).where(eq(knowledgeItems.restaurantId, rid)).orderBy(asc(knowledgeItems.topic)),
    db.select().from(menuItems).where(eq(menuItems.restaurantId, rid)).orderBy(asc(menuItems.category), asc(menuItems.sort), asc(menuItems.name)),
    db.select().from(transferRules).where(eq(transferRules.restaurantId, rid)),
  ]);
  return {
    restaurant,
    hours: hours.map((h) => ({ weekday: h.weekday, opens: h.opens, closes: h.closes })),
    exceptions: exceptions.map((e) => ({ day: String(e.day), closed: e.closed, opens: e.opens, closes: e.closes, note: e.note })),
    knowledge: knowledge.map((k) => ({ topic: k.topic, answer: k.answer })),
    menu,
    transfers,
  };
}

/** Requisitos para salir en vivo. El menú es OBLIGATORIO (en Slang venía apagado y vacío). */
export function goLiveChecklist(b: Bundle): { key: string; label: string; done: boolean }[] {
  const r = b.restaurant;
  return [
    { key: "menu", label: "Menú cargado (al menos 5 platillos con precio)", done: b.menu.filter((m) => m.available).length >= 5 },
    { key: "hours", label: "Horario de la semana", done: b.hours.length > 0 },
    { key: "info", label: "Info del local (dirección, parking, políticas…)", done: !!r.address && b.knowledge.length >= 3 },
    { key: "owner", label: "Celular del dueño para avisos y recados", done: !!r.ownerPhone },
    { key: "transfer", label: "A dónde transferir cuando piden a una persona", done: b.transfers.some((t) => t.reason === "human" && (!!t.targetPhone || !!t.targetEmail)) },
    { key: "greeting", label: "Saludo con el nombre de la voz", done: [r.greetingEs, r.greetingEn].every((g) => !g || g.includes(r.voiceName)) },
    { key: "payments", label: "Pagos: Stripe conectado o pago al recoger", done: !!r.stripeAccountId || r.payAtPickupAllowed },
  ];
}

export async function availableMenu(db: Db, restaurantId: string): Promise<MenuItem[]> {
  return db.select().from(menuItems).where(and(eq(menuItems.restaurantId, restaurantId), eq(menuItems.available, true)));
}
