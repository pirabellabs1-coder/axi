import { Banknote, Smartphone, Landmark, Globe } from "lucide-react";

/** Métadonnées des moyens de paiement : module partagé serveur/client (pas de "use client"). */
export const KIND_META = {
  CASH_ON_DELIVERY: { label: "Paiement à la livraison ou au retrait", icon: Banknote, hint: "Espèces à la réception. La commande reste « à encaisser » jusqu'à votre confirmation." },
  MOBILE_MONEY_MANUAL: { label: "Mobile Money (manuel)", icon: Smartphone, hint: "Le client envoie le montant sur votre numéro puis saisit la référence ; vous confirmez à la main." },
  BANK_TRANSFER_MANUAL: { label: "Virement bancaire (manuel)", icon: Landmark, hint: "Même principe que le Mobile Money manuel : confirmation à la main." },
  GATEWAY: { label: "Mobile Money et carte en ligne", icon: Globe, hint: "Paiement vérifié automatiquement par webhook signé. Vos propres clés, les frais de votre fournisseur." },
} as const;
