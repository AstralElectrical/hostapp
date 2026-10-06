import { callClaude, textOf, WORK_MODEL } from "@/lib/anthropic";

// MENÚ INTELIGENTE: el dueño sube el PDF (o pega el texto) y Claude lo convierte en platillos con precio.
// El dueño revisa antes de guardar; los precios que usa Casia salen de la tabla, no del PDF.

export type ImportedItem = {
  category: string; name: string; nameEs?: string | null; description?: string | null; priceCents: number;
  tags?: string[]; allergens?: string[]; modifiers?: { name: string; priceCents: number }[];
};

const SYSTEM = `Extract a restaurant menu into JSON. Return ONLY a JSON array of items:
[{"category": "...", "name": "...", "nameEs": "Spanish name if the menu shows one, else null", "description": "... or null", "priceCents": 1250, "tags": ["vegetarian","vegan","gluten-free","spicy"], "allergens": ["nuts","dairy","gluten","shellfish","egg","soy","fish"], "modifiers": [{"name": "Add chicken", "priceCents": 400}]}]
Rules: copy names and prices exactly; priceCents is an integer; if an item has sizes, make one item per size ("Pozole (small)"); skip items with no price; only tag/allergen what the menu states.`;

export function parseItems(raw: string): ImportedItem[] {
  const s = raw.replace(/^```(json)?/m, "").replace(/```\s*$/m, "").trim();
  const start = s.indexOf("["), end = s.lastIndexOf("]");
  if (start < 0 || end < 0) return [];
  let arr: unknown;
  try { arr = JSON.parse(s.slice(start, end + 1)); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  return arr
    .map((x: any): ImportedItem | null => {
      const price = Math.round(Number(x?.priceCents));
      if (!x?.name || !Number.isFinite(price) || price <= 0) return null;
      return {
        category: String(x.category || "Menu").slice(0, 60),
        name: String(x.name).slice(0, 120),
        nameEs: x.nameEs ? String(x.nameEs).slice(0, 120) : null,
        description: x.description ? String(x.description).slice(0, 400) : null,
        priceCents: price,
        tags: Array.isArray(x.tags) ? x.tags.map(String).slice(0, 8) : [],
        allergens: Array.isArray(x.allergens) ? x.allergens.map(String).slice(0, 10) : [],
        modifiers: Array.isArray(x.modifiers) ? x.modifiers.filter((m: any) => m?.name).map((m: any) => ({ name: String(m.name).slice(0, 60), priceCents: Math.max(0, Math.round(Number(m.priceCents) || 0)) })) : [],
      };
    })
    .filter((x): x is ImportedItem => x !== null);
}

export async function importMenu(input: { pdfBase64?: string; text?: string }): Promise<ImportedItem[]> {
  const content: unknown[] = [];
  if (input.pdfBase64) content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: input.pdfBase64 } });
  if (input.text) content.push({ type: "text", text: input.text.slice(0, 60_000) });
  content.push({ type: "text", text: "Extract every menu item." });
  const res = await callClaude({ model: WORK_MODEL(), max_tokens: 16000, system: SYSTEM, messages: [{ role: "user", content }] });
  return res ? parseItems(textOf(res.content)) : [];
}
