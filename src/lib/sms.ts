import "server-only";
import { toE164 } from "./phone";

// SMS vía Twilio REST (mismo patrón que Ana). Sin configuración → no rompe: devuelve skipped.
// MODO PRUEBA: con SMS_DRY_RUN=1 (o sin credenciales) nada sale; se registra en consola.
export type SmsResult = { ok: boolean; id?: string; error?: string; skipped?: boolean };

export function smsConfigured(): boolean {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM) && process.env.SMS_DRY_RUN !== "1";
}

export async function sendSms(opts: { to: string; body: string }): Promise<SmsResult> {
  const to = toE164(opts.to);
  if (!to) return { ok: false, error: "invalid-phone" };
  if (!smsConfigured()) {
    console.info("[sms:dry-run]", to, opts.body);
    return { ok: false, skipped: true, error: "sms-not-configured" };
  }
  const sid = process.env.TWILIO_ACCOUNT_SID!, token = process.env.TWILIO_AUTH_TOKEN!, from = process.env.TWILIO_FROM!;
  try {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: to, From: from, Body: opts.body }).toString(),
    });
    const j = (await r.json().catch(() => ({}))) as { sid?: string; message?: string };
    if (!r.ok) return { ok: false, error: (j?.message || `HTTP ${r.status}`).slice(0, 240) };
    return { ok: true, id: j?.sid };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "sms-send-failed" };
  }
}
