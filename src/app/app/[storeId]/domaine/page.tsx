import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink, Globe, ShieldCheck, ShoppingBag } from "lucide-react";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import type { DomainRegistrationStatus } from "@prisma/client";
import { PLANS } from "@/config/plans";
import { SITE } from "@/config/site";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { domainSalesEnabled } from "@/lib/domains/registrar";
import { sellableTlds } from "@/lib/domains/names";
import { PageHeader, EmptyState, Alert, StatusDot } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PlanGate } from "@/components/app/plan-gate";
import { CopyButton } from "@/components/app/action-controls";
import { SlugForm, AddDomainForm, DomainCard } from "./domaine-client";
import { DomainPurchase, RegistrationActions, type ContactDefaults } from "./purchase-client";

const REG_LABEL: Record<DomainRegistrationStatus, string> = {
  AWAITING_PAYMENT: "En attente de paiement",
  PENDING: "Enregistrement en cours",
  REGISTERED: "Actif",
  FAILED: "Opération en attente (notre équipe s'en occupe)",
  EXPIRED: "Expiré",
  TRANSFERRED_OUT: "Transféré",
  CANCELLED: "Annulé",
};

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

  // Domaines achetés via Axi (isolation : filtrés par storeId)
  const registrations = await db.domainRegistration.findMany({
    where: { storeId: store.id, status: { not: "CANCELLED" } },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { charges: { where: { status: "OPEN" }, orderBy: { createdAt: "desc" }, take: 1, select: { invoiceId: true, kind: true } } },
  });
  const canSell = hasCustom && domainSalesEnabled();
  const [firstName, ...rest] = (ctx.user.name ?? "").trim().split(/\s+/);
  const phone = store.contactPhone ?? store.whatsappNumber ?? "";
  const defaults: ContactDefaults = {
    firstName: firstName ?? "",
    lastName: rest.join(" "),
    organization: store.name,
    email: store.contactEmail ?? ctx.user.email,
    phone: phone ? (phone.startsWith("+") ? phone : `+${phone.replace(/\D/g, "")}`) : "",
    address1: store.address ?? "",
    city: store.city ?? "",
    zip: "",
    country: store.country ?? "",
  };
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

          {hasCustom && (
            <Card as="section" aria-labelledby="buy-title">
              <CardHeader
                title={
                  <span id="buy-title" className="inline-flex items-center gap-2">
                    <ShoppingBag className="size-[18px] text-primary" aria-hidden /> Acheter un nom de domaine
                  </span>
                }
                description={`Axi enregistre le domaine à votre nom, le relie à votre boutique (HTTPS inclus) et le renouvelle. Prix en ${store.currency}, payable sur facture.`}
              />
              <CardBody>
                {canSell ? (
                  <DomainPurchase storeId={store.id} defaults={defaults} tlds={sellableTlds()} />
                ) : (
                  <Alert tone="info">L&apos;achat de domaine via Axi arrive bientôt. En attendant, connectez un domaine que vous possédez ci-dessus.</Alert>
                )}
                <p className="mt-4 text-sm text-ink-muted">
                  Domaine en .bj ou autre extension nationale ? Il ne peut pas être acheté via Axi : réservez-le auprès du registre de votre pays, puis connectez-le avec « Connecter un domaine que vous possédez ».
                </p>
              </CardBody>
            </Card>
          )}

          {registrations.length > 0 && (
            <ul className="space-y-3" aria-label="Domaines achetés via Axi">
              {registrations.map((r) => {
                const open = r.charges[0];
                return (
                  <li key={r.id}>
                    <Card>
                      <CardBody className="space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-mono text-[15px] text-ink">{r.domainName}</span>
                          <Badge tone={r.status === "REGISTERED" ? "success" : r.status === "FAILED" || r.status === "EXPIRED" ? "warning" : "neutral"} dot>
                            {REG_LABEL[r.status]}
                          </Badge>
                        </div>
                        {r.expiresAt && r.status === "REGISTERED" && (
                          <p className="text-sm text-ink-muted">
                            Échéance le {formatDate(r.expiresAt)}. {r.autoRenew ? "Facture de renouvellement envoyée 30 jours avant." : "Renouvellement automatique désactivé."}
                          </p>
                        )}
                        {open?.invoiceId && (
                          <Alert tone="warning" title={open.kind === "REGISTER" ? "Facture d'achat à régler" : "Facture de renouvellement à régler"}>
                            <Link href={`/app/${store.id}/abonnement/factures/${open.invoiceId}`} className="font-medium text-primary underline-offset-4 hover:underline">
                              Voir et payer la facture
                            </Link>
                          </Alert>
                        )}
                        {r.status === "REGISTERED" && <RegistrationActions storeId={store.id} id={r.id} autoRenew={r.autoRenew} canRenew={!open} />}
                        <p className="text-xs text-ink-muted">Acheté {formatMoney(r.price, r.currency)} · protection de la vie privée {r.privacyProtection ? "active" : "inactive"}</p>
                      </CardBody>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
