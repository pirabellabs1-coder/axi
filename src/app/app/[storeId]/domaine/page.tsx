import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink, Globe, PackagePlus, ShieldCheck } from "lucide-react";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { PLANS, ZONE_CURRENCY, getAddOn, zoneForCurrency, ADD_ON_BILLING_LABEL, type PricingZone } from "@/config/plans";
import { SITE } from "@/config/site";
import { formatMoney } from "@/lib/money";
import { PageHeader, EmptyState, Alert, StatusDot } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PlanGate } from "@/components/app/plan-gate";
import { CopyButton } from "@/components/app/action-controls";
import { SlugForm, AddDomainForm, DomainCard } from "./domaine-client";

export const metadata: Metadata = { title: "Domaine" };

export default async function DomainPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const ctx = await getStoreContext(storeId, "store.settings");
  const store = ctx.store;
  const hasCustom = PLANS[ctx.planId].features.customDomain;
  // Les domaines existants restent visibles après un changement de plan (lecture et retrait).
  const domains = await db.domain.findMany({ where: { storeId: store.id }, orderBy: { createdAt: "asc" } });
  const protocol = SITE.url.startsWith("https") ? "https" : "http";
  const host = `${store.slug}.${SITE.domain}`;
  const subdomainUrl = `${protocol}://${host}`;
  const pathUrl = `${SITE.url}/s/${store.slug}`;
  const appDomain = SITE.domain.split(":")[0];
  const primary = domains.find((d) => d.verified && d.isPrimary) ?? domains.find((d) => d.verified);

  const domainAddOn = getAddOn("DOMAIN_NAME");
  const zone = (store.subscription?.zone as PricingZone | undefined) ?? zoneForCurrency(store.currency);
  const addOnAvailable = !!domainAddOn && domainAddOn.plans.includes(ctx.planId);
  const addOnPrice = domainAddOn ? formatMoney(domainAddOn.price[zone], ZONE_CURRENCY[zone]) : null;
  const live = store.status === "PUBLISHED";

  return (
    <>
      <PageHeader title="Domaine" description="L'adresse de votre boutique : sous-domaine Axi inclus, ou votre propre nom de domaine." />

      <div className="space-y-6">
        {/* Adresse principale */}
        <section className="bezel" aria-labelledby="addr-title">
          <div className="bezel-core p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="addr-title" className="text-[15px] font-semibold tracking-tight text-ink">
                Adresse de votre boutique
              </h2>
              <StatusDot tone={live ? "success" : "neutral"}>{live ? "En ligne" : "Boutique non publiée"}</StatusDot>
            </div>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <a
                href={primary ? `https://${primary.hostname}` : subdomainUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="group inline-flex min-w-0 flex-1 items-center gap-3 rounded-[var(--radius-md)] bg-surface-2/70 px-4 py-3 ring-1 ring-inset ring-line transition-colors hover:ring-primary"
              >
                <Globe className="size-5 shrink-0 text-primary" aria-hidden />
                <span className="min-w-0 flex-1 truncate font-mono text-[15px] text-ink">{primary ? primary.hostname : host}</span>
                <ExternalLink className="size-4 shrink-0 text-ink-faint transition-colors group-hover:text-ink" aria-hidden />
                <span className="sr-only">(ouvre un nouvel onglet)</span>
              </a>
              <CopyButton value={primary ? `https://${primary.hostname}` : subdomainUrl} label="Copier le lien" className="h-11 rounded-full px-4" />
            </div>
            <dl className="mt-4 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              {primary && (
                <div className="flex min-w-0 items-center gap-2">
                  <dt className="shrink-0 text-ink-muted">Sous-domaine Axi :</dt>
                  <dd className="min-w-0 truncate font-mono text-[13px] text-ink">{host}</dd>
                </div>
              )}
              <div className="flex min-w-0 items-center gap-2">
                <dt className="shrink-0 text-ink-muted">Lien de secours :</dt>
                <dd className="min-w-0 truncate font-mono text-[13px] text-ink">{pathUrl.replace(/^https?:\/\//, "")}</dd>
              </div>
            </dl>
            <p className="mt-4 text-sm text-ink-muted">Partagez ce lien sur WhatsApp, Instagram, Facebook et vos QR codes.</p>
          </div>
        </section>

        <Card as="section" aria-labelledby="slug-title">
          <CardHeader title={<span id="slug-title">Changer le sous-domaine</span>} description="Choisissez un nom court et facile à dicter au téléphone." />
          <CardBody>
            <SlugForm storeId={store.id} slug={store.slug} domain={SITE.domain} />
          </CardBody>
        </Card>

        {/* Domaine personnalisé */}
        <section aria-labelledby="custom-title" className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="custom-title" className="text-lg font-semibold tracking-[-0.02em] text-ink">
              Domaine personnalisé
            </h2>
            {hasCustom ? <Badge tone="success">Inclus dans votre plan</Badge> : <Badge tone="sun">Plan Business</Badge>}
          </div>

          {!hasCustom ? (
            <>
              <PlanGate
                storeId={store.id}
                feature="customDomain"
                description="Vendez sur boutique.votremarque.com : une adresse à votre nom inspire confiance et se retient facilement."
                unlocks={["Votre propre domaine, certificat HTTPS inclus", "Achat du domaine via Axi avec l'option « Nom de domaine »", "Pixel Meta, Google Analytics et rapports avancés"]}
              />
              {domains.length > 0 && (
                <Alert tone="warning" title="Domaines inactifs">
                  Vos domaines sont conservés mais ne sont plus servis avec votre plan actuel. Vous pouvez les retirer ci-dessous.
                </Alert>
              )}
            </>
          ) : (
            <Card>
              <CardHeader title="Connecter un domaine que vous possédez" description="Un sous-domaine (boutique.votremarque.com) est le plus simple à configurer." />
              <CardBody>
                <AddDomainForm storeId={store.id} disabled={domains.length >= 3} />
              </CardBody>
            </Card>
          )}

          {domains.length > 0 ? (
            <ul className="space-y-3" aria-label="Domaines connectés">
              {domains.map((d) => (
                <DomainCard
                  key={d.id}
                  storeId={store.id}
                  appDomain={appDomain}
                  inactive={!hasCustom}
                  domain={{ id: d.id, hostname: d.hostname, verified: d.verified, verifyToken: d.verifyToken, isPrimary: d.isPrimary }}
                />
              ))}
            </ul>
          ) : (
            hasCustom && (
              <EmptyState
                icon={ShieldCheck}
                title="Aucun domaine connecté"
                description="Ajoutez votre domaine ci-dessus : nous vous indiquons les deux enregistrements DNS à créer, puis nous vérifions."
              />
            )
          )}

          {hasCustom && domainAddOn && (
            <div className="flex flex-wrap items-center gap-4 rounded-[var(--radius-lg)] bg-surface-2/60 px-5 py-4 ring-1 ring-line">
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-ink">
                <PackagePlus className="size-[18px]" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold text-ink">Pas encore de nom de domaine ?</p>
                <p className="mt-0.5 text-sm text-ink-muted">
                  Avec l&apos;option « {domainAddOn.name} », Axi achète, configure et renouvelle votre domaine pour vous
                  {addOnPrice ? ` (${addOnPrice} ${ADD_ON_BILLING_LABEL[domainAddOn.billing]})` : ""}.
                </p>
              </div>
              {addOnAvailable && (
                <Link
                  href={`/app/${store.id}/options#${domainAddOn.id}`}
                  className="inline-flex h-11 items-center gap-1.5 rounded-full bg-surface px-5 text-sm font-medium text-ink ring-1 ring-inset ring-line-strong transition-colors hover:bg-surface-2"
                >
                  Voir l&apos;option
                </Link>
              )}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
