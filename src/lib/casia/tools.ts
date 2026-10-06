import type { Db } from "@/db";
import { eq } from "drizzle-orm";
import { orders as ordersT, reservations as reservationsT, type Reservation } from "@/db/schema";
import { createCheckout } from "@/lib/stripe";
import { sendSms } from "@/lib/sms";
import { usd } from "@/lib/money";
import { toE164 } from "@/lib/phone";
import { isOpenAt, localParts, speakable, windowsForDay, zonedToUtc } from "@/lib/time";
import { noteCall, upsertGuest } from "@/lib/services/calls";
import { liveTransfer, takeMessage } from "@/lib/services/messages";
import { createOrder, priceOrder, recentOrdersFor, type RequestedLine } from "@/lib/services/orders";
import * as resv from "@/lib/services/reservations";
import type { Bundle } from "@/lib/services/restaurant";
import { menuRef } from "./prompt";

// HERRAMIENTAS DE CASIA. Cada una devuelve JSON corto con `say` (qué decirle al cliente) cuando aplica.
// En modo prueba (panel del dueño) nada se escribe ni se envía: se simula y se dice "practice".

export type ToolCtx = {
  db: Db;
  bundle: Bundle;
  callId: string | null;
  callerPhone: string | null;
  controlUrl: string | null;
  test: boolean;
  now: Date;
  /** Trabajo después de responder (SMS, transferencias) para no dejar silencio en la llamada. */
  defer: (fn: () => Promise<void>) => void;
};

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });
const S = (description: string) => ({ type: "string", description });
const N = (description: string) => ({ type: "integer", description });

export const TOOLS = [
  { name: "check_availability", description: "Real open reservation times for a date and party size. Always call before offering or confirming a time.",
    input_schema: obj({ date: S("YYYY-MM-DD"), party_size: N("Number of people"), time: S("Preferred time HH:MM 24h, if they said one") }, ["date", "party_size"]) },
  { name: "book_reservation", description: "Book a table at a time returned by check_availability. Texts a confirmation (or a deposit link for large groups).",
    input_schema: obj({ date: S("YYYY-MM-DD"), time: S("HH:MM 24h"), party_size: N("Number of people"), name: S("Name for the reservation"), phone: S("Number to text, if different from caller ID"), notes: S("Birthday, high chair, patio, allergies…") }, ["date", "time", "party_size", "name"]) },
  { name: "find_reservation", description: "Find the caller's upcoming reservations by phone (default caller ID) or by code.",
    input_schema: obj({ phone: S("Phone number, if not the caller ID"), code: S("Reservation code like R-123") }) },
  { name: "change_reservation", description: "Move a reservation to a new date/time and/or party size. Use the code from find_reservation.",
    input_schema: obj({ code: S("Reservation code"), date: S("New YYYY-MM-DD"), time: S("New HH:MM 24h"), party_size: N("New party size") }, ["code"]) },
  { name: "cancel_reservation", description: "Cancel a reservation by code (after confirming with the caller).",
    input_schema: obj({ code: S("Reservation code") }, ["code"]) },
  { name: "running_late", description: "Note that a guest is running late for their reservation today.",
    input_schema: obj({ code: S("Reservation code, if known"), minutes: N("How many minutes late") }, ["minutes"]) },
  { name: "join_waitlist", description: "Add the caller to the waitlist for a full time slot. We text them if a table opens.",
    input_schema: obj({ date: S("YYYY-MM-DD"), time: S("HH:MM 24h"), party_size: N("Number of people"), name: S("Name"), phone: S("Number to text, if not caller ID") }, ["date", "time", "party_size", "name"]) },
  { name: "place_order", description: "Place a food order with items from the MENU (ids in brackets). Prices are computed by the system. Texts a secure payment link (or marks pay at pickup).",
    input_schema: obj({
      items: { type: "array", items: obj({ menu_item_id: S("The id in brackets from the MENU"), qty: N("Quantity"), modifiers: { type: "array", items: { type: "string" }, description: "Option names exactly as listed" }, notes: S("Special request for this item") }, ["menu_item_id", "qty"]) },
      kind: { type: "string", enum: ["pickup", "delivery"] },
      name: S("Name for the order"),
      phone: S("Number to text, if not caller ID"),
      address: S("Delivery address (delivery only)"),
      pickup_time: S("HH:MM 24h today, if later than as soon as possible"),
      payment: { type: "string", enum: ["link", "at_pickup"], description: "link = secure payment link by text; at_pickup = pay in person" },
      notes: S("Order-level notes"),
    }, ["items", "kind", "name", "payment"]) },
  { name: "order_status", description: "Look up the caller's recent orders (last 12 hours) by phone.",
    input_schema: obj({ phone: S("Phone, if not caller ID") }) },
  { name: "send_link", description: "Text the caller one of the restaurant's links (menu, maps, gift cards…).",
    input_schema: obj({ link: S("Link name from 'Links you can text'"), phone: S("Phone, if not caller ID") }, ["link"]) },
  { name: "take_message", description: "Leave a message for the staff with a callback. The owner gets a text right away.",
    input_schema: obj({ reason: { type: "string", enum: ["human", "order_problem", "catering", "employment", "other"] }, name: S("Caller name"), phone: S("Callback number, if not caller ID"), message: S("What they need, one or two lines") }, ["reason", "message"]) },
  { name: "transfer_to_staff", description: "Connect the caller with a person. Always saves a message with callback first, then transfers live if the restaurant is open and staff is reachable.",
    input_schema: obj({ reason: { type: "string", enum: ["human", "order_problem", "catering", "employment", "other"] }, name: S("Caller name"), phone: S("Callback number, if not caller ID"), summary: S("One line: what they need") }, ["reason", "summary"]) },
];

const J = (o: unknown) => JSON.stringify(o);
const ymdOk = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
function hhmm(s: unknown): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]), mm = Number(m[2]);
  return h < 24 && mm < 60 ? h * 60 + mm : null;
}

function phoneFor(ctx: ToolCtx, given: unknown): string | null {
  return toE164(String(given ?? "")) ?? toE164(ctx.callerPhone);
}

async function guestFor(ctx: ToolCtx, phone: string | null, name?: unknown) {
  if (!phone || ctx.test) return null;
  const g = await upsertGuest(ctx.db, ctx.bundle.restaurant.id, phone, { name: name ? String(name) : null });
  if (g) await noteCall(ctx.db, ctx.callId, { guestId: g.id });
  return g;
}

function text(ctx: ToolCtx, to: string | null, body: string) {
  if (!to || ctx.test) return;
  ctx.defer(async () => { await sendSms({ to, body }); });
}

function describeResv(r: Reservation, tz: string) {
  return { code: r.code, when: speakable(r.startsAt, tz), party_size: r.partySize, name: r.name, status: r.status };
}

export async function runTool(name: string, input: Record<string, unknown>, ctx: ToolCtx): Promise<string> {
  const { db, bundle } = ctx;
  const r = bundle.restaurant;
  const tz = r.timezone;
  const rctx = { restaurant: r, hours: bundle.hours, exceptions: bundle.exceptions };
  try {
    switch (name) {
      case "check_availability": {
        if (!r.reservationsEnabled) return J({ error: "Reservations are off. Offer to take a message." });
        const party = Number(input.party_size);
        if (!ymdOk(input.date) || !(party >= 1)) return J({ error: "Need date YYYY-MM-DD and party_size." });
        if (party > r.maxPartyAuto) return J({ large_group: true, say: `Groups over ${r.maxPartyAuto} are confirmed by the manager. Get the date, time, name, then use book_reservation and it goes for approval.` });
        const slots = await resv.availability(db, rctx, input.date, party, undefined, ctx.now);
        await noteCall(db, ctx.callId, { topic: "reservation" });
        if (!slots.length) return J({ slots: [], say: "Nothing open that day for that group. Offer another day or the waitlist." });
        const near = resv.nearest(slots, hhmm(input.time));
        const wanted = hhmm(input.time);
        return J({ requested_time_available: wanted != null ? near.some((s) => s.minutes === wanted) : undefined, slots: near.map((s) => ({ time: `${String(Math.floor(s.minutes / 60)).padStart(2, "0")}:${String(s.minutes % 60).padStart(2, "0")}`, say: s.local })) });
      }

      case "book_reservation": {
        const party = Number(input.party_size), minutes = hhmm(input.time);
        if (!ymdOk(input.date) || minutes == null || !(party >= 1) || !input.name) return J({ error: "Need date, time, party_size and name." });
        const phone = phoneFor(ctx, input.phone);
        if (!phone) return J({ error: "Need a phone number to text the confirmation. Ask for it and read it back." });
        await noteCall(db, ctx.callId, { topic: "reservation" });
        if (ctx.test) {
          const slots = await resv.availability(db, rctx, input.date, party, undefined, ctx.now);
          const ok = party > r.maxPartyAuto || slots.some((s) => s.minutes === minutes);
          return J(ok ? { ok: true, practice: true, code: "R-000", say: "Practice mode: it would be booked and a text confirmation sent." } : { ok: false, say: "That time isn't available.", alternatives: resv.nearest(slots, minutes).map((s) => s.local) });
        }
        const guest = await guestFor(ctx, phone, input.name);
        const res = await resv.book(db, rctx, { ymd: input.date, minutes, party, name: String(input.name), phone, notes: input.notes ? String(input.notes) : null, guestId: guest?.id, callId: ctx.callId, now: ctx.now });
        if (!res.ok) return J({ ok: false, say: res.error === "closed_or_full" ? "That time just isn't available." : "Something's missing.", alternatives: res.alternatives?.map((s) => s.local) ?? [] });
        const b = res.reservation;
        const when = speakable(b.startsAt, tz);
        if (res.kind === "needs_approval") {
          text(ctx, phone, `${r.name}: we got your request for ${b.partySize} on ${when}. The manager will confirm shortly. Ref ${b.code}.`);
          return J({ ok: true, code: b.code, status: "needs_approval", say: `Tell them the manager confirms large groups and they'll get a text or call soon. Reference ${b.code}.` });
        }
        if (res.kind === "awaiting_deposit") {
          const co = await createCheckout({ accountId: r.stripeAccountId, lines: [{ name: `Deposit · ${r.name} · ${b.partySize} people`, unitCents: b.depositCents, qty: 1 }], metadata: { kind: "deposit", reservation_id: b.id, restaurant_id: r.id }, successPath: `/pay/thanks`, phone });
          if (co) {
            await db.update(reservationsT).set({ depositUrl: co.url, stripeSessionId: co.id }).where(eq(reservationsT.id, b.id));
            text(ctx, phone, `${r.name}: your table for ${b.partySize} on ${when} is held. Please pay the ${usd(b.depositCents)} deposit to confirm: ${co.url}  Ref ${b.code}.`);
            return J({ ok: true, code: b.code, status: "awaiting_deposit", deposit: usd(b.depositCents), say: `Tell them it's held and you just texted a secure link for the ${usd(b.depositCents)} deposit to confirm it.` });
          }
          // Sin Stripe → no bloquear: confirmada y el dueño decide.
          await db.update(reservationsT).set({ status: "confirmed", depositCents: 0 }).where(eq(reservationsT.id, b.id));
        }
        text(ctx, phone, `${r.name}: you're confirmed for ${b.partySize} on ${when}. Ref ${b.code}. Running late or need to change it? Just call us.`);
        return J({ ok: true, code: b.code, when, say: `Confirmed. Tell them the day and time and that a text confirmation is on its way.` });
      }

      case "find_reservation": {
        const list = await resv.findUpcoming(db, r.id, { code: input.code ? String(input.code) : null, phone: input.code ? null : phoneFor(ctx, input.phone) }, ctx.now);
        await noteCall(db, ctx.callId, { topic: "reservation" });
        if (!list.length) return J({ found: 0, say: "No upcoming reservation found with that. Ask for the name or another number, or the code from their text." });
        return J({ found: list.length, reservations: list.map((x) => describeResv(x, tz)) });
      }

      case "change_reservation":
      case "cancel_reservation":
      case "running_late": {
        await noteCall(db, ctx.callId, { topic: "reservation" });
        const code = input.code ? String(input.code) : null;
        const list = await resv.findUpcoming(db, r.id, code ? { code } : { phone: ctx.callerPhone }, ctx.now);
        const target = list[0];
        if (!target) return J({ ok: false, say: "Couldn't find that reservation. Use find_reservation first." });
        if (ctx.test) return J({ ok: true, practice: true, say: "Practice mode: it would be updated and a text sent." });
        if (name === "cancel_reservation") {
          await resv.cancel(db, target);
          text(ctx, target.phone, `${r.name}: your reservation ${target.code} for ${speakable(target.startsAt, tz)} is cancelled. Hope to see you soon!`);
          ctx.defer(async () => {
            const cand = await resv.waitlistCandidates(db, rctx, target.startsAt, new Date());
            if (cand) {
              await resv.markWaitlist(db, cand.entry.id, "notified");
              await sendSms({ to: cand.entry.phone, body: `${r.name}: good news! A table for ${cand.entry.partySize} opened ${cand.slot.local}. Call us${r.phone ? ` at ${r.phone}` : ""} to grab it.` });
            }
          });
          return J({ ok: true, say: "Cancelled. Tell them it's done and a text is on its way." });
        }
        if (name === "running_late") {
          const mins = Number(input.minutes) || 10;
          await resv.runningLate(db, target, mins);
          return J({ ok: true, say: mins > r.lateGraceMinutes ? `Noted. Kindly mention we hold tables ${r.lateGraceMinutes} minutes, and we'll do our best.` : "Noted, no problem — the table will be ready." });
        }
        const minutes = input.time != null ? hhmm(input.time) : undefined;
        if (minutes === null) return J({ error: "time must be HH:MM" });
        const res = await resv.change(db, rctx, target, { ymd: ymdOk(input.date) ? input.date : undefined, minutes, party: input.party_size ? Number(input.party_size) : undefined }, ctx.now);
        if (!res.ok) return J({ ok: false, say: res.error === "bad_input" ? "That's now a large group: take_message so the manager confirms." : "That new time isn't available.", alternatives: res.alternatives?.map((s) => s.local) ?? [] });
        text(ctx, res.reservation.phone, `${r.name}: your reservation ${res.reservation.code} is now for ${res.reservation.partySize} on ${speakable(res.reservation.startsAt, tz)}.`);
        return J({ ok: true, ...describeResv(res.reservation, tz), say: "Updated. Tell them the new details and that a text is on its way." });
      }

      case "join_waitlist": {
        const minutes = hhmm(input.time), party = Number(input.party_size);
        const phone = phoneFor(ctx, input.phone);
        if (!ymdOk(input.date) || minutes == null || !(party >= 1) || !input.name || !phone) return J({ error: "Need date, time, party_size, name and a phone." });
        await noteCall(db, ctx.callId, { topic: "reservation" });
        if (ctx.test) return J({ ok: true, practice: true, say: "Practice mode: they'd be on the waitlist." });
        const guest = await guestFor(ctx, phone, input.name);
        await resv.joinWaitlist(db, r.id, { name: String(input.name), phone, party, wantedAt: zonedToUtc(input.date, minutes, tz), guestId: guest?.id });
        return J({ ok: true, say: "They're on the waitlist; we'll text them if a table opens." });
      }

      case "place_order": {
        if (!r.ordersEnabled) return J({ error: "Orders are turned off. Offer the menu link or take a message." });
        await noteCall(db, ctx.callId, { topic: "order" });
        const kind = input.kind === "delivery" ? "delivery" : "pickup";
        if (kind === "delivery" && (!r.deliveryEnabled || !input.address)) return J({ error: r.deliveryEnabled ? "Delivery needs the full address." : "We only do pickup." });
        if (kind === "pickup" && !r.pickupEnabled) return J({ error: "Pickup is not available." });
        const phone = phoneFor(ctx, input.phone);
        if (!phone) return J({ error: "Need a phone number for the order. Ask and read it back." });
        // ids del prompt (8 caracteres) → ids completos
        const req = (Array.isArray(input.items) ? input.items : []) as RequestedLine[];
        const mapped = req.map((l) => ({ ...l, menu_item_id: bundle.menu.find((m) => menuRef(m.id) === String(l.menu_item_id).replace(/[[\]]/g, "").trim() || m.id === l.menu_item_id)?.id ?? String(l.menu_item_id) }));
        const priced = priceOrder(bundle.menu, mapped);
        if (!priced.ok) return J({ ok: false, errors: priced.errors, say: "Fix these with the caller before placing the order." });
        // ¿Cuándo? ASAP (abierto ahora) o una hora de hoy dentro del horario.
        const lp = localParts(ctx.now, tz);
        let readyAt = new Date(ctx.now.getTime() + r.prepMinutes * 60_000);
        const later = hhmm(input.pickup_time);
        if (later != null) {
          const at = zonedToUtc(lp.ymd, later, tz);
          const inHours = windowsForDay(lp.ymd, bundle.hours, bundle.exceptions).some((w) => later >= w.opens && later <= w.closes - 10);
          if (!inHours || at.getTime() < readyAt.getTime()) return J({ ok: false, say: `That pickup time doesn't work. The earliest is about ${r.prepMinutes} minutes from now, during today's hours.` });
          readyAt = at;
        } else if (!isOpenAt(ctx.now, tz, bundle.hours, bundle.exceptions)) {
          return J({ ok: false, say: "The kitchen is closed right now. Offer a later pickup time today during open hours, or another day by calling back." });
        }
        let payment: "link" | "at_pickup" = input.payment === "at_pickup" && r.payAtPickupAllowed ? "at_pickup" : "link";
        if (ctx.test) {
          const t = priced.subtotalCents;
          return J({ ok: true, practice: true, code: "A-000", subtotal: usd(t), ready: speakable(readyAt, tz), say: "Practice mode: the order would go to the kitchen screen and the payment link would be texted." });
        }
        const guest = await guestFor(ctx, phone, input.name);
        let order = await createOrder(db, r, { lines: priced.lines, kind, name: String(input.name), phone, address: input.address ? String(input.address) : null, notes: input.notes ? String(input.notes) : null, readyAt, payment, guestId: guest?.id, callId: ctx.callId });
        if (payment === "link") {
          const co = await createCheckout({
            accountId: r.stripeAccountId,
            lines: [
              ...order.lines.map((l) => ({ name: `${l.name}${l.modifiers.length ? ` (${l.modifiers.map((m) => m.name).join(", ")})` : ""}`, unitCents: l.unitCents, qty: l.qty })),
              ...(order.taxCents ? [{ name: "Tax", unitCents: order.taxCents, qty: 1 }] : []),
              ...(order.feeCents ? [{ name: "Delivery fee", unitCents: order.feeCents, qty: 1 }] : []),
            ],
            metadata: { kind: "order", order_id: order.id, restaurant_id: r.id },
            successPath: `/pay/thanks`,
            phone,
          }).catch(() => null);
          if (co) {
            [order] = await db.update(ordersT).set({ paymentUrl: co.url, stripeSessionId: co.id }).where(eq(ordersT.id, order.id)).returning();
          } else if (r.payAtPickupAllowed) {
            payment = "at_pickup";
            [order] = await db.update(ordersT).set({ payment, status: "new" }).where(eq(ordersT.id, order.id)).returning();
          } else {
            await db.update(ordersT).set({ status: "cancelled" }).where(eq(ordersT.id, order.id));
            return J({ ok: false, say: "Payments are down right now. Apologize and use take_message with reason order_problem so the staff calls back to take the order." });
          }
        }
        const ready = speakable(order.readyAt ?? readyAt, tz);
        text(ctx, phone, payment === "link"
          ? `${r.name}: order ${order.code}, total ${usd(order.totalCents)}. Pay securely here and we start cooking: ${order.paymentUrl}  Ready ${ready}.`
          : `${r.name}: order ${order.code}, total ${usd(order.totalCents)}, pay at pickup. Ready ${ready}. See you soon!`);
        return J({ ok: true, code: order.code, total: usd(order.totalCents), ready, payment,
          say: payment === "link" ? "Tell them the code, the total, and that you just texted a secure payment link; the kitchen starts as soon as it's paid." : "Tell them the code, the total, they pay at pickup, and when it'll be ready." });
      }

      case "order_status": {
        await noteCall(db, ctx.callId, { topic: "order" });
        const list = await recentOrdersFor(db, r.id, phoneFor(ctx, input.phone), ctx.now);
        if (!list.length) return J({ found: 0, say: "No recent order with that number." });
        return J({ orders: list.map((o) => ({ code: o.code, status: o.status, total: usd(o.totalCents), ready: o.readyAt ? speakable(o.readyAt, tz) : null, items: o.lines.map((l) => `${l.qty} ${l.name}`).join(", ") })) });
      }

      case "send_link": {
        const key = String(input.link ?? "").toLowerCase().trim();
        const url = r.links?.[key];
        const phone = phoneFor(ctx, input.phone);
        if (!url) return J({ error: `No link called ${key}. Available: ${Object.keys(r.links ?? {}).join(", ") || "none"}` });
        if (!phone) return J({ error: "Need a phone number to text it." });
        if (key === "menu") await noteCall(db, ctx.callId, { topic: "menu" });
        text(ctx, phone, `${r.name}: here's the ${key.replace(/_/g, " ")} link: ${url}`);
        return J({ ok: true, say: ctx.test ? "Practice mode: it would be texted." : "Texted. Tell them it's on its way." });
      }

      case "take_message":
      case "transfer_to_staff": {
        const reason = String(input.reason ?? "other");
        const phone = phoneFor(ctx, input.phone);
        if (!phone) return J({ error: "Need a callback number first. Ask for it and read it back." });
        const body = String(input.message ?? input.summary ?? "").trim() || "Asked to speak with someone.";
        await noteCall(db, ctx.callId, { topic: reason === "employment" ? "employment" : reason === "catering" ? "catering" : reason === "order_problem" ? "order" : "other" });
        const rule = bundle.transfers.find((t) => t.reason === reason) ?? bundle.transfers.find((t) => t.reason === "human");
        const open = isOpenAt(ctx.now, tz, bundle.hours, bundle.exceptions);
        const canTransfer = name === "transfer_to_staff" && open && !!(rule?.targetPhone || r.ownerPhone) && !!ctx.controlUrl && reason !== "employment";
        if (ctx.test) return J({ ok: true, practice: true, transferring: canTransfer, say: canTransfer ? "Practice mode: message saved, then a live transfer." : "Practice mode: message saved and the owner texted; someone calls back." });
        const guest = await guestFor(ctx, phone, input.name);
        // 1) SIEMPRE el recado primero (red de seguridad), 2) luego la transferencia en vivo si se puede.
        await takeMessage(db, r, rule, { reason, name: input.name ? String(input.name) : null, phone, body, guestId: guest?.id, callId: ctx.callId });
        if (canTransfer) {
          await noteCall(db, ctx.callId, { outcome: "transferred" });
          const target = rule?.targetPhone || r.ownerPhone;
          ctx.defer(async () => {
            await new Promise((ok) => setTimeout(ok, 2500)); // deja que Casia termine la frase
            await liveTransfer(ctx.controlUrl, target, "");
          });
          return J({ ok: true, transferring: true, say: "Tell them you're connecting them now, and that if nobody picks up, their message is already with the team and they'll get a call back." });
        }
        await noteCall(db, ctx.callId, { outcome: "message" });
        const why = !open ? "we're closed right now" : "the team is with guests right now";
        return J({ ok: true, transferring: false, say: `Tell them ${why}, their message is already with ${rule?.label || "the manager"}, and they'll get a call back as soon as possible. Ask if there's anything else.` });
      }
    }
    return J({ error: `unknown tool ${name}` });
  } catch (e) {
    console.error("[casia:tool]", name, e);
    return J({ error: "That didn't go through. Apologize, and use take_message so the staff follows up — never leave the caller hanging." });
  }
}
