import type { Metadata } from "next";
import Link from "next/link";
import { FileSpreadsheet } from "lucide-react";
import { getStoreContext, planFeature } from "@/lib/auth/permissions";
import { checkProductsQuota } from "@/lib/commerce/quotas";
import { PLANS } from "@/config/plans";
import { PageHeader, Alert } from "@/components/ui/misc";
import { Progress } from "@/components/ui/progress";
import { PlanGate } from "@/components/app/plan-gate";
import { ImportForm } from "./import-form";

export const metadata: Metadata = { title: "Importer des produits" };

export default async function ImportPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const ctx = await getStoreContext(storeId, "products.manage");
  const base = `/app/${ctx.store.id}`;
  const canImport = planFeature(ctx.planId, "csvImport");
  const quota = await checkProductsQuota(ctx.store.id, ctx.planId);
  const remaining = quota.limit != null ? Math.max(0, quota.limit - quota.used) : null;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        back={{ href: `${base}/produits`, label: "Produits" }}
        title="Importer des produits"
        description="Fichier CSV ou export Excel, séparateur virgule ou point-virgule. Vous associez les colonnes avant de valider."
      />
      {!canImport ? (
        <PlanGate
          storeId={ctx.store.id}
          feature="csvImport"
          description={`Votre plan ${PLANS[ctx.planId].name} ne permet pas l'import en masse. Vos produits actuels ne sont pas concernés.`}
          unlocks={["Jusqu'à 500 produits par fichier", "Association libre des colonnes", "Export CSV du catalogue et des clients"]}
        />
      ) : (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="flex items-start gap-3 rounded-[var(--radius-lg)] bg-surface px-4 py-3 ring-1 ring-line">
              <FileSpreadsheet className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
              <p className="text-sm text-ink-muted">
                Colonnes reconnues : <span className="font-medium text-ink">Nom</span> et <span className="font-medium text-ink">Prix</span> (obligatoires), puis Description, Catégorie, SKU et Stock. Les catégories manquantes sont créées automatiquement.
              </p>
            </div>
            {quota.limit != null && (
              <div className="w-full rounded-[var(--radius-lg)] bg-surface px-4 py-3 ring-1 ring-line sm:w-64">
                <Progress value={quota.used} max={quota.limit} size="sm" label="Produits du plan" showValue />
              </div>
            )}
          </div>
          {remaining === 0 ? (
            <Alert tone="warning" title="Limite de produits atteinte">
              Votre plan ne permet pas d&apos;ajouter de nouveaux produits.{" "}
              <Link href={`${base}/abonnement#plans`} className="font-semibold underline underline-offset-4">
                Augmenter la limite
              </Link>
            </Alert>
          ) : (
            <ImportForm storeId={ctx.store.id} currency={ctx.store.currency} stockTracking={planFeature(ctx.planId, "stockTracking")} remaining={remaining} />
          )}
        </>
      )}
    </div>
  );
}
