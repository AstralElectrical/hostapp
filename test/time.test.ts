import { describe, expect, it } from "vitest";
import { isOpenAt, localParts, zonedToUtc, describeWeek, speakable } from "@/lib/time";

const TZ = "America/Los_Angeles";
const hours = [{ weekday: 5, opens: 17 * 60, closes: 26 * 60 }, { weekday: 2, opens: 660, closes: 1260 }]; // viernes 5pm–2am, martes 11–9

describe("time", () => {
  it("convierte hora local a UTC con horario de verano e invierno", () => {
    expect(zonedToUtc("2026-10-06", 19 * 60, TZ).toISOString()).toBe("2026-10-07T02:00:00.000Z"); // PDT
    expect(zonedToUtc("2026-12-01", 19 * 60, TZ).toISOString()).toBe("2026-12-02T03:00:00.000Z"); // PST
    expect(localParts(new Date("2026-10-07T02:00:00Z"), TZ)).toMatchObject({ ymd: "2026-10-06", minutes: 1140, weekday: 2 });
  });
  it("sabe si está abierto, incluso pasada la medianoche", () => {
    expect(isOpenAt(new Date("2026-10-06T19:00:00Z"), TZ, hours, [])).toBe(true); // martes mediodía
    expect(isOpenAt(new Date("2026-10-07T05:00:00Z"), TZ, hours, [])).toBe(false); // martes 10pm
    expect(isOpenAt(new Date("2026-10-10T08:00:00Z"), TZ, hours, [])).toBe(true); // sábado 1am (turno del viernes)
    expect(isOpenAt(new Date("2026-10-06T19:00:00Z"), TZ, hours, [{ day: "2026-10-06", closed: true, opens: null, closes: null }])).toBe(false);
  });
  it("describe la semana y dice fechas como persona", () => {
    expect(describeWeek(hours)).toContain("Friday: 5 PM–2 AM");
    expect(speakable(new Date("2026-10-07T02:30:00Z"), TZ)).toBe("Tuesday October 6 at 7:30 PM");
    expect(speakable(new Date("2026-10-07T02:30:00Z"), TZ, "es")).toBe("martes 6 de octubre a las 19:30");
  });
});
