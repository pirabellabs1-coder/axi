import { z } from "zod";

/**
 * Politique de retours de la boutique (`Store.returnPolicy`) — module PUR (client + serveur).
 * Spécification : docs/specs/LOT-1-ventes-fidelite.md §4. Testé dans tests/returns-amounts.test.ts.
 */

export const RETURN_SHIPPING_PAYERS = ["customer", "merchant"] as const;

export const returnPolicySchema = z.object({
  enabled: z.boolean(),
  windowDays: z.number().int().min(1).max(90),
  allowRefund: z.boolean(),
  allowStoreCredit: z.boolean(),
  allowExchange: z.boolean(),
  storeCreditBonusPercent: z.number().int().min(0).max(20),
  restockingFeePercent: z.number().int().min(0).max(30),
  nonReturnableTags: z.array(z.string().trim().min(1).max(60)).max(50),
  requirePhotos: z.boolean(),
  returnShippingPaidBy: z.enum(RETURN_SHIPPING_PAYERS),
  instructions: z.string().max(1000),
});

export type ReturnPolicy = z.infer<typeof returnPolicySchema>;

export const DEFAULT_RETURN_POLICY: ReturnPolicy = {
  enabled: false,
  windowDays: 7,
  allowRefund: true,
  allowStoreCredit: true,
  allowExchange: true,
  storeCreditBonusPercent: 0,
  restockingFeePercent: 0,
  nonReturnableTags: [],
  requirePhotos: false,
  returnShippingPaidBy: "customer",
  instructions: "",
};

/** Lecture tolérante : valeurs par défaut pour les clés absentes ; politique invalide → défauts (désactivée). */
export function parseReturnPolicy(raw: unknown): ReturnPolicy {
  const merged = { ...DEFAULT_RETURN_POLICY, ...(raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) };
  const r = returnPolicySchema.safeParse(merged);
  return r.success ? r.data : DEFAULT_RETURN_POLICY;
}

/** Étiquettes normalisées (comparaison insensible à la casse et aux espaces). */
export function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase();
}

export function parseTagList(raw: string): string[] {
  return [...new Set(raw.split(/[,\n]/).map((t) => t.trim()).filter(Boolean))].slice(0, 50);
}

/* ───────────────────────── Motifs, états, résolutions ───────────────────────── */

export const RETURN_REASONS = {
  size: "Taille ou coupe",
  defect: "Article défectueux",
  not_as_described: "Non conforme à la description",
  changed_mind: "J'ai changé d'avis",
  other: "Autre",
} as const;
export type ReturnReason = keyof typeof RETURN_REASONS;
export const RETURN_REASON_KEYS = Object.keys(RETURN_REASONS) as [ReturnReason, ...ReturnReason[]];

export const ITEM_CONDITIONS = { neuf: "Neuf", ouvert: "Ouvert", abime: "Abîmé" } as const;
export type ItemCondition = keyof typeof ITEM_CONDITIONS;
export const ITEM_CONDITION_KEYS = Object.keys(ITEM_CONDITIONS) as [ItemCondition, ...ItemCondition[]];

export type ResolutionKind = "REFUND" | "STORE_CREDIT" | "EXCHANGE" | "NONE";
export const RESOLUTION_LABELS: Record<ResolutionKind, string> = {
  REFUND: "Remboursement",
  STORE_CREDIT: "Avoir",
  EXCHANGE: "Échange",
  NONE: "Aucune",
};

/** Résolutions proposées à l'acheteur selon la politique (le commerçant reste libre de son choix final). */
export function buyerResolutions(policy: ReturnPolicy): Exclude<ResolutionKind, "NONE">[] {
  const out: Exclude<ResolutionKind, "NONE">[] = [];
  if (policy.allowRefund) out.push("REFUND");
  if (policy.allowStoreCredit) out.push("STORE_CREDIT");
  if (policy.allowExchange) out.push("EXCHANGE");
  return out;
}

/* ───────────────────────── Éligibilité ───────────────────────── */

const DAY_MS = 86_400_000;

/** Date limite de demande : livraison + fenêtre (jours entiers de 24 h). */
export function returnDeadline(deliveredAt: Date, windowDays: number): Date {
  return new Date(deliveredAt.getTime() + windowDays * DAY_MS);
}

export type EligibilityOrder = { status: string; deliveredAt: Date | null };

export type Eligibility = { ok: true; deadline: Date } | { ok: false; code: "disabled" | "not_delivered" | "expired"; message: string };

/**
 * Commande éligible à une demande de retour par l'acheteur : politique active, commande livrée et
 * `deliveredAt + windowDays ≥ now`. Le commerçant (retour en boutique) n'est soumis qu'à la livraison.
 */
export function orderEligibility(order: EligibilityOrder, policy: ReturnPolicy, now: Date = new Date(), opts: { merchant?: boolean } = {}): Eligibility {
  if (!opts.merchant && !policy.enabled) return { ok: false, code: "disabled", message: "Cette boutique n'accepte pas les demandes de retour en ligne." };
  if (order.status !== "DELIVERED" || !order.deliveredAt) return { ok: false, code: "not_delivered", message: "Un retour n'est possible qu'après la livraison de la commande." };
  const deadline = returnDeadline(order.deliveredAt, policy.windowDays);
  if (!opts.merchant && deadline.getTime() < now.getTime()) {
    return { ok: false, code: "expired", message: `Le délai de retour de ${policy.windowDays} jour${policy.windowDays > 1 ? "s" : ""} après la livraison est dépassé.` };
  }
  return { ok: true, deadline };
}

export type ReturnableItemInput = { isGiftCard: boolean; productTags?: string[] | null };

/** Article retournable : ni carte cadeau, ni étiquette non retournable (produit supprimé : retournable, instantané). */
export function isItemReturnable(item: ReturnableItemInput, policy: ReturnPolicy): boolean {
  if (item.isGiftCard) return false;
  if (!policy.nonReturnableTags.length || !item.productTags?.length) return true;
  const blocked = new Set(policy.nonReturnableTags.map(normalizeTag));
  return !item.productTags.some((t) => blocked.has(normalizeTag(t)));
}

/** Statuts qui réservent des quantités (tout sauf annulé ou refusé). */
export function reservesQuantity(status: string): boolean {
  return status !== "CANCELLED" && status !== "REJECTED";
}

/**
 * Quantité encore retournable par article : commandée − Σ des retours non annulés ni refusés.
 * `existing` : lignes de retours de la commande avec le statut de leur retour (`excludeReturnId` ignoré).
 */
export function remainingQuantities(
  orderItems: { id: string; quantity: number }[],
  existing: { orderItemId: string; quantity: number; status: string; returnId?: string }[],
  excludeReturnId?: string,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const it of orderItems) out.set(it.id, it.quantity);
  for (const r of existing) {
    if (!reservesQuantity(r.status) || (excludeReturnId && r.returnId === excludeReturnId)) continue;
    if (!out.has(r.orderItemId)) continue;
    out.set(r.orderItemId, Math.max(0, (out.get(r.orderItemId) ?? 0) - r.quantity));
  }
  return out;
}
