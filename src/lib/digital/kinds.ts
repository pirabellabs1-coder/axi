/**
 * Nature des produits (vague 2) — module PUR, importable côté client comme côté serveur.
 *
 * `Product.kind` (`ProductKind`) complète le drapeau historique `Product.isGiftCard` :
 *  - `PHYSICAL` : comportement d'origine (livraison ou retrait, stock suivi si demandé) ;
 *  - `DIGITAL`  : fichiers téléchargeables, aucune expédition, aucun stock ;
 *  - `SERVICE`  : prestation (durée, lieu ou à distance), aucune expédition, stock FACULTATIF (places limitées) ;
 *  - `GIFT_CARD`: carte cadeau du lot 1, toujours équivalent à `isGiftCard = true`.
 *
 * Invariant tenu par l'application (et par la migration) : `kind === "GIFT_CARD"` ⇔ `isGiftCard === true`.
 * Les deux champs coexistent : tout le code du lot 1 continue de lire `isGiftCard`.
 */

export const PRODUCT_KINDS = ["PHYSICAL", "DIGITAL", "SERVICE", "GIFT_CARD"] as const;
export type ProductKindValue = (typeof PRODUCT_KINDS)[number];

export const PRODUCT_KIND_LABELS: Record<ProductKindValue, string> = {
  PHYSICAL: "Produit physique",
  DIGITAL: "Produit numérique",
  SERVICE: "Service",
  GIFT_CARD: "Carte cadeau",
};

export const PRODUCT_KIND_HINTS: Record<ProductKindValue, string> = {
  PHYSICAL: "Livré ou retiré en boutique. Stock, poids et livraison disponibles.",
  DIGITAL: "Fichiers téléchargeables, envoyés dès le paiement confirmé. Ni stock, ni livraison.",
  SERVICE: "Prestation (séance, consultation, atelier). Ni livraison, ni poids ; stock facultatif pour limiter les places.",
  GIFT_CARD: "Chaque variante est une valeur. La carte est émise et envoyée dès le paiement confirmé.",
};

/** Libellé court pour la liste des produits et les commandes. */
export const PRODUCT_KIND_BADGES: Record<ProductKindValue, string> = {
  PHYSICAL: "Physique",
  DIGITAL: "Numérique",
  SERVICE: "Service",
  GIFT_CARD: "Carte cadeau",
};

export function isProductKind(v: unknown): v is ProductKindValue {
  return typeof v === "string" && (PRODUCT_KINDS as readonly string[]).includes(v);
}

/**
 * Nature retenue pour une fiche : `kind` s'il est connu, sinon déduite de `isGiftCard` (données antérieures
 * à la migration ou appelant partiel). Jamais d'exception : repli sur `PHYSICAL`.
 */
export function productKindOf(p: { kind?: unknown; isGiftCard?: boolean | null } | null | undefined): ProductKindValue {
  if (!p) return "PHYSICAL";
  if (p.isGiftCard) return "GIFT_CARD";
  return isProductKind(p.kind) ? p.kind : "PHYSICAL";
}

/** `kind` et `isGiftCard` cohérents (valeur à écrire en base depuis une intention). */
export function normalizeKind(kind: unknown, isGiftCard?: boolean | null): { kind: ProductKindValue; isGiftCard: boolean } {
  const k = isGiftCard ? "GIFT_CARD" : isProductKind(kind) ? kind : "PHYSICAL";
  return { kind: k, isGiftCard: k === "GIFT_CARD" };
}

/** Le produit part-il physiquement (livraison, retrait, poids, frais de port) ? */
export function kindRequiresShipping(kind: ProductKindValue): boolean {
  return kind === "PHYSICAL";
}

/** Le stock est-il suivi pour cette nature ? DIGITAL et GIFT_CARD : jamais. SERVICE : si le marchand le demande. */
export function kindTracksStock(kind: ProductKindValue): boolean {
  return kind === "PHYSICAL" || kind === "SERVICE";
}

/** Des fichiers peuvent-ils être attachés ? */
export function kindHasFiles(kind: ProductKindValue): boolean {
  return kind === "DIGITAL";
}

/** La nature exige-t-elle un paiement confirmé avant remise (donc pas de paiement à la livraison) ? */
export function kindRequiresPrepayment(kind: ProductKindValue): boolean {
  return kind === "DIGITAL" || kind === "GIFT_CARD";
}

export type CartKindLine = { kind?: unknown; isGiftCard?: boolean | null; quantity?: number };

export type CartKindSummary = {
  /** Au moins une ligne part physiquement : la livraison et le retrait restent proposés. */
  requiresShipping: boolean;
  /** Aucune ligne ne part physiquement (numérique, service, carte cadeau) : remise `DIGITAL`, sans frais ni adresse. */
  digitalOnly: boolean;
  /** Au moins une ligne doit être payée avant remise (numérique ou carte cadeau) : paiement à la livraison refusé. */
  prepaymentRequired: boolean;
  /** Au moins une ligne numérique : des accès de téléchargement seront émis après paiement. */
  hasDigital: boolean;
  /** Au moins un service. */
  hasService: boolean;
};

/**
 * Règles de panier dérivées de la nature des lignes (pur, utilisé par le checkout, l'aperçu et la vitrine).
 * Un panier vide n'est jamais « numérique seulement » (aucune commande n'est créée sans ligne).
 */
export function summarizeCartKinds(lines: readonly CartKindLine[]): CartKindSummary {
  const kinds = lines.map((l) => productKindOf(l));
  const requiresShipping = kinds.some(kindRequiresShipping);
  return {
    requiresShipping,
    digitalOnly: kinds.length > 0 && !requiresShipping,
    prepaymentRequired: kinds.some(kindRequiresPrepayment),
    hasDigital: kinds.includes("DIGITAL"),
    hasService: kinds.includes("SERVICE"),
  };
}

/** Message unique du refus du paiement à la livraison (numérique ou carte cadeau dans le panier). */
export function codRefusedMessage(summary: Pick<CartKindSummary, "hasDigital">): string {
  return summary.hasDigital
    ? "Le paiement à la livraison n'est pas accepté pour une commande contenant un produit numérique : le fichier n'est remis qu'après paiement confirmé."
    : "Le paiement à la livraison n'est pas accepté pour une commande contenant une carte cadeau.";
}
