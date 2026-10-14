import type { Metadata } from "next";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { getBalances } from "@/lib/credits";
import { parseBrandKit } from "@/lib/brand-kit/palette";
import { isAiConfigured } from "@/lib/ai/client";
import { isFakeAi } from "@/lib/ai/design/fake";
import { DESIGN_CREDITS, grantOnboardingGiftSafe } from "@/lib/ai/design/credits";
import { PageHeader } from "@/components/ui/misc";
import { GenerateDesignView } from "./generate-view";

export const metadata: Metadata = { title: "Générer la boutique avec l'IA" };

/**
 * Lot 4 §9 : formulaire de génération de boutique par l'IA.
 * Rien n'est enregistré ici : la page propose 3 aperçus ; seul « Choisir » écrit le brouillon,
 * après une version de sauvegarde « Avant génération IA ». Aucune publication automatique.
 */
export default async function GenerateDesignPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const ctx = await getStoreContext(storeId, "theme.manage");
  const store = ctx.store;
  const plan = PLANS[ctx.planId];

  // Crédits offerts à la création de la boutique (idempotent, une seule fois par boutique).
  const gift = await grantOnboardingGiftSafe(store.id);
  const [balances, collections, products, reviewCount] = await Promise.all([
    getBalances(store.id),
    db.category.count({ where: { storeId: store.id, published: true } }),
    db.product.count({ where: { storeId: store.id, status: "ACTIVE" } }),
    db.review.count({ where: { storeId: store.id, status: "APPROVED" } }),
  ]);

  return (
    <>
      <PageHeader
        title="Générer la boutique avec l'IA"
        description="Décrivez votre activité : l'IA propose 3 directions complètes. Vous comparez, vous choisissez, et rien n'est publié sans vous."
        back={{ href: `/app/${store.id}/apparence`, label: "Personnaliser la boutique" }}
      />
      <GenerateDesignView
        storeId={store.id}
        slug={store.slug}
        storeName={store.name}
        sector={store.sector}
        logoUrl={store.logoUrl}
        brandKit={parseBrandKit(store.brandKit)}
        aiBalance={balances.AI}
        gift={gift}
        costs={{ generate: DESIGN_CREDITS.generate, withPhotos: DESIGN_CREDITS.generateWithPhotos, regenerate: DESIGN_CREDITS.regenerate }}
        planName={plan.name}
        enabled={plan.features.aiStoreBuilder}
        configured={isAiConfigured() || isFakeAi()}
        simulated={isFakeAi()}
        facts={{ collections, products, hasReviews: reviewCount > 0 }}
      />
    </>
  );
}
