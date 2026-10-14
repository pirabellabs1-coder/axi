/**
 * Lot 4 §3 : scores qualité en direct (module PUR, calculé côté client à chaque modification, et côté serveur pour
 * le MCP `get_quality_report`).
 *
 * `scoreTheme(doc, facts)` → `{ scores: { accessibility, performance, seo, conversion } (0..100), issues }`.
 *  - `facts` : données hors document chargées une fois par session d'éditeur (métadonnées d'images, produits sans
 *    texte alternatif, description de boutique, avis…). Fait absent = règle correspondante non évaluée.
 *  - Chaque `Issue` peut porter une correction : `fix` = `ThemeOperation[]` (à passer à `applyOperations`, annulable
 *    via l'historique de l'éditeur) ou une action hors document (`ai_alt`, `ai_seo`, `compress_image`, `open_product`).
 *  - Corrections IDEMPOTENTES : appliquer `fix` puis recalculer fait disparaître l'issue (tests `quality.test.ts`).
 *
 * Pondération : pénalité par issue selon la gravité (erreur 20, avertissement 8, conseil 3), plafonnée par règle à
 * 2 × la pénalité de sa gravité la plus forte (vingt images lourdes ne valent pas zéro), score = max(0, 100 − total).
 */
import { contrastRatio, isHexColor, readableOn } from "@/lib/storefront/theme-doc";
import { SECTION_SCHEMAS } from "./schemas";
import { allTemplates, type TemplateKey } from "./alternates";
import { canAddSection, type ThemeOperation } from "./operations";
import type { SectionInstance, SettingField, Settings, SettingValue, Template, ThemeDocument } from "./types";

export type QualityCategory = "accessibility" | "performance" | "seo" | "conversion";
export type IssueSeverity = "error" | "warning" | "tip";

export type IssueTarget = {
  template?: TemplateKey;
  sectionId?: string;
  blockId?: string;
  settingId?: string;
  /** Réglage global (`colors.text`, `header.announcement.text`…). */
  global?: string;
};

/** Correction hors document (crédits IA, pipeline de stockage, fiche produit). */
export type QualityAction =
  | { action: "ai_alt"; productIds: string[] }
  | { action: "ai_seo"; target: "store_description" | "collections" | "product_seo"; ids?: string[] }
  | { action: "compress_image"; url: string }
  | { action: "open_product"; productId: string };

export type Issue = {
  /** Identifiant stable (`règle:cible`), utilisable comme clé de liste. */
  id: string;
  /** Règle (`a11y.contrast.text`…). */
  rule: string;
  category: QualityCategory;
  severity: IssueSeverity;
  message: string;
  target?: IssueTarget;
  fix?: ThemeOperation[] | QualityAction;
  /** Libellé du bouton de correction. */
  fixLabel?: string;
};

export type ImageFact = { bytes?: number; width?: number; height?: number; format?: string };

export type QualityFacts = {
  /** Métadonnées par URL d'image (stockage objet). Les data-URL sont mesurées directement. */
  images?: Record<string, ImageFact>;
  storeName?: string;
  storeDescription?: string | null;
  productsWithoutAlt?: { id: string; name: string }[];
  collectionsWithoutDescription?: { id: string; name: string }[];
  /** Produits dont le `seoTitle` dépasse 60 caractères. */
  productsWithLongSeoTitle?: { id: string; name: string; length: number }[];
  /** Avis approuvés de la boutique. */
  reviewCount?: number;
  /** Numéro WhatsApp renseigné. */
  hasWhatsapp?: boolean;
};

export type QualityReport = { scores: Record<QualityCategory, number>; issues: Issue[] };

export const SEVERITY_PENALTY: Record<IssueSeverity, number> = { error: 20, warning: 8, tip: 3 };
export const QUALITY_THRESHOLDS = {
  contrast: 4.5,
  imageBytes: 400_000,
  imageDimension: 2_500,
  slideshowAutoplaySlides: 3,
  homeSections: 15,
  storeDescription: 50,
  seoTitle: 60,
  announcement: 120,
} as const;

const SEVERITY_ORDER: Record<IssueSeverity, number> = { error: 0, warning: 1, tip: 2 };

/* ───────────── Utilitaires ───────────── */

function hexMix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round((((pa >> s) & 255) * (1 - t)) + (((pb >> s) & 255) * t));
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, "0")).join("")}`;
}

/** Couleur la plus proche de `fg` (même teinte, rapprochée du noir ou du blanc) qui atteint `min` sur `bg`. */
export function adjustForContrast(fg: string, bg: string, min: number = QUALITY_THRESHOLDS.contrast): string {
  if (contrastRatio(fg, bg) >= min) return fg;
  const target = readableOn(bg);
  for (let t = 0.1; t < 1; t += 0.1) {
    const c = hexMix(fg, target, t);
    if (contrastRatio(c, bg) >= min) return c;
  }
  return target;
}

type Visit = { key: TemplateKey; base: string; section: SectionInstance; blockId?: string; fields: SettingField[]; settings: Settings };

/** Parcourt les réglages de toutes les sections ACTIVES (modèles par défaut et alternatifs), blocs actifs compris. */
function* visitSettings(doc: ThemeDocument): Generator<Visit> {
  for (const { key, base, template } of allTemplates(doc)) {
    for (const sid of template.order) {
      const s = template.sections[sid];
      const schema = s && SECTION_SCHEMAS[s.type];
      if (!s || !schema || s.disabled) continue;
      yield { key, base, section: s, fields: schema.settings, settings: s.settings };
      for (const b of s.blocks) {
        if (b.disabled) continue;
        const bs = schema.blocks?.find((x) => x.type === b.type);
        if (bs) yield { key, base, section: s, blockId: b.id, fields: bs.settings, settings: b.settings };
      }
    }
  }
}

function activeSections(t: Template): SectionInstance[] {
  return t.order.map((id) => t.sections[id]).filter((s): s is SectionInstance => !!s && !s.disabled);
}

function plain(v: unknown): string {
  return typeof v === "string" ? v.replace(/[*_`#>[\]()]/g, "").replace(/\s+/g, " ").trim() : "";
}

/** Texte alternatif proposé : titre du bloc ou de la section, sinon nom du schéma. */
function altFor(v: Visit): string {
  const own = plain(v.settings.heading) || plain(v.settings.title) || plain(v.settings.caption);
  const sec = plain(v.section.settings.heading);
  return (own || sec || SECTION_SCHEMAS[v.section.type].name).slice(0, 200);
}

function setOp(v: Visit, key: string, value: SettingValue): ThemeOperation {
  return v.blockId
    ? { op: "updateBlockSetting", template: v.key, sectionId: v.section.id, blockId: v.blockId, key, value }
    : { op: "updateSectionSetting", template: v.key, sectionId: v.section.id, key, value };
}

function targetOf(v: Visit, settingId?: string): IssueTarget {
  return { template: v.key, sectionId: v.section.id, ...(v.blockId ? { blockId: v.blockId } : {}), ...(settingId ? { settingId } : {}) };
}

function tkey(t: IssueTarget | undefined): string {
  if (!t) return "doc";
  return t.global ?? [t.template, t.sectionId, t.blockId, t.settingId].filter(Boolean).join("/");
}

/* ───────────── Règles ───────────── */

function accessibility(doc: ThemeDocument, facts: QualityFacts, out: Issue[]) {
  const c = doc.settings.colors;
  const push = (i: Omit<Issue, "id" | "category">) => out.push({ ...i, id: `${i.rule}:${tkey(i.target)}`, category: "accessibility" });

  if (isHexColor(c.text) && isHexColor(c.background) && contrastRatio(c.text, c.background) < QUALITY_THRESHOLDS.contrast) {
    push({ rule: "a11y.contrast.text", severity: "error", message: "Le texte est peu lisible sur le fond de la boutique (contraste inférieur à 4,5:1).", target: { global: "colors.text" }, fix: [{ op: "updateGlobalSetting", path: "colors.text", value: adjustForContrast(c.text, c.background) }], fixLabel: "Rendre le texte lisible" });
  }
  if (isHexColor(c.muted) && isHexColor(c.background) && contrastRatio(c.muted, c.background) < QUALITY_THRESHOLDS.contrast) {
    push({ rule: "a11y.contrast.muted", severity: "warning", message: "Le texte secondaire manque de contraste avec le fond.", target: { global: "colors.muted" }, fix: [{ op: "updateGlobalSetting", path: "colors.muted", value: adjustForContrast(c.muted, c.background) }], fixLabel: "Assombrir le texte secondaire" });
  }
  if (isHexColor(c.primary) && isHexColor(c.primaryText) && contrastRatio(c.primaryText, c.primary) < QUALITY_THRESHOLDS.contrast) {
    push({ rule: "a11y.contrast.button", severity: "error", message: "Le texte des boutons principaux est peu lisible sur leur couleur.", target: { global: "colors.primaryText" }, fix: [{ op: "updateGlobalSetting", path: "colors.primaryText", value: readableOn(c.primary) }], fixLabel: "Corriger le texte des boutons" });
  }
  const badSchemes = c.schemes.filter((s) => contrastRatio(s.text, s.background) < QUALITY_THRESHOLDS.contrast || contrastRatio(s.primaryText, s.primary) < QUALITY_THRESHOLDS.contrast);
  if (badSchemes.length) {
    const fixed = c.schemes.map((s) => ({ ...s, text: adjustForContrast(s.text, s.background), primaryText: contrastRatio(s.primaryText, s.primary) >= QUALITY_THRESHOLDS.contrast ? s.primaryText : readableOn(s.primary) }));
    push({ rule: "a11y.contrast.scheme", severity: "warning", message: `Schéma de couleurs peu lisible : ${badSchemes.map((s) => `« ${s.name} »`).join(", ")}.`, target: { global: "colors.schemes" }, fix: [{ op: "updateGlobalSetting", path: "colors.schemes", value: fixed }], fixLabel: "Corriger les schémas" });
  }

  // Images sans texte alternatif (sections et blocs).
  for (const v of visitSettings(doc)) {
    for (const f of v.fields) {
      if (f.type !== "image") continue;
      const val = v.settings[f.id];
      if (!val || typeof val !== "object" || Array.isArray(val) || !("url" in val) || (val.alt ?? "").trim()) continue;
      push({ rule: "a11y.alt.section", severity: "warning", message: `Image sans texte alternatif dans « ${SECTION_SCHEMAS[v.section.type].name} ».`, target: targetOf(v, f.id), fix: [setOp(v, f.id, { url: val.url, alt: altFor(v) })], fixLabel: "Utiliser le titre de la section" });
    }
  }
  const logo = doc.settings.header.logo;
  if (logo && !(logo.alt ?? "").trim() && facts.storeName?.trim()) {
    push({ rule: "a11y.alt.logo", severity: "warning", message: "Le logo n'a pas de texte alternatif.", target: { global: "header.logo" }, fix: [{ op: "updateGlobalSetting", path: "header.logo", value: { url: logo.url, alt: facts.storeName.trim().slice(0, 200) } }], fixLabel: "Utiliser le nom de la boutique" });
  }
  if (facts.productsWithoutAlt?.length) {
    const n = facts.productsWithoutAlt.length;
    push({ rule: "a11y.alt.products", severity: "warning", message: `${n} produit${n > 1 ? "s ont" : " a"} des images sans texte alternatif.`, fix: { action: "ai_alt", productIds: facts.productsWithoutAlt.slice(0, 50).map((p) => p.id) }, fixLabel: "Générer les textes (IA, 1 crédit pour 10)" });
  }

  // Plusieurs titres « très grand » en tête de l'accueil.
  const firstThree = activeSections(doc.templates.home).slice(0, 3);
  const xl: Visit[] = [];
  for (const s of firstThree) {
    const schema = SECTION_SCHEMAS[s.type];
    if (s.settings.heading_size === "xl") xl.push({ key: "home", base: "home", section: s, fields: schema.settings, settings: s.settings });
    for (const b of s.blocks) if (!b.disabled && b.type === "heading" && b.settings.size === "xl") xl.push({ key: "home", base: "home", section: s, blockId: b.id, fields: [], settings: b.settings });
  }
  if (xl.length > 1) {
    push({ rule: "a11y.headings.xl", severity: "tip", message: "Plusieurs titres « très grand » se suivent en haut de l'accueil : la hiérarchie devient confuse.", target: { template: "home" }, fix: xl.slice(1).map((v) => setOp(v, v.blockId ? "size" : "heading_size", "lg")), fixLabel: "Garder un seul très grand titre" });
  }

  // Lien sans libellé (boutons : `{prefix}_link` renseigné, `{prefix}_label` vide).
  for (const v of visitSettings(doc)) {
    for (const f of v.fields) {
      if (f.type !== "url" || !f.id.endsWith("_link")) continue;
      const labelId = `${f.id.slice(0, -5)}_label`;
      if (!v.fields.some((x) => "id" in x && x.id === labelId)) continue;
      const link = v.settings[f.id];
      if (typeof link === "string" && link.trim() && !plain(v.settings[labelId])) {
        push({ rule: "a11y.link.label", severity: "warning", message: `Bouton sans texte dans « ${SECTION_SCHEMAS[v.section.type].name} » : invisible pour les lecteurs d'écran.`, target: targetOf(v, labelId), fix: [setOp(v, labelId, "En savoir plus")], fixLabel: "Ajouter « En savoir plus »" });
      }
    }
  }
}

function dataUrlFact(url: string): ImageFact | null {
  const m = /^data:image\/([a-z]+);base64,/.exec(url);
  if (!m) return null;
  return { bytes: Math.floor(((url.length - m[0].length) * 3) / 4), format: m[1] };
}

function formatOf(url: string, fact: ImageFact): string | null {
  if (fact.format) return fact.format.toLowerCase().replace("image/", "");
  const m = /\.([a-z0-9]{3,4})(?:$|[?#])/i.exec(url);
  return m ? m[1].toLowerCase() : null;
}

function performance(doc: ThemeDocument, facts: QualityFacts, out: Issue[]) {
  const push = (i: Omit<Issue, "id" | "category">) => out.push({ ...i, id: `${i.rule}:${tkey(i.target)}`, category: "performance" });

  // Images lourdes : une issue par URL (la première occurrence sert de cible).
  const seen = new Map<string, IssueTarget>();
  for (const v of visitSettings(doc)) {
    for (const f of v.fields) {
      if (f.type !== "image") continue;
      const val = v.settings[f.id];
      if (val && typeof val === "object" && !Array.isArray(val) && "url" in val && !seen.has(val.url)) seen.set(val.url, targetOf(v, f.id));
    }
  }
  if (doc.settings.header.logo && !seen.has(doc.settings.header.logo.url)) seen.set(doc.settings.header.logo.url, { global: "header.logo" });
  for (const [url, target] of seen) {
    const fact = url.startsWith("data:") ? dataUrlFact(url) : facts.images?.[url];
    if (!fact) continue;
    const reasons: string[] = [];
    let severity: IssueSeverity = "tip";
    if ((fact.bytes ?? 0) > QUALITY_THRESHOLDS.imageBytes) {
      reasons.push(`${Math.round((fact.bytes ?? 0) / 1000)} Ko`);
      severity = "warning";
    }
    if (Math.max(fact.width ?? 0, fact.height ?? 0) > QUALITY_THRESHOLDS.imageDimension) {
      reasons.push(`${fact.width} × ${fact.height} px`);
      severity = "warning";
    }
    const fmt = formatOf(url, fact);
    if (fmt && !["webp", "avif", "svg"].includes(fmt)) reasons.push(`format ${fmt.toUpperCase()}`);
    if (!reasons.length) continue;
    push({ rule: "perf.image", severity, message: `Image à alléger (${reasons.join(", ")}) : elle ralentit l'affichage sur mobile.`, target, fix: { action: "compress_image", url }, fixLabel: "Recompresser" });
  }

  for (const v of visitSettings(doc)) {
    if (v.blockId) continue;
    const s = v.section;
    if (s.type === "slideshow" && s.settings.autoplay === true && s.blocks.filter((b) => !b.disabled).length > QUALITY_THRESHOLDS.slideshowAutoplaySlides) {
      push({ rule: "perf.slideshow.autoplay", severity: "warning", message: "Diaporama de plus de 3 diapositives en lecture automatique : lourd sur mobile et difficile à lire.", target: targetOf(v, "autoplay"), fix: [setOp(v, "autoplay", false)], fixLabel: "Désactiver la lecture automatique" });
    }
    if (s.type === "video" && s.settings.autoplay === true) {
      push({ rule: "perf.video.autoplay", severity: "warning", message: "Vidéo en lecture automatique : elle consomme les données mobiles de vos clients.", target: targetOf(v, "autoplay"), fix: [setOp(v, "autoplay", false)], fixLabel: "Désactiver la lecture automatique" });
    }
  }

  const home = activeSections(doc.templates.home);
  if (home.length > QUALITY_THRESHOLDS.homeSections) {
    const extra = home.slice(QUALITY_THRESHOLDS.homeSections).filter((s) => !SECTION_SCHEMAS[s.type]?.required);
    push({ rule: "perf.home.sections", severity: "warning", message: `${home.length} sections sur l'accueil : au-delà de ${QUALITY_THRESHOLDS.homeSections}, la page devient longue et lente.`, target: { template: "home" }, fix: extra.map((s) => ({ op: "setSectionHidden", template: "home", sectionId: s.id, hidden: true })), fixLabel: `Masquer les sections après la ${QUALITY_THRESHOLDS.homeSections}e` });
  }
}

function seo(doc: ThemeDocument, facts: QualityFacts, out: Issue[]) {
  const push = (i: Omit<Issue, "id" | "category">) => out.push({ ...i, id: `${i.rule}:${tkey(i.target)}`, category: "seo" });
  if (facts.storeDescription !== undefined && (facts.storeDescription ?? "").trim().length < QUALITY_THRESHOLDS.storeDescription) {
    push({ rule: "seo.store.description", severity: "warning", message: "Description de la boutique trop courte (moins de 50 caractères) : Google et WhatsApp l'affichent sous votre lien.", fix: { action: "ai_seo", target: "store_description" }, fixLabel: "Proposer une description (IA, 1 crédit)" });
  }
  if (!doc.settings.social.shareImage) {
    const logo = doc.settings.header.logo;
    push({ rule: "seo.share_image", severity: "tip", message: "Aucune image de partage : vos liens partagés sur WhatsApp et les réseaux s'affichent sans visuel.", target: { global: "social.shareImage" }, ...(logo ? { fix: [{ op: "updateGlobalSetting", path: "social.shareImage", value: { url: logo.url } }] as ThemeOperation[], fixLabel: "Utiliser le logo" } : {}) });
  }
  if (facts.collectionsWithoutDescription?.length) {
    const n = facts.collectionsWithoutDescription.length;
    push({ rule: "seo.collection.description", severity: "tip", message: `${n} collection${n > 1 ? "s" : ""} sans description.`, fix: { action: "ai_seo", target: "collections", ids: facts.collectionsWithoutDescription.slice(0, 50).map((c) => c.id) }, fixLabel: "Proposer des descriptions (IA)" });
  }
  if (facts.productsWithLongSeoTitle?.length) {
    const n = facts.productsWithLongSeoTitle.length;
    push({ rule: "seo.product.seo_title", severity: "warning", message: `${n} produit${n > 1 ? "s ont" : " a"} un titre SEO de plus de 60 caractères (coupé dans Google).`, fix: { action: "ai_seo", target: "product_seo", ids: facts.productsWithLongSeoTitle.slice(0, 50).map((p) => p.id) }, fixLabel: "Raccourcir (IA, 1 crédit)" });
  }
}

function hasActive(t: Template | undefined, type: string): boolean {
  return !!t && activeSections(t).some((s) => s.type === type);
}

function mainProducts(doc: ThemeDocument): { key: TemplateKey; section: SectionInstance }[] {
  return allTemplates(doc)
    .filter((t) => t.base === "product")
    .flatMap((t) => Object.values(t.template.sections).filter((s) => s.type === "main-product").map((section) => ({ key: t.key, section })));
}

function addSectionFix(doc: ThemeDocument, type: Parameters<typeof canAddSection>[2], index?: number): ThemeOperation[] | undefined {
  return canAddSection(doc, "home", type).ok ? [{ op: "addSection", template: "home", type, ...(index != null ? { index } : {}) }] : undefined;
}

function conversion(doc: ThemeDocument, facts: QualityFacts, out: Issue[]) {
  const push = (i: Omit<Issue, "id" | "category">) => out.push({ ...i, id: `${i.rule}:${tkey(i.target)}`, category: "conversion" });
  const home = doc.templates.home;
  const products = mainProducts(doc);
  const productBlock = (type: string) => products.some(({ section }) => section.blocks.some((b) => b.type === type && !b.disabled));

  const whatsappButton = products.some(({ section }) => section.blocks.some((b) => b.type === "buy_buttons" && !b.disabled && b.settings.show_whatsapp !== false));
  if (!hasActive(home, "whatsapp-cta") && !whatsappButton) {
    if (facts.hasWhatsapp === false) {
      push({ rule: "conv.whatsapp", severity: "warning", message: "Aucun numéro WhatsApp : vos clients ne peuvent pas vous écrire en un clic. Renseignez-le dans les paramètres de la boutique.", target: { template: "home" } });
    } else {
      const fix = addSectionFix(doc, "whatsapp-cta");
      push({ rule: "conv.whatsapp", severity: "warning", message: "Aucun appel WhatsApp sur l'accueil ni sur la fiche produit.", target: { template: "home" }, ...(fix ? { fix, fixLabel: "Ajouter un appel WhatsApp" } : {}) });
    }
  }
  if (!hasActive(home, "trust-badges") && !productBlock("trust")) {
    const fix = addSectionFix(doc, "trust-badges", Math.min(2, home.order.length));
    push({ rule: "conv.trust", severity: "tip", message: "Aucune garantie affichée (livraison, paiement, échange) : elles rassurent avant l'achat.", target: { template: "home" }, ...(fix ? { fix, fixLabel: "Ajouter des garanties" } : {}) });
  }
  if ((facts.reviewCount ?? 0) > 0 && !hasActive(home, "reviews") && !productBlock("rating")) {
    const fix = addSectionFix(doc, "reviews");
    push({ rule: "conv.reviews", severity: "warning", message: `Vous avez ${facts.reviewCount} avis clients, mais ils ne sont affichés nulle part.`, target: { template: "home" }, ...(fix ? { fix, fixLabel: "Afficher les avis" } : {}) });
  }
  const ann = doc.settings.header.announcement;
  if (ann.enabled && ann.text.length > QUALITY_THRESHOLDS.announcement) {
    const cut = ann.text.slice(0, QUALITY_THRESHOLDS.announcement - 1);
    const short = `${(cut.lastIndexOf(" ") > 60 ? cut.slice(0, cut.lastIndexOf(" ")) : cut).trimEnd()}…`;
    push({ rule: "conv.announcement.length", severity: "warning", message: "Annonce trop longue (plus de 120 caractères) : elle est coupée sur mobile.", target: { global: "header.announcement.text" }, fix: [{ op: "updateGlobalSetting", path: "header.announcement.text", value: short }], fixLabel: "Raccourcir l'annonce" });
  }
  for (const { key, section } of products) {
    const price = section.blocks.find((b) => b.type === "price");
    if (price && !price.disabled) continue;
    const titleIndex = section.blocks.findIndex((b) => b.type === "title");
    const fix: ThemeOperation[] = price
      ? [{ op: "setBlockHidden", template: key, sectionId: section.id, blockId: price.id, hidden: false }]
      : [{ op: "addBlock", template: key, sectionId: section.id, type: "price", index: titleIndex + 1 }];
    push({ rule: "conv.price_hidden", severity: "error", message: "Le prix n'est pas affiché sur la fiche produit.", target: { template: key, sectionId: section.id }, fix, fixLabel: "Afficher le prix" });
  }
}

/* ───────────── Score ───────────── */

/** Scores par catégorie (voir la pondération en tête du module). */
export function computeScores(issues: readonly Issue[]): Record<QualityCategory, number> {
  const byRule = new Map<string, { category: QualityCategory; sum: number; cap: number }>();
  for (const i of issues) {
    const r = byRule.get(i.rule) ?? { category: i.category, sum: 0, cap: 0 };
    r.sum += SEVERITY_PENALTY[i.severity];
    r.cap = Math.max(r.cap, SEVERITY_PENALTY[i.severity] * 2);
    byRule.set(i.rule, r);
  }
  const scores: Record<QualityCategory, number> = { accessibility: 100, performance: 100, seo: 100, conversion: 100 };
  for (const r of byRule.values()) scores[r.category] -= Math.min(r.sum, r.cap);
  for (const k of Object.keys(scores) as QualityCategory[]) scores[k] = Math.max(0, Math.round(scores[k]));
  return scores;
}

/** Calcule les scores et la liste des problèmes (triée : erreurs, avertissements, conseils). */
export function scoreTheme(doc: ThemeDocument, facts: QualityFacts = {}): QualityReport {
  const issues: Issue[] = [];
  accessibility(doc, facts, issues);
  performance(doc, facts, issues);
  seo(doc, facts, issues);
  conversion(doc, facts, issues);
  // Identifiants uniques même si deux problèmes partagent une cible.
  const seen = new Map<string, number>();
  for (const i of issues) {
    const n = seen.get(i.id) ?? 0;
    seen.set(i.id, n + 1);
    if (n) i.id = `${i.id}#${n}`;
  }
  issues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return { scores: computeScores(issues), issues };
}

/** Correction applicable au document (`ThemeOperation[]`) ? Sinon action hors document ou aucune. */
export function isDocumentFix(fix: Issue["fix"]): fix is ThemeOperation[] {
  return Array.isArray(fix);
}

