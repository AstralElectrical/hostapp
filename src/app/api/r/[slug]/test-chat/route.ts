import { getDb } from "@/db";
import { apiRestaurant } from "@/lib/auth";
import { voiceTurn } from "@/lib/services/voice";
import type { Turn } from "@/lib/casia/brain";

// "Probar a Casia" desde el panel: el MISMO cerebro, en modo práctica (nada se reserva ni se envía).
export const maxDuration = 30;

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const r = await apiRestaurant((await params).slug);
  if (!r) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { turns } = (await req.json().catch(() => ({}))) as { turns?: Turn[] };
  const out = await voiceTurn(getDb(), r, { turns: Array.isArray(turns) ? turns.slice(-40) : [], vapiCallId: null, callerPhone: "+12095550123", controlUrl: null, test: true, defer: () => {} });
  return Response.json(out);
}
