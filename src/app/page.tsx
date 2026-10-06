import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { restaurants } from "@/db/schema";
import { session } from "@/lib/auth";

export default async function Home() {
  const s = await session();
  if (!s) redirect("/login");
  const [r] = await getDb().select({ slug: restaurants.slug }).from(restaurants).where(eq(restaurants.id, s.restaurantId)).limit(1);
  redirect(r ? `/r/${r.slug}` : "/login");
}
