/** Normaliza a E.164 US (+1XXXXXXXXXX). null si no parece un número válido. */
export function toE164(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (/^\+\d{10,15}$/.test(s)) return s;
  const d = s.replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return null;
}

/** (209) 555-0134 para pantallas. */
export function prettyPhone(e164: string | null | undefined): string {
  const d = (e164 ?? "").replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return ten.length === 10 ? `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}` : (e164 ?? "");
}
