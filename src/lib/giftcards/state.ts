/**
 * Règles pures des cartes cadeaux (spécification lot 1, §3) : machine d'états, éligibilité au paiement,
 * ordre d'utilisation des cartes, plafonds. Aucune dépendance serveur : importable partout et testé.
 *
 *             (paiement confirmé de la commande d'achat, ou création manuelle)
 *                                  │
 *                                  ▼
 *    ┌──────────────────────► ACTIVE ◄───────────────┐
 *    │ réactivation           │    │ expiresAt ≤ now  │ prolongation
 *    │ (non expirée)          │    ▼ (job quotidien)  │ (nouvelle date)
 * DISABLED ◄── désactivation ─┘  EXPIRED ────────────┘
 * « Épuisée » = ACTIVE avec balance = 0 (affichage).
 */

export type GiftCardStatusValue = "ACTIVE" | "DISABLED" | "EXPIRED";
export type GiftCardDisplayStatus = "ACTIVE" | "EXHAUSTED" | "DISABLED" | "EXPIRED";

export const MAX_GIFT_CARDS_PER_CHECKOUT = 3;
export const MAX_GIFT_CARDS_PER_ORDER = 5;
export const DEFAULT_GIFT_CARD_VALIDITY_DAYS = 365;
export const MIN_GIFT_CARD_VALIDITY_DAYS = 180;
/** Au-delà, une date d'expiration manuelle est refusée (5 ans). */
export const MAX_GIFT_CARD_VALIDITY_DAYS = 1825;
export const GIFT_CARD_MESSAGE_MAX = 300;

/** Message unique pour toute carte inconnue, désactivée, expirée ou d'une autre devise (anti-énumération). */
export const GIFT_CARD_INVALID_MESSAGE = "Carte cadeau invalide";

/**
 * Transitions autorisées :
 *  - ACTIVE → DISABLED (désactivation) ;
 *  - DISABLED → ACTIVE (réactivation, si `expiresAt` absent ou futur) ;
 *  - ACTIVE → EXPIRED (job quotidien, `expiresAt ≤ now`) ;
 *  - EXPIRED → ACTIVE (prolongation : nouvelle `expiresAt` future obligatoire).
 */
export function canTransitionGiftCard(
  from: GiftCardStatusValue,
  to: GiftCardStatusValue,
  ctx: { expiresAt: Date | null; newExpiresAt?: Date | null; now?: Date } = { expiresAt: null },
): boolean {
  const now = ctx.now ?? new Date();
  const future = (d: Date | null | undefined) => !d || d.getTime() > now.getTime();
  if (from === "ACTIVE" && to === "DISABLED") return true;
  if (from === "DISABLED" && to === "ACTIVE") return future(ctx.expiresAt);
  if (from === "ACTIVE" && to === "EXPIRED") return !!ctx.expiresAt && ctx.expiresAt.getTime() <= now.getTime();
  if (from === "EXPIRED" && to === "ACTIVE") return !!ctx.newExpiresAt && ctx.newExpiresAt.getTime() > now.getTime();
  return false;
}

/** Statut affiché : une carte ACTIVE dont la date est passée (job pas encore passé) est déjà « Expirée ». */
export function displayGiftCardStatus(card: { status: GiftCardStatusValue; balance: number; expiresAt: Date | null }, now = new Date()): GiftCardDisplayStatus {
  if (card.status === "DISABLED") return "DISABLED";
  if (card.status === "EXPIRED" || (card.expiresAt && card.expiresAt.getTime() <= now.getTime())) return "EXPIRED";
  return card.balance <= 0 ? "EXHAUSTED" : "ACTIVE";
}

export const GIFT_CARD_STATUS_LABELS: Record<GiftCardDisplayStatus, string> = {
  ACTIVE: "Active",
  EXHAUSTED: "Épuisée",
  DISABLED: "Désactivée",
  EXPIRED: "Expirée",
};

export type UsabilityProblem = "status" | "expired" | "currency" | "empty";

/** Contrôles du checkout (§3 « createOrder » étape 2). null = utilisable. */
export function giftCardUsabilityProblem(
  card: { status: GiftCardStatusValue; balance: number; expiresAt: Date | null; currency: string },
  ctx: { currency: string; now?: Date },
): UsabilityProblem | null {
  const now = ctx.now ?? new Date();
  if (card.status !== "ACTIVE") return "status";
  if (card.expiresAt && card.expiresAt.getTime() <= now.getTime()) return "expired";
  if (card.currency !== ctx.currency) return "currency";
  if (card.balance <= 0) return "empty";
  return null;
}

export type TenderCard = { id: string; balance: number; expiresAt: Date | null };

/** Ordre normatif (§0.2-9) : expiration la plus proche d'abord (sans date en dernier), puis plus petit solde, puis id. */
export function sortGiftCardsForTender<T extends TenderCard>(cards: T[]): T[] {
  return [...cards].sort((a, b) => {
    const ea = a.expiresAt ? a.expiresAt.getTime() : Number.POSITIVE_INFINITY;
    const eb = b.expiresAt ? b.expiresAt.getTime() : Number.POSITIVE_INFINITY;
    if (ea !== eb) return ea < eb ? -1 : 1;
    if (a.balance !== b.balance) return a.balance - b.balance;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Répartit `maxAmount` (assiette des tenders = total − lignes carte cadeau) sur les cartes, dans l'ordre normatif.
 * Renvoie une entrée par carte (montant 0 possible), dans l'ordre d'utilisation. Σ amount ≤ maxAmount.
 */
export function allocateGiftCardTenders<T extends TenderCard>(cards: T[], maxAmount: number): { card: T; amount: number; remainingAfter: number }[] {
  let left = Math.max(0, Math.floor(maxAmount));
  return sortGiftCardsForTender(cards).map((card) => {
    const amount = Math.max(0, Math.min(card.balance, left));
    left -= amount;
    return { card, amount, remainingAfter: card.balance - amount };
  });
}

/** Validité en jours d'un produit carte cadeau (null = 365, minimum 180, maximum 5 ans). */
export function giftCardValidityDays(days: number | null | undefined): number {
  if (days == null || !Number.isFinite(days)) return DEFAULT_GIFT_CARD_VALIDITY_DAYS;
  return Math.min(MAX_GIFT_CARD_VALIDITY_DAYS, Math.max(MIN_GIFT_CARD_VALIDITY_DAYS, Math.floor(days)));
}

export function giftCardExpiry(issuedAt: Date, validityDays: number | null | undefined): Date {
  return new Date(issuedAt.getTime() + giftCardValidityDays(validityDays) * 86_400_000);
}

/**
 * Bornes en unités entières de la devise : valeur faciale 1 000 à 500 000 FCFA, 1 000 000 FCFA de cartes par commande.
 * EUR : équivalents en centimes au taux fixe 655,957. Autres devises : mêmes nombres que le FCFA (à revoir au lot 2).
 */
export function giftCardLimits(currency: string): { minValue: number; maxValue: number; maxPerOrder: number; maxCardsPerOrder: number } {
  if (currency === "EUR") return { minValue: 152, maxValue: 76_225, maxPerOrder: 152_449, maxCardsPerOrder: MAX_GIFT_CARDS_PER_ORDER };
  return { minValue: 1_000, maxValue: 500_000, maxPerOrder: 1_000_000, maxCardsPerOrder: MAX_GIFT_CARDS_PER_ORDER };
}

/**
 * Plafonds anti-blanchiment d'une commande (à appeler par createOrder sur les lignes `isGiftCard`).
 * Renvoie un message d'erreur lisible, ou null.
 */
export function giftCardOrderLimitError(lines: { unitPrice: number; quantity: number }[], currency: string): string | null {
  const l = giftCardLimits(currency);
  let count = 0;
  let sum = 0;
  for (const line of lines) {
    if (line.unitPrice < l.minValue || line.unitPrice > l.maxValue) return "Valeur de carte cadeau hors des limites autorisées.";
    count += line.quantity;
    sum += line.unitPrice * line.quantity;
  }
  if (count > l.maxCardsPerOrder) return `Au plus ${l.maxCardsPerOrder} cartes cadeaux par commande.`;
  if (sum > l.maxPerOrder) return "Montant total de cartes cadeaux trop élevé pour une seule commande.";
  return null;
}

/**
 * Informations du destinataire portées par la ligne de commande (`OrderItem.options`).
 * Contrat avec les équipes B et E : `options` est soit un objet `{ giftCard: GiftCardRecipient, … }`,
 * soit un tableau dont un élément vaut `{ giftCard: GiftCardRecipient }`.
 */
export type GiftCardRecipient = { recipientName?: string | null; recipientPhone?: string | null; recipientEmail?: string | null; message?: string | null; sendAt?: string | null };

export function readGiftCardRecipient(options: unknown): GiftCardRecipient {
  const pick = (v: unknown): GiftCardRecipient | null => (v && typeof v === "object" && !Array.isArray(v) && "giftCard" in v ? ((v as { giftCard: unknown }).giftCard as GiftCardRecipient) : null);
  const raw = Array.isArray(options) ? options.map(pick).find(Boolean) : pick(options);
  if (!raw || typeof raw !== "object") return {};
  const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  return {
    recipientName: str(raw.recipientName, 80),
    recipientPhone: str(raw.recipientPhone, 20)?.replace(/[^\d]/g, "") || null,
    recipientEmail: str(raw.recipientEmail, 160)?.toLowerCase() ?? null,
    message: str(raw.message, GIFT_CARD_MESSAGE_MAX),
    sendAt: str(raw.sendAt, 40),
  };
}

/**
 * Répartition d'un montant au prorata (méthode du plus fort reste, égalités départagées par l'index).
 * Copie locale volontaire (pas de dépendance vers src/lib/commerce, propriété de l'équipe B). Σ = amount.
 */
export function prorata(amount: number, weights: number[]): number[] {
  const total = weights.reduce((s, w) => s + Math.max(0, w), 0);
  if (amount <= 0 || total <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (Math.max(0, w) * amount) / total);
  const floors = exact.map(Math.floor);
  let rest = amount - floors.reduce((s, v) => s + v, 0);
  const order = exact.map((e, i) => ({ i, r: e - Math.floor(e) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of order) {
    if (rest <= 0) break;
    floors[i]++;
    rest--;
  }
  return floors;
}

/** Décalage (minutes) du fuseau `timeZone` par rapport à UTC à l'instant `d` (heure locale − UTC). */
export function timeZoneOffsetMinutes(d: Date, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(d);
    const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const asUtc = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
    return Math.round((asUtc - Math.floor(d.getTime() / 1000) * 1000) / 60_000);
  } catch {
    return 0;
  }
}

/** « AAAA-MM-JJ » (saisie de date) → fin de cette journée dans le fuseau de la boutique ; null si invalide. */
export function endOfLocalDay(day: string, timeZone: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const guess = new Date(`${day}T23:59:59.000Z`);
  if (Number.isNaN(guess.getTime())) return null;
  return new Date(guess.getTime() - timeZoneOffsetMinutes(guess, timeZone) * 60_000);
}

/** Date « AAAA-MM-JJ » dans le fuseau de la boutique (valeur par défaut des champs de date). */
export function localDayString(d: Date, timeZone: string): string {
  const shifted = new Date(d.getTime() + timeZoneOffsetMinutes(d, timeZone) * 60_000);
  return shifted.toISOString().slice(0, 10);
}
