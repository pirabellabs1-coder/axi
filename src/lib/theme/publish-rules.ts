/**
 * Décision pure : lors de la publication du thème, faut-il AUSSI mettre la boutique en ligne ?
 * Module pur (pas de « use server », pas d'accès base) pour être testable et réutilisable par
 * l'action `publishTheme`. Mêmes prérequis que `publishStore`.
 */

export type StorePublishInput = {
  status: string; // StoreStatus : DRAFT | PUBLISHED | CLOSED_TEMPORARILY | SUSPENDED | ARCHIVED | PAUSED
  hasWhatsapp: boolean;
  activeProducts: number;
  activePaymentMethods: number;
};

export type StorePublishDecision = {
  /** La boutique est déjà publique (visible des clients). */
  alreadyOnline: boolean;
  /** Suspendue par la plateforme : mise en ligne impossible côté marchand. */
  suspended: boolean;
  /** Prérequis manquants (boutique restera en brouillon). */
  missing: string[];
  /** Faut-il basculer la boutique en PUBLISHED lors de cette publication ? */
  bringOnline: boolean;
};

export function decideStoreGoOnline(input: StorePublishInput): StorePublishDecision {
  const alreadyOnline = input.status === "PUBLISHED" || input.status === "CLOSED_TEMPORARILY";
  // En pause (abonnement) : comme une suspension, jamais remise en ligne par la publication du thème
  // (la pause n'est levée que par le paiement d'un plan, src/lib/billing/pause.ts).
  const suspended = input.status === "SUSPENDED" || input.status === "PAUSED";
  const missing: string[] = [];
  if (!alreadyOnline && !suspended) {
    if (!input.hasWhatsapp) missing.push("un numéro WhatsApp");
    if (input.activeProducts === 0) missing.push("au moins un produit actif");
    if (input.activePaymentMethods === 0) missing.push("un moyen de paiement actif");
  }
  const bringOnline = !alreadyOnline && !suspended && missing.length === 0;
  return { alreadyOnline, suspended, missing, bringOnline };
}

/** Message de publication du thème selon l'issue de la mise en ligne. */
export function publishThemeMessage(d: Pick<StorePublishDecision, "bringOnline" | "suspended" | "missing"> & { paused?: boolean }): string {
  if (d.bringOnline) return "Thème publié — votre boutique est maintenant EN LIGNE.";
  if (d.suspended && d.paused) return "Thème publié. Votre boutique est en pause : choisissez un plan pour la rouvrir.";
  if (d.suspended) return "Thème publié. Boutique suspendue par la plateforme : contactez le support pour la remettre en ligne.";
  if (d.missing.length) return `Thème publié. Pour mettre votre boutique en ligne, ajoutez ${d.missing.join(", ")}.`;
  return "Thème publié sur la boutique";
}
