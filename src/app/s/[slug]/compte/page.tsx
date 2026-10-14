import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Award, Gift, Package, Wallet } from "lucide-react";
import { db } from "@/lib/db";
import { getAccountPage } from "@/lib/buyer/account";
import { needsName } from "@/lib/buyer/otp";
import { loyaltyInfo } from "@/lib/storefront/data";
import { ORDER_STATUS_LABELS } from "@/lib/commerce/order-state";
import { formatMoney } from "@/lib/money";
import { formatDate, formatPhone } from "@/lib/utils";
import { AccountCard, AccountShell } from "@/components/storefront/account/account-shell";
import { AccountDisabled } from "@/components/storefront/account/account-disabled";
import { ConsentForm, EmailVerifyForm, NameForm, SecurityActions } from "@/components/storefront/account/account-forms";
import { OrderStatusPill } from "@/components/storefront/account/order-status-pill";

export const metadata: Metadata = { title: "Mon compte", robots: { index: false, follow: false } };

const CREDIT_LABEL: Record<string, string> = { GRANT: "Avoir accordé", REDEEM: "Utilisé sur une commande", REVERSAL: "Recrédité", ADJUST: "Ajustement", REFUND_TO_CREDIT: "Remboursement en avoir" };
const POINTS_LABEL: Record<string, string> = { order: "Commande", reward: "Récompense", adjustment: "Ajustement", refund: "Remboursement", expiration: "Expiration", redeem: "Points utilisés", redeem_reversal: "Points restitués", return: "Retour d'articles" };

export default async function AccountHome({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getAccountPage(slug, `/s/${slug}/compte`);
  if (ctx.state === "disabled") return <AccountDisabled slug={ctx.store.slug} />;
  const { store, buyer, readOnly } = ctx;
  const sid = store.id;
  const cid = buyer.customerId;
  const c = buyer.customer;
  const loyalty = loyaltyInfo(store.loyaltyConfig);

  const [orders, ordersCount, creditTx, pointsTx, giftCards, consent] = await Promise.all([
    db.order.findMany({ where: { storeId: sid, customerId: cid }, orderBy: { createdAt: "desc" }, take: 3, select: { id: true, reference: true, createdAt: true, status: true, total: true, currency: true, _count: { select: { items: true } } } }),
    db.order.count({ where: { storeId: sid, customerId: cid } }),
    db.storeCreditTransaction.findMany({ where: { storeId: sid, customerId: cid }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, kind: true, amount: true, createdAt: true } }),
    loyalty ? db.loyaltyLedger.findMany({ where: { storeId: sid, customerId: cid }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, delta: true, reason: true, createdAt: true } }) : Promise.resolve([]),
    db.giftCard.findMany({ where: { storeId: sid, customerId: cid }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, last4: true, balance: true, currency: true, status: true, expiresAt: true } }),
    db.consent.findFirst({ where: { customerId: cid, channel: "WHATSAPP", purpose: "MARKETING" }, orderBy: { createdAt: "desc" }, select: { granted: true } }),
  ]);

  const askName = needsName(c.name, c.phone);
  const pointsValue = loyalty && loyalty.rewardValue > 0 ? Math.floor(c.loyaltyPoints / loyalty.rewardPoints) * loyalty.rewardValue : 0;
  const base = `/s/${store.slug}/compte`;
  const firstName = askName ? null : c.name.trim().split(/\s+/)[0];

  return (
    <AccountShell slug={store.slug} active="home" title={firstName ? `Bonjour ${firstName}` : "Mon compte"} description={`Votre espace client chez ${store.name}.`} readOnlyNotice={readOnly}>
      <div className="space-y-5">
        {askName && (
          <AccountCard className="sf-rise ring-2 ring-[var(--store-primary)]">
            <h2 className="text-base font-semibold text-ink">Comment vous appelez-vous ?</h2>
            <p className="mb-4 mt-1 text-sm text-ink-muted">Dernière étape : {store.name} saura à qui préparer vos commandes.</p>
            <NameForm slug={store.slug} defaultName="" disabled={readOnly} />
          </AccountCard>
        )}

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <AccountCard aria-labelledby="orders-title" className="md:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="orders-title" className="flex items-center gap-2 text-base font-semibold text-ink">
                <Package className="size-5 text-[var(--store-primary)]" aria-hidden /> Commandes récentes
              </h2>
              {ordersCount > 0 && (
                <Link href={`${base}/commandes`} className="sf-link inline-flex min-h-11 items-center gap-1 text-sm font-semibold underline-offset-4 hover:underline">
                  Tout voir ({ordersCount}) <ArrowRight className="size-4" aria-hidden />
                </Link>
              )}
            </div>
            {orders.length === 0 ? (
              <div className="mt-4 rounded-[14px] bg-surface-2 px-4 py-6 text-center">
                <p className="text-sm font-medium text-ink">Aucune commande pour le moment</p>
                <p className="mt-1 text-[13px] text-ink-muted">Vos prochaines commandes avec ce numéro apparaîtront ici.</p>
                <Link href={`/s/${store.slug}`} className="sf-btn sf-btn-solid mt-4 h-11 px-5 text-sm">
                  Découvrir la boutique
                </Link>
              </div>
            ) : (
              <ul className="mt-3 divide-y divide-line">
                {orders.map((o) => (
                  <li key={o.id} className="relative flex items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <Link href={`${base}/commandes/${o.reference}`} className="font-mono text-sm font-semibold text-ink after:absolute after:inset-0 after:content-['']">
                        {o.reference}
                      </Link>
                      <p className="text-[13px] text-ink-muted">
                        {formatDate(o.createdAt)} · {o._count.items} article{o._count.items > 1 ? "s" : ""}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-sm font-semibold tabular-nums text-ink">{formatMoney(o.total, o.currency)}</span>
                      <OrderStatusPill status={o.status} label={ORDER_STATUS_LABELS[o.status]} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </AccountCard>

          <AccountCard aria-labelledby="credit-title">
            <h2 id="credit-title" className="flex items-center gap-2 text-base font-semibold text-ink">
              <Wallet className="size-5 text-[var(--store-primary)]" aria-hidden /> Avoir
            </h2>
            <p className="mt-3 text-[28px] font-semibold tabular-nums tracking-[-0.02em] text-ink">{formatMoney(c.storeCreditBalance, store.currency)}</p>
            <p className="text-[13px] text-ink-muted">Utilisable lors de votre prochaine commande, connecté à votre compte.</p>
            {creditTx.length > 0 && (
              <details className="group mt-3 text-sm">
                <summary className="inline-flex min-h-11 cursor-pointer items-center font-medium text-ink-muted hover:text-ink">Historique</summary>
                <ul className="space-y-1.5">
                  {creditTx.map((t) => (
                    <li key={t.id} className="flex justify-between gap-3 text-[13px]">
                      <span className="text-ink-muted">
                        {CREDIT_LABEL[t.kind] ?? t.kind} · {formatDate(t.createdAt)}
                      </span>
                      <span className={`font-semibold tabular-nums ${t.amount < 0 ? "text-ink" : "text-[#0b5a3f]"}`}>
                        {t.amount > 0 ? "+" : ""}
                        {formatMoney(t.amount, store.currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </AccountCard>

          <AccountCard aria-labelledby="points-title">
            <h2 id="points-title" className="flex items-center gap-2 text-base font-semibold text-ink">
              <Award className="size-5 text-[var(--store-primary)]" aria-hidden /> Points fidélité
            </h2>
            {loyalty ? (
              <>
                <p className="mt-3 text-[28px] font-semibold tabular-nums tracking-[-0.02em] text-ink">
                  {c.loyaltyPoints.toLocaleString("fr-FR")} <span className="text-base font-medium text-ink-muted">points</span>
                </p>
                <p className="text-[13px] text-ink-muted">
                  {pointsValue > 0 ? `Soit ${formatMoney(pointsValue, store.currency)} de réduction disponible.` : `${loyalty.rewardPoints.toLocaleString("fr-FR")} points = ${formatMoney(loyalty.rewardValue, store.currency)} de réduction.`}
                </p>
                {pointsTx.length > 0 && (
                  <details className="group mt-3 text-sm">
                    <summary className="inline-flex min-h-11 cursor-pointer items-center font-medium text-ink-muted hover:text-ink">Historique</summary>
                    <ul className="space-y-1.5">
                      {pointsTx.map((t) => (
                        <li key={t.id} className="flex justify-between gap-3 text-[13px]">
                          <span className="text-ink-muted">
                            {POINTS_LABEL[t.reason] ?? t.reason} · {formatDate(t.createdAt)}
                          </span>
                          <span className="font-semibold tabular-nums text-ink">
                            {t.delta > 0 ? "+" : ""}
                            {t.delta.toLocaleString("fr-FR")}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            ) : (
              <p className="mt-3 text-sm text-ink-muted">Cette boutique ne propose pas de programme de fidélité pour le moment.</p>
            )}
          </AccountCard>

          {giftCards.length > 0 && (
            <AccountCard aria-labelledby="gift-title" className="md:col-span-2">
              <h2 id="gift-title" className="flex items-center gap-2 text-base font-semibold text-ink">
                <Gift className="size-5 text-[var(--store-primary)]" aria-hidden /> Cartes cadeaux reçues
              </h2>
              <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {giftCards.map((g) => {
                  const expired = g.status === "EXPIRED" || (g.expiresAt && g.expiresAt <= new Date());
                  const label = g.status === "DISABLED" ? "Désactivée" : expired ? "Expirée" : g.balance === 0 ? "Épuisée" : g.expiresAt ? `Valable jusqu'au ${formatDate(g.expiresAt)}` : "Active";
                  return (
                    <li key={g.id} className="rounded-[14px] bg-surface-2 px-4 py-3">
                      <p className="font-mono text-sm text-ink-muted">•••• {g.last4}</p>
                      <p className="mt-1 text-lg font-semibold tabular-nums text-ink">{formatMoney(g.balance, g.currency)}</p>
                      <p className="text-[13px] text-ink-muted">{label}</p>
                    </li>
                  );
                })}
              </ul>
            </AccountCard>
          )}

          <AccountCard aria-labelledby="contact-title">
            <h2 id="contact-title" className="text-base font-semibold text-ink">
              Coordonnées
            </h2>
            <dl className="mt-3 space-y-4 text-sm">
              {!askName && (
                <div>
                  <dt className="text-[13px] text-ink-muted">Nom</dt>
                  <dd className="mt-1">
                    <details>
                      <summary className="inline-flex min-h-11 cursor-pointer items-center gap-2 font-medium text-ink">
                        {c.name} <span className="text-[13px] font-normal text-ink-muted underline underline-offset-4">Modifier</span>
                      </summary>
                      <div className="mt-2">
                        <NameForm slug={store.slug} defaultName={c.name} disabled={readOnly} />
                      </div>
                    </details>
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-[13px] text-ink-muted">Téléphone</dt>
                <dd className="mt-1 font-medium tabular-nums text-ink">
                  {formatPhone(c.phone)}
                  {c.phoneVerifiedAt && <span className="ml-2 inline-flex rounded-full bg-[#e8f6ef] px-2 py-0.5 text-[12px] font-semibold text-[#0b5a3f]">Vérifié</span>}
                </dd>
              </div>
              <div>
                <dt className="mb-1 text-[13px] text-ink-muted">E-mail</dt>
                <dd>
                  <EmailVerifyForm slug={store.slug} email={c.email} verified={!!c.emailVerifiedAt} disabled={readOnly} />
                </dd>
              </div>
            </dl>
          </AccountCard>

          <AccountCard aria-labelledby="prefs-title">
            <h2 id="prefs-title" className="text-base font-semibold text-ink">
              Préférences
            </h2>
            <div className="mt-3">
              <ConsentForm slug={store.slug} granted={consent?.granted ?? false} storeName={store.name} disabled={readOnly} />
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-ink-muted">Les messages liés à vos commandes (confirmation, livraison) restent envoyés.</p>
          </AccountCard>

          <AccountCard aria-labelledby="security-title" className="md:col-span-2">
            <h2 id="security-title" className="text-base font-semibold text-ink">
              Connexion et données
            </h2>
            <p className="mb-4 mt-1 text-sm text-ink-muted">Vous restez connecté 90 jours sur cet appareil.</p>
            <SecurityActions slug={store.slug} storeName={store.name} />
          </AccountCard>
        </div>
      </div>
    </AccountShell>
  );
}
