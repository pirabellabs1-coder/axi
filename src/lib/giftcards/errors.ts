/**
 * Erreur métier des cartes cadeaux, levée par les fonctions transactionnelles (`*Tx`) de service.ts.
 * L'appelant (createOrder, équipe B) la convertit en `CheckoutError(e.message)` : le message est lisible tel quel.
 */
export type GiftCardErrorCode = "invalid" | "empty" | "too_many" | "suspended" | "insufficient" | "rate_limited";

export class GiftCardError extends Error {
  constructor(
    message: string,
    public code: GiftCardErrorCode,
  ) {
    super(message);
    this.name = "GiftCardError";
  }
}
