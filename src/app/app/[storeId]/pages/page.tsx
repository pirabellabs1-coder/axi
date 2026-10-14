import type { Metadata } from "next";
import Link from "next/link";
import { FileText, Plus, ExternalLink } from "lucide-react";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { PLANS, planRank } from "@/config/plans";
import { PAGE_TEMPLATES } from "@/lib/pages/constants";
import { PageHeader, EmptyState, Alert } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PlanGate } from "@/components/app/plan-gate";
import { relativeTime } from "@/lib/utils";
import { PageRowActions } from "./page-row-actions";

export const metadata: Metadata = { title: "Pages" };

export default async function PagesPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const ctx = await getStoreContext(storeId, "store.settings");
  const store = ctx.store;
  const base = `/app/${store.id}/pages`;
  const limit = PLANS[ctx.planId].limits.customPages;

  if (limit === 0) {
    return (
      <>
        <PageHeader title="Pages" description="À propos, questions fréquentes, conditions de livraison." />
        <PlanGate
          storeId={store.id}
          feature="removeBranding"
          title="Pages personnalisées"
          description="Ajoutez des pages À propos, FAQ ou Livraison et retours à votre boutique. 3 pages avec le plan Starter, illimitées à partir de Business."
        />
      </>
    );
  }

  const pages = await db.storePage.findMany({ where: { storeId: store.id }, orderBy: [{ position: "asc" }, { title: "asc" }] });
  const atLimit = limit !== null && pages.length >= limit;
  const usedSlugs = new Set(pages.map((p) => p.slug));
  const suggestions = PAGE_TEMPLATES.filter((t) => !usedSlugs.has(t.slug));

  return (
    <>
      <PageHeader
        title="Pages"
        description={limit === null ? "Pages d'information de votre boutique." : `${pages.length} sur ${limit} pages incluses dans votre plan.`}
        actions={
          atLimit ? (
            <ButtonLink href={`/app/${store.id}/abonnement`} variant="outline">
              Plus de pages avec Business
            </ButtonLink>
          ) : (
            <ButtonLink href={`${base}/nouvelle`} trailing={Plus}>
              Nouvelle page
            </ButtonLink>
          )
        }
      />

      {atLimit && planRank(ctx.planId) < planRank("BUSINESS") && (
        <Alert tone="info" className="mb-5">
          Vous avez atteint les {limit} pages de votre plan. Le plan Business offre des pages illimitées.
        </Alert>
      )}

      {pages.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Aucune page pour l'instant"
          description="Les pages répondent aux questions de vos clients avant qu'ils ne vous écrivent : livraison, retours, paiement."
          action={
            <ButtonLink href={`${base}/nouvelle`} trailing={Plus}>
              Créer une page
            </ButtonLink>
          }
        />
      ) : (
        <Card as="section" aria-label="Pages de la boutique">
          <ul className="divide-y divide-line">
            {pages.map((p, i) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-surface-2 text-ink-muted">
                  <FileText className="size-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <Link href={`${base}/${p.id}`} className="font-medium text-ink hover:text-primary hover:underline">
                    {p.title}
                  </Link>
                  <p className="truncate text-xs text-ink-muted">
                    <span className="font-mono">/{p.slug}</span> · modifiée {relativeTime(p.updatedAt)}
                  </p>
                </div>
                <PageRowActions storeId={store.id} id={p.id} title={p.title} published={p.published} first={i === 0} last={i === pages.length - 1} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {!atLimit && suggestions.length > 0 && (
        <section className="mt-8" aria-labelledby="tpl-title">
          <h2 id="tpl-title" className="mb-3 text-lg font-semibold text-ink">
            Pages suggérées
          </h2>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {suggestions.map((t) => (
              <li key={t.slug}>
                <Link href={`${base}/nouvelle?modele=${t.slug}`} className="group flex h-full flex-col rounded-[var(--radius-lg)] bg-surface p-4 ring-1 ring-line transition-shadow duration-200 hover:shadow-[var(--shadow-md)]">
                  <span className="flex items-center justify-between font-medium text-ink">
                    {t.title}
                    <Plus className="size-4 text-ink-faint transition-colors group-hover:text-primary" aria-hidden />
                  </span>
                  <span className="mt-1 line-clamp-2 text-sm text-ink-muted">{t.body.replace(/[#*\-\n]+/g, " ").trim()}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {pages.some((p) => p.published) && (
        <p className="mt-6 flex items-center gap-1.5 text-sm text-ink-muted">
          <ExternalLink className="size-4" aria-hidden /> Les pages publiées sont reliées à votre boutique{" "}
          <Link href={`/s/${store.slug}`} target="_blank" className="font-medium text-primary hover:underline">
            /s/{store.slug}
          </Link>
          .
        </p>
      )}
    </>
  );
}
