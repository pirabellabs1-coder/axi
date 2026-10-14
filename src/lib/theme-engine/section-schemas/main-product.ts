import type { SectionSchema } from "../types";
import { metafieldBlock, SCHEME } from "./_shared";

export const schema: SectionSchema = {
  type: "main-product",
  name: "Fiche produit",
  category: "Modèle",
  templates: ["product"],
  required: true,
  settings: [
    { type: "select", id: "gallery", label: "Galerie", default: "thumbnails-left", options: [{ value: "thumbnails-left", label: "Vignettes à gauche" }, { value: "thumbnails-bottom", label: "Vignettes en dessous" }, { value: "carousel", label: "Carrousel" }, { value: "stacked", label: "Images empilées" }, { value: "grid-2", label: "Grille 2 colonnes" }] },
    { type: "checkbox", id: "zoom", label: "Zoom sur l'image", default: true },
    { type: "checkbox", id: "sticky_info", label: "Infos collantes au défilement (ordinateur)", default: true },
    { type: "checkbox", id: "sticky_add_to_cart", label: "Bouton d'ajout collant (mobile)", default: true },
    SCHEME,
  ],
  blocks: [
    { type: "vendor", name: "Marque", limit: 1, settings: [] },
    { type: "title", name: "Titre", limit: 1, settings: [] },
    { type: "price", name: "Prix", limit: 1, settings: [{ type: "checkbox", id: "show_savings", label: "Afficher l'économie (-x %)", default: true }] },
    { type: "rating", name: "Note moyenne", limit: 1, settings: [] },
    { type: "variant_picker", name: "Variantes", limit: 1, settings: [{ type: "segmented", id: "style", label: "Style", default: "buttons", options: [{ value: "buttons", label: "Boutons" }, { value: "dropdown", label: "Liste" }, { value: "swatches", label: "Pastilles couleur" }] }, { type: "checkbox", id: "show_sold_out", label: "Montrer les variantes épuisées", default: true }] },
    { type: "options", name: "Options et suppléments", limit: 1, settings: [] },
    { type: "quantity", name: "Quantité", limit: 1, settings: [] },
    { type: "buy_buttons", name: "Boutons d'achat", limit: 1, settings: [{ type: "checkbox", id: "show_whatsapp", label: "Bouton « Commander sur WhatsApp »", default: true }, { type: "checkbox", id: "show_buy_now", label: "Bouton « Acheter maintenant »", default: true }] },
    { type: "stock", name: "Disponibilité", limit: 1, settings: [{ type: "paragraph", content: "Le seuil « stock bas » se règle sur chaque produit (ou par défaut dans Notifications). Une rupture vendue en précommande s'affiche « Précommande »." }] },
    { type: "description", name: "Description", limit: 1, settings: [{ type: "checkbox", id: "collapsed", label: "Repliée par défaut", default: false }] },
    { type: "collapsible_tab", name: "Onglet repliable", settings: [{ type: "text", id: "title", label: "Titre", default: "Livraison et retours" }, { type: "richtext", id: "content", label: "Contenu", default: "" }, { type: "checkbox", id: "use_product_details", label: "Utiliser les détails du produit", default: false }] },
    { type: "delivery_info", name: "Infos livraison", limit: 1, settings: [] },
    { type: "trust", name: "Garanties", limit: 1, settings: [] },
    { type: "share", name: "Partager", limit: 1, settings: [] },
    { type: "sku", name: "Référence (SKU)", limit: 1, settings: [] },
    { type: "text", name: "Texte libre", settings: [{ type: "richtext", id: "text", label: "Texte", default: "" }] },
    // Lot 4 §5 : libellé + valeur liée à un champ personnalisé
    metafieldBlock,
    // Lot 1 : ventes croisées, cartes cadeaux, remises automatiques
    {
      type: "complementary",
      name: "Souvent achetés ensemble",
      limit: 1,
      settings: [
        { type: "text", id: "heading", label: "Titre", default: "Souvent achetés ensemble", maxLength: 80 },
        { type: "range", id: "max", label: "Produits affichés", default: 3, min: 1, max: 4 },
        { type: "paragraph", content: "Produits proposés par vos offres au panier (Promotions, onglet « Offres au panier », emplacement « Fiche produit »). Masqué s'il n'y a aucune offre." },
      ],
    },
    { type: "gift_card_form", name: "Carte cadeau : destinataire", limit: 1, settings: [{ type: "paragraph", content: "Visible uniquement sur les produits « carte cadeau » : nom, téléphone ou e-mail du destinataire, message et date d'envoi." }] },
    { type: "discount_badges", name: "Offres disponibles", limit: 1, settings: [{ type: "text", id: "heading", label: "Titre", default: "Offres disponibles", maxLength: 80 }, { type: "paragraph", content: "Remises automatiques actives qui concernent ce produit (lots, quantités, paliers)." }] },
  ],
  presets: [{ name: "Fiche produit", blocks: [{ type: "vendor" }, { type: "title" }, { type: "rating" }, { type: "price" }, { type: "discount_badges" }, { type: "variant_picker" }, { type: "options" }, { type: "stock" }, { type: "quantity" }, { type: "gift_card_form" }, { type: "buy_buttons" }, { type: "complementary" }, { type: "delivery_info" }, { type: "description" }, { type: "collapsible_tab", settings: { title: "Détails", use_product_details: true } }, { type: "share" }] }],
};
