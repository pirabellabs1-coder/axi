/**
 * Montée en gamme (offre au panier, mode `replace`, spec lot 1 §2) : choix de la variante et des suppléments du
 * produit proposé à partir de la ligne déclencheuse. Fonction pure, testée (tests/offer-upgrade.test.ts).
 *
 * Règles (comparaison par NOM, sans tenir compte de la casse, des accents ni des espaces superflus) :
 *  - produit proposé à variantes : la variante retenue a, pour CHAQUE option du produit proposé (ex. « Taille »),
 *    la même valeur que la ligne déclencheuse (ex. « M ») ; elle doit être achetable. Les options de la ligne que le
 *    produit proposé n'a pas (ex. une couleur) sont sans objet. Aucune variante correspondante : `null`.
 *  - suppléments : chaque supplément de la ligne doit exister dans le produit proposé (même nom de groupe, même nom
 *    d'option), sinon `null` ; les groupes obligatoires et les bornes min/max du produit proposé doivent être
 *    respectés, sinon `null`.
 * `null` = l'acheteur choisit lui-même sur la fiche du produit proposé.
 */

export type UpgradeSource = {
  /** Valeurs d'options de la variante de la ligne (`Variant.attributes`), vide pour un produit sans variante. */
  attributes: Record<string, string>;
  /** Suppléments choisis sur la ligne : nom du groupe et nom de l'option. */
  options: { group: string; name: string }[];
};

export type UpgradeTarget = {
  variants: { id: string; attributes: Record<string, string>; purchasable: boolean }[];
  optionGroups: { id: string; name: string; required: boolean; minSelect: number; maxSelect: number; options: { id: string; name: string }[] }[];
};

export type UpgradeSelection = { variantId: string | null; optionIds: string[] };

/** Normalisation des noms et valeurs : casse, accents et espaces ignorés. */
export function normalizeOptionLabel(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Lecture défensive de `Variant.attributes` (JSON) : uniquement les paires texte → texte non vides. */
export function readVariantAttributes(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string" && k.trim() && v.trim()) out[k] = v;
  }
  return out;
}

function normalizedMap(attrs: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(attrs).map(([k, v]) => [normalizeOptionLabel(k), normalizeOptionLabel(v)]));
}

export function matchUpgradeSelection(source: UpgradeSource, target: UpgradeTarget): UpgradeSelection | null {
  // 1. Variante.
  let variantId: string | null = null;
  if (target.variants.length > 0) {
    const src = normalizedMap(source.attributes);
    const match = target.variants.find((v) => {
      const entries = [...normalizedMap(v.attributes).entries()];
      return v.purchasable && entries.length > 0 && entries.every(([k, val]) => src.get(k) === val);
    });
    if (!match) return null;
    variantId = match.id;
  }

  // 2. Suppléments : tous retrouvés, sans doublon.
  const optionIds: string[] = [];
  const perGroup = new Map<string, number>();
  for (const wanted of source.options) {
    const group = target.optionGroups.find((g) => normalizeOptionLabel(g.name) === normalizeOptionLabel(wanted.group));
    const option = group?.options.find((o) => normalizeOptionLabel(o.name) === normalizeOptionLabel(wanted.name) && !optionIds.includes(o.id));
    if (!group || !option) return null;
    optionIds.push(option.id);
    perGroup.set(group.id, (perGroup.get(group.id) ?? 0) + 1);
  }

  // 3. Contraintes des groupes du produit proposé (mêmes règles que la fiche produit).
  for (const g of target.optionGroups) {
    const n = perGroup.get(g.id) ?? 0;
    if (g.required && n < Math.max(1, g.minSelect)) return null;
    if (n > g.maxSelect) return null;
  }
  return { variantId, optionIds };
}
