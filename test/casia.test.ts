import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { calls, messages, orders, reservations, waitlist, type Restaurant } from "@/db/schema";
import { runTool, type ToolCtx } from "@/lib/casia/tools";
import { casiaReply } from "@/lib/casia/brain";
import { menuRef } from "@/lib/casia/prompt";
import { ensureCall } from "@/lib/services/calls";
import { loadBundle } from "@/lib/services/restaurant";
import { closeCall, readReport } from "@/lib/services/voice";
import { insights } from "@/lib/services/metrics";
import { seedDemo } from "@/lib/seed";
import { NOON_TUE, testDb } from "./db";

const CALLER = "+12095551234";
let db: Db, r: Restaurant, ctx: ToolCtx, deferred: (() => Promise<void>)[];

async function makeCtx(over: Partial<ToolCtx> = {}): Promise<ToolCtx> {
  const bundle = await loadBundle(db, r);
  const call = await ensureCall(db, { restaurant: r, hours: bundle.hours, exceptions: bundle.exceptions, vapiCallId: `vapi-${Math.random()}`, fromPhone: CALLER });
  return { db, bundle, callId: call.id, callerPhone: CALLER, controlUrl: null, test: false, now: NOON_TUE, defer: (fn) => deferred.push(fn), ...over };
}
const run = async (name: string, input: Record<string, unknown>, c = ctx) => JSON.parse(await runTool(name, input, c));

beforeEach(async () => {
  delete process.env.STRIPE_SECRET_KEY;
  db = await testDb();
  r = await seedDemo(db);
  deferred = [];
  ctx = await makeCtx();
});

describe("reservas", () => {
  it("ofrece horarios reales y reserva", async () => {
    const av = await run("check_availability", { date: "2026-10-06", party_size: 2, time: "19:00" });
    expect(av.requested_time_available).toBe(true);
    const b = await run("book_reservation", { date: "2026-10-06", time: "19:00", party_size: 2, name: "Lupe" });
    expect(b.ok).toBe(true);
    const [row] = await db.select().from(reservations);
    expect(row).toMatchObject({ status: "confirmed", partySize: 2, phone: CALLER, name: "Lupe" });
    expect(deferred).toHaveLength(1); // SMS de confirmación (en segundo plano)
  });

  it("no sobrevende: con el lugar lleno ofrece alternativas", async () => {
    await run("book_reservation", { date: "2026-10-06", time: "19:00", party_size: 8, name: "A" });
    await run("book_reservation", { date: "2026-10-06", time: "19:00", party_size: 8, name: "B" });
    const full = await run("book_reservation", { date: "2026-10-06", time: "19:00", party_size: 5, name: "C" });
    expect(full.ok).toBe(false);
    expect(full.alternatives.length).toBeGreaterThan(0);
  });

  it("lunes cerrado y no reserva en el pasado", async () => {
    expect((await run("check_availability", { date: "2026-10-12", party_size: 2 })).slots).toEqual([]);
    const today = await run("check_availability", { date: "2026-10-06", party_size: 2, time: "11:00" });
    expect(today.slots.every((s: { time: string }) => s.time >= "12:30")).toBe(true);
  });

  it("grupo grande va a aprobación del dueño con recado", async () => {
    const b = await run("book_reservation", { date: "2026-10-07", time: "18:00", party_size: 14, name: "Boda" });
    expect(b.status).toBe("needs_approval");
    expect(await db.select().from(messages)).toHaveLength(1);
  });

  it("depósito sin Stripe configurado no bloquea: queda confirmada", async () => {
    const b = await run("book_reservation", { date: "2026-10-07", time: "18:00", party_size: 6, name: "Familia" });
    expect(b.ok).toBe(true);
    const [row] = await db.select().from(reservations);
    expect(row.status).toBe("confirmed");
  });

  it("cambia, avisa que llega tarde, cancela y le avisa a la lista de espera", async () => {
    await run("book_reservation", { date: "2026-10-06", time: "19:00", party_size: 8, name: "A" });
    const second = await makeCtx({ callerPhone: "+12095550002" });
    await run("book_reservation", { date: "2026-10-06", time: "19:00", party_size: 8, name: "B" }, second);
    const third = await makeCtx({ callerPhone: "+12095550003" });
    await run("join_waitlist", { date: "2026-10-06", time: "19:00", party_size: 4, name: "Espera" }, third);
    const found = await run("find_reservation", {});
    const code = found.reservations[0].code;
    expect((await run("change_reservation", { code, time: "19:30" })).ok).toBe(true);
    expect((await run("running_late", { code, minutes: 20 })).say).toContain("15 minutes");
    expect((await run("cancel_reservation", { code })).ok).toBe(true);
    for (const d of deferred) await d().catch(() => {});
    const [w] = await db.select().from(waitlist);
    expect(w.status).toBe("notified");
  });
});

describe("pedidos", () => {
  it("toma el pedido con precios del menú e impuesto; sin Stripe pasa a pago al recoger y llega a cocina", async () => {
    const bundle = ctx.bundle;
    const taco = bundle.menu.find((m) => m.name === "Carne Asada Taco")!;
    const res = await run("place_order", { items: [{ menu_item_id: menuRef(taco.id), qty: 3, modifiers: ["Add cheese"] }], kind: "pickup", name: "Pablo", payment: "link" });
    expect(res).toMatchObject({ ok: true, payment: "at_pickup", total: "$15.43" }); // 3×4.75 = 14.25 + 8.25% = 1.18
    const [o] = await db.select().from(orders);
    expect(o).toMatchObject({ status: "new", subtotalCents: 1425, taxCents: 118, totalCents: 1543 });
    const [c] = await db.select().from(calls).where(eq(calls.id, ctx.callId!));
    expect(c.topic).toBe("order");
  });

  it("no acepta pedidos con la cocina cerrada salvo para más tarde hoy", async () => {
    const closed = await makeCtx({ now: new Date("2026-10-06T16:00:00Z") }); // 9am
    const taco = closed.bundle.menu[0];
    expect((await run("place_order", { items: [{ menu_item_id: menuRef(taco.id), qty: 1 }], kind: "pickup", name: "X", payment: "at_pickup" }, closed)).ok).toBe(false);
    expect((await run("place_order", { items: [{ menu_item_id: menuRef(taco.id), qty: 1 }], kind: "pickup", name: "X", payment: "at_pickup", pickup_time: "12:00" }, closed)).ok).toBe(true);
  });
});

describe("transferencias: nadie se queda colgado", () => {
  it("en horario con control de llamada: recado + transferencia en vivo", async () => {
    const live = await makeCtx({ controlUrl: "https://example.invalid/control" });
    const t = await run("transfer_to_staff", { reason: "human", name: "Ana", summary: "Quiere hablar con el dueño" }, live);
    expect(t.transferring).toBe(true);
    expect(await db.select().from(messages)).toHaveLength(1);
    const [c] = await db.select().from(calls).where(eq(calls.id, live.callId!));
    expect(c.outcome).toBe("transferred");
  });
  it("cerrado: toma recado con callback y lo dice", async () => {
    const night = await makeCtx({ now: new Date("2026-10-07T06:00:00Z"), controlUrl: "https://example.invalid/control" });
    const t = await run("transfer_to_staff", { reason: "human", summary: "Queja" }, night);
    expect(t.transferring).toBe(false);
    expect(t.say).toContain("call back");
    const [m] = await db.select().from(messages);
    expect(m).toMatchObject({ phone: CALLER, status: "open" });
  });
});

describe("modo prueba del panel", () => {
  it("no escribe nada", async () => {
    const t = await makeCtx({ test: true });
    await run("book_reservation", { date: "2026-10-06", time: "19:00", party_size: 2, name: "Prueba" }, t);
    await run("transfer_to_staff", { reason: "human", summary: "x" }, t);
    expect(await db.select().from(reservations)).toHaveLength(0);
    expect(await db.select().from(messages)).toHaveLength(0);
  });
});

describe("cerebro + fin de llamada + métricas", () => {
  it("usa herramientas y responde; el reporte cierra la llamada y alimenta Insights", async () => {
    let step = 0;
    const fake = async () => {
      step++;
      if (step === 1) return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "check_availability", input: { date: "2026-10-06", party_size: 2, time: "19:00" } }] };
      return { stop_reason: "end_turn", content: [{ type: "text", text: "Sí, tengo a las siete. ¿A nombre de quién?" }] };
    };
    const out = await casiaReply([{ role: "user", content: "Hola, ¿tienen mesa para dos hoy a las 7?" }], ctx, { call: fake as never });
    expect(out).toEqual({ text: "Sí, tengo a las siete. ¿A nombre de quién?", tools: ["check_availability"] });

    const [c] = await db.select().from(calls).where(eq(calls.id, ctx.callId!));
    const rep = readReport({ message: { type: "end-of-call-report", call: { id: c.vapiCallId, customer: { number: CALLER } }, durationSeconds: 75, endedReason: "customer-ended-call",
      artifact: { messages: [{ role: "bot", message: "Hola" }, { role: "user", message: "Mesa para dos" }] } } })!;
    await closeCall(db, r, rep, async () => ({ summary: "Pidió mesa para dos.", topic: "reservation", language: "es", sentiment: "positive" }));
    // llamada colgada sin hablar
    await closeCall(db, r, readReport({ message: { type: "end-of-call-report", call: { id: "silent", customer: { number: "+12095559999" } }, artifact: { messages: [{ role: "bot", message: "Hola" }] } } })!);

    const ins = await insights(db, r.id, r.timezone, 7, new Date("2026-10-07T00:00:00Z"));
    expect(ins.totalCalls).toBeGreaterThanOrEqual(2);
    expect(ins.answerRate).toBeLessThan(1);
    expect(ins.byLanguage.es).toBe(1);
    expect(ins.satisfaction).toBe(1);
  });
});
