import { apiRestaurant } from "@/lib/auth";
import { importMenu } from "@/lib/services/menu-import";

// Sube el PDF (o pega el texto) del menú → vista previa de platillos para revisar antes de guardar.
export const maxDuration = 120;

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const r = await apiRestaurant((await params).slug);
  if (!r) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const form = await req.formData();
  const file = form.get("file");
  const text = String(form.get("text") ?? "").trim();
  let pdfBase64: string | undefined;
  if (file instanceof File && file.size > 0) {
    if (file.size > 20 * 1024 * 1024) return Response.json({ error: "El PDF pesa más de 20 MB." }, { status: 400 });
    pdfBase64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  }
  if (!pdfBase64 && !text) return Response.json({ error: "Sube un PDF o pega el texto del menú." }, { status: 400 });
  const items = await importMenu({ pdfBase64, text: text || undefined });
  if (!items.length) return Response.json({ error: "No pude leer platillos con precio. Prueba pegando el texto." }, { status: 422 });
  return Response.json({ items });
}
