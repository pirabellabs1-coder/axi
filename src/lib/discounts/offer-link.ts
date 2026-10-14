import { parseDiscountConfig } from "./schema";

/**
 * Offre au panier : condition « remise liée seulement si un produit déclencheur est au panier »
 * (`requiresProductsInCart` d'une remise PRODUCT_AMOUNT). Pur et testé.
 *
 * `requires` : produits déclencheurs exigés, ou null pour retirer la condition.
 * Renvoie null si rien ne change (ou configuration illisible : on n'y touche pas), la nouvelle configuration
 * validée sinon, ou une erreur.
 */
export function linkedDiscountConfig(config: unknown, requires: string[] | null): { config: unknown } | { error: string } | null {
  const current = parseDiscountConfig("PRODUCT_AMOUNT", config);
  if (!current.ok || current.value.kind !== "PRODUCT_AMOUNT") return null;
  const { requiresProductsInCart: before, ...rest } = current.value.config;
  const wanted = requires ? [...new Set(requires)].slice(0, 50) : [];
  if ((before ?? []).join(",") === wanted.join(",")) return null;
  const next = wanted.length ? { ...rest, requiresProductsInCart: wanted } : rest;
  const checked = parseDiscountConfig("PRODUCT_AMOUNT", next);
  if (!checked.ok) return { error: checked.error };
  return { config: checked.value.config };
}

/** La remise exige-t-elle un produit au panier ? (affichage du formulaire d'offre) */
export function discountRequiresProducts(config: unknown): boolean {
  const r = parseDiscountConfig("PRODUCT_AMOUNT", config);
  return r.ok && r.value.kind === "PRODUCT_AMOUNT" && (r.value.config.requiresProductsInCart?.length ?? 0) > 0;
}
