import type { Metadata } from "next";
import { StorefrontView, type SP } from "@/components/storefront/storefront-view";

export const metadata: Metadata = { title: "Panier", robots: { index: false } };

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<SP> };

export default async function CartRoute({ params, searchParams }: Props) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  return <StorefrontView slug={slug} template="cart" searchParams={sp} />;
}
