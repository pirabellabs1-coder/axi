import { redirect } from "next/navigation";
import { getStorefront } from "@/lib/storefront/data";
import { StorefrontView, type SP } from "@/components/storefront/storefront-view";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<SP> };

export default async function StoreHome({ params, searchParams }: Props) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  // Compatibilité des anciens liens : ?q= → recherche, ?cat= → collection.
  if (typeof sp.q === "string" && sp.q.trim()) redirect(`/s/${slug}/recherche?q=${encodeURIComponent(sp.q.trim().slice(0, 80))}`);
  if (typeof sp.cat === "string" && sp.preview !== "1") {
    const store = (await getStorefront(slug))?.store;
    const c = store?.categories.find((x) => x.id === sp.cat);
    if (c) redirect(`/s/${slug}/collections/${c.slug}`);
  }
  return <StorefrontView slug={slug} template="home" searchParams={sp} />;
}
