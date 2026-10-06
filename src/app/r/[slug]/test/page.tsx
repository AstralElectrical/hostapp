import { requireRestaurant } from "@/lib/auth";
import { firstMessage } from "@/lib/casia/prompt";
import { loadBundle } from "@/lib/services/restaurant";
import { getDb } from "@/db";
import TestChat from "./chat";

export default async function TestPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const r = await requireRestaurant(slug);
  const greeting = firstMessage(await loadBundle(getDb(), r));
  return (
    <>
      <h1>Probar a {r.voiceName}</h1>
      <p className="muted">Escríbele como si fueras un cliente. Usa el mismo cerebro que en el teléfono, en modo práctica: no se reserva, no se cobra y no se manda ningún mensaje.</p>
      <TestChat slug={slug} greeting={greeting} />
    </>
  );
}
