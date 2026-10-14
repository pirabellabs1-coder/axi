import "server-only";
import type { CreditType, Prisma } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { PLANS, CREDIT_LABELS, type PlanId } from "@/config/plans";
import { paidPlanInvoiceCovering } from "@/lib/billing/service";
import { isTrialActive, monthlyCreditsPlan } from "@/lib/billing/rules";

/**
 * Portefeuille de crédits (cahier V4 §7).
 *
 * Modèle : CreditLedger en ajout seul. Chaque crédit appartient à un « lot » défini par sa date
 * d'expiration (fin de mois pour les crédits inclus du plan, 12 mois pour les packs, aucune pour
 * un geste commercial). Un débit consomme d'abord le lot qui expire le plus tôt et porte la même
 * date d'expiration que ce lot : quand le lot expire, ses crédits et leurs consommations sortent
 * ensemble du solde. Le solde reste donc juste sans écriture d'expiration.
 *
 * Règles :
 *  - débit uniquement quand Axi remet réellement le message à l'API WhatsApp (jamais pour un lien
 *    wa.me, un brouillon ou une campagne planifiée) ; remboursement automatique en cas d'échec ;
 *  - crédits inclus du plan : mois courant, non cumulables (expiration au 1er du mois suivant) ;
 *  - alertes in-app à 80 % puis 100 % de consommation.
 */

export const CREDIT_TYPES: CreditType[] = ["WA_UTILITY", "WA_MARKETING", "AI"];
export type Balances = Record<CreditType, number>;
type Client = Tx | typeof db;

/** Lots actifs (non expirés) d'un type, du plus tôt au plus tard à expirer. */
async function activeBuckets(storeId: string, type: CreditType, client: Client, now = new Date()) {
  const rows = await client.creditLedger.groupBy({
    by: ["expiresAt"],
    where: { storeId, type, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    _sum: { delta: true },
  });
  return rows
    .map((r) => ({ expiresAt: r.expiresAt, remaining: r._sum.delta ?? 0 }))
    .filter((b) => b.remaining > 0)
    .sort((a, b) => (a.expiresAt?.getTime() ?? Infinity) - (b.expiresAt?.getTime() ?? Infinity));
}

/** Soldes par type : somme des mouvements non expirés. */
export async function getBalances(storeId: string, client: Client = db): Promise<Balances> {
  const now = new Date();
  const rows = await client.creditLedger.groupBy({
    by: ["type"],
    where: { storeId, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    _sum: { delta: true },
  });
  const out: Balances = { WA_UTILITY: 0, WA_MARKETING: 0, AI: 0 };
  for (const r of rows) out[r.type] = Math.max(0, r._sum.delta ?? 0);
  return out;
}

/** Crédits accordés (non expirés) et consommés, pour les jauges et les alertes. */
export async function getUsage(storeId: string, type: CreditType, client: Client = db): Promise<{ granted: number; used: number; balance: number }> {
  const now = new Date();
  const where = { storeId, type, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };
  // Les remboursements réduisent la consommation : ce ne sont pas des crédits accordés.
  const [pos, neg, refunds] = await Promise.all([
    client.creditLedger.aggregate({ where: { ...where, delta: { gt: 0 }, reason: { not: "refund" } }, _sum: { delta: true } }),
    client.creditLedger.aggregate({ where: { ...where, delta: { lt: 0 } }, _sum: { delta: true } }),
    client.creditLedger.aggregate({ where: { ...where, reason: "refund" }, _sum: { delta: true } }),
  ]);
  const granted = pos._sum.delta ?? 0;
  const used = Math.max(0, Math.abs(neg._sum.delta ?? 0) - (refunds._sum.delta ?? 0));
  return { granted, used, balance: Math.max(0, granted - used) };
}

/** 1er jour du mois suivant (UTC) : fin de validité des crédits inclus. */
export function endOfCurrentMonth(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}

function periodKey(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Crédits inclus du plan pour le mois courant. Idempotent (une écriture par type et par mois),
 * non cumulable : les crédits expirent au 1er du mois suivant.
 * Droit vérifié ICI (B2) : essai en cours, ou facture d'abonnement PAYÉE couvrant la date, et
 * abonnement effectif ; on retient le plus bas des deux plans (monthlyCreditsPlan). Jamais de crédits
 * pour une montée en gamme non réglée.
 * Plans « sur mesure » (limite null) : rien n'est accordé automatiquement.
 */
export async function grantMonthlyCredits(storeId: string, now = new Date()): Promise<Partial<Balances>> {
  return db.$transaction(async (tx) => {
    // Verrou : deux appels simultanés ne peuvent pas accorder deux fois le même mois.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`credits:grant:${storeId}`}))`;
    const sub = await tx.subscription.findUnique({ where: { storeId } });
    if (!sub) return {};
    const paid = isTrialActive(sub, now) ? null : await paidPlanInvoiceCovering(sub.id, now, tx);
    const planId = monthlyCreditsPlan(sub, paid, now);
    if (!planId) return {};
    return grantMonthlyCreditsTx(storeId, planId, tx, now);
  });
}

async function grantMonthlyCreditsTx(storeId: string, planId: PlanId, client: Tx, now: Date): Promise<Partial<Balances>> {
  const limits = PLANS[planId]?.limits;
  if (!limits) return {};
  const included: Partial<Record<CreditType, number | null>> = {
    WA_UTILITY: limits.whatsappMessagesPerMonth,
    AI: limits.aiCreditsPerMonth,
  };
  // Une seule attribution par mois et par type, même si le plan change en cours de mois.
  const reference = `plan_monthly:${periodKey(now)}`;
  const expiresAt = endOfCurrentMonth(now);
  const granted: Partial<Balances> = {};
  for (const type of CREDIT_TYPES) {
    const amount = included[type];
    if (!amount || amount <= 0) continue;
    const exists = await client.creditLedger.findFirst({ where: { storeId, type, reason: "plan_monthly", reference }, select: { id: true } });
    if (exists) continue;
    await client.creditLedger.create({ data: { storeId, type, delta: amount, reason: "plan_monthly", reference, expiresAt } });
    granted[type] = amount;
  }
  return granted;
}

export type DebitResult = { ok: true; balance: number } | { ok: false; error: string; balance: number };

/**
 * Débite `amount` crédits. À appeler DANS la transaction qui crée les messages.
 * Verrou consultatif par (boutique, type) : deux envois simultanés ne peuvent pas dépasser le solde.
 * Échoue proprement (ok: false) si le solde est insuffisant : l'appelant annule sa transaction.
 */
export async function debitCredits(storeId: string, type: CreditType, amount: number, reference: string, tx: Tx): Promise<DebitResult> {
  if (!Number.isInteger(amount) || amount <= 0) return { ok: false, error: "Montant de crédits invalide", balance: 0 };
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`credits:${storeId}:${type}`}))`;

  const before = await getUsage(storeId, type, tx);
  if (before.balance < amount) {
    return {
      ok: false,
      error: `Solde insuffisant : ${amount} crédit${amount > 1 ? "s" : ""} nécessaire${amount > 1 ? "s" : ""}, ${before.balance} disponible${before.balance > 1 ? "s" : ""} (${CREDIT_LABELS[type]}). Achetez un pack depuis la page Abonnement.`,
      balance: before.balance,
    };
  }

  // Consommation FIFO par date d'expiration
  let left = amount;
  const rows: Prisma.CreditLedgerCreateManyInput[] = [];
  for (const b of await activeBuckets(storeId, type, tx)) {
    if (left <= 0) break;
    const take = Math.min(left, b.remaining);
    rows.push({ storeId, type, delta: -take, reason: "usage", reference, expiresAt: b.expiresAt });
    left -= take;
  }
  if (left > 0) return { ok: false, error: "Solde insuffisant", balance: before.balance };
  await tx.creditLedger.createMany({ data: rows });

  const after = { granted: before.granted, used: before.used + amount, balance: before.balance - amount };
  await maybeAlert(storeId, type, before, after, tx);
  return { ok: true, balance: after.balance };
}

/**
 * Rembourse les crédits d'une référence (envoi échoué). Idempotent : une seule écriture
 * `refund:<reference>` par référence. Les crédits reviennent dans leurs lots d'origine.
 */
export async function refundCredits(storeId: string, reference: string, amount: number | null, client: Client = db): Promise<number> {
  const refundRef = `refund:${reference}`;
  const debits = await client.creditLedger.findMany({ where: { storeId, reference, delta: { lt: 0 } }, orderBy: { createdAt: "asc" } });
  if (debits.length === 0) return 0;
  const already = await client.creditLedger.aggregate({ where: { storeId, reference: refundRef }, _sum: { delta: true } });
  const totalDebited = debits.reduce((s, d) => s - d.delta, 0);
  let left = Math.min(amount ?? totalDebited, totalDebited - (already._sum.delta ?? 0));
  if (left <= 0) return 0;
  const rows: Prisma.CreditLedgerCreateManyInput[] = [];
  for (const d of debits) {
    if (left <= 0) break;
    const give = Math.min(left, -d.delta);
    rows.push({ storeId, type: d.type, delta: give, reason: "refund", reference: refundRef, expiresAt: d.expiresAt });
    left -= give;
  }
  await client.creditLedger.createMany({ data: rows });
  return rows.reduce((s, r) => s + r.delta, 0);
}

async function maybeAlert(
  storeId: string,
  type: CreditType,
  before: { granted: number; used: number },
  after: { granted: number; used: number },
  tx: Tx,
) {
  if (after.granted <= 0) return;
  const ratioBefore = before.used / before.granted;
  const ratioAfter = after.used / after.granted;
  for (const threshold of [1, 0.8]) {
    if (ratioBefore < threshold && ratioAfter >= threshold) {
      const pct = Math.round(threshold * 100);
      const owner = await tx.membership.findFirst({ where: { storeId, role: "OWNER" }, include: { user: { select: { email: true } } } });
      await tx.notification.create({
        data: {
          storeId,
          channel: "inapp",
          recipient: owner?.user.email ?? "store",
          template: `credits.threshold_${pct}`,
          // In-app : la notification est « remise » dès qu'elle est enregistrée.
          status: "SENT",
          sentAt: new Date(),
          payload: {
            type,
            threshold: pct,
            title: pct >= 100 ? `${CREDIT_LABELS[type]} : crédits épuisés` : `${CREDIT_LABELS[type]} : 80 % consommés`,
            text:
              pct >= 100
                ? "Vos crédits sont épuisés. Les envois par l'API WhatsApp sont suspendus jusqu'à l'achat d'un pack ou au renouvellement mensuel."
                : `Il vous reste ${after.granted - after.used} crédit${after.granted - after.used > 1 ? "s" : ""}. Pensez à prendre un pack pour ne pas interrompre vos envois.`,
          },
        },
      });
      break; // une seule alerte par débit (la plus haute franchie)
    }
  }
}
