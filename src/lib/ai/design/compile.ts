/**
 * Lot 4 §9 : COMPILATEUR DÉTERMINISTE brief → document de thème (module PUR, testé : tests/design-compile.test.ts).
 *
 * L'IA ne décrit qu'une intention (`StoreDesignDirection`). Tout le document est construit ici :
 *  1. préréglage du secteur (`defaultThemeDocument`), en-tête / pied de page / menus existants conservés ;
 *  2. kit de marque (§7) puis palette, polices et formes de la direction ;
 *  3. sections d'accueil construites à partir de `SECTION_SCHEMAS[type].presets[preset]` et de `COPY_MAP` ;
 *  4. indices de photos, collections et produits résolus en valeurs RÉELLES (hors bornes → ignorés) ;
 *  5. garde-fous (`guards.ts`) : liste blanche, textes filtrés, aucun faux avis, contraste AA ;
 *  6. `validateThemeDocument` doit passer ; sinon les sections fautives sont retirées, puis en dernier
 *     recours on renvoie le préréglage du secteur avec la palette seule.
 *
 * Propriété garantie (testée sur 200 briefs) : TOUT brief valide au schéma produit un document VALIDE.
 */
import { applyBrandKit, type BrandKit } from "@/lib/brand-kit/palette";
import { SECTION_SCHEMAS } from "@/lib/theme-engine/schemas";
import { defaultThemeDocument } from "@/lib/theme-engine/defaults";
import { sanitizeSettings } from "@/lib/storefront/theme-doc";
import { validateThemeDocument, type ThemeRefs } from "@/lib/theme-engine/validate";
import type {
  BlockInstance,
  GlobalSettings,
  SectionInstance,
  SectionType,
  Settings,
  SettingValue,
  Template,
  ThemeDocument,
} from "@/lib/theme-engine/types";
import { cleanCopy, ensureAccessibleColors, filterSections } from "./guards";
import type { BriefHomeSection, StoreDesignDirection } from "./schema";

/* ───────────── Données réelles de la boutique ───────────── */

export type DesignProduct = { id: string; name: string; collection: string | null; hasImage: boolean };
export type DesignCollection = { id: string; name: string };

export type StoreDesignData = {
  storeName: string;
  tagline: string | null;
  sector: string | null;
  city: string | null;
  country: string | null;
  /** Photos déjà téléversées (URL https ou média de la boutique), dans l'ordre proposé au modèle. */
  photos: string[];
  logoUrl: string | null;
  bannerUrl: string | null;
  products: DesignProduct[];
  collections: DesignCollection[];
  paymentMethods: string[];
  deliveryZones: string[];
  hours: string | null;
  /** Des avis APPROUVÉS existent : seule condition pour qu'une section d'avis soit autorisée. */
  hasReviews: boolean;
  brandKit: BrandKit | null;
  /** Document actuel (brouillon) : en-tête, pied de page et menus sont reportés tels quels. */
  current?: ThemeDocument | null;
};

/* ───────────── Table de copie (brief → identifiants de réglages) ───────────── */

type CopyKey = "heading" | "subheading" | "text" | "button_label";

/**
 * Cibles possibles de chaque texte du brief, par ordre de préférence : réglages de la section
 * puis premier bloc du type indiqué. Une cible absente du schéma est simplement ignorée.
 */
export const COPY_MAP: Record<CopyKey, { settingIds: string[]; blocks: { type: string; key: string }[]; max: number }> = {
  heading: { settingIds: ["heading"], blocks: [{ type: "heading", key: "text" }], max: 120 },
  subheading: { settingIds: ["subheading", "text"], blocks: [{ type: "text", key: "text" }], max: 160 },
  text: { settingIds: ["text"], blocks: [{ type: "text", key: "text" }], max: 600 },
  button_label: { settingIds: ["button_label"], blocks: [{ type: "button", key: "button_label" }], max: 40 },
};

/* ───────────── Fabrique de sections ───────────── */

function schemaDefaults(fields: { type: string; id?: string; default?: unknown }[]): Settings {
  const out: Settings = {};
  for (const f of fields) if (f.id && f.default !== undefined) out[f.id] = f.default as SettingValue;
  return out;
}

function fieldExists(type: SectionType, id: string): boolean {
  return SECTION_SCHEMAS[type]?.settings.some((f) => "id" in f && f.id === id) ?? false;
}

/** Instance de section à partir d'un préréglage du schéma (index hors bornes ramené à 0). */
function instanceFromPreset(id: string, type: SectionType, presetIndex: number): SectionInstance | null {
  const schema = SECTION_SCHEMAS[type];
  if (!schema) return null;
  const preset = schema.presets[Math.max(0, Math.min(schema.presets.length - 1, Math.floor(presetIndex) || 0))] ?? schema.presets[0];
  const blocks: BlockInstance[] = (preset?.blocks ?? []).map((b, i) => {
    const bs = schema.blocks?.find((x) => x.type === b.type);
    return { id: `${id}-${b.type}-${i + 1}`, type: b.type, settings: { ...schemaDefaults(bs?.settings ?? []), ...(b.settings ?? {}) } };
  });
  return { id, type, settings: { ...schemaDefaults(schema.settings), ...(preset?.settings ?? {}) }, blocks };
}

function setIfExists(section: SectionInstance, key: string, value: SettingValue): boolean {
  if (!fieldExists(section.type, key)) return false;
  section.settings[key] = value;
  return true;
}

function setBlockValue(section: SectionInstance, blockType: string, key: string, value: SettingValue, used: Set<string>): boolean {
  const schema = SECTION_SCHEMAS[section.type];
  const bs = schema?.blocks?.find((x) => x.type === blockType);
  if (!bs || !bs.settings.some((f) => "id" in f && f.id === key)) return false;
  let block = section.blocks.find((b) => b.type === blockType && !used.has(b.id));
  if (!block) {
    if (section.blocks.length >= (schema?.maxBlocks ?? 20)) return false;
    block = { id: `${section.id}-${blockType}-${section.blocks.length + 1}`, type: blockType, settings: schemaDefaults(bs.settings) };
    section.blocks.push(block);
  }
  block.settings[key] = value;
  used.add(block.id);
  return true;
}

/** Applique les textes du brief à une section, via COPY_MAP. */
function applyCopy(section: SectionInstance, copy: BriefHomeSection["copy"]) {
  const usedBlocks = new Set<string>();
  const usedSettings = new Set<string>();
  for (const key of ["heading", "text", "subheading", "button_label"] as CopyKey[]) {
    const raw = copy?.[key];
    const value = cleanCopy(raw, COPY_MAP[key].max);
    if (!value) continue;
    const map = COPY_MAP[key];
    const settingId = map.settingIds.find((id) => !usedSettings.has(id) && fieldExists(section.type, id));
    if (settingId && setIfExists(section, settingId, value)) {
      usedSettings.add(settingId);
      continue;
    }
    for (const b of map.blocks) if (setBlockValue(section, b.type, b.key, value, usedBlocks)) break;
  }
}

/* ───────────── Résolution des références réelles ───────────── */

function at<T>(list: T[], index: number | null | undefined): T | null {
  if (index == null || !Number.isInteger(index) || index < 0 || index >= list.length) return null;
  return list[index];
}

function applyImage(section: SectionInstance, url: string, alt: string) {
  const schema = SECTION_SCHEMAS[section.type];
  const field = schema?.settings.find((f) => f.type === "image");
  if (field && "id" in field) {
    section.settings[field.id] = { url, alt };
    return;
  }
  for (const b of section.blocks) {
    const bs = schema?.blocks?.find((x) => x.type === b.type);
    const f = bs?.settings.find((x) => x.type === "image");
    if (f && "id" in f && !b.settings[f.id]) {
      b.settings[f.id] = { url, alt };
      return;
    }
  }
}

function applyReferences(section: SectionInstance, brief: BriefHomeSection, data: StoreDesignData, heading: string) {
  const schema = SECTION_SCHEMAS[section.type];
  // Image : photo du commerçant (indice hors bornes ignoré), sinon bannière existante pour la bannière principale.
  const photo = at(data.photos, brief.image?.photoIndex ?? null);
  if (photo) applyImage(section, photo, heading || data.storeName);
  else if (section.type === "hero-banner" && data.bannerUrl) applyImage(section, data.bannerUrl, data.storeName);

  // Collection (réglage de section)
  const collection = at(data.collections, brief.collectionIndex);
  const collField = schema?.settings.find((f) => f.type === "collection");
  if (collection && collField && "id" in collField) section.settings[collField.id] = collection.id;

  // Produit (réglage de section) : premier indice valide
  const productField = schema?.settings.find((f) => f.type === "product");
  if (productField && "id" in productField) {
    const product = brief.productIndexes.map((i) => at(data.products, i)).find((p): p is DesignProduct => !!p) ?? data.products[0];
    if (product) section.settings[productField.id] = product.id;
  }

  // Liste de produits
  const listField = schema?.settings.find((f) => f.type === "product_list");
  if (listField && "id" in listField) {
    const ids = brief.productIndexes.map((i) => at(data.products, i)).filter((p): p is DesignProduct => !!p).map((p) => p.id);
    if (ids.length) section.settings[listField.id] = ids;
  }

  // Blocs « collection » (liste de collections) : collections réelles, dans l'ordre.
  if (section.type === "collection-list") {
    const blocks = section.blocks.filter((b) => b.type === "collection");
    const list = data.collections.slice(0, Math.max(blocks.length, 3));
    section.blocks = list.map((c, i) => ({ id: `${section.id}-collection-${i + 1}`, type: "collection", settings: { collection: c.id } }));
    if (!section.blocks.length) section.blocks = blocks;
  }

  // Blocs « image » (galerie) : photos réelles.
  if (section.type === "image-gallery" && data.photos.length) {
    section.blocks = data.photos.slice(0, 8).map((url, i) => ({ id: `${section.id}-image-${i + 1}`, type: "image", settings: { image: { url, alt: data.storeName } } }));
  }
}

/** FAQ : questions et réponses du brief, nettoyées (le prompt n'autorise que des faits fournis). */
function applyFaq(section: SectionInstance, faq: StoreDesignDirection["faq"]) {
  if (section.type !== "faq" || !faq.length) return;
  const blocks = faq
    .map((qa, i) => ({ q: cleanCopy(qa.q, 120), a: cleanCopy(qa.a, 400), i }))
    .filter((x) => x.q && x.a)
    .slice(0, 6)
    .map((x) => ({ id: `${section.id}-question-${x.i + 1}`, type: "question", settings: { question: x.q, answer: x.a } }));
  if (blocks.length) section.blocks = blocks;
}

/* ───────────── Réglages globaux ───────────── */

const DENSITY: Record<StoreDesignDirection["density"], { sectionSpacing: number; gutter: number }> = {
  airy: { sectionSpacing: 80, gutter: 24 },
  balanced: { sectionSpacing: 56, gutter: 20 },
  compact: { sectionSpacing: 36, gutter: 16 },
};

function applyDirectionSettings(base: GlobalSettings, d: StoreDesignDirection, data: StoreDesignData): GlobalSettings {
  const kit = data.brandKit;
  const withKit = kit ? applyBrandKit(base, kit) : base;
  const announcement = cleanCopy(d.announcement ?? "", 120);
  const weight = ([500, 600, 700, 800] as const).includes(d.headingWeight as 500) ? (d.headingWeight as 500 | 600 | 700 | 800) : 600;
  const next: GlobalSettings = {
    ...withKit,
    colors: {
      ...withKit.colors,
      background: d.palette.background,
      surface: d.palette.surface,
      text: d.palette.text,
      muted: withKit.colors.muted,
      primary: d.palette.primary,
      primaryText: withKit.colors.primaryText,
      accent: d.palette.accent,
      border: withKit.colors.border,
    },
    typography: { ...withKit.typography, heading: d.fonts.heading, body: d.fonts.body, headingWeight: weight },
    buttons: { ...withKit.buttons, radius: d.buttons.radius, style: d.buttons.style },
    cards: { ...withKit.cards, radius: d.cards.radius, imageRatio: d.cards.imageRatio },
    layout: { ...withKit.layout, ...DENSITY[d.density] },
    product: { ...withKit.product, gallery: d.product.gallery, variantPicker: d.product.variantPicker, stickyAddToCart: d.product.stickyAddToCart },
    header: {
      ...withKit.header,
      ...(data.current ? { logo: data.current.settings.header.logo, logoWidth: data.current.settings.header.logoWidth, menu: data.current.settings.header.menu } : {}),
      announcement: announcement ? { ...withKit.header.announcement, enabled: true, text: announcement } : { ...withKit.header.announcement, enabled: false, text: "" },
    },
    footer: data.current ? { ...withKit.footer, menus: data.current.settings.footer.menus, social: data.current.settings.footer.social, showSocial: data.current.settings.footer.showSocial, text: data.current.settings.footer.text } : withKit.footer,
  };
  return ensureAccessibleColors(next);
}

/** Ordre des blocs de la fiche produit : seuls les blocs EXISTANTS sont réordonnés, aucun n'est créé ni supprimé. */
function reorderProductBlocks(template: Template, order: readonly string[]): Template {
  if (!order.length) return template;
  const sections = { ...template.sections };
  for (const [id, section] of Object.entries(sections)) {
    if (section.type !== "main-product") continue;
    const rank = (t: string) => {
      const i = order.indexOf(t);
      return i === -1 ? order.length + 1 : i;
    };
    sections[id] = { ...section, blocks: [...section.blocks].sort((a, b) => rank(a.type) - rank(b.type)) };
  }
  return { ...template, sections };
}

/* ───────────── Compilation ───────────── */

export type CompileResult = { doc: ThemeDocument; notes: string[]; fallback: boolean };

/** Nettoie les réglages d'une section par le sanitize officiel (valeurs typées uniquement). */
function sanitizeSection(section: SectionInstance): SectionInstance {
  const schema = SECTION_SCHEMAS[section.type];
  if (!schema) return section;
  return {
    ...section,
    settings: sanitizeSettings(schema.settings, section.settings),
    blocks: section.blocks
      .map((b) => {
        const bs = schema.blocks?.find((x) => x.type === b.type);
        return bs ? { ...b, settings: sanitizeSettings(bs.settings, b.settings) } : null;
      })
      .filter((b): b is BlockInstance => !!b),
  };
}

export function compileBrief(direction: StoreDesignDirection, data: StoreDesignData, opts: { refs?: ThemeRefs } = {}): CompileResult {
  const notes: string[] = [];
  const base = defaultThemeDocument(data.sector, { name: data.storeName, tagline: data.tagline, logoUrl: data.logoUrl, bannerUrl: data.bannerUrl });
  const settings = applyDirectionSettings(base.settings, direction, data);

  const { sections: briefSections, removed } = filterSections(direction.home, { hasReviews: data.hasReviews });
  for (const r of removed) notes.push(`Section « ${r.type} » retirée : ${r.reason}.`);

  const built: SectionInstance[] = [];
  let n = 0;
  for (const brief of briefSections) {
    // Pas de faux témoignage : une demande de témoignages devient la section « Avis clients vérifiés » (base de données).
    const type: SectionType = brief.type === "testimonials" ? "reviews" : brief.type;
    if (type === "reviews" && built.some((s) => s.type === "reviews")) continue;
    const id = `${type}-${++n}`;
    const section = instanceFromPreset(id, type, brief.preset);
    if (!section) {
      notes.push(`Section « ${brief.type} » inconnue, ignorée.`);
      continue;
    }
    const heading = cleanCopy(brief.copy?.heading ?? "", 120);
    applyCopy(section, brief.copy ?? {});
    applyReferences(section, brief, data, heading);
    applyFaq(section, direction.faq);
    if (fieldExists(type, "scheme")) section.settings.scheme = brief.scheme;
    built.push(sanitizeSection(section));
  }

  // Sections obligatoires du modèle d'accueil (le préréglage n'en a pas aujourd'hui, mais le contrat peut changer).
  for (const id of base.templates.home.order) {
    const s = base.templates.home.sections[id];
    if (s && SECTION_SCHEMAS[s.type]?.required && !built.some((x) => x.type === s.type)) built.push(s);
  }

  const homeSections = built.length ? built : Object.values(base.templates.home.sections);
  const home: Template = { order: homeSections.map((s) => s.id), sections: Object.fromEntries(homeSections.map((s) => [s.id, s])) };

  let doc: ThemeDocument = {
    ...base,
    settings,
    templates: { ...base.templates, home, product: reorderProductBlocks(base.templates.product, direction.product.blocks) },
    updatedAt: new Date(0).toISOString(),
  };

  // Validation : les sections fautives sont retirées, puis on revalide. L'IA ne peut jamais produire un document invalide.
  let check = validateThemeDocument(doc, opts.refs ? { refs: opts.refs } : {});
  if (!check.ok) {
    const bad = new Set<string>();
    for (const issue of check.errors) {
      const i = issue.path.indexOf("sections");
      const id = i >= 0 ? issue.path[i + 1] : null;
      if (typeof id === "string") bad.add(id);
    }
    if (bad.size) {
      const kept = home.order.filter((id) => !bad.has(id));
      notes.push(`${bad.size} section(s) retirée(s) à la validation.`);
      doc = { ...doc, templates: { ...doc.templates, home: { order: kept, sections: Object.fromEntries(kept.map((id) => [id, home.sections[id]])) } } };
      check = validateThemeDocument(doc, opts.refs ? { refs: opts.refs } : {});
    }
  }
  if (check.ok) return { doc: check.doc, notes, fallback: false };

  // Dernier recours : préréglage du secteur avec la palette seule.
  notes.push("Document refusé à la validation : préréglage du secteur conservé avec la palette proposée.");
  const safe = { ...base, settings, updatedAt: new Date(0).toISOString() };
  const last = validateThemeDocument(safe, opts.refs ? { refs: opts.refs } : {});
  return { doc: last.ok ? last.doc : base, notes, fallback: true };
}
