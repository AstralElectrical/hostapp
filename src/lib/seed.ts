import bcrypt from "bcryptjs";
import type { Db } from "@/db";
import { businessHours, knowledgeItems, menuItems, restaurants, transferRules, users, type Restaurant } from "@/db/schema";

// Restaurante DEMO para probar el piloto de punta a punta (pruebas automáticas y `npm run db:seed`).
// Datos inventados; se reemplazan por los del restaurante piloto en el onboarding.

export async function seedDemo(db: Db, opts: { slug?: string; ownerEmail?: string; password?: string } = {}): Promise<Restaurant> {
  const [r] = await db.insert(restaurants).values({
    slug: opts.slug ?? "demo",
    name: "La Casa Demo",
    timezone: "America/Los_Angeles",
    phone: "(209) 555-0100",
    address: "123 Main St, Tracy, CA",
    voiceName: "Casia",
    ownerName: "Dueño Demo",
    ownerPhone: "+12095550199",
    ownerEmail: opts.ownerEmail ?? "demo@hostapp.local",
    taxRateBps: 825,
    capacityCovers: 20,
    turnMinutes: 90,
    slotMinutes: 30,
    maxPartyAuto: 8,
    depositPartyMin: 6,
    depositPerPersonCents: 1000,
    links: { menu: "https://example.com/menu", maps: "https://maps.google.com/?q=123+Main+St+Tracy+CA" },
  }).returning();

  // Mar–Dom 11:00–21:00 (viernes y sábado hasta 22:00). Lunes cerrado.
  const hrs = [2, 3, 4, 5, 6, 0].map((weekday) => ({ restaurantId: r.id, weekday, opens: 11 * 60, closes: weekday === 5 || weekday === 6 ? 22 * 60 : 21 * 60 }));
  await db.insert(businessHours).values(hrs);

  await db.insert(knowledgeItems).values([
    { restaurantId: r.id, topic: "Parking", answer: "Free parking lot behind the building." },
    { restaurantId: r.id, topic: "Accessibility", answer: "Wheelchair accessible entrance and restroom." },
    { restaurantId: r.id, topic: "Payment methods", answer: "Cards, Apple Pay and cash." },
    { restaurantId: r.id, topic: "Kids", answer: "Kids menu and high chairs available." },
  ]);

  await db.insert(menuItems).values([
    { restaurantId: r.id, category: "Tacos", name: "Carne Asada Taco", nameEs: "Taco de carne asada", priceCents: 400, modifiers: [{ name: "Add cheese", priceCents: 75 }], sort: 1 },
    { restaurantId: r.id, category: "Tacos", name: "Al Pastor Taco", nameEs: "Taco al pastor", priceCents: 375, sort: 2 },
    { restaurantId: r.id, category: "Tacos", name: "Veggie Taco", nameEs: "Taco vegetariano", priceCents: 350, tags: ["vegetarian"], sort: 3 },
    { restaurantId: r.id, category: "Platos", name: "Enchiladas Suizas", priceCents: 1495, allergens: ["dairy"], sort: 1 },
    { restaurantId: r.id, category: "Platos", name: "Pozole Rojo", priceCents: 1395, tags: ["spicy"], sort: 2 },
    { restaurantId: r.id, category: "Bebidas", name: "Horchata", priceCents: 350, allergens: ["dairy"], sort: 1 },
    { restaurantId: r.id, category: "Bebidas", name: "Agua de Jamaica", priceCents: 325, sort: 2 },
  ]);

  await db.insert(transferRules).values([
    { restaurantId: r.id, reason: "human", label: "the manager", targetPhone: "+12095550199" },
    { restaurantId: r.id, reason: "order_problem", label: "the kitchen manager", targetPhone: "+12095550199" },
    { restaurantId: r.id, reason: "catering", label: "our events team", targetEmail: "events@example.com" },
    { restaurantId: r.id, reason: "employment", label: "the hiring manager", targetEmail: "jobs@example.com" },
  ]);

  await db.insert(users).values({ restaurantId: r.id, email: opts.ownerEmail ?? "demo@hostapp.local", name: "Dueño Demo", passwordHash: await bcrypt.hash(opts.password ?? "demo1234", 10) });
  return r;
}
