import { describe, expect, it } from "vitest";
import { priceOrder } from "@/lib/services/orders";
import type { MenuItem } from "@/db/schema";

const item = (o: Partial<MenuItem>): MenuItem => ({ id: "x", restaurantId: "r", category: "c", name: "n", nameEs: null, description: null, priceCents: 100, available: true, tags: [], allergens: [], modifiers: [], sort: 0, ...o });
const menu = [item({ id: "a", name: "Taco", priceCents: 400, modifiers: [{ name: "Add cheese", priceCents: 75 }] }), item({ id: "b", name: "Soda", priceCents: 250, available: false })];

describe("priceOrder", () => {
  it("precia desde el menú, nunca desde lo que diga la IA", () => {
    const r = priceOrder(menu, [{ menu_item_id: "a", qty: 3, modifiers: ["add cheese"] }]);
    expect(r).toMatchObject({ ok: true, subtotalCents: 1425 });
  });
  it("rechaza platillos inexistentes, agotados u opciones inventadas", () => {
    const r = priceOrder(menu, [{ menu_item_id: "zzz", qty: 1 }, { menu_item_id: "b", qty: 1 }, { menu_item_id: "a", qty: 1, modifiers: ["gold flakes"] }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toHaveLength(3);
  });
});
