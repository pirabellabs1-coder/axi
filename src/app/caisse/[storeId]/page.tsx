import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { PageHeader } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { PlanGate } from "@/components/app/plan-gate";
import { MAX_DISCOUNT_PERCENT, CASH_ROUNDING_STEP, type PosRole } from "@/lib/pos/cash";
import { PosApp } from "./caisse-client";

export const metadata: Metadata = { title: "Caisse", robots: { index: false } };

/**
 * ÉCRAN DE VENTE de la caisse en magasin (lot 3 §2) : plein écran, utilisable HORS LIGNE (service
 * worker dédié `/caisse/sw.js` et instantané du catalogue en IndexedDB). L'accès exige une session
 * membre avec la capacité `pos.sell` ET un appareil enregistré (jeton haché, révocable).
 *
 * Réglages et suivi (enregistrement et révocation d'appareils, code du gérant, sessions, rapports Z)
 * vivent dans l'espace marchand, sur `/app/[storeId]/caisse` : cet écran ne garde que le strict
 * nécessaire au comptoir, et un retour visible vers l'espace marchand.
 */
export default async function PosPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const ctx = await getStoreContext(storeId, "pos.sell");
  const plan = PLANS[ctx.planId];
  const settingsHref = `/app/${ctx.store.id}/caisse`;

  if (plan.limits.posDevices === 0) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-8">
        <PageHeader
          title="Caisse en magasin"
          description="Encaissez au comptoir, même sans réseau : les ventes sont mises en file et synchronisées au retour de la connexion."
        />
        <PlanGate feature="pos" storeId={storeId} />
        <ButtonLink href={settingsHref} variant="secondary" size="md" className="mt-4 h-12">
          <ArrowLeft className="size-4" aria-hidden /> Retour à l&apos;espace marchand
        </ButtonLink>
      </div>
    );
  }

  const [devices, sessions] = await Promise.all([
    db.posDevice.findMany({
      where: { storeId: ctx.store.id, revokedAt: null },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, tokenPrefix: true, locationId: true },
    }),
    db.posSession.findMany({
      where: { storeId: ctx.store.id, status: "OPEN" },
      select: { id: true, deviceId: true, openedAt: true, openingFloat: true },
    }),
  ]);

  return (
    <PosApp
      storeId={ctx.store.id}
      storeName={ctx.store.name}
      currency={ctx.store.currency}
      role={ctx.role as PosRole}
      maxDiscountPercent={MAX_DISCOUNT_PERCENT[ctx.role as PosRole] ?? 0}
      cashRoundingStep={CASH_ROUNDING_STEP}
      canManageDevices={ctx.can("store.settings")}
      managerCodeSet={!!ctx.store.posManagerCodeHash}
      devices={devices.map((d) => ({ id: d.id, name: d.name, tokenPrefix: d.tokenPrefix, openSessionId: sessions.find((s) => s.deviceId === d.id)?.id ?? null }))}
    />
  );
}
