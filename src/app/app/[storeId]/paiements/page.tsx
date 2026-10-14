import type { Metadata } from "next";
import Link from "next/link";
import { CreditCard, Check, Lock } from "lucide-react";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { getCountry, SITE } from "@/config/site";
import { GATEWAYS, gatewayCredentials } from "@/lib/payments/gateways";
import { decryptSecret } from "@/lib/crypto";
import { channelLabel } from "@/lib/payments/channels";
import { formatDateTime } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import { PageHeader, EmptyState, Alert } from "@/components/ui/misc";
import { Card, CardBody, CardHeader, Bezel } from "@/components/ui/card";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { PlanGate } from "@/components/app/plan-gate";
import { MethodDialog, MethodRowActions, ReconcileButton, ConfiguredBadge, type GatewayDTO, type MethodDTO } from "./paiements-client";
import { KIND_META } from "./meta";

export const metadata: Metadata = { title: "Paiements" };

const ATTEMPT_TONE: Record<string, BadgeTone> = { CREATED: "neutral", PENDING: "info", INITIATED: "info", CONFIRMED: "success", FAILED: "danger", EXPIRED: "warning" };
const ATTEMPT_LABEL: Record<string, string> = { CREATED: "Créée", PENDING: "En attente", INITIATED: "Initiée", CONFIRMED: "Confirmée", FAILED: "Échouée", EXPIRED: "Expirée" };

export default async function PaymentsPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const ctx = await getStoreContext(storeId, "payments.manage");
  const store = ctx.store;
  const country = getCountry(store.country);
  const onlinePayments = PLANS[ctx.planId].features.onlinePayments;

  const [methods, attempts] = await Promise.all([
    db.paymentMethod.findMany({ where: { storeId: store.id }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], include: { _count: { select: { attempts: true } } } }),
    db.paymentAttempt.findMany({ where: { order: { storeId: store.id } }, orderBy: { createdAt: "desc" }, take: 20, include: { order: { select: { id: true, reference: true, customerName: true } } } }),
  ]);

  const gateways: GatewayDTO[] = Object.values(GATEWAYS).map((g) => ({
    id: g.id,
    label: g.label,
    credentialFields: g.credentialFields,
    supportedCountries: g.supportedCountries,
    supportedCurrencies: g.supportedCurrencies,
    // Lot 1 bis : portefeuilles disponibles dans le pays de la boutique (null = sans notion de portefeuille).
    channels: g.channelsByCountry ? (g.channelsByCountry[store.country] ?? []) : null,
    docsUrl: g.docsUrl ?? null,
    canTest: !!g.testConnection,
  }));
  const dtos: MethodDTO[] = methods.map((m) => {
    const gw = m.kind === "GATEWAY" && m.provider ? GATEWAYS[m.provider as keyof typeof GATEWAYS] : undefined;
    // Valeurs NON secrètes seulement (environnement, pays) : les secrets ne quittent jamais le serveur.
    let publicCreds: Record<string, string> = {};
    let mode: "test" | "live" | null = null;
    if (gw && m.credentialsEncrypted) {
      try {
        const creds = gatewayCredentials(decryptSecret(m.credentialsEncrypted));
        publicCreds = Object.fromEntries(gw.credentialFields.filter((f) => !f.secret && creds[f.key]).map((f) => [f.key, creds[f.key]]));
        mode = gw.modeOf?.(creds) ?? null;
      } catch {
        publicCreds = {};
      }
    }
    return { id: m.id, kind: m.kind, provider: m.provider, label: m.label, instructions: m.instructions, accountNumber: m.accountNumber, accountName: m.accountName, active: m.active, configured: !!m.credentialsEncrypted, attempts: m._count.attempts, channels: m.channels, publicCreds, mode };
  });
  const dialogProps = { gateways, momoOperators: country.mobileMoney, country: store.country, currency: store.currency, appUrl: SITE.url, onlinePayments };
  const pendingCount = attempts.filter((a) => a.status === "INITIATED").length;
  const activeCount = methods.filter((m) => m.active).length;
  const lockedGateways = dtos.filter((m) => m.kind === "GATEWAY" && !onlinePayments);

  const included = [
    { label: "Paiement à la livraison ou au retrait", ok: true, note: "Tous les plans" },
    { label: "Mobile Money et virement manuels", ok: true, note: "Tous les plans" },
    { label: "Mobile Money et carte en ligne", ok: onlinePayments, note: onlinePayments ? "Inclus dans votre plan" : "À partir du plan Starter" },
  ];

  return (
    <>
      <PageHeader
        title="Paiements"
        description="Vous encaissez directement : espèces, Mobile Money, virement ou paiement en ligne avec vos propres clés."
        actions={<MethodDialog storeId={store.id} {...dialogProps} />}
      />

      <Bezel className="mb-8" coreClassName="grid grid-cols-1 gap-6 p-5 sm:p-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] md:items-center">
        <div>
          <p className="text-[40px] font-semibold leading-none tracking-[-0.04em] text-ink tabular">0 %</p>
          <p className="mt-2 text-[15px] font-semibold text-ink">de commission Axi sur vos ventes</p>
          <p className="mt-1 max-w-[46ch] text-sm text-ink-muted">Sur tous les plans. Seuls les frais de votre opérateur ou de votre fournisseur de paiement s'appliquent.</p>
        </div>
        <ul className="divide-y divide-line rounded-[var(--radius-md)] ring-1 ring-line" aria-label="Moyens disponibles selon votre plan">
          {included.map((it) => (
            <li key={it.label} className="flex items-center gap-3 px-4 py-3 text-sm">
              {it.ok ? <Check className="size-4 shrink-0 text-primary" aria-hidden /> : <Lock className="size-4 shrink-0 text-ink-faint" aria-hidden />}
              <span className="min-w-0 flex-1 text-ink">{it.label}</span>
              {it.ok ? (
                <span className="text-xs text-ink-muted">{it.note}</span>
              ) : (
                <Link href={`/app/${store.id}/abonnement#plans`} className="inline-flex min-h-8 items-center rounded-full text-xs font-medium text-primary underline-offset-4 hover:underline">
                  {it.note}
                </Link>
              )}
              <span className="sr-only">{it.ok ? "disponible" : "verrouillé"}</span>
            </li>
          ))}
        </ul>
      </Bezel>

      {methods.length > 0 && activeCount === 0 && (
        <Alert tone="warning" className="mb-6" title="Aucun moyen de paiement proposé">
          La boutique ne peut pas être publiée sans au moins un moyen de paiement actif.
        </Alert>
      )}
      {lockedGateways.length > 0 && (
        <Alert tone="warning" className="mb-6" title="Paiement en ligne non inclus dans votre plan">
          {lockedGateways.length > 1 ? `${lockedGateways.length} moyens en ligne sont configurés` : "Un moyen en ligne est configuré"}, mais votre plan {PLANS[ctx.planId].name} ne comprend pas le Mobile Money et la carte en ligne. Ils ne peuvent pas être réactivés sans le plan Starter.
        </Alert>
      )}

      <section aria-labelledby="methods-title">
        <div className="mb-3 flex items-end justify-between gap-3">
          <h2 id="methods-title" className="text-lg font-semibold tracking-[-0.02em] text-ink">Moyens de paiement</h2>
          {methods.length > 0 && (
            <p className="text-sm text-ink-muted">
              <span className="tabular">{activeCount}</span> proposé{activeCount > 1 ? "s" : ""} sur <span className="tabular">{methods.length}</span>
            </p>
          )}
        </div>
        {methods.length === 0 ? (
          <EmptyState
            icon={CreditCard}
            title="Aucun moyen de paiement"
            description="Commencez par le paiement à la livraison ou votre numéro Mobile Money."
            action={<MethodDialog storeId={store.id} {...dialogProps} />}
          />
        ) : (
          <Card>
            <ul className="divide-y divide-line">
              {dtos.map((m, i) => {
                const meta = KIND_META[m.kind];
                const Icon = meta.icon;
                const providerLabel = m.kind === "GATEWAY" ? (GATEWAYS[m.provider as keyof typeof GATEWAYS]?.label ?? "Paiement en ligne") : meta.label;
                return (
                  <li key={m.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 sm:px-6">
                    <span className={`inline-flex size-10 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ring-line ${m.active ? "bg-primary-soft text-primary" : "bg-surface-2 text-ink-muted"}`}>
                      <Icon className="size-[18px]" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1 basis-48">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-ink [overflow-wrap:anywhere]">{m.label}</p>
                        <Badge tone="neutral">{providerLabel}</Badge>
                        {m.kind === "GATEWAY" && <ConfiguredBadge configured={m.configured} />}
                        {m.kind === "GATEWAY" && m.mode === "test" && <Badge tone="info">Mode test</Badge>}
                        {m.kind === "GATEWAY" && !onlinePayments && <Badge tone="sun">Plan Starter</Badge>}
                      </div>
                      <p className="mt-0.5 truncate text-sm text-ink-muted">
                        {m.accountNumber ? (
                          <>
                            <span className="tabular">{m.accountNumber}</span>
                            {m.accountName ? ` · ${m.accountName}` : ""}
                          </>
                        ) : (
                          m.instructions ?? meta.hint
                        )}
                      </p>
                      {m.kind === "GATEWAY" && m.channels.length > 0 && (
                        <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Moyens proposés au client">
                          {m.channels.map((c) => (
                            <li key={c}>
                              <Badge tone="neutral">{channelLabel(c)}</Badge>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <MethodRowActions storeId={store.id} method={m} index={i} total={dtos.length} {...dialogProps} />
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
        {!onlinePayments && (
          <PlanGate
            compact
            className="mt-4"
            storeId={store.id}
            feature="onlinePayments"
            description="Encaissez par Mobile Money et carte, vérifiés automatiquement, sur votre propre compte fournisseur. Toujours 0 % de commission Axi."
          />
        )}
      </section>

      <Card as="section" className="mt-10" aria-labelledby="recon-title">
        <CardHeader
          className="pb-4"
          title={<span id="recon-title">Rapprochement des paiements</span>}
          description={
            pendingCount > 0
              ? `${pendingCount} paiement${pendingCount > 1 ? "s" : ""} en ligne en attente de confirmation du fournisseur.`
              : "Tentatives de paiement récentes. La vérification interroge le fournisseur pour les paiements sans confirmation reçue."
          }
          action={onlinePayments ? <ReconcileButton storeId={store.id} /> : undefined}
        />
        <CardBody className="border-t border-line p-0 sm:p-0">
          {attempts.length === 0 ? (
            <EmptyState compact icon={CreditCard} title="Aucune tentative de paiement" description="Les paiements de vos clients apparaîtront ici, avec leur statut." />
          ) : (
            <Table bare minWidth={720}>
              <THead>
                <tr>
                  <TH>Date</TH>
                  <TH>Commande</TH>
                  <TH>Moyen</TH>
                  <TH align="right">Montant</TH>
                  <TH>Statut</TH>
                  <TH>Référence</TH>
                </tr>
              </THead>
              <TBody>
                {attempts.map((a) => (
                  <TR key={a.id}>
                    <TD className="whitespace-nowrap tabular text-ink-muted">{formatDateTime(a.createdAt)}</TD>
                    <TD>
                      <Link href={`/app/${store.id}/commandes/${a.order.id}`} className="font-mono text-[13px] font-medium text-primary underline-offset-4 hover:underline">
                        {a.order.reference}
                      </Link>
                      <span className="block text-xs text-ink-muted">{a.order.customerName}</span>
                    </TD>
                    <TD>
                      <span className="capitalize">{GATEWAYS[a.provider as keyof typeof GATEWAYS]?.label ?? a.provider}</span>
                      {a.channel && <span className="block text-xs text-ink-muted">{channelLabel(a.channel)}</span>}
                    </TD>
                    <TD align="right">{formatMoney(a.amount, a.currency)}</TD>
                    <TD>
                      <Badge tone={ATTEMPT_TONE[a.status] ?? "neutral"} dot>{ATTEMPT_LABEL[a.status] ?? a.status}</Badge>
                    </TD>
                    <TD className="max-w-[220px] truncate font-mono text-xs text-ink-muted">
                      {a.providerRef ?? a.customerRef ?? "-"}
                      {a.failureReason ? ` · ${a.failureReason}` : ""}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </>
  );
}
