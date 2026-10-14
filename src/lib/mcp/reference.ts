/**
 * Référence publique des outils MCP (libellés français), affichée sur /developpeurs et dans docs/API-MCP.md.
 * Module pur. Alignement garanti par tests/mcp-reference.test.ts (noms et scopes = ceux du serveur).
 */
import type { Scope } from "./scopes";

export type ToolGroup = "Boutique" | "Catalogue" | "Stock" | "Commandes" | "Clients" | "Marketing" | "Analyses" | "Cartes cadeaux" | "Retours";
export type ToolRef = { name: string; group: ToolGroup; scopes: Scope[]; write: boolean; description: string };

export const MERCHANT_TOOL_REFERENCE: ToolRef[] = [
  { name: "get_store_overview", group: "Boutique", scopes: ["store:read"], write: false, description: "Identité, plan, devise et chiffres clés : ventes du jour, 7 et 30 jours, panier moyen, commandes à traiter, meilleures ventes." },
  { name: "search_products", group: "Catalogue", scopes: ["catalog:read"], write: false, description: "Recherche par texte, statut, étiquette ou collection, avec pagination." },
  { name: "get_product", group: "Catalogue", scopes: ["catalog:read"], write: false, description: "Fiche complète : variantes, options, suppléments, stock, collections." },
  { name: "create_product", group: "Catalogue", scopes: ["catalog:write"], write: true, description: "Crée un produit, en brouillon par défaut, dans la limite du plan." },
  { name: "update_product", group: "Catalogue", scopes: ["catalog:write"], write: true, description: "Titre, description, prix, promotion, statut, étiquettes, collections." },
  { name: "update_variant_price_stock", group: "Catalogue", scopes: ["catalog:write", "inventory:write"], write: true, description: "Prix et niveau de stock d'une variante, historisé." },
  { name: "list_collections", group: "Catalogue", scopes: ["catalog:read"], write: false, description: "Collections manuelles et automatiques avec leur nombre de produits." },
  { name: "add_products_to_collection", group: "Catalogue", scopes: ["catalog:write"], write: true, description: "Ajoute des produits à une collection manuelle." },
  { name: "adjust_inventory", group: "Stock", scopes: ["inventory:write"], write: true, description: "Entrée ou sortie de stock avec motif, jamais en négatif." },
  { name: "list_low_stock", group: "Stock", scopes: ["catalog:read"], write: false, description: "Ruptures et stocks bas, du plus urgent au moins urgent." },
  { name: "list_orders", group: "Commandes", scopes: ["orders:read"], write: false, description: "Commandes filtrées par statut, paiement, période ou référence." },
  { name: "get_order", group: "Commandes", scopes: ["orders:read"], write: false, description: "Détail, paiement, historique et prochains statuts possibles." },
  { name: "update_order_status", group: "Commandes", scopes: ["orders:write"], write: true, description: "Fait avancer une commande selon le cycle de vie Axi (stock et client mis à jour)." },
  { name: "add_order_note", group: "Commandes", scopes: ["orders:write"], write: true, description: "Note interne dans l'historique, jamais visible du client." },
  { name: "list_customers", group: "Clients", scopes: ["customers:read"], write: false, description: "Clients avec commandes, montant dépensé et dernière visite." },
  { name: "get_customer", group: "Clients", scopes: ["customers:read"], write: false, description: "Coordonnées, consentement WhatsApp, fidélité et historique." },
  { name: "create_discount_code", group: "Marketing", scopes: ["marketing:write"], write: true, description: "Code promo en pourcentage, montant fixe ou livraison offerte, daté." },
  { name: "list_discount_codes", group: "Marketing", scopes: ["marketing:write", "analytics:read"], write: false, description: "Codes promo, validité et nombre d'utilisations." },
  { name: "sales_report", group: "Analyses", scopes: ["analytics:read"], write: false, description: "Ventes par jour, semaine ou produit, comparées à la période précédente." },
  { name: "list_automatic_discounts", group: "Marketing", scopes: ["marketing:write", "analytics:read"], write: false, description: "Remises automatiques (lots, 2 achetés = 1 offert, paliers), résumé en phrase et statut." },
  { name: "create_automatic_discount", group: "Marketing", scopes: ["marketing:write"], write: true, description: "Crée une remise automatique ; confirmation requise au-delà de 50 %, du panier moyen ou d'un lot à moitié prix." },
  { name: "set_automatic_discount_active", group: "Marketing", scopes: ["marketing:write"], write: true, description: "Active ou désactive une remise automatique." },
  { name: "list_gift_cards", group: "Cartes cadeaux", scopes: ["orders:read"], write: false, description: "Cartes cadeaux, solde et statut ; 4 derniers caractères du code uniquement." },
  { name: "issue_gift_card", group: "Cartes cadeaux", scopes: ["giftcards:write"], write: true, description: "Émet une carte cadeau (confirmation toujours requise) ; le code n'est jamais renvoyé à l'assistant." },
  { name: "grant_store_credit", group: "Cartes cadeaux", scopes: ["giftcards:write"], write: true, description: "Crédite l'avoir d'un client avec motif (confirmation toujours requise, nécessite aussi customers:read)." },
  { name: "list_returns", group: "Retours", scopes: ["orders:read"], write: false, description: "Demandes de retour par statut, textes de l'acheteur isolés." },
  { name: "get_return", group: "Retours", scopes: ["orders:read"], write: false, description: "Détail d'un retour : articles, motif, montants, historique, prochains statuts." },
  { name: "update_return_status", group: "Retours", scopes: ["orders:write"], write: true, description: "Approuve, refuse (motif), annule, réceptionne ou résout un retour selon son cycle de vie." },
  { name: "get_catalog_sync_status", group: "Catalogue", scopes: ["catalog:read"], write: false, description: "Catalogue WhatsApp / Meta : URL des flux, état de la synchronisation, articles refusés par Meta et motif." },
  { name: "trigger_catalog_sync", group: "Catalogue", scopes: ["catalog:write"], write: true, description: "Lance une synchronisation complète du catalogue WhatsApp (6 par heure au plus)." },
  { name: "list_webhook_deliveries", group: "Boutique", scopes: ["webhooks:write"], write: false, description: "Livraisons des webhooks sortants : statut, essais, code HTTP, erreur ; filtres par point, statut, événement." }, // Lot 2 (W)
  { name: "list_blog_posts", group: "Marketing", scopes: ["content:write"], write: false, description: "Articles du blog : statut (programmé échu = publié), date, catégorie, étiquettes, adresse publique." }, // Lot 2 (D)
  { name: "create_blog_post", group: "Marketing", scopes: ["content:write"], write: true, description: "Crée un BROUILLON d'article (jamais publié) en Markdown limité, sans image ; quota d'articles du plan." }, // Lot 2 (D)
  { name: "set_metafield", group: "Catalogue", scopes: ["catalog:write"], write: true, description: "Renseigne ou efface un champ personnalisé (défini dans Axi) d'un produit, d'une variante ou d'une collection ; valeur validée par type." }, // Lot 4A (D/T5)
  { name: "list_saved_sections", group: "Boutique", scopes: ["store:read", "theme:write"], write: false, description: "Sections de thème enregistrées : nom, type, pages compatibles, usage, limite du plan." }, // Lot 4A (D/T5)
  { name: "get_tax_settings", group: "Boutique", scopes: ["store:read"], write: false, description: "Réglages fiscaux : TVA collectée ou non, TTC ou HT, régime, identité fiscale, taux par pays et catégorie, factures émises." }, // Lot 2 (T)
  { name: "list_digital_downloads", group: "Commandes", scopes: ["orders:read"], write: false, description: "Accès de téléchargement des produits numériques : téléchargements utilisés, limite, expiration, dernier téléchargement. Jamais de lien ni de jeton." }, // Vague 2 (N)
  { name: "list_product_files", group: "Catalogue", scopes: ["catalog:read"], write: false, description: "Fichiers vendus d'un produit numérique : nom, taille, type, version. Jamais de clé de stockage ni de lien." }, // Vague 2 (N)
  { name: "list_locations", group: "Stock", scopes: ["catalog:read"], write: false, description: "Dépôts, magasins et points de retrait : rôle, retrait possible, nombre d'articles détenus." }, // Lot 3 (OPS)
  { name: "get_inventory_levels", group: "Stock", scopes: ["catalog:read"], write: false, description: "Stock par dépôt et stock total de chaque article suivi, avec signalement des écarts et des surventes." }, // Lot 3 (OPS)
  { name: "transfer_stock", group: "Stock", scopes: ["inventory:write"], write: true, description: "Déplace des unités d'un dépôt à l'autre (stock total inchangé) ; confirmation exigée au-delà de 50 unités." }, // Lot 3 (OPS)
  { name: "create_shipment", group: "Commandes", scopes: ["orders:write"], write: true, description: "Crée une expédition, même partielle, avec livreur interne ou transporteur, et le code de remise à transmettre à l'acheteur." }, // Lot 3 (OPS)
  { name: "update_shipment_status", group: "Commandes", scopes: ["orders:write"], write: true, description: "Fait avancer une expédition dans les seules transitions permises ; une expédition partie ne s'annule pas." }, // Lot 3 (OPS)
  { name: "pos_daily_report", group: "Analyses", scopes: ["analytics:read"], write: false, description: "Ventes du jour en caisse : nombre, chiffre d'affaires, moyens de paiement, espèces attendues et comptées, écarts de prix hors ligne." }, // Lot 3 (OPS)
];

export const PUBLIC_TOOL_REFERENCE: { name: string; write: boolean; description: string }[] = [
  { name: "get_store_info", write: false, description: "Présentation, horaires, contact WhatsApp, livraison, paiements et conditions." },
  { name: "search_catalog", write: false, description: "Produits en vente, prix du moment et disponibilité." },
  { name: "get_product", write: false, description: "Fiche publique : variantes, suppléments, photos." },
  { name: "check_availability", write: false, description: "Vérifie qu'un panier peut être commandé maintenant." },
  { name: "get_delivery_options", write: false, description: "Zones et frais de livraison, créneaux de retrait." },
  { name: "create_checkout_link", write: true, description: "Prépare un panier : l'acheteur ouvre le lien et valide lui-même sa commande." },
];
