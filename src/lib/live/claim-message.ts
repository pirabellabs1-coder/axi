/**
 * Textes du « commenter pour acheter » (fonctions PURES, testées) : message privé avec lien de paiement,
 * réponse publique, message de rupture. Variables : {nom} {produit} {quantite} {total} {lien} {delai} {boutique}.
 */

export const DEFAULT_CLAIM_MESSAGE =
  "Bonjour {nom} ! {quantite} × {produit} est réservé pour vous pendant {delai}. Total indicatif : {total}. Finalisez votre commande ici : {lien}";

export const DEFAULT_PUBLIC_REPLY = "Réservé ! Regardez vos messages privés pour finaliser.";

export const CLAIM_MESSAGE_MAX = 600;
export const PUBLIC_REPLY_MAX = 200;

/** Durée lisible : 30 → « 30 minutes », 90 → « 1 h 30 », 1440 → « 24 heures ». */
export function holdLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} minute${minutes > 1 ? "s" : ""}`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return `${h} heure${h > 1 ? "s" : ""}`;
  return `${h} h ${String(m).padStart(2, "0")}`;
}

/** Modèle valide : contient {lien}, longueur bornée. Renvoie un message d'erreur ou null. */
export function validateClaimTemplate(t: string): string | null {
  if (!t.includes("{lien}")) return "Le message doit contenir {lien} (le lien de paiement).";
  if (t.length > CLAIM_MESSAGE_MAX) return `${CLAIM_MESSAGE_MAX} caractères maximum.`;
  return null;
}

export type ClaimMessageVars = { name: string | null; product: string; quantity: number; total: string; link: string; holdMinutes: number; store: string };

export function renderClaimMessage(template: string | null | undefined, v: ClaimMessageVars): string {
  const t = template && validateClaimTemplate(template) === null ? template : DEFAULT_CLAIM_MESSAGE;
  const firstName = (v.name ?? "").replace(/^@/, "").trim().split(/\s+/)[0] ?? "";
  const out = t
    .replaceAll("{nom}", firstName || "")
    .replaceAll("{produit}", v.product)
    .replaceAll("{quantite}", String(v.quantity))
    .replaceAll("{total}", v.total)
    .replaceAll("{delai}", holdLabel(v.holdMinutes))
    .replaceAll("{boutique}", v.store)
    .replaceAll("{lien}", v.link)
    .replace(/Bonjour\s+!/, "Bonjour !")
    .replace(/[ \t]{2,}/g, " ");
  // Instagram : 1 000 octets maximum par message ; on garde une marge et le lien intact.
  return out.length > 900 ? `${out.slice(0, 900 - v.link.length - 2)}… ${v.link}` : out;
}

export function soldOutMessage(product: string, store: string): string {
  return `Merci pour votre intérêt ! ${product} n'est plus disponible pour le moment chez ${store}. Répondez à ce message si vous souhaitez être prévenu(e) du retour en stock.`;
}

export function followUpMessage(product: string, link: string): string {
  return `Petit rappel : votre réservation (${product}) vous attend. Finalisez ici : ${link}`;
}
