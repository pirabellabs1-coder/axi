"use client";

import { useState } from "react";
import { Check, Mail, ArrowUpRight, CalendarClock, Tag } from "lucide-react";
import { changePlan, cancelScheduledChange, setCancelAtPeriodEnd, declareInvoicePaid, payInvoiceOnline } from "@/lib/billing/actions";
import { PLANS, type Interval, type PlanId } from "@/config/plans";
import { SITE } from "@/config/site";
import { formatMoney } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Field, Input } from "@/components/ui/field";
import { ActionButton, ConfirmActionButton } from "@/components/app/action-controls";
import { cn } from "@/lib/utils";

export type QuoteDTO = {
  planId: PlanId;
  interval: Interval;
  kind: "upgrade" | "downgrade" | "start" | "same" | "contact";
  gross: number;
  credit: number;
  amount: number;
  currency: string;
  effectiveAt: string | null;
  hiddenProducts: number;
};

type PlanCardDTO = { id: PlanId; monthly: number | null; yearly: number | null; yearlyPerMonth: number | null };

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "la fin de la période");

function confirmCopy(q: QuoteDTO): { title: string; description: string; label: string } {
  const plan = PLANS[q.planId];
  const period = q.interval === "YEARLY" ? "annuel" : "mensuel";
  const hidden = q.hiddenProducts > 0 ? ` ${q.hiddenProducts} produit${q.hiddenProducts > 1 ? "s" : ""} au-delà de la limite passer${q.hiddenProducts > 1 ? "ont" : "a"} en brouillon (masqué${q.hiddenProducts > 1 ? "s" : ""}, jamais supprimé${q.hiddenProducts > 1 ? "s" : ""}).` : "";
  if (q.kind === "downgrade") {
    return { title: `Passer au plan ${plan.name} (${period}) ?`, description: `Vous gardez votre plan actuel jusqu'au ${fmtDate(q.effectiveAt)}. Le plan ${plan.name} démarre ensuite, au prix de ${formatMoney(q.gross, q.currency)}.${hidden}`, label: "Programmer le changement" };
  }
  if (q.kind === "upgrade") {
    const credit = q.credit > 0 ? ` Le temps restant de votre période est déduit : ${formatMoney(q.gross, q.currency)} moins ${formatMoney(q.credit, q.currency)} de crédit.` : "";
    return { title: `Passer au plan ${plan.name} (${period}) ?`, description: `Facture de ${formatMoney(q.amount, q.currency)}, payable sous 7 jours. Votre plan actuel reste en place jusqu'au paiement ; le plan ${plan.name} démarre dès sa confirmation.${credit}`, label: "Confirmer et voir la facture" };
  }
  return { title: `Choisir le plan ${plan.name} (${period}) ?`, description: `Facture de ${formatMoney(q.amount, q.currency)}, payable sous 7 jours. Le plan ${plan.name} démarre dès la confirmation du paiement.${hidden}`, label: "Confirmer et voir la facture" };
}

export function PlanComparison({
  storeId,
  plans,
  quotes,
  currentPlan,
  currentInterval,
  isTrial,
  scheduledTo,
  pendingTo = null,
  currency,
  zoneLabel,
}: {
  storeId: string;
  plans: PlanCardDTO[];
  quotes: QuoteDTO[];
  currentPlan: PlanId;
  currentInterval: Interval;
  isTrial: boolean;
  scheduledTo: PlanId | null;
  /** Plan demandé, en attente de paiement (facture OPEN). */
  pendingTo?: PlanId | null;
  currency: string;
  zoneLabel: string;
}) {
  const [interval, setInterval] = useState<Interval>(currentInterval);
  const [coupon, setCoupon] = useState("");
  // Plus de plan Gratuit : seuls les plans vendables arrivent ici (PUBLIC_PLANS, côté serveur).
  const selfServe = plans.filter((p) => p.id !== "ENTERPRISE" && p.id !== "FREE");
  const enterprise = plans.find((p) => p.id === "ENTERPRISE");

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">
          Tarifs {zoneLabel}. 0 % de commission sur vos ventes, sur tous les plans.
        </p>
        <div className="flex items-center gap-3">
          <div className="inline-flex rounded-full bg-surface-2 p-1 ring-1 ring-inset ring-line" role="radiogroup" aria-label="Période de facturation">
            {(["MONTHLY", "YEARLY"] as const).map((i) => (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={interval === i}
                onClick={() => setInterval(i)}
                className={cn(
                  "h-10 min-w-24 rounded-full px-4 text-sm font-medium transition-[background-color,color,box-shadow] duration-200 ease-out",
                  interval === i ? "bg-surface text-ink shadow-[var(--shadow-card)] ring-1 ring-line" : "text-ink-muted hover:text-ink",
                )}
              >
                {i === "MONTHLY" ? "Mensuel" : "Annuel"}
              </button>
            ))}
          </div>
          <Badge tone="accent">2 mois offerts en annuel</Badge>
        </div>
      </div>

      <details className="group mb-5 rounded-[var(--radius-md)] bg-surface px-4 ring-1 ring-line [&[open]]:pb-4" open={coupon !== "" || undefined}>
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-medium text-ink [&::-webkit-details-marker]:hidden">
          <Tag className="size-4 text-ink-muted" aria-hidden /> Vous avez un code promo ?
          {coupon && <Badge tone="accent" className="ml-auto font-mono">{coupon.toUpperCase()}</Badge>}
        </summary>
        <div className="max-w-sm">
          <Field id="coupon-code" label="Code promo" hint="Appliqué à la facture émise lors de votre choix de plan (souscription ou montée en gamme).">
            {(f) => <Input {...f} value={coupon} onChange={(e) => setCoupon(e.target.value.replace(/\s+/g, "").slice(0, 32))} placeholder="Ex. LANCEMENT20" autoCapitalize="characters" autoComplete="off" spellCheck={false} className="font-mono uppercase" />}
          </Field>
        </div>
      </details>

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {selfServe.map((p) => {
          const plan = PLANS[p.id];
          const q = quotes.find((x) => x.planId === p.id && x.interval === interval);
          const isCurrent = p.id === currentPlan && !isTrial;
          const sameAsCurrent = isCurrent && interval === currentInterval;
          const price = interval === "YEARLY" ? p.yearlyPerMonth : p.monthly;
          const isScheduled = scheduledTo === p.id && !isCurrent;
          return (
            <li
              key={p.id}
              className={cn(
                "relative flex flex-col rounded-[var(--radius-lg)] bg-surface p-5 ring-1 shadow-[var(--shadow-card)]",
                plan.highlight ? "ring-2 ring-primary" : "ring-line",
              )}
            >
              <div className="flex min-h-7 items-center justify-between gap-2">
                <h3 className="text-[17px] font-semibold tracking-[-0.02em] text-ink">{plan.name}</h3>
                {isCurrent ? <Badge tone="success" dot>Plan actuel</Badge> : p.id === currentPlan && isTrial ? <Badge tone="sun">En essai</Badge> : pendingTo === p.id ? <Badge tone="warning" dot>En attente de paiement</Badge> : plan.highlight ? <Badge tone="primary">Le plus choisi</Badge> : null}
              </div>
              <p className="mt-0.5 text-sm text-ink-muted">{plan.audience}</p>

              <div className="mt-5">
                <p className="flex items-baseline gap-1 text-ink">
                  <span className="text-[30px] font-semibold leading-none tracking-[-0.04em] tabular">{price == null ? "Sur devis" : formatMoney(price, currency)}</span>
                  {price != null && <span className="text-sm text-ink-muted">/ mois</span>}
                </p>
                <p className="mt-1.5 min-h-5 text-xs text-ink-muted tabular">
                  {interval === "YEARLY" && p.yearly ? `Facturé ${formatMoney(p.yearly, currency)} par an` : "Sans engagement"}
                </p>
              </div>

              <ul className="mt-5 flex-1 space-y-2 border-t border-line pt-4 text-sm text-ink">
                {plan.bullets.map((b) => (
                  <li key={b} className="flex gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-6">
                {sameAsCurrent ? (
                  scheduledTo ? (
                    <ActionButton variant="primary" className="w-full" action={() => cancelScheduledChange(storeId)}>
                      Conserver ce plan
                    </ActionButton>
                  ) : (
                    <span className="inline-flex h-11 w-full items-center justify-center rounded-full bg-surface-2 text-[15px] font-medium text-ink-muted" aria-current="true">
                      Plan actuel
                    </span>
                  )
                ) : isScheduled ? (
                  <span className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-surface-2 px-3 text-sm font-medium text-ink-muted">
                    <CalendarClock className="size-4" aria-hidden /> Programmé
                  </span>
                ) : q ? (
                  <PlanCta storeId={storeId} quote={q} coupon={coupon} highlight={!!plan.highlight || q.kind === "upgrade"} label={isCurrent ? `Passer en ${interval === "YEARLY" ? "annuel" : "mensuel"}` : q.kind === "downgrade" ? `Passer au plan ${plan.name}` : `Choisir ${plan.name}`} />
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {enterprise && (
        <div className="mt-4 flex flex-col gap-4 rounded-[var(--radius-lg)] bg-forest p-6 text-white sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-[17px] font-semibold tracking-[-0.02em]">
              Enterprise
              <span className="text-sm font-normal text-white/70">
                à partir de {enterprise.monthly != null ? formatMoney(interval === "YEARLY" ? (enterprise.yearlyPerMonth ?? enterprise.monthly) : enterprise.monthly, currency) : "devis"} / mois
              </span>
            </p>
            <p className="mt-1 max-w-[60ch] text-sm text-white/75">{PLANS.ENTERPRISE.tagline} Boutiques et membres illimités, revendeurs, gestionnaire dédié.</p>
          </div>
          <a
            href={`mailto:${SITE.supportEmail}?subject=${encodeURIComponent("Plan Enterprise")}`}
            className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-white px-5 text-[15px] font-medium text-forest transition-transform duration-150 ease-out hover:bg-white/90 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime"
          >
            <Mail className="size-4" aria-hidden /> Nous contacter
          </a>
        </div>
      )}
    </div>
  );
}

function PlanCta({ storeId, quote, label, highlight, coupon }: { storeId: string; quote: QuoteDTO; label: string; highlight: boolean; coupon: string }) {
  const base = confirmCopy(quote);
  const withCoupon = !!coupon && quote.kind !== "downgrade";
  const copy = withCoupon ? { ...base, description: `${base.description} Code promo ${coupon.toUpperCase()} : la remise est vérifiée et déduite sur la facture.` } : base;
  return (
    <div>
      <ConfirmActionButton
        tone="primary"
        title={copy.title}
        description={copy.description}
        confirmLabel={copy.label}
        action={() => changePlan(storeId, quote.planId, quote.interval, withCoupon ? coupon : undefined)}
        className={cn(
          "inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-full text-[15px] font-medium transition-[background-color,transform] duration-150 ease-out active:scale-[0.98]",
          highlight ? "bg-accent text-on-accent hover:bg-accent-hover" : "bg-surface text-ink ring-1 ring-inset ring-line-strong hover:bg-surface-2",
        )}
      >
        {label} {quote.kind !== "downgrade" && <ArrowUpRight className="size-4" aria-hidden />}
      </ConfirmActionButton>
      <p className="mt-2 min-h-4 text-center text-xs text-ink-muted tabular">
        {quote.kind === "upgrade" && quote.credit > 0
          ? `${formatMoney(quote.amount, quote.currency)} aujourd'hui, crédit de ${formatMoney(quote.credit, quote.currency)} déduit`
          : quote.kind === "downgrade"
            ? `À partir du ${fmtDate(quote.effectiveAt)}`
            : quote.amount > 0
              ? `${formatMoney(quote.amount, quote.currency)} aujourd'hui`
              : ""}
      </p>
    </div>
  );
}

export function CancelControls({ storeId, cancelAtPeriodEnd }: { storeId: string; cancelAtPeriodEnd: boolean }) {
  return cancelAtPeriodEnd ? (
    <ActionButton variant="outline" size="sm" action={() => cancelScheduledChange(storeId)}>
      Annuler le changement
    </ActionButton>
  ) : (
    <ConfirmActionButton
      title="Résilier l'abonnement ?"
      description="Votre plan reste actif jusqu'à la fin de la période payée, puis la boutique est mise en pause (vitrine fermée). Aucune donnée n'est supprimée : elle rouvre dès que vous choisissez et payez un plan."
      confirmLabel="Résilier en fin de période"
      action={() => setCancelAtPeriodEnd(storeId, true)}
      className="inline-flex h-11 items-center rounded-full px-4 text-sm font-medium text-danger transition-colors hover:bg-danger-soft"
    >
      Résilier
    </ConfirmActionButton>
  );
}

export function ManualPayBox({ storeId, invoiceId, instructions, amount }: { storeId: string; invoiceId: string; instructions: React.ReactNode; amount: string }) {
  const [ref, setRef] = useState("");
  return (
    <div className="space-y-4">
      <ol className="space-y-3 text-sm text-ink">
        <li className="flex gap-3">
          <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-2 font-mono text-xs text-ink-muted ring-1 ring-line">1</span>
          <span>
            Envoyez <strong className="tabular">{amount}</strong> {instructions}
          </span>
        </li>
        <li className="flex gap-3">
          <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-2 font-mono text-xs text-ink-muted ring-1 ring-line">2</span>
          <span>Indiquez la référence de la transaction (facultatif, mais plus rapide).</span>
        </li>
        <li className="flex gap-3">
          <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-2 font-mono text-xs text-ink-muted ring-1 ring-line">3</span>
          <span>Cliquez sur « J'ai payé » : nous vérifions et activons sous 24 h ouvrées.</span>
        </li>
      </ol>
      <Field id="momo-ref" label="Référence de transaction" hint="Exemple : MP240110.1234.A56789">
        {(p) => <Input {...p} value={ref} onChange={(e) => setRef(e.target.value)} maxLength={80} autoComplete="off" />}
      </Field>
      <ActionButton className="w-full" action={() => declareInvoicePaid(storeId, invoiceId, ref)}>
        J'ai payé
      </ActionButton>
    </div>
  );
}

export function OnlinePayButton({ storeId, invoiceId, label }: { storeId: string; invoiceId: string; label: string }) {
  return (
    <ActionButton variant="accent" className="w-full" trailing={ArrowUpRight} action={() => payInvoiceOnline(storeId, invoiceId)}>
      {label}
    </ActionButton>
  );
}
