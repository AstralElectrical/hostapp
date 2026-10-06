import {
  boolean, date, index, integer, jsonb, pgTable, smallint, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";

// MODELO DE DATOS de HostApp. Una fila de `restaurants` = una ubicación (multi-local desde el día uno).
// Todo cuelga de restaurant_id. El horario vive SOLO en business_hours (+ excepciones): una sola fuente de verdad.

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const restaurantId = () => uuid("restaurant_id").notNull().references(() => restaurants.id, { onDelete: "cascade" });

export const restaurants = pgTable("restaurants", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("America/Los_Angeles"),
  phone: text("phone"), // línea pública que contesta Casia
  address: text("address"),
  // Voz / marca. El nombre de la voz ES el nombre del saludo (no "Simran" vs "Sophia").
  voiceName: text("voice_name").notNull().default("Casia"),
  greetingEs: text("greeting_es"),
  greetingEn: text("greeting_en"),
  // A quién avisar y a dónde transferir.
  ownerName: text("owner_name"),
  ownerPhone: text("owner_phone"),
  ownerEmail: text("owner_email"),
  // Pedidos
  ordersEnabled: boolean("orders_enabled").notNull().default(true),
  pickupEnabled: boolean("pickup_enabled").notNull().default(true),
  deliveryEnabled: boolean("delivery_enabled").notNull().default(false),
  deliveryFeeCents: integer("delivery_fee_cents").notNull().default(0),
  payAtPickupAllowed: boolean("pay_at_pickup_allowed").notNull().default(true),
  prepMinutes: integer("prep_minutes").notNull().default(20),
  taxRateBps: integer("tax_rate_bps").notNull().default(0), // 875 = 8.75%
  // Reservas (libro propio para el piloto; adaptador para OpenTable/Resy después)
  reservationsEnabled: boolean("reservations_enabled").notNull().default(true),
  capacityCovers: integer("capacity_covers").notNull().default(40), // cubiertos sentados a la vez
  turnMinutes: integer("turn_minutes").notNull().default(90), // cuánto ocupa una mesa
  slotMinutes: integer("slot_minutes").notNull().default(30), // cada cuánto se ofrecen horarios
  maxPartyAuto: integer("max_party_auto").notNull().default(8), // más grande → lo decide el dueño
  depositPartyMin: integer("deposit_party_min").notNull().default(6), // desde aquí pide depósito
  depositPerPersonCents: integer("deposit_per_person_cents").notNull().default(0), // 0 = sin depósito
  lastSeatingMinutes: integer("last_seating_minutes").notNull().default(60), // última reserva X min antes de cerrar
  lateGraceMinutes: integer("late_grace_minutes").notNull().default(15),
  // Enlaces que Casia puede mandar por SMS: { menu, maps, gift_cards, happy_hour, website, ... }
  links: jsonb("links").$type<Record<string, string>>().notNull().default({}),
  // Pagos: cuenta conectada de Stripe del restaurante (Stripe Connect). La IA NUNCA toma tarjeta por teléfono.
  stripeAccountId: text("stripe_account_id"),
  live: boolean("live").notNull().default(false), // solo contesta llamadas reales cuando el onboarding está completo
  createdAt: createdAt(),
});

export const users = pgTable("users", {
  id: id(),
  restaurantId: restaurantId(),
  email: text("email").notNull().unique(),
  name: text("name"),
  passwordHash: text("password_hash").notNull(),
  createdAt: createdAt(),
});

// 0 = domingo … 6 = sábado. Minutos desde medianoche, hora local. closes > opens; si cruza medianoche, closes > 1440.
export const businessHours = pgTable("business_hours", {
  id: id(),
  restaurantId: restaurantId(),
  weekday: smallint("weekday").notNull(),
  opens: integer("opens").notNull(),
  closes: integer("closes").notNull(),
}, (t) => [index("bh_rest_idx").on(t.restaurantId)]);

export const hoursExceptions = pgTable("hours_exceptions", {
  id: id(),
  restaurantId: restaurantId(),
  day: date("day").notNull(),
  closed: boolean("closed").notNull().default(true),
  opens: integer("opens"),
  closes: integer("closes"),
  note: text("note"),
}, (t) => [uniqueIndex("hx_rest_day").on(t.restaurantId, t.day)]);

// Info del local: dirección, parking, accesibilidad, políticas, catering, gift cards, formas de pago…
export const knowledgeItems = pgTable("knowledge_items", {
  id: id(),
  restaurantId: restaurantId(),
  topic: text("topic").notNull(),
  answer: text("answer").notNull(),
  createdAt: createdAt(),
}, (t) => [index("ki_rest_idx").on(t.restaurantId)]);

export type Modifier = { name: string; priceCents: number };

export const menuItems = pgTable("menu_items", {
  id: id(),
  restaurantId: restaurantId(),
  category: text("category").notNull().default("Menu"),
  name: text("name").notNull(),
  nameEs: text("name_es"),
  description: text("description"),
  priceCents: integer("price_cents").notNull(),
  available: boolean("available").notNull().default(true),
  tags: jsonb("tags").$type<string[]>().notNull().default([]), // vegetarian, vegan, gluten-free, spicy…
  allergens: jsonb("allergens").$type<string[]>().notNull().default([]),
  modifiers: jsonb("modifiers").$type<Modifier[]>().notNull().default([]),
  sort: integer("sort").notNull().default(0),
}, (t) => [index("mi_rest_idx").on(t.restaurantId)]);

export const guests = pgTable("guests", {
  id: id(),
  restaurantId: restaurantId(),
  phone: text("phone").notNull(), // E.164
  name: text("name"),
  email: text("email"),
  language: text("language"),
  notes: text("notes"),
  callCount: integer("call_count").notNull().default(0),
  firstSeenAt: createdAt(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("guest_rest_phone").on(t.restaurantId, t.phone)]);

export type TranscriptLine = { role: "assistant" | "user"; text: string };

export const calls = pgTable("calls", {
  id: id(),
  restaurantId: restaurantId(),
  guestId: uuid("guest_id").references(() => guests.id, { onDelete: "set null" }),
  vapiCallId: text("vapi_call_id").unique(),
  fromPhone: text("from_phone"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  durationSec: integer("duration_sec"),
  language: text("language"), // es | en | otro
  topic: text("topic"), // order | reservation | menu | hours | directions | catering | employment | other
  // automated = la IA lo resolvió; transferred = pasó a humano; message = tomó recado; abandoned = colgaron sin hablar
  outcome: text("outcome"),
  afterHours: boolean("after_hours").notNull().default(false),
  sentiment: text("sentiment"), // positive | neutral | negative
  summary: text("summary"),
  endedReason: text("ended_reason"),
  transcript: jsonb("transcript").$type<TranscriptLine[]>(),
  recordingUrl: text("recording_url"),
  test: boolean("test").notNull().default(false),
}, (t) => [index("call_rest_started").on(t.restaurantId, t.startedAt)]);

export type OrderLine = { menuItemId: string; name: string; qty: number; unitCents: number; modifiers: Modifier[]; notes?: string };

export const orders = pgTable("orders", {
  id: id(),
  restaurantId: restaurantId(),
  guestId: uuid("guest_id").references(() => guests.id, { onDelete: "set null" }),
  callId: uuid("call_id").references(() => calls.id, { onDelete: "set null" }),
  code: text("code").notNull(), // corto, se dice por teléfono: "A-482"
  kind: text("kind").notNull().default("pickup"), // pickup | delivery
  lines: jsonb("lines").$type<OrderLine[]>().notNull(),
  subtotalCents: integer("subtotal_cents").notNull(),
  taxCents: integer("tax_cents").notNull(),
  feeCents: integer("fee_cents").notNull().default(0),
  totalCents: integer("total_cents").notNull(),
  customerName: text("customer_name"),
  customerPhone: text("customer_phone"),
  address: text("address"),
  notes: text("notes"),
  readyAt: timestamp("ready_at", { withTimezone: true }),
  // awaiting_payment → paid → preparing → ready → completed. pay_at_pickup entra directo a cocina.
  status: text("status").notNull().default("awaiting_payment"),
  payment: text("payment").notNull().default("link"), // link | at_pickup
  paymentUrl: text("payment_url"),
  stripeSessionId: text("stripe_session_id"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index("order_rest_created").on(t.restaurantId, t.createdAt)]);

export const reservations = pgTable("reservations", {
  id: id(),
  restaurantId: restaurantId(),
  guestId: uuid("guest_id").references(() => guests.id, { onDelete: "set null" }),
  callId: uuid("call_id").references(() => calls.id, { onDelete: "set null" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  phone: text("phone"),
  partySize: integer("party_size").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  // confirmed | awaiting_deposit | needs_approval | cancelled | seated | completed | no_show
  status: text("status").notNull().default("confirmed"),
  notes: text("notes"),
  depositCents: integer("deposit_cents").notNull().default(0),
  depositUrl: text("deposit_url"),
  stripeSessionId: text("stripe_session_id"),
  depositPaidAt: timestamp("deposit_paid_at", { withTimezone: true }),
  runningLateMinutes: integer("running_late_minutes"),
  source: text("source").notNull().default("phone"), // phone | staff | test
  createdAt: createdAt(),
}, (t) => [index("resv_rest_starts").on(t.restaurantId, t.startsAt)]);

export const waitlist = pgTable("waitlist", {
  id: id(),
  restaurantId: restaurantId(),
  guestId: uuid("guest_id").references(() => guests.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  partySize: integer("party_size").notNull(),
  wantedAt: timestamp("wanted_at", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("waiting"), // waiting | notified | booked | cancelled
  createdAt: createdAt(),
}, (t) => [index("wl_rest_idx").on(t.restaurantId, t.wantedAt)]);

// RECADOS / CALLBACKS: la red de seguridad. Nadie se queda colgado: si la transferencia no se puede, queda aquí
// y el dueño recibe un SMS al instante.
export const messages = pgTable("messages", {
  id: id(),
  restaurantId: restaurantId(),
  guestId: uuid("guest_id").references(() => guests.id, { onDelete: "set null" }),
  callId: uuid("call_id").references(() => calls.id, { onDelete: "set null" }),
  reason: text("reason").notNull(), // human | order_problem | catering | employment | large_party | other
  name: text("name"),
  phone: text("phone").notNull(),
  body: text("body").notNull(),
  callbackBy: timestamp("callback_by", { withTimezone: true }),
  status: text("status").notNull().default("open"), // open | done
  notifiedAt: timestamp("notified_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index("msg_rest_status").on(t.restaurantId, t.status)]);

// A dónde va cada caso. target_phone → transferencia en vivo (en horario); target_email → aviso por correo.
export const transferRules = pgTable("transfer_rules", {
  id: id(),
  restaurantId: restaurantId(),
  reason: text("reason").notNull(),
  label: text("label").notNull(),
  targetPhone: text("target_phone"),
  targetEmail: text("target_email"),
}, (t) => [uniqueIndex("tr_rest_reason").on(t.restaurantId, t.reason)]);

export type Restaurant = typeof restaurants.$inferSelect;
export type MenuItem = typeof menuItems.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type Reservation = typeof reservations.$inferSelect;
export type Call = typeof calls.$inferSelect;
export type Guest = typeof guests.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type BusinessHours = typeof businessHours.$inferSelect;
export type HoursException = typeof hoursExceptions.$inferSelect;
export type TransferRule = typeof transferRules.$inferSelect;
