# T1 Moteur de thème (lot 4A) : contrats publiés

> Consolidé dans `docs/CONSTRUCTEUR-BOUTIQUE.md`, `docs/ARCHITECTURE.md`, `docs/FEUILLE-DE-ROUTE.md`. Ce fichier reste comme historique.

Propriété : `src/lib/theme-engine/**` (sauf `render-registry.tsx`, T3) et `src/lib/storefront/theme-doc.ts`.
Tous les modules ci-dessous sont **purs** (aucun accès base, aucun `server-only`) : utilisables dans l'éditeur (client), le rendu (serveur) et l'aperçu.

## 1. Schémas de sections : un fichier par section
- `src/lib/theme-engine/section-schemas/<type>.ts` : `export const schema: SectionSchema`.
- Champs partagés : `section-schemas/_shared.ts` (`SCHEME`, `PADDING`, `HEADING(def)`, `ALIGN`, `BUTTON(prefix, def)`, `textBlock`, `headingBlock`, `buttonBlock`).
- `schemas.ts` = AGRÉGATEUR : `SECTION_SCHEMAS = indexSchemas([CORE_SECTIONS, BLOG_SECTION_SCHEMAS, …])`. `SECTION_SCHEMAS`, `sectionsForTemplate`, `SECTION_CATEGORIES` sont strictement identiques à avant le découpage (instantané `tests/fixtures/section-schemas.snapshot.json`, test `tests/theme-section-schemas-split.test.ts`).
- Ajouter des sections d'une équipe : exporter une liste (ex. T3 `section-schemas/_t3-sections.ts` → `T3_SECTION_SCHEMAS`) puis ajouter UNE entrée dans le tableau de `indexSchemas([...])`, **dans le même changement** que les types dans `SectionType` (types.ts) et les entrées de `render-registry.tsx` (sinon `tsc` échoue sur `SECTION_RENDERERS`).
- Un type en double lève une erreur au chargement. Ne jamais importer `@/lib/theme-engine/schemas` depuis un fichier de schéma (cycle).
- Blog (B) : `src/lib/blog/section-schemas.ts` exporte `BLOG_SECTION_SCHEMAS: SectionSchema[]` (stub créé par T1, remplacé par B ; déjà branché).

## 2. Clés de modèle et modèles alternatifs — `alternates.ts`
```ts
type TemplateKey = TemplateId | `${"product"|"collection"|"page"|"article"}:${string}`; // "product", "product:luxe"
templateKey(type, suffix?): TemplateKey
parseTemplateKey(key: unknown): { base: TemplateId; suffix: string | null } | null
isTemplateKey(v): v is TemplateKey
getTemplateByKey(doc, key): Template | null
resolveTemplate(doc, type: TemplateId, suffix?: string | null): { template; key: TemplateKey; suffix: string | null }
  // rendu : alternates[type][suffix] ?? templates[type] ; suffixe invalide/inconnu → défaut
listAlternates(doc, type?): { type; suffix; key; sections }[]
countAlternates(doc, type?): number
templateKeysOf(doc): TemplateKey[]
allTemplates(doc): { key; base; template }[]
normalizeSuffix("Luxe Été") → "luxe-ete" | null
canAddAlternate(doc, type, suffix, { perTypeLimit?: number | null }) // plafond global 20 + limite du plan
```
Même forme de clé que `issueKey` (validate.ts) pour les alternatifs.

## 3. Opérations — `operations.ts`
Toutes les opérations existantes acceptent désormais une `TemplateKey` (un `TemplateId` reste valide : rétrocompatible). Nouvelles fonctions (lèvent `ThemeOpError`) :
```ts
setSectionAnimation(doc, template, sectionId, animation: SectionAnimation): ThemeDocument   // "inherit" retire le champ
setSectionVisibility(doc, template, sectionId, visibility: SectionVisibility | null): ThemeDocument
  // null/aucune règle = visible pour tous ; refusée sur les sections obligatoires ; 30 personnalisées max par modèle
bindDynamicSource(doc, template, sectionId, blockId | null, key, source: string): ThemeDocument
unbindDynamicSource(doc, template, sectionId, blockId | null, key): ThemeDocument          // remet le défaut du champ
addAlternate(doc, type, suffix, { perTypeLimit?, ids? }): { doc; key }                      // depuis les sections par défaut
duplicateAlternate(doc, type, from: string | null, suffix, { perTypeLimit?, ids? }): { doc; key } // from null = modèle par défaut
removeAlternate(doc, type, suffix): ThemeDocument
renameAlternate(doc, type, from, to): ThemeDocument
insertSavedSection(doc, template, payload: unknown, { index?, ids?, refs?: ThemeRefs }): { doc; id }
  // payload = SavedSection.payload (SectionInstance sans id) ; sanitize, ids neufs, références absentes retirées
baseTemplate(key): TemplateId
```
**Liste sérialisable** (IA, scores, éditeur, MCP `apply_theme_operations`) :
```ts
type ThemeOperation = { op: "addSection" | "duplicateSection" | "removeSection" | "moveSection" | "setSectionHidden"
  | "updateSectionSetting" | "resetSectionSettings" | "applySectionPreset" | "setSectionAnimation" | "setSectionVisibility"
  | "addBlock" | "duplicateBlock" | "removeBlock" | "moveBlock" | "setBlockHidden" | "updateBlockSetting" | "resetBlockSettings"
  | "bindDynamicSource" | "unbindDynamicSource" | "updateGlobalSetting" | "addAlternate" | "duplicateAlternate"
  | "removeAlternate" | "renameAlternate" | "insertSavedSection", … } // champs exacts : type ThemeOperation
applyOperations(doc, ops: unknown, opts?: {
  ids?; maxOps?: number /* défaut 100 ; MCP : 20 */; allow?: ThemeOperationName[]; validate?: boolean /* défaut true */;
  refs?: ThemeRefs; alternatesPerType?: number | null }):
  | { ok: true; doc; created: string[] /* ids de sections/blocs créés, clés d'alternatifs */ }
  | { ok: false; error: string; index: number; issues?: ValidationIssue[] }
THEME_OPERATION_NAMES, DESTRUCTIVE_OPERATIONS (confirmation MCP), GLOBAL_SETTING_PATHS (liste blanche des chemins globaux)
```
Atomique (tout ou rien, aucune mutation), entrée non fiable revérifiée champ par champ, document final revalidé par `validateThemeDocument` (avec `refs`). Annulation éditeur : historique (`pushHistory`) du document précédent.

## 4. Scores qualité — `quality.ts`
```ts
scoreTheme(doc, facts?: QualityFacts): { scores: { accessibility; performance; seo; conversion } /* 0..100 */; issues: Issue[] }
type Issue = { id; rule; category; severity: "error" | "warning" | "tip"; message; target?: IssueTarget; fix?: ThemeOperation[] | QualityAction; fixLabel? }
type IssueTarget = { template?: TemplateKey; sectionId?; blockId?; settingId?; global?: string /* "colors.text" */ }
type QualityAction = { action: "ai_alt"; productIds } | { action: "ai_seo"; target: "store_description" | "collections" | "product_seo"; ids? }
  | { action: "compress_image"; url } | { action: "open_product"; productId }
type QualityFacts = { images?: Record<url, { bytes?; width?; height?; format? }>; storeName?; storeDescription?;
  productsWithoutAlt?; collectionsWithoutDescription?; productsWithLongSeoTitle?; reviewCount?; hasWhatsapp? }
isDocumentFix(fix): fix is ThemeOperation[]     computeScores(issues)     adjustForContrast(fg, bg, min = 4.5)
```
Règles : `a11y.contrast.{text,muted,button,scheme}`, `a11y.alt.{section,logo,products}`, `a11y.headings.xl`, `a11y.link.label`, `perf.image`, `perf.slideshow.autoplay`, `perf.video.autoplay`, `perf.home.sections`, `seo.store.description`, `seo.share_image`, `seo.collection.description`, `seo.product.seo_title`, `conv.whatsapp`, `conv.trust`, `conv.reviews`, `conv.announcement.length`, `conv.price_hidden`. Un fait absent de `facts` = règle non évaluée. Pondération : erreur 20, avertissement 8, conseil 3, plafond par règle 2 × la plus forte pénalité. Corrections idempotentes (testées). Correction à appliquer par `applyOperations(doc, issue.fix)`.

## 5. Sources dynamiques — `dynamic-sources.ts`
```ts
parseSource(s): ParsedSource | null                 // grammaire fermée DYNAMIC_SOURCE_RE ; jamais client ni commande
checkBinding(fieldType, source, { definitions?, template? }): { ok: true; kind } | { ok: false; reason }
compatibleSources(fieldType, template, definitions?): { source; label; group; kind }[]   // sélecteur « Connecter une donnée »
sourceKind(source, definitions?)   ownersForTemplate(template)   isBound(settings, id)
SOURCE_COMPATIBILITY = { text: [text, number, date, money, list], textarea: [+multi_line], richtext: [rich_text, multi_line, text],
  image: [image], url: [url, reference], color: [color] }
resolveSetting(settings, id, renderCtx, fields): SettingValue | undefined   // repasse par sanitizeFieldValue ; absent → défaut
resolveSettings(settings, fields, renderCtx): { settings; empty }
resolveSection(section, renderCtx): { section; hidden }   // hidden si réglage hide_if_empty vrai et source vide
type DynamicRenderContext = { product?, variant?, collection?, store?, page?, article?: SourceEntity | null;
  currency?; formatMoney?; formatDate?; resolveReference?(type, id): string | null }
type SourceEntity = { title?; vendor?; description?; type?; tags?; price?; compare_at_price?; image?; url?;
  metafields?: Record<"namespace.key", { type; value; storefrontVisible }> }
```
- `MetafieldDefinitionLike = { ownerType; namespace; key; type; name?; storefrontVisible }` (sous-ensemble de `MetafieldDefinition`, équipe D).
- Le chargeur serveur (T3) ne doit fournir que des définitions `storefrontVisible` ; `resolveSetting` ignore de toute façon une valeur `storefrontVisible !== true`.
- Rendu T3 : appeler `resolveSection(section, ctx)` avant de passer la section au composant (les lecteurs `S.*` lisent alors des valeurs résolues) ; ne pas rendre si `hidden`.
- `hide_if_empty` : à déclarer (case à cocher) dans le schéma des sections qui le proposent (ex. `product-specs`).

## 6. Animations — `motion.ts`
```ts
effectiveMotion(settings.motion, env: { saveData?; lite?; reduce? }): EffectiveMotion   // enabled:false sous Save-Data, axi_lite=1, aperçu « réduire »
motionEnvFromRequest({ saveDataHeader, liteCookie, reduce })
motionRootAttrs(m)            // racine boutique : data-motion, data-motion-hover, data-motion-parallax
sectionMotionAttrs(section, m) / sectionAnimation(section, m)   // data-anim="fade-up" (inherit → fade-up)
motionItemAttrs(i) / motionItemProps(i)   // data-anim-item + --anim-i, 6 maximum par section
MOTION_CSS                    // à insérer tel quel dans store-styles.tsx
```
`MotionObserver` (T3, client) : pose `data-motion-ready` sur l'élément qui porte `data-motion`, puis `data-in-view` sur chaque `[data-anim]` visible. Sans élément `data-anim-item`, mettre `data-anim-self` sur la section. Zoom au survol : `data-hover-zoom` sur le conteneur de l'image ; parallaxe : `data-parallax`. Tout le CSS est sous `@media (prefers-reduced-motion: no-preference)`, transform/opacity uniquement, 200 à 600 ms, jamais `transition: all` (test `tests/motion-css.test.ts`).

## 7. Audiences — `audience.ts`
```ts
evaluateVisibility(visibility, ctx: AudienceContext): boolean   // robots (ctx.isBot) → audience par défaut
type AudienceContext = { city?; customer?: CustomerSegment[]; source?; locale?; device?; now?: Date; timeZone?; isBot? }
visibleSectionIds(template, ctx): string[]
evaluateRule, matchesSchedule (fuseau boutique, plage passant minuit), defaultAudience
isBotUserAgent(ua), deviceFromHints({ chUaMobile, userAgent }), customerSegments({ loggedIn, orderCount, points }),
sourceFromSignals({ utmSource, ref, utmCampaign, referrer, selfHost }), parseSourceCookie(v)
disallowedRuleTypes(visibility, allowed)   // contrôle de plan côté serveur (Business : ["customer"])
```

## 8. Édition directe — `edit-attrs.ts`
```ts
editAttrs(ctx: { preview?: boolean } | null, { sectionId, blockId?, settingId, kind: "text" | "textarea" | "richtext" | "image" })
  // → { "data-edit": "sectionId:blockId|-:settingId", "data-edit-kind" } en aperçu seulement, {} sinon
parseEditAttr(v): { sectionId; blockId | null; settingId } | null
```

## 9. Validation et sanitize
`validate.ts` / `theme-doc.ts` acceptent déjà `alternates`, `motion`, `animation`, `visibility`, `$source` (rétrocompatibles : absents d'un document antérieur, ils ne sont jamais ajoutés). Taille maximale inchangée (3,5 Mo). Tests : `tests/theme-doc-v2-ext.test.ts`.

## 10. Tests du lot
`theme-section-schemas-split`, `theme-doc-v2-ext`, `theme-operations-apply`, `quality`, `dynamic-sources`, `alternates-resolve`, `motion-css`, `audience`.
