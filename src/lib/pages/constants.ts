export const PAGE_BODY_MAX = 20_000;

/** Adresses déjà utilisées par la boutique publique (/s/{slug}/…) ou réservées. */
export const RESERVED_PAGE_SLUGS = ["p", "commander", "merci", "panier", "produit", "produits", "categorie", "categories", "avis", "suivi", "recherche", "api", "app", "admin", "pages", "page", "compte", "connexion"];

export const PAGE_TEMPLATES: { title: string; slug: string; body: string }[] = [
  {
    title: "À propos",
    slug: "a-propos",
    body: "## Notre histoire\n\nPrésentez votre boutique : depuis quand, pourquoi, ce qui vous rend unique.\n\n## Nos engagements\n\n- Produits vérifiés avant chaque envoi\n- Réponse rapide sur WhatsApp\n- Livraison soignée",
  },
  {
    title: "Questions fréquentes",
    slug: "faq",
    body: "## Comment commander ?\n\nAjoutez vos articles au panier puis validez : la commande nous arrive sur WhatsApp.\n\n## Quels sont les délais de livraison ?\n\nIndiquez vos délais par zone.\n\n## Comment payer ?\n\nListez vos moyens de paiement acceptés.",
  },
  {
    title: "Livraison et retours",
    slug: "livraison-retours",
    body: "## Livraison\n\nZones desservies, délais et frais.\n\n## Retours\n\nConditions de retour ou d'échange, délai, état du produit.",
  },
];
