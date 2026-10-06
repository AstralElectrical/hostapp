// Crea el assistant "Casia" en Vapi COPIANDO la voz y el transcriptor de Ana (Astral Field) y apuntando el
// cerebro a HostApp. Por defecto solo MUESTRA lo que haría; con --apply lo crea. NO compra números.
//
//   VAPI_API_KEY=… ANA_ASSISTANT_ID=… APP_URL=https://hostapp.vercel.app VOICE_WEBHOOK_SECRET=… DATABASE_URL=… \
//     npm run vapi:setup -- <slug> [--apply]
//
// Después, en Vapi → Phone Numbers, asigna este assistant al número del restaurante (o desvía su línea a ese número).
import { getDb } from "../src/db";
import { firstMessage } from "../src/lib/casia/prompt";
import { getRestaurantBySlug, loadBundle } from "../src/lib/services/restaurant";

const slug = process.argv[2];
const apply = process.argv.includes("--apply");
const need = (k: string) => { const v = process.env[k]; if (!v) { console.error(`Falta ${k}`); process.exit(1); } return v; };
if (!slug) { console.error("Uso: npm run vapi:setup -- <slug> [--apply]"); process.exit(1); }

const key = need("VAPI_API_KEY"), ana = need("ANA_ASSISTANT_ID"), app = need("APP_URL").replace(/\/$/, ""), secret = need("VOICE_WEBHOOK_SECRET");
const db = getDb();
const r = await getRestaurantBySlug(db, slug);
if (!r) { console.error(`No existe el restaurante ${slug}`); process.exit(1); }
const bundle = await loadBundle(db, r);

const res = await fetch(`https://api.vapi.ai/assistant/${ana}`, { headers: { authorization: `Bearer ${key}` } });
if (!res.ok) { console.error("No pude leer el assistant de Ana:", res.status, await res.text()); process.exit(1); }
const anaCfg = (await res.json()) as Record<string, any>;

// Misma voz que Ana; transcriptor en modo multilingüe para español/inglés en la misma llamada.
const transcriber = anaCfg.transcriber?.provider === "deepgram"
  ? { ...anaCfg.transcriber, model: "nova-3", language: "multi" }
  : anaCfg.transcriber;

const assistant = {
  name: `Casia · ${r.name}`.slice(0, 40),
  firstMessage: firstMessage(bundle),
  firstMessageMode: "assistant-speaks-first",
  voice: anaCfg.voice,
  transcriber,
  model: { provider: "custom-llm", url: `${app}/api/voice/${slug}/${secret}`, model: "hostapp-casia", messages: [{ role: "system", content: "HostApp" }] },
  server: { url: `${app}/api/voice/${slug}/${secret}/events` },
  serverMessages: ["end-of-call-report"],
  monitorPlan: { listenEnabled: false, controlEnabled: true }, // controlUrl → transferencias en vivo
  backgroundSound: "off",
  endCallFunctionEnabled: true,
  artifactPlan: { recordingEnabled: true },
};

if (!apply) {
  console.log("VISTA PREVIA (no se creó nada). Agrega --apply para crearlo:\n", JSON.stringify({ ...assistant, model: { ...assistant.model, url: assistant.model.url.replace(secret, "<secreto>") }, server: { url: assistant.server.url.replace(secret, "<secreto>") } }, null, 2));
  process.exit(0);
}
const created = await fetch("https://api.vapi.ai/assistant", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(assistant) });
const j = (await created.json()) as { id?: string; message?: unknown };
if (!created.ok) { console.error("Vapi rechazó el assistant:", j); process.exit(1); }
console.log(`Listo: assistant ${j.id}. Asígnalo al número del restaurante en Vapi → Phone Numbers.`);
process.exit(0);
