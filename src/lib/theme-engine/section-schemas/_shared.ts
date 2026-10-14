/**
 * Champs et blocs partagés par les schémas de sections (un fichier par section dans ce dossier).
 * Importables par toute équipe qui écrit un schéma (`src/lib/blog/section-schemas.ts`, sections premium…).
 * Ne jamais importer `../schemas` d'ici ni d'un fichier de schéma (cycle d'import).
 */
import type { BlockSchema, SettingField } from "../types";

export const SCHEME: SettingField = {
  type: "select",
  id: "scheme",
  label: "Couleurs de la section",
  default: "default",
  options: [
    { value: "default", label: "Par défaut" },
    { value: "surface", label: "Surface" },
    { value: "inverse", label: "Inversé" },
    { value: "brand", label: "Couleur de marque" },
  ],
};
export const PADDING: SettingField[] = [
  { type: "range", id: "padding_top", label: "Marge haute", default: 48, min: 0, max: 160, step: 8, unit: "px" },
  { type: "range", id: "padding_bottom", label: "Marge basse", default: 48, min: 0, max: 160, step: 8, unit: "px" },
];
export const HEADING = (def = ""): SettingField[] => [
  { type: "text", id: "heading", label: "Titre", default: def, maxLength: 120 },
  { type: "select", id: "heading_size", label: "Taille du titre", default: "md", options: [{ value: "sm", label: "Petit" }, { value: "md", label: "Moyen" }, { value: "lg", label: "Grand" }, { value: "xl", label: "Très grand" }] },
];
export const ALIGN: SettingField = { type: "segmented", id: "align", label: "Alignement", default: "left", options: [{ value: "left", label: "Gauche" }, { value: "center", label: "Centre" }] };
export const BUTTON = (prefix = "button", def = ""): SettingField[] => [
  { type: "text", id: `${prefix}_label`, label: "Texte du bouton", default: def, maxLength: 40 },
  { type: "url", id: `${prefix}_link`, label: "Lien du bouton", default: "/catalogue" },
  { type: "segmented", id: `${prefix}_style`, label: "Style", default: "solid", options: [{ value: "solid", label: "Plein" }, { value: "secondary", label: "Secondaire" }, { value: "outline", label: "Contour" }, { value: "link", label: "Lien" }] },
];

/**
 * Arrière-plan de section (image ou dégradé + superposition). Groupe optionnel, à ajouter aux sections de contenu
 * qui n'ont PAS déjà une image de fond propre (pas les `main-*`, ni hero/slideshow/vidéo). Défaut « Aucun » : rien
 * ne change pour l'existant. Rendu : `resolveSectionBackground` (theme-doc.ts) appliqué par `SectionShell` (ui.tsx),
 * derrière le contenu, avec report du contraste (texte clair/sombre) via `backgroundToneVars`.
 */
export const BACKGROUND: SettingField[] = [
  { type: "header", content: "Arrière-plan" },
  { type: "segmented", id: "bg_type", label: "Type de fond", default: "none", options: [{ value: "none", label: "Aucun" }, { value: "image", label: "Image" }, { value: "gradient", label: "Dégradé" }] },
  { type: "image", id: "bg_image", label: "Image de fond", info: "Affichée en plein cadre (recadrage automatique). Ajoutez une superposition si le texte manque de lisibilité." },
  { type: "select", id: "bg_position", label: "Cadrage de l'image", default: "center", options: [{ value: "top", label: "Haut" }, { value: "center", label: "Centre" }, { value: "bottom", label: "Bas" }] },
  { type: "checkbox", id: "bg_fixed", label: "Effet parallaxe léger", default: false, info: "L'image reste fixe au défilement. Ignoré pour les visiteurs qui réduisent les animations." },
  { type: "color", id: "bg_gradient_from", label: "Dégradé : couleur de départ", default: "#1f2937" },
  { type: "color", id: "bg_gradient_to", label: "Dégradé : couleur d'arrivée", default: "#111827" },
  { type: "range", id: "bg_gradient_angle", label: "Dégradé : angle", default: 135, min: 0, max: 360, step: 5, unit: "°" },
  { type: "color", id: "bg_overlay_color", label: "Superposition : couleur", default: "#000000" },
  { type: "range", id: "bg_overlay", label: "Superposition : intensité", default: 0, min: 0, max: 80, step: 5, unit: "%" },
];

/**
 * Largeur de section (standard Shopify) : complète l'arrière-plan de section. Groupe optionnel, à ajouter aux
 * sections de contenu (PAS les `main-*`). Défauts « Contenu » + « Standard » = comportement actuel (rendu inchangé
 * pour l'existant). Rendu : `resolveSectionWidth` (theme-doc.ts) appliqué par `SectionShell` (ui.tsx) via la variable
 * `--section-max` lue par `.sf-container`.
 * - `section_width` : « Contenu » (contenu limité à `content_width`, fond déjà bord à bord par la mise en page) vs
 *   « Pleine largeur » (le contenu s'étend aussi bord à bord, dans les marges latérales).
 * - `content_width` : largeur maximale du CONTENU interne — « Étroit » ≈ 720 px, « Standard » = largeur de page,
 *   « Large » = largeur de page + 160 px (bornée par la fenêtre). Sans effet quand « Pleine largeur » est choisi.
 */
export const SECTION_WIDTH: SettingField[] = [
  { type: "segmented", id: "section_width", label: "Largeur de la section", default: "content", options: [{ value: "content", label: "Contenu" }, { value: "full", label: "Pleine largeur" }] },
  { type: "select", id: "content_width", label: "Largeur du contenu (sans effet en pleine largeur)", default: "standard", options: [{ value: "narrow", label: "Étroit" }, { value: "standard", label: "Standard" }, { value: "wide", label: "Large" }] },
];

export const textBlock: BlockSchema = { type: "text", name: "Texte", settings: [{ type: "richtext", id: "text", label: "Texte", default: "" }] };
export const headingBlock: BlockSchema = { type: "heading", name: "Titre", settings: [{ type: "text", id: "text", label: "Titre", default: "Titre", maxLength: 120 }, { type: "select", id: "size", label: "Taille", default: "lg", options: [{ value: "md", label: "Moyen" }, { value: "lg", label: "Grand" }, { value: "xl", label: "Très grand" }] }] };
export const buttonBlock: BlockSchema = { type: "button", name: "Bouton", limit: 2, settings: BUTTON("button", "Voir la boutique") };

/**
 * Lot 4 §5 (consolidation vague 2) : bloc « Champ personnalisé » des sections de modèle (fiche produit, collection).
 * Libellé + valeur, la valeur étant en général liée à un champ personnalisé par « Connecter une donnée ».
 * Rendu : `product/product-main.tsx` (cas `metafield`) et `sections/main-collection.tsx` (`MetafieldLines`).
 */
export const metafieldBlock: BlockSchema = {
  type: "metafield",
  name: "Champ personnalisé",
  settings: [
    { type: "text", id: "label", label: "Libellé", default: "", maxLength: 60 },
    { type: "textarea", id: "value", label: "Valeur", default: "", maxLength: 500, info: "Connectez un champ personnalisé (« Connecter une donnée »). Rien ne s'affiche si la valeur est vide." },
  ],
};
