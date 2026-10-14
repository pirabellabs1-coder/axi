/**
 * Dictionnaire d'interface de la vitrine — FRANÇAIS, langue de référence (lot 2 §1.1).
 *
 * C'est la seule source de vérité des clés : toutes les autres langues sont des dictionnaires PARTIELS
 * (`Partial<Record<StorefrontKey, string>>`) et toute clé absente retombe sur le français
 * (`src/i18n/dictionary.ts`). Les variables sont écrites `{nom}` et remplacées par `t(dict, clé, vars)`.
 */
export const fr = {
  /* Formules par secteur (`StoreInfo.copy`, src/lib/storefront/theme.ts) */
  "copy.browseCta": "Voir les produits",
  "copy.catalogTitle": "Nos produits",
  "copy.featuredTitle": "Sélection",
  "copy.addLabel": "Ajouter",
  "copy.searchPlaceholder": "Rechercher un produit",
  "copy.emptyCatalog": "Aucun produit pour le moment.",
  "copy.pickupTitle": "Retrait sur place",
  "copy.pickupHint": "Choisissez un créneau de retrait.",
  "copy.slotLabel": "Créneau",
  "copy.checkoutTitle": "Votre commande",
  "copy.confirmLabel": "Commander",
  "copy.itemNoun": "article",

  /* Navigation */
  "nav.home": "Accueil",
  "nav.catalog": "Catalogue",
  "nav.search": "Rechercher",
  "nav.account": "Mon compte",
  "nav.cart": "Panier",
  "nav.menu": "Menu",
  "nav.blog": "Blog",

  /* Produit */
  "product.addToCart": "Ajouter au panier",
  "product.buyNow": "Commander maintenant",
  "product.soldOut": "Épuisé",
  "product.preorder": "Précommande",
  "product.inStock": "En stock",
  "product.lowStock": "Bientôt épuisé",
  "product.from": "À partir de",
  "product.description": "Description",
  "product.details": "Détails",
  "product.chooseOption": "Choisissez une option",
  "product.quantity": "Quantité",
  "product.reviews": "Avis",
  "product.share": "Partager",

  /* Panier */
  "cart.title": "Panier",
  "cart.empty": "Votre panier est vide.",
  "cart.subtotal": "Sous-total",
  "cart.total": "Total",
  "cart.delivery": "Livraison",
  "cart.discount": "Remise",
  "cart.checkout": "Passer la commande",
  "cart.continue": "Continuer mes achats",
  "cart.remove": "Retirer",

  /* Recherche et listes */
  "search.placeholder": "Rechercher",
  "search.noResults": "Aucun résultat.",
  "search.results": "{count} résultat(s)",
  "list.filter": "Filtrer",
  "list.sort": "Trier",
  "list.seeAll": "Tout voir",
  "list.next": "Suivant",
  "list.previous": "Précédent",

  /* Commande */
  "checkout.title": "Finaliser la commande",
  "checkout.name": "Nom complet",
  "checkout.phone": "Téléphone",
  "checkout.email": "E-mail",
  "checkout.address": "Adresse de livraison",
  "checkout.note": "Note pour la boutique",
  "checkout.delivery": "Livraison",
  "checkout.pickup": "Retrait",
  "checkout.payment": "Paiement",
  "checkout.submit": "Confirmer la commande",
  "checkout.thanks": "Merci ! Votre commande est enregistrée.",

  /* Divers */
  "common.loading": "Chargement…",
  "common.error": "Une erreur est survenue.",
  "common.close": "Fermer",
  "common.back": "Retour",
  "common.yes": "Oui",
  "common.no": "Non",

  /* Bandeau de suggestion de langue */
  "locale.suggestion": "Voir la boutique en {language} ?",
  "locale.switch": "Changer de langue",
  "locale.dismiss": "Non merci",
  "locale.label": "Langue",

  /* Notifications transactionnelles (e-mail, WhatsApp) — `Order.locale` */
  "notif.order.subject": "Commande {reference} : {status}",
  "notif.order.greeting": "Bonjour {name},",
  "notif.order.body": "Votre commande {reference} chez {store} {status}.",
  "notif.order.track": "Suivre votre commande :",
  "notif.order.status.CONFIRMED": "a été confirmée",
  "notif.order.status.PREPARING": "est en préparation",
  "notif.order.status.READY": "est prête",
  "notif.order.status.OUT_FOR_DELIVERY": "est en cours de livraison",
  "notif.order.status.DELIVERED": "a été livrée / remise",
  "notif.order.status.CANCELLED": "a été annulée",
  "notif.order.status.REFUNDED": "a été remboursée",
} as const;

export type StorefrontKey = keyof typeof fr;
/** Dictionnaire d'une langue secondaire : partiel, chaque clé absente retombe sur le français. */
export type StorefrontDictionary = Partial<Record<StorefrontKey, string>>;

export default fr;
