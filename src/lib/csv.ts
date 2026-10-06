/** CSV seguro para Excel (incluye BOM y neutraliza fórmulas inyectadas). */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "﻿";
  const cols = Object.keys(rows[0]);
  const cell = (v: unknown) => {
    let s = v == null ? "" : v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n");
}
