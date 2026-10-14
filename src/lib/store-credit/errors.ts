/** Erreur métier de l'avoir, levée par store-credit/service.ts ; message lisible (convertible en CheckoutError). */
export type StoreCreditErrorCode = "not_found" | "insufficient" | "invalid_amount" | "not_allowed";

export class StoreCreditError extends Error {
  constructor(
    message: string,
    public code: StoreCreditErrorCode,
  ) {
    super(message);
    this.name = "StoreCreditError";
  }
}
