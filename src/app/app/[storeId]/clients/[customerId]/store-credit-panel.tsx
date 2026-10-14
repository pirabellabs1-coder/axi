import Link from "next/link";
import { db } from "@/lib/db";
import { PLANS, type PlanId } from "@/config/plans";
import { formatDateTime } from "@/lib/utils";
import { STORE_CREDIT_KIND_LABELS } from "@/lib/store-credit/rules";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Money } from "@/components/ui/misc";
import { StoreCreditButtons } from "../../cartes-cadeaux/store-credit-forms";

/**
 * Panneau « Avoir » de la fiche client (équipe C) : solde, crédit/débit avec motif, journal, cartes cadeaux rattachées.
 * Composant serveur autonome : `<StoreCreditPanel storeId={sid} customerId={customer.id} planId={ctx.planId} canManage={…} />`.
 */
export async function StoreCreditPanel({ storeId, customerId, planId, canManage, currency }: { storeId: string; customerId: string; planId: PlanId; canManage: boolean; currency: string }) {
  const [customer, ledger, giftCards] = await Promise.all([
    db.customer.findFirst({ where: { id: customerId, storeId }, select: { id: true, storeCreditBalance: true } }),
    db.storeCreditTransaction.findMany({ where: { storeId, customerId }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, kind: true, amount: true, balanceAfter: true, note: true, createdAt: true } }),
    db.giftCard.count({ where: { storeId, customerId } }),
  ]);
  if (!customer) return null;
  const enabled = PLANS[planId].features.storeCredit;
  const unit = currency === "XOF" || currency === "XAF" ? "FCFA" : currency;
  const balance = customer.storeCreditBalance;
  if (!enabled && balance === 0 && ledger.length === 0) return null;

  return (
    <Card>
      <CardHeader title="Avoir" description="Utilisable par le client connecté à son compte, ou par vous dans une commande manuelle." />
      <CardBody className="pt-2">
        <p className="tabular text-2xl font-semibold tracking-[-0.03em] text-ink">
          <Money amount={balance} currency={currency} />
        </p>
        {canManage && (
          <div className="mt-3">
            <StoreCreditButtons storeId={storeId} customerId={customer.id} unit={unit} canGrant={enabled} canDeduct={balance > 0} />
          </div>
        )}
        {!enabled && <p className="mt-2 text-xs text-ink-muted">Nouveaux crédits d&apos;avoir inclus à partir du plan {PLANS.BUSINESS.name}. Le solde existant reste utilisable.</p>}
        {ledger.length > 0 && (
          <ul className="mt-4 divide-y divide-line border-t border-line text-sm">
            {ledger.map((l) => (
              <li key={l.id} className="flex items-start justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="text-ink">{STORE_CREDIT_KIND_LABELS[l.kind]}</span>
                  <span className="block text-xs text-ink-muted [overflow-wrap:anywhere]">
                    {formatDateTime(l.createdAt)}
                    {l.note ? ` · ${l.note}` : ""}
                  </span>
                </span>
                <span className={`tabular shrink-0 font-semibold ${l.amount < 0 ? "text-danger" : "text-primary"}`}>
                  {l.amount > 0 ? "+" : "−"}
                  <Money amount={Math.abs(l.amount)} currency={currency} />
                </span>
              </li>
            ))}
          </ul>
        )}
        {giftCards > 0 && (
          <Link href={`/app/${storeId}/cartes-cadeaux?client=${customer.id}`} className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline">
            {giftCards} carte{giftCards > 1 ? "s" : ""} cadeau rattachée{giftCards > 1 ? "s" : ""}
          </Link>
        )}
      </CardBody>
    </Card>
  );
}
