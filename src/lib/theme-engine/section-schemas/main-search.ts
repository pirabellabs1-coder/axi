import type { SectionSchema } from "../types";

/**
 * Section principale du modèle « Recherche » (vague 2) : champ de recherche, en-tête de résultats, filtres et tri
 * du catalogue, suggestions et état vide personnalisables. Remplace l'ancienne réutilisation de `main-collection`
 * sur le modèle `search` (migration rétrocompatible : `migrateSearchTemplate`, `editor-defaults.ts`).
 */
export const schema: SectionSchema = {
  type: "main-search",
  name: "Recherche",
  category: "Modèle",
  templates: ["search"],
  required: true,
  settings: [
    { type: "text", id: "heading", label: "Titre de la page", default: "Rechercher", maxLength: 80, info: "Affiché au-dessus du champ de recherche. Laissez vide pour n'afficher que le champ." },
    { type: "select", id: "heading_size", label: "Taille du titre", default: "lg", options: [{ value: "md", label: "Moyen" }, { value: "lg", label: "Grand" }, { value: "xl", label: "Très grand" }] },
    { type: "text", id: "placeholder", label: "Texte du champ", default: "", maxLength: 60, info: "Vide : le texte du secteur de la boutique est utilisé." },
    { type: "header", content: "Résultats" },
    { type: "checkbox", id: "show_filters", label: "Filtres", default: true },
    { type: "checkbox", id: "show_sort", label: "Tri", default: true },
    {
      type: "select",
      id: "default_sort",
      label: "Tri par défaut",
      default: "pertinence",
      options: [
        { value: "pertinence", label: "En vedette" },
        { value: "nouveautes", label: "Nouveautés" },
        { value: "meilleures-ventes", label: "Meilleures ventes" },
        { value: "prix-croissant", label: "Prix croissant" },
        { value: "prix-decroissant", label: "Prix décroissant" },
        { value: "alpha", label: "De A à Z" },
      ],
    },
    { type: "range", id: "per_page", label: "Résultats par page", default: 24, min: 8, max: 60, step: 4 },
    { type: "segmented", id: "columns", label: "Colonnes", default: "4", options: [{ value: "2", label: "2" }, { value: "3", label: "3" }, { value: "4", label: "4" }] },
    { type: "header", content: "Suggestions et page vide" },
    { type: "checkbox", id: "show_suggestions", label: "Suggestions quand il y a peu ou pas de résultats", default: true, info: "Mots proches trouvés dans le catalogue (noms, marques, thèmes)." },
    {
      type: "select",
      id: "empty_content",
      label: "Avant la recherche et sans résultat",
      default: "both",
      options: [
        { value: "both", label: "Collections et produits mis en avant" },
        { value: "collections", label: "Collections seulement" },
        { value: "products", label: "Produits mis en avant seulement" },
        { value: "none", label: "Rien" },
      ],
    },
    { type: "text", id: "featured_heading", label: "Titre des produits mis en avant", default: "Les plus demandés", maxLength: 60 },
    { type: "range", id: "featured_limit", label: "Produits mis en avant", default: 4, min: 2, max: 8, step: 2 },
  ],
  presets: [{ name: "Recherche" }],
};
