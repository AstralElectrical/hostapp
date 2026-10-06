// Tiempo y horario en la zona del restaurante. Sin librerías: Intl hace la conversión de zona.
// Horario = UNA sola fuente de verdad: business_hours (semana) + hours_exceptions (feriados / días especiales).

export type HoursRow = { weekday: number; opens: number; closes: number };
export type ExceptionRow = { day: string; closed: boolean; opens: number | null; closes: number | null; note?: string | null };
export type Window = { opens: number; closes: number };

const DAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAYS_ES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/** Partes de fecha/hora locales de `date` en la zona `tz`. */
export function localParts(date: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short",
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  const y = Number(p.year), m = Number(p.month), d = Number(p.day);
  return { y, m, d, weekday, minutes: Number(p.hour) * 60 + Number(p.minute), ymd: `${p.year}-${p.month}-${p.day}` };
}

/** Fecha local (YYYY-MM-DD) + minutos desde medianoche en `tz` → instante UTC. Maneja horario de verano. */
export function zonedToUtc(ymd: string, minutes: number, tz: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, 0) + minutes * 60_000;
  // Ajusta por el desfase de la zona en ese instante (dos pasadas cubren el cambio de horario).
  let t = guess;
  for (let i = 0; i < 2; i++) {
    const lp = localParts(new Date(t), tz);
    const asUtc = Date.UTC(lp.y, lp.m - 1, lp.d, 0, 0) + lp.minutes * 60_000;
    t += guess - asUtc;
  }
  return new Date(t);
}

export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

export function weekdayOf(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Ventanas de apertura de un día local (antes de considerar las que vienen cruzando medianoche del día anterior). */
export function windowsForDay(ymd: string, hours: HoursRow[], exceptions: ExceptionRow[]): Window[] {
  const ex = exceptions.find((e) => e.day === ymd);
  if (ex) {
    if (ex.closed || ex.opens == null || ex.closes == null) return [];
    return [{ opens: ex.opens, closes: ex.closes }];
  }
  const wd = weekdayOf(ymd);
  return hours.filter((h) => h.weekday === wd).map((h) => ({ opens: h.opens, closes: h.closes })).sort((a, b) => a.opens - b.opens);
}

/** ¿Está abierto en el instante `at`? Considera turnos que cruzan medianoche (closes > 1440). */
export function isOpenAt(at: Date, tz: string, hours: HoursRow[], exceptions: ExceptionRow[]): boolean {
  const lp = localParts(at, tz);
  if (windowsForDay(lp.ymd, hours, exceptions).some((w) => lp.minutes >= w.opens && lp.minutes < w.closes)) return true;
  const prev = addDays(lp.ymd, -1);
  return windowsForDay(prev, hours, exceptions).some((w) => w.closes > 1440 && lp.minutes + 1440 < w.closes);
}

export function fmtMinutes(min: number, lang: "es" | "en" = "en"): string {
  const m = ((min % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60), mm = m % 60;
  if (lang === "es") return `${h24}:${String(mm).padStart(2, "0")}`;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}${mm ? `:${String(mm).padStart(2, "0")}` : ""} ${h24 < 12 ? "AM" : "PM"}`;
}

/** Horario semanal en texto para el prompt de Casia y para la web. */
export function describeWeek(hours: HoursRow[], lang: "es" | "en" = "en"): string {
  const names = lang === "es" ? DAYS_ES : DAYS_EN;
  return [1, 2, 3, 4, 5, 6, 0].map((wd) => {
    const ws = hours.filter((h) => h.weekday === wd).sort((a, b) => a.opens - b.opens);
    const txt = ws.length ? ws.map((w) => `${fmtMinutes(w.opens, lang)}–${fmtMinutes(w.closes, lang)}`).join(", ") : (lang === "es" ? "cerrado" : "closed");
    return `${names[wd]}: ${txt}`;
  }).join("\n");
}

export function dayName(ymd: string, lang: "es" | "en" = "en"): string {
  return (lang === "es" ? DAYS_ES : DAYS_EN)[weekdayOf(ymd)];
}

/** "Thursday Oct 9 at 7:30 PM" en la zona del restaurante (para hablar y para SMS). */
export function speakable(at: Date, tz: string, lang: "es" | "en" = "en"): string {
  const lp = localParts(at, tz);
  const month = new Intl.DateTimeFormat(lang === "es" ? "es-MX" : "en-US", { timeZone: tz, month: "long" }).format(at);
  return lang === "es"
    ? `${dayName(lp.ymd, "es")} ${lp.d} de ${month} a las ${fmtMinutes(lp.minutes, "es")}`
    : `${dayName(lp.ymd)} ${month} ${lp.d} at ${fmtMinutes(lp.minutes)}`;
}
