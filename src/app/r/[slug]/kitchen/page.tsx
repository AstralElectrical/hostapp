import { requireRestaurant } from "@/lib/auth";
import Kitchen from "./kitchen";

export default async function KitchenPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const r = await requireRestaurant(slug);
  return <><h1>Cocina</h1><Kitchen slug={slug} tz={r.timezone} /></>;
}
