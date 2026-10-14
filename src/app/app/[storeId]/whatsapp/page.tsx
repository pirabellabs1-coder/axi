import type { Metadata } from "next";
import Link from "next/link";
import { MessageCircle, MousePointerClick, ShoppingBag, Cloud, Phone, PackagePlus, ArrowUpRight, FileText } from "lucide-react";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { getCountry } from "@/config/site";
import { buildCartMessage } from "@/lib/whatsapp";
import { getUsage } from "@/lib/commerce/quotas";
import { creditBalances } from "@/lib/addons/service";
import { formatDateTime, formatPhone } from "@/lib/utils";
import { PageHeader, Kpi, EmptyState, Alert } from "@/components/ui/misc";
import { Card, CardBody, CardHeader, Bezel } from "@/components/ui/card";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ButtonLink } from "@/components/ui/button";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { PlanGate } from "@/components/app/plan-gate";
import { partnerModeConfig } from "@/lib/whatsapp/embedded-signup";
import { GRAPH_VERSION } from "@/lib/social/graph-client";
import { WhatsappForm } from "./whatsapp-form";
import { CloudApiForm } from "./cloud-api-form";
import { EmbeddedSignupButton } from "./embedded-signup";
import { buildEmbeddedSignupSetup } from "@/lib/whatsapp/embedded-signup-prefill";
import { MessagePreview } from "./message-preview";

export const metadata: Metadata = { title: "WhatsApp" };

const NOTIF_TONE: Record<string, BadgeTone> = { QUEUED: "info", SENT: "success", FAILED: "danger", SKIPPED: "neutral" };
const NOTIF_LABEL: Record<string, string> = { QUEUED: "En file", SENT: "Envoyée", FAILED: "Échec", SKIPPED: "Ignorée" };
const INTEG_TONE: Record<string, BadgeTone> = { inactive: "neutral", pending: "sun", active: "success", error: "danger" };
const INTEG_LABEL: Record<string, string> = { inactive: "Non connectée", pending: "En attente de validation", active: "Active", error: "Erreur" };

const nf = (n: number) => n.toLocaleString("fr-FR");

/** Il y a 30 jours (fenêtre des indicateurs). */
function thirtyDaysAgo() {
  return new Date(Date.now() - 30 * 86400_000);
}

export default async function WhatsappPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const ctx = await getStoreContext(storeId, "store.settings");
  const store = ctx.store;
  const plan = PLANS[ctx.planId];
  const hasApi = plan.features.whatsappApi;
  const since = thirtyDaysAgo();

  const [eventClicks, cartClicks, waOrders, sampleProducts, integration, notifications, messagesUsed, credits] = await Promise.all([
    db.orderEvent.count({ where: { type: "whatsapp_click", createdAt: { gte: since }, order: { storeId: store.id } } }),
    db.cart.count({ where: { storeId: store.id, whatsappClickedAt: { gte: since } } }),
    db.order.count({ where: { storeId: store.id, channel: "WHATSAPP", createdAt: { gte: since } } }),
    db.product.findMany({ where: { storeId: store.id, status: "ACTIVE" }, orderBy: { position: "asc" }, take: 2, select: { name: true, price: true } }),
    db.integration.findUnique({ where: { storeId_kind: { storeId: store.id, kind: "whatsapp_cloud" } } }),
    db.notification.findMany({ where: { storeId: store.id, channel: "whatsapp" }, orderBy: { createdAt: "desc" }, take: 20 }),
    getUsage(store.id, "whatsapp_messages"),
    hasApi ? creditBalances(store.id) : Promise.resolve([]),
  ]);

  const items = sampleProducts.length
    ? sampleProducts.map((p) => ({ name: p.name, quantity: 1, lineTotal: p.price }))
    : [{ name: "Exemple de produit", quantity: 2, lineTotal: 5000 }];
  const previewMessage = buildCartMessage({
    storeName: store.name,
    items,
    currency: store.currency,
    total: items.reduce((s, i) => s + i.lineTotal, 0),
    cartUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/s/${store.slug}/panier/EXEMPLE`,
  });
  const country = getCountry(store.country);
  const cfg = (integration?.config ?? {}) as { phoneNumberId?: string; wabaId?: string; source?: string };
  const status = integration?.status ?? "inactive";
  const partner = partnerModeConfig();
  const esSetup = buildEmbeddedSignupSetup({
    store,
    email: ctx.user.email,
    website: process.env.NEXT_PUBLIC_APP_URL ? `${process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/s/${store.slug}` : null,
    dialCode: getCountry(store.country).dialCode,
  });
  const connectedViaPartner = cfg.source === "embedded_signup";
  const clicks = eventClicks + cartClicks;
  const conversion = clicks > 0 ? Math.round((waOrders / clicks) * 100) : null;

  const quota = plan.limits.whatsappMessagesPerMonth;
  const packUtility = credits.find((c) => c.type === "WA_UTILITY")?.balance ?? 0;
  const packMarketing = credits.find((c) => c.type === "WA_MARKETING")?.balance ?? 0;
  const monthLabel = new Date().toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

  return (
    <>
      <PageHeader
        title="WhatsApp"
        description="Votre canal de vente principal. Le lien de commande wa.me est inclus dans tous les plans, l'API officielle à partir du plan Business."
      />

      {!store.whatsappNumber && (
        <Alert tone="warning" className="mb-6" title="Aucun numéro WhatsApp">
          Renseignez votre numéro pour que les clients puissent vous écrire depuis la boutique.
        </Alert>
      )}

      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Clics vers WhatsApp" value={nf(clicks)} hint="30 derniers jours" icon={MousePointerClick} />
        <Kpi label="Commandes WhatsApp" value={nf(waOrders)} hint="30 derniers jours" icon={ShoppingBag} />
        <Kpi label="Clics transformés" value={conversion == null ? "Aucun clic" : `${conversion} %`} hint="Commandes rapportées aux clics" icon={ArrowUpRight} />
        <Kpi
          label="Numéro actif"
          value={<span className="text-[19px]">{store.whatsappNumber ? formatPhone(store.whatsappNumber) : "Aucun"}</span>}
          hint={store.whatsappOrdering ? "Commande WhatsApp activée" : "Commande WhatsApp désactivée"}
          icon={Phone}
        />
      </div>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <WhatsappForm storeId={store.id} number={store.whatsappNumber ?? ""} ordering={store.whatsappOrdering} dialCode={country.dialCode} previewMessage={previewMessage} />
        <MessagePreview storeName={store.name} message={previewMessage} />
      </div>

      <section className="mt-10" aria-labelledby="api-title">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 id="api-title" className="text-lg font-semibold tracking-[-0.02em] text-ink">API WhatsApp officielle</h2>
            {hasApi ? (
              <Badge tone={INTEG_TONE[status]} dot>{INTEG_LABEL[status]}</Badge>
            ) : (
              <Badge tone="sun">Plan Business</Badge>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-ink-muted">Meta Cloud API, depuis votre propre numéro WhatsApp Business.</p>
            {hasApi && (
              <ButtonLink href={`/app/${store.id}/whatsapp/modeles`} variant="outline" size="sm">
                <FileText className="size-4" aria-hidden /> Modèles de messages
              </ButtonLink>
            )}
          </div>
        </div>

        {!hasApi ? (
          <PlanGate
            storeId={store.id}
            feature="whatsappApi"
            description="Envoyez automatiquement confirmations, avis de commande prête et suivis de livraison depuis votre numéro WhatsApp Business. Le lien de commande wa.me reste disponible sur votre plan actuel."
            unlocks={["Notifications automatiques depuis votre numéro", "300 messages inclus chaque mois", "Boîte de réception partagée avec l'équipe", "Campagnes WhatsApp aux clients consentants"]}
          />
        ) : (
          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-6">
              {partner && (
                <Card>
                  <CardHeader
                    title={
                      <span className="inline-flex items-center gap-2">
                        <MessageCircle className="size-4 text-primary" aria-hidden /> Connexion partenaire (recommandé)
                        {connectedViaPartner && status === "active" && <Badge tone="success" dot>Connecté</Badge>}
                      </span>
                    }
                    description="Connectez votre numéro WhatsApp Business en quelques clics via Meta. Axi configure l'envoi pour vous : aucun identifiant à recopier."
                  />
                  <CardBody>
                    {integration?.lastError && (
                      <Alert tone="danger" className="mb-4" title="La dernière connexion a échoué">
                        {integration.lastError}
                      </Alert>
                    )}
                    {connectedViaPartner && status === "active" ? (
                      <div className="space-y-4">
                        <Alert tone="success" title="Numéro connecté">
                          Votre numéro WhatsApp Business est connecté via le mode partenaire. Les messages partent depuis votre numéro.
                        </Alert>
                        <EmbeddedSignupButton storeId={store.id} appId={partner.appId} configId={partner.configId} version={GRAPH_VERSION} setup={esSetup} connected />
                      </div>
                    ) : (
                      <EmbeddedSignupButton storeId={store.id} appId={partner.appId} configId={partner.configId} version={GRAPH_VERSION} setup={esSetup} />
                    )}
                  </CardBody>
                </Card>
              )}
              <Card>
                <CardHeader
                  title={
                    <span className="inline-flex items-center gap-2">
                      <Cloud className="size-4 text-primary" aria-hidden /> {partner ? "Connexion manuelle (avancé)" : "Connexion Meta Cloud API"}
                    </span>
                  }
                  description={
                    partner
                      ? "Vous gérez déjà votre propre application Meta ? Saisissez vos identifiants Cloud API à la place."
                      : "Nécessite un compte Meta Business et un numéro vérifié. Les notifications partent une fois la connexion validée."
                  }
                />
                <CardBody>
                  {!partner && integration?.lastError && (
                    <Alert tone="danger" className="mb-4" title="La dernière vérification a échoué">
                      {integration.lastError}
                    </Alert>
                  )}
                  <CloudApiForm storeId={store.id} phoneNumberId={cfg.phoneNumberId ?? ""} wabaId={cfg.wabaId ?? ""} hasToken={!!integration?.secretsEncrypted} />
                </CardBody>
              </Card>
            </div>

            <Bezel as="section" coreClassName="p-5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[15px] font-semibold tracking-tight text-ink">Messages du mois</h3>
                <Badge tone="neutral">Plan {plan.name}</Badge>
              </div>
              <p className="mt-0.5 text-sm text-ink-muted first-letter:uppercase">{monthLabel}</p>
              <Progress
                className="mt-5"
                value={messagesUsed}
                max={quota}
                label="Inclus dans le plan"
                showValue
                valueLabel={quota == null ? `${nf(messagesUsed)} envoyés, sur mesure` : `${nf(messagesUsed)} / ${nf(quota)}`}
              />
              {quota != null && messagesUsed >= quota && (
                <p className="mt-3 text-sm text-danger">Quota mensuel atteint : les envois suivants utilisent vos packs de messages.</p>
              )}
              <dl className="mt-5 divide-y divide-line rounded-[var(--radius-md)] ring-1 ring-line">
                <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm">
                  <dt className="text-ink-muted">Pack utilitaire</dt>
                  <dd className="tabular font-medium text-ink">{nf(packUtility)}</dd>
                </div>
                <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm">
                  <dt className="text-ink-muted">Pack marketing</dt>
                  <dd className="tabular font-medium text-ink">{nf(packMarketing)}</dd>
                </div>
              </dl>
              <p className="mt-3 text-xs leading-relaxed text-ink-muted">
                Le quota se renouvelle le 1er du mois. Les packs servent au-delà du quota et restent valables 12 mois.
              </p>
              <ButtonLink href={`/app/${store.id}/options#PACK_WA_UTILITY_500`} variant="outline" size="md" className="mt-4 w-full">
                <PackagePlus className="size-4" aria-hidden /> Ajouter des messages
              </ButtonLink>
            </Bezel>
          </div>
        )}
      </section>

      <section className="mt-10" aria-labelledby="log-title">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <h2 id="log-title" className="text-lg font-semibold tracking-[-0.02em] text-ink">Journal des notifications</h2>
          {notifications.length > 0 && <p className="text-sm text-ink-muted">20 derniers envois</p>}
        </div>
        {notifications.length === 0 ? (
          <EmptyState
            icon={MessageCircle}
            title="Aucune notification WhatsApp"
            description={
              hasApi ? (
                <>
                  Les messages automatiques apparaîtront ici une fois l'API connectée et une{" "}
                  <Link href={`/app/${store.id}/automatisations`} className="font-medium text-primary underline-offset-4 hover:underline">
                    automatisation
                  </Link>{" "}
                  activée.
                </>
              ) : (
                "Les messages automatiques envoyés via l'API officielle apparaîtront ici."
              )
            }
          />
        ) : (
          <Table minWidth={720}>
            <THead>
              <tr>
                <TH>Date</TH>
                <TH>Destinataire</TH>
                <TH>Modèle</TH>
                <TH>Statut</TH>
                <TH>Détail</TH>
              </tr>
            </THead>
            <TBody>
              {notifications.map((n) => (
                <TR key={n.id}>
                  <TD className="whitespace-nowrap tabular text-ink-muted">{formatDateTime(n.createdAt)}</TD>
                  <TD className="whitespace-nowrap tabular">{formatPhone(n.recipient)}</TD>
                  <TD className="font-mono text-xs">{n.template}</TD>
                  <TD>
                    <Badge tone={NOTIF_TONE[n.status] ?? "neutral"} dot>{NOTIF_LABEL[n.status] ?? n.status}</Badge>
                  </TD>
                  <TD className="max-w-[280px] truncate text-ink-muted">{n.error ?? (n.sentAt ? `Envoyée le ${formatDateTime(n.sentAt)}` : "-")}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </section>
    </>
  );
}
