import { after } from "next/server";
import { getDb } from "@/db";
import { getRestaurantBySlug } from "@/lib/services/restaurant";
import { closeCall, readReport } from "@/lib/services/voice";
import { secretOk } from "@/lib/vapi";

// "Server URL" de Vapi: aquí llega el end-of-call-report (transcripción, duración, grabación).
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: Promise<{ slug: string; secret: string }> }) {
  const { slug, secret } = await params;
  if (!secretOk(secret)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const rep = readReport(body);
  if (!rep) return Response.json({ ok: true, ignored: true });
  const db = getDb();
  const restaurant = await getRestaurantBySlug(db, slug);
  if (!restaurant) return Response.json({ ok: false }, { status: 404 });
  after(() => closeCall(db, restaurant, rep).catch((e) => console.error("[events]", e)));
  return Response.json({ ok: true });
}
