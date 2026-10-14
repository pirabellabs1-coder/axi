import "server-only";
import type { CreditType as DbCreditType } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { ADD_ONS, PLANS, getAddOn, type AddOn, type AddOnId, type CreditType, type PlanId, type PlanLimits } from "@/config/plans";
import { addMonths } from "@/lib/utils";
import { audit } from "@/lib/audit";

/** Durée de validité des crédits achetés en pack (cahier des charges V4 §7). */
export const PACK_VALIDITY_MONTHS = 12;
/** Seuil d'alerte « solde bas » (en unités de crédit). */
export const LOW_CREDIT_THRESHOLD = 50;

/** Options éligibles pour un plan (catalogue filtré). */
export function eligibleAddOns(planId: PlanId): AddOn[] {
  return ADD_ONS.filter((a) => a.plans.includes(planId));
}

/**
 * Filtre « option en vigueur » : démarrée, non échue, et
 * - ACTIVE (renouvelée tant qu'elle n'est pas résiliée), ou
 * - CANCELLED avec une échéance future (résiliée en fin de période : reste utilisable jusqu'à endsAt).
 */
export function inForceWhere(storeId: string, now = new Date()) {
  return {
    storeId,
    startsAt: { lte: now },
    OR: [
      { status: "ACTIVE" as const, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
      { status: "CANCELLED" as const, endsAt: { gt: now } },
    ],
  };
}

/** Options en vigueur d'une boutique. */
export async function activeAddOns(storeId: string, tx: Tx | typeof db = db) {
  return tx.addOnPurchase.findMany({ where: inForceWhere(storeId), orderBy: { createdAt: "desc" } });
}

/** Quantité active d'une option récurrente (ex. 2 membres en plus). */
export async function activeAddOnQuantity(storeId: string, addOnId: AddOnId, tx: Tx | typeof db = db): Promise<number> {
  const agg = await tx.addOnPurchase.aggregate({
    where: { ...inForceWhere(storeId), addOnId },
    _sum: { quantity: true },
  });
  return agg._sum.quantity ?? 0;
}

/**
 * Limites effectives = limites du plan + options actives.
 * - EXTRA_MEMBER : +1 membre par unité
 * - EXTRA_STORE  : +1 boutique par unité
 * Les limites illimitées (null) restent illimitées.
 */
export async function effectiveLimits(storeId: string, planId: PlanId, tx: Tx | typeof db = db): Promise<PlanLimits & { extraMembers: number; extraStores: number }> {
  const base = PLANS[planId].limits;
  const [extraMembers, extraStores] = await Promise.all([
    activeAddOnQuantity(storeId, "EXTRA_MEMBER", tx),
    activeAddOnQuantity(storeId, "EXTRA_STORE", tx),
  ]);
  return {
    ...base,
    members: base.members == null ? null : base.members + extraMembers,
    stores: base.stores == null ? null : base.stores + extraStores,
    extraMembers,
    extraStores,
  };
}

/* ───────────────────────── Portefeuille de crédits ───────────────────────── */

export type CreditBalance = { type: CreditType; balance: number; granted: number; used: number; nextExpiry: Date | null; expiringSoon: number };

/**
 * Solde par type de crédit. Le grand livre est en ajout seul :
 * - deltas positifs = dotations (packs, ajustements) avec expiration éventuelle ;
 * - deltas négatifs = consommation (ou expiration explicite).
 * Calcul FIFO : la consommation est imputée d'abord sur les dotations qui expirent le plus tôt ;
 * le reliquat d'une dotation expirée n'est plus disponible.
 */
export async function creditBalances(storeId: string, tx: Tx | typeof db = db): Promise<CreditBalance[]> {
  const rows = await tx.creditLedger.findMany({ where: { storeId }, orderBy: { createdAt: "asc" } });
  const now = new Date();
  const soon = new Date(now.getTime() + 30 * 86400_000);
  const types: CreditType[] = ["WA_UTILITY", "WA_MARKETING", "AI"];
  return types.map((type) => {
    const mine = rows.filter((r) => r.type === type);
    const grants = mine
      .filter((r) => r.delta > 0)
      .map((r) => ({ remaining: r.delta, expiresAt: r.expiresAt }))
      .sort((a, b) => (a.expiresAt?.getTime() ?? Infinity) - (b.expiresAt?.getTime() ?? Infinity));
    const granted = grants.reduce((s, g) => s + g.remaining, 0);
    let consumed = -mine.filter((r) => r.delta < 0).reduce((s, r) => s + r.delta, 0);
    const used = consumed;
    for (const g of grants) {
      if (consumed <= 0) break;
      const take = Math.min(g.remaining, consumed);
      g.remaining -= take;
      consumed -= take;
    }
    const live = grants.filter((g) => !g.expiresAt || g.expiresAt > now);
    const balance = live.reduce((s, g) => s + g.remaining, 0);
    const withRemaining = live.filter((g) => g.remaining > 0 && g.expiresAt);
    return {
      type,
      balance,
      granted,
      used,
      nextExpiry: withRemaining[0]?.expiresAt ?? null,
      expiringSoon: withRemaining.filter((g) => g.expiresAt! <= soon).reduce((s, g) => s + g.remaining, 0),
    };
  });
}

/* ───────────────────────── Activation ───────────────────────── */

/**
 * Active une option après confirmation du paiement de sa facture.
 * - PACK : crédite le portefeuille (expiration 12 mois), l'achat passe ACTIVE (consommé via le grand livre).
 * - MONTHLY / YEARLY : ACTIVE jusqu'à endsAt (1 mois / 1 an), renouvelée par facture.
 * - ONE_TIME : ACTIVE sans échéance (prestation à réaliser par l'équipe : ticket support créé).
 * Idempotente : un achat déjà ACTIVE n'est jamais crédité deux fois.
 * À appeler DANS la transaction qui marque la facture payée (voir confirmInvoicePayment).
 */
export async function activateAddOnPurchase(purchaseId: string, tx?: Tx): Promise<{ activated: boolean; reason?: string }> {
  const run = async (t: Tx) => {
    // Verrou optimiste : seule la transition PENDING → ACTIVE crédite.
    const purchase = await t.addOnPurchase.findUnique({ where: { id: purchaseId }, include: { store: { select: { id: true, name: true, contactEmail: true } } } });
    if (!purchase) return { activated: false, reason: "not_found" };
    if (purchase.status !== "PENDING") return { activated: false, reason: `status_${purchase.status.toLowerCase()}` };
    const addOn = getAddOn(purchase.addOnId);
    if (!addOn) return { activated: false, reason: "unknown_addon" };

    const now = new Date();
    const recurring = addOn.billing === "MONTHLY" || addOn.billing === "YEARLY";
    // Renouvellement : la nouvelle période démarre à l'échéance de l'option en cours (pas de double comptage).
    const running = recurring
      ? await t.addOnPurchase.findFirst({ where: { storeId: purchase.storeId, addOnId: purchase.addOnId, status: "ACTIVE", endsAt: { gt: now }, id: { not: purchase.id } }, orderBy: { endsAt: "desc" } })
      : null;
    const startsAt = running?.endsAt ?? now;
    const endsAt = addOn.billing === "MONTHLY" ? addMonths(startsAt, 1) : addOn.billing === "YEARLY" ? addMonths(startsAt, 12) : null;
    const locked = await t.addOnPurchase.updateMany({ where: { id: purchase.id, status: "PENDING" }, data: { status: "ACTIVE", startsAt, endsAt } });
    if (locked.count === 0) return { activated: false, reason: "race" };

    if (addOn.billing === "PACK" && addOn.credits) {
      await t.creditLedger.create({
        data: {
          storeId: purchase.storeId,
          type: addOn.credits.type as DbCreditType,
          delta: addOn.credits.amount * purchase.quantity,
          reason: "pack_purchase",
          reference: purchase.id,
          expiresAt: addMonths(now, PACK_VALIDITY_MONTHS),
        },
      });
    }
    if (addOn.billing === "ONE_TIME" || (addOn.id === "DOMAIN_NAME" && !running)) {
      // Prestation humaine : l'équipe Axi est prévenue par ticket.
      await t.supportTicket.create({
        data: {
          storeId: purchase.storeId,
          email: purchase.store.contactEmail ?? "support@axi.africa",
          subject: `Option à réaliser : ${addOn.name} (${purchase.store.name})`,
          message: `L'option « ${addOn.name} » a été payée (achat ${purchase.id}, quantité ${purchase.quantity}). À réaliser par l'équipe Axi puis à confirmer au marchand.`,
        },
      });
    }
    await audit({ storeId: purchase.storeId, action: "addon.activated", target: purchase.id, metadata: { addOnId: addOn.id, quantity: purchase.quantity, endsAt } }, t);
    return { activated: true };
  };
  return tx ? run(tx) : db.$transaction(run);
}
