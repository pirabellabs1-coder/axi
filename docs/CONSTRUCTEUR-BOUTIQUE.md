# Constructeur de boutique Axi (niveau Shopify Online Store 2.0)

Document de conception ; guide utilisateur : docs/GUIDE-BOUTIQUE.md

Demande du porteur : « que les gens puissent personnaliser complètement leur boutique, au niveau de Shopify ou plus ; fiches produits, variantes couleur/taille, avis et page produit bien faits ; une plateforme de référence ».

## Socle (déjà en place)
- `src/lib/theme-engine/types.ts` : contrat du document de thème (réglages globaux, modèles de page, sections, blocs, champs de réglage).
- `src/lib/theme-engine/schemas.ts` : bibliothèque des sections avec leurs schémas (l'éditeur génère ses formulaires, le rendu lit les valeurs). Depuis le lot 4A, c'est un agrégateur : un fichier par section dans `section-schemas/` (voir « Lot 4A » ci-dessous).
- Base : `Store.themeDocDraft` (brouillon) / `Store.themeDoc` (publié), `ThemeVersion` (historique), `StoreMenu` (menus), `Category` = collection (image, description, SEO, règles automatiques, tri, publiée), `Product.options` (jusqu'à 3 options avec pastilles couleur et images), `Product.tags/vendor/productType/seoTitle/seoDescription/details`, `Variant.compareAtPrice/barcode/weightGrams/imageUrl/available`.
- L'ancien thème (`themeId` + `themeConfig`) reste lu tant qu'aucun `themeDoc` n'existe : la migration crée un document v2 à partir du preset du secteur.

## Équipes
1. **Moteur + éditeur** : `src/lib/theme-engine/**` (sauf types/schemas : extension seulement), `src/app/app/[storeId]/apparence/**`, `src/app/app/[storeId]/navigation/**`, `src/lib/theme/**`, `src/components/theme-editor/**`.
2. **Rendu boutique** : `src/app/s/**`, `src/components/storefront/**`, `src/lib/storefront/**`.
3. **Catalogue** : `src/app/app/[storeId]/produits/**`, `src/app/app/[storeId]/collections/**`, `src/lib/products/**`, `src/lib/collections/**`.

## Règles communes
- Valeurs de réglage toujours validées côté serveur (zod) avant enregistrement ; aucune injection de HTML/JS ; URLs d'images https ou chemins internes ; couleurs `#RRGGBB`.
- Aperçu en direct : l'éditeur affiche `/s/{slug}?preview=1&template=…` dans une iframe et envoie le document brouillon par `postMessage` (`{ type: "axi:theme-preview", doc }`, origine vérifiée) ; le rendu de prévisualisation applique ce document côté client sans recharger, et met en évidence la section sélectionnée (`{ type: "axi:select-section", id }`). Prévisualisation réservée aux membres de la boutique. Protocole complet ci-dessous.

## Protocole `postMessage` éditeur ↔ aperçu
Constantes et lecture défensive : `src/lib/theme-engine/preview-messages.ts` (tests : `tests/theme-preview-messages.test.ts`). Côté boutique : `src/components/storefront/live-preview.tsx` ; côté éditeur : `src/components/theme-editor/preview.tsx` et `theme-editor.tsx`. Tous les messages sont envoyés avec `targetOrigin = window.location.origin` (même origine) et ignorés à la réception si `e.origin !== window.location.origin` ou si `e.source` n'est pas la fenêtre attendue (`window.parent` dans l'aperçu, `iframe.contentWindow` dans l'éditeur).

| Sens | Message | Effet |
|---|---|---|
| aperçu → éditeur | `{ type: "axi:preview-ready", template }` | au montage : l'éditeur renvoie le document et la sélection |
| éditeur → aperçu | `{ type: "axi:theme-preview", doc }` | document brouillon, revalidé (`sanitizeThemeDocument`) puis rendu sans rechargement ; depuis le lot 4A, `doc` est la **vue d'aperçu** (voir plus bas), jamais enregistrée |
| éditeur → aperçu | `{ type: "axi:select-section", id }` | contour + étiquette sur `[data-section-id=id]`, défilement (instantané si `prefers-reduced-motion`) |
| éditeur → aperçu | `{ type: "axi:preview-options", allowNavigation?, reduceMotion? }` | optionnel ; `allowNavigation: true` laisse les liens et formulaires naviguer (désactivé par défaut, l'éditeur ne l'envoie pas aujourd'hui) ; `reduceMotion: true` (case « Réduire les animations ») : pas de `data-motion`, aucun `data-anim`, pas de `MotionObserver`, animations décoratives coupées. Option officielle, type exporté par `preview-messages.ts` |
| éditeur → aperçu | `{ type: "axi:preview-audience", audience: SimulatedAudience \| null }` | audience simulée (`customer`, `source`, `city`, `device`, `locale`, `day` 0 à 6, `time` HH:MM) ; `null` = règles ignorées. Envoyé à chaque changement et après `axi:preview-ready`. Constante officielle `PREVIEW_MESSAGES.audience` ; lecture défensive côté boutique (`src/components/storefront/preview-audience.ts`, même origine, fenêtre parente) |
| aperçu → éditeur | `{ type: "axi:section-clicked", id, template }` | clic dans une section (`data-section-id`, identifiant `^[\w-]{1,64}$`) : l'éditeur la sélectionne, bascule sur `template` si c'est un modèle éditable différent qui contient la section, ouvre l'onglet « Sections » (et « Réglages » sur mobile) |
| aperçu → éditeur | `{ type: "axi:section-clicked", group: "header" \| "footer" }` | clic dans l'en-tête / le pied de page (`data-section-group`) : sélection du groupe global correspondant |

Dans l'iframe de l'éditeur uniquement (`window.parent !== window`) : écouteurs en phase de capture sur `document` ; un clic sur un lien appelle `preventDefault()` + `stopPropagation()` (avant le `Link` de Next) et `submit` est bloqué, sauf `allowNavigation` ; les boutons gardent leur comportement. Survol (`pointerover`) et focus clavier (`focusin`) posent `data-hovered` : contour pointillé et étiquette `data-section-label` (nom du schéma, « En-tête », « Pied de page »), styles dans `store-styles.tsx` limités à `[data-preview]`. Ouvert hors iframe, `?preview=1` se comporte comme la boutique.

### Adresses de l'aperçu (lot 2 et lot 4A)
| Adresse | Effet |
|---|---|
| `/s/{slug}?preview=1&template={TemplateId}` | aperçu d'un modèle (`home`, `product`, `collection`, `catalog`, `page`, `cart`, `search`, `not_found`, `blog`, `article`) avec des données d'exemple si besoin |
| `/s/{slug}?preview=1&template=product:luxe` | aperçu d'un modèle alternatif (clé de modèle `TemplateKey` du moteur) |
| `/s/{slug}?preview=1&template=blog` / `article` | vrais articles de la boutique, ou contenus d'exemple neutres s'il n'y en a aucun (`withBlogData`) |
| `/s/{slug}{path}?preview=1` (`/p/…`, `/collections/…`, `/pages/…`) | « Aperçu avec » : fiche réelle qui utilise un modèle alternatif |
| `/s/{slug}/p/{produit}?variant={variantId}` | hors aperçu aussi : la fiche présélectionne la variante (liens des flux catalogue) ; `?variante=` (liens partagés depuis la fiche) prime ; l'adresse est ensuite réécrite en `?variante=` (`requestedVariantParam`, `src/lib/storefront/variants.ts`) |

### Vue d'aperçu (`src/components/theme-editor/preview-doc.ts`, jamais enregistrée)
- Modèle alternatif édité : `templates[type]` = `alternates[type][suffixe]`, donc l'aperçu le montre même pour un produit exemple qui ne l'utilise pas (aucune dépendance au `templateSuffix` côté rendu).
- Audience simulée : sections exclues rendues `disabled: true` puis `visibility` retirée de toutes les sections (le rendu ne réévalue pas avec l'audience réelle du marchand). Sans simulation : toutes les sections visibles.
- « Réduire les animations » : `settings.motion = { preset: "none", … false }` et `animation: "none"` partout, en plus de `axi:preview-options { reduceMotion: true }`.
- Polices : uniquement la liste `FontId` (chargées en local ou via `next/font`, pas de requête tierce bloquante).
- Accessibilité et mobile d'abord (375 px), performance (LCP < 2,5 s), thème clair forcé sur la boutique.

## Lot 1 : ventes et fidélité dans le thème
Schémas : `src/lib/theme-engine/schemas.ts` ; types : `types.ts` (`GlobalSettings.header.showAccount`, `GlobalSettings.cards.showFavorite`, `SectionType` `cart-progress`) ; valeurs par défaut : `defaults.ts` et `editor-defaults.ts`, validation `validate.ts`, lecture tolérante `src/lib/storefront/theme-doc.ts` (une clé absente des anciens documents prend sa valeur par défaut). Données de rendu : `src/components/storefront/lot1-data.ts` (`loadShopper`, `loadPromotions`), calculées côté serveur à chaque requête ; aucun montant affiché ici n'est repris tel quel à la commande (le pipeline de prix recalcule tout, voir `docs/ARCHITECTURE.md` §4 bis).

### Section `cart-progress` (« Barre d'offres »)
- Catégorie « Mise en avant », modèles `cart` et `home` ; enregistrée dans `render-registry.tsx` (`src/components/storefront/sections/cart-progress.tsx`, îlot client `promotions/cart-progress-bar.tsx`).
- Réglages : `heading` (texte, défaut vide, 80 caractères, libellé de la section « Offres en cours » s'il est vide), `empty_text` (défaut « Remises automatiques selon le montant de votre panier. », 140 caractères), `hide_when_empty` (défaut `false`, ignoré dans l'aperçu de l'éditeur), `scheme`, `padding_top` / `padding_bottom` (0 à 160 px, pas de 8). Préréglage : `scheme: "surface"`, marges de 24 px.
- Contenu : progression du panier local vers les paliers des remises `CART_TIER` actives dont la cible couvre **tout** le panier (les paliers ciblés ne sont évalués qu'au checkout), triés par seuil, 10 au maximum. Sans palier, la section ne rend rien ; dans l'aperçu, deux paliers d'exemple (−5 % dès 20 000, −10 % dès 50 000) illustrent le rendu.
- Sous-total indicatif : somme `prix unitaire × quantité` du panier local hors cartes cadeaux ; le serveur applique le meilleur palier sur le net après les remises de ligne. Barre animée en `transform` (`scaleX`), sans transition si `prefers-reduced-motion`, `role="progressbar"`, message en `aria-live="polite"`.

### Blocs de `main-product`
| Bloc | Nom affiché | Limite | Réglages | Rendu |
|---|---|---|---|---|
| `complementary` | Souvent achetés ensemble | 1 | `heading` (défaut « Souvent achetés ensemble », 80 caractères), `max` (1 à 4, défaut 3) | offres au panier d'emplacement `PRODUCT` déclenchées par le produit de la fiche (`getCartOffers`, plan `cartOffers`), 4 produits au plus avant la limite `max` ; rien si aucune offre |
| `gift_card_form` | Carte cadeau : destinataire | 1 | aucun (paragraphe d'aide) | seulement sur un produit `isGiftCard` : nom, téléphone WhatsApp ou e-mail, message (300 caractères), date d'envoi facultative (future) ; contrôle local, revalidé par le serveur |
| `discount_badges` | Offres disponibles | 1 | `heading` (défaut « Offres disponibles », 80 caractères) | jusqu'à 4 remises automatiques actives qui concernent le produit (`discountConcernsProduct` : cible, `excludeOnSale`, produits d'un lot), avec leur résumé et « Appliquée automatiquement au panier. » ; jamais sur une carte cadeau |

Le préréglage « Fiche produit » place `discount_badges` après le prix, `gift_card_form` avant les boutons d'achat et `complementary` après eux. Documents antérieurs au lot 1 (`product-main.tsx`) : un bloc **absent** du document est inséré automatiquement à ces positions s'il a un contenu (`gift_card_form` sur une carte cadeau, `discount_badges` s'il y a des remises, `complementary` s'il y a des offres) ; un bloc présent mais masqué reste masqué ; l'insertion suppose que le bloc d'ancrage (`price` ou `buy_buttons`) est visible.

### Réglages de `main-cart`
Trois cases sous l'en-tête « Offres (s'appliquent aussi au tiroir) ». Elles sont lues dans la section `main-cart` du modèle `cart` (`cartConfig`, `sections/main-cart.tsx`) et s'appliquent à la page panier comme au tiroir.

| Réglage | Défaut | Effet |
|---|---|---|
| `show_offers` | `true` | offres d'emplacement `CART` sous « Vous aimerez aussi » (chargées par `loadCartOffers`, débit limité), si le plan inclut `cartOffers` |
| `show_tier_progress` | `true` | progression des paliers (`TierProgress`) dans le pied du panier, s'il existe au moins un palier sur tout le panier |
| `show_gift_card_field` | `false` | champ « Carte cadeau » vérifié par `previewTotals`, codes mémorisés sur l'appareil et repris au checkout ; affiché seulement si l'arrêt d'urgence des cartes est inactif et si le plan inclut `giftCards` (ou si la boutique a encore des cartes actives avec solde) |

### Réglages globaux
| Réglage | Défaut | Libellé dans l'éditeur | Effet |
|---|---|---|---|
| `header.showAccount` | `true` | En-tête › « Icône « Compte » » | icône vers `/s/{slug}/compte` (point de couleur si l'acheteur est connecté) ; masquée si `Store.accountsEnabled` est faux et dans l'en-tête réduit des pages de commande et de confirmation |
| `cards.showFavorite` | `false` | Cartes produit › « Cœur « favori » (cartes et fiche produit) » | cœur sur les cartes produit et à côté du titre de la fiche, si les comptes clients sont activés ; non connecté, le clic mène à `/s/{slug}/compte/connexion?next=…` ; mise à jour optimiste, annulée si le serveur refuse |

## Lot 2 : blog dans le thème
- `SectionType` gagne `blog-posts` (« Derniers articles », catégorie Texte, tous modèles), `main-blog` (« Liste des articles », modèle `blog`, obligatoire) et `main-article` (« Article », modèle `article`, obligatoire, blocs Titre, Date et auteur, Image de couverture, Contenu, Partager, Articles liés). Schémas : `src/lib/blog/section-schemas.ts` (`BLOG_SECTION_SCHEMAS`, branché dans l'agrégateur) ; rendu : `src/components/storefront/sections/{blog-posts,main-blog,main-article}.tsx` (composants purs, aussi rendus dans l'aperçu client).
- Les modèles `blog` et `article` reçoivent leur section principale via `lateMainSections` dès que le schéma existe ; les documents antérieurs sont complétés au sanitize. Les deux modèles sont éditables (sélecteur de page de l'éditeur) et acceptent des modèles alternatifs (`article:{suffixe}`, `BlogPost.templateSuffix`).
- Type de réglage `blog_category` : liste déroulante des catégories de la boutique, utilisée par « Derniers articles » (une adresse texte saisie auparavant reste lue). Section masquée pour les clients tant qu'aucun article n'est publié.

## Vague 2 (correctifs rendu) : devise d'affichage et modèle « Recherche »

### Devise d'affichage de bout en bout
- Contexte chargé **une fois par requête** : `requestCurrencyView(store)` / `requestCurrencyPicker(store)` (`src/lib/storefront/currency-context.ts`, mémorisé par `cache()` de React, cookie `axi_cur` lu par `getDisplayCurrency`). Exposé au rendu par `RenderData.currency` (`loadRenderData`), donc disponible dans toutes les sections, l'aperçu en direct et les îlots clients.
- Vue sérialisable `CurrencyView` (`src/lib/storefront/currency-view.ts`, module PUR) : `viewPrice` (règle d'arrondi, prix fixé `ProductPrice` par article), `viewCompareAt`, `viewPlain` (remises, seuils), `viewMoney`, `storeMoney`, `chargeNotice`. `FxContext` contenant des BigInt, il n'est jamais mis dans `RenderData` : la vue porte le taux en chaînes et reconstruit le contexte à la demande (mémorisé par objet).
- Converti : cartes produit, fiche produit (prix, prix barré, économies, suppléments d'options, barre collante, livraison), collections, catalogue, recherche, sections de thème (produit mis en avant, look, offres), panier (tiroir et page : lignes, sous-total, bouton, paliers, livraison offerte), favoris, sources dynamiques `price` / `compare_at_price`.
- **Jamais converti** : les montants calculés, enregistrés et encaissés (devise boutique), les données structurées schema.org (`priceCurrency` = devise boutique), les cartes cadeaux, le filtre de prix du catalogue (fourchette en devise boutique, mention explicite sous les champs).
- Mention obligatoire : `chargeNotice` dans le pied de page (au moins une fois par page) et `<CurrencyNotice short>` sous le prix de la fiche produit (« Vous serez débité en FCFA. »).
- Repli : devise désactivée ou taux de plus de 72 h → `loadStoreFx` ne fournit aucun contexte, la vue reste celle de la boutique et rien n'est converti (aucune erreur). Une cotation illisible est ignorée de la même façon.
- Sélecteur : barre d'outils de l'en-tête à partir de 640 px, **menu mobile** en dessous (l'en-tête n'a pas la place à 375 px).

### Modèle « Recherche » personnalisable
- Section `main-search` (« Recherche », catégorie Modèle, modèle `search`, obligatoire) : `src/lib/theme-engine/section-schemas/main-search.ts`, rendu `src/components/storefront/sections/main-search.tsx`. Réglages : titre et taille, texte du champ, filtres, tri, tri par défaut, résultats par page, colonnes, suggestions, contenu d'accueil et de secours (collections / produits mis en avant / les deux / rien), titre et nombre de produits mis en avant.
- Rendu : en-tête de résultats (« 12 résultats pour “wax” »), filtres et tri **réutilisés du catalogue** (`sections/listing-parts.tsx` : `ListingFilters`, `FiltersAside`, `MobileFilters`, `ListingSort`, `ActiveFilters`, `ListingPagination`), suggestions de mots proches issues du catalogue quand il y a peu ou pas de résultats, états vide et avant recherche, mobile d'abord (375 px), aucun débordement horizontal.
- `main-collection` n'est plus proposée sur le modèle `search` (instantané `tests/fixtures/section-schemas.snapshot.json` mis à jour en conséquence).
- **Rétrocompatibilité** : `migrateSearchTemplate` (`editor-defaults.ts`) remplace, au chargement, la `main-collection` d'un ancien modèle recherche par `main-search` en reprenant ses réglages (`show_filters`, `show_sort`, `per_page`, `columns`). Appelée par `sanitizeThemeDocument` (rendu) et `completeLateTemplates` (validation) : aucun brouillon n'est invalidé, l'opération est idempotente.
- Éditeur : modèle « Recherche » dans `EDITABLE_TEMPLATES` (sélecteur de page) ; aperçu `?preview=1&template=search` (le catalogue sert d'exemple de résultats).
- Tests : `tests/storefront-currency-view.test.ts`, `tests/storefront-search-template.test.ts`.

## Lot 4A : moteur, éditeur, rendu
Spécification : `docs/specs/LOT-4-personnalisation.md` §2, §4, §5, §6, §12, §20 à §24. Guide : `docs/GUIDE-BOUTIQUE.md` §19 et §20. Tous les modules du moteur ci-dessous sont **purs** (aucun accès base, aucun `server-only`) : utilisables dans l'éditeur (client), le rendu (serveur) et l'aperçu.

### Schémas : un fichier par section
- `src/lib/theme-engine/section-schemas/<type>.ts` : `export const schema: SectionSchema`. Champs partagés : `section-schemas/_shared.ts` (`SCHEME`, `PADDING`, `HEADING(def)`, `ALIGN`, `BUTTON(prefix, def)`, `textBlock`, `headingBlock`, `buttonBlock`, bloc `metafield`).
- `schemas.ts` = agrégateur : `SECTION_SCHEMAS = indexSchemas([CORE_SECTIONS, BLOG_SECTION_SCHEMAS, T3_SECTION_SCHEMAS, …])`. `SECTION_SCHEMAS`, `sectionsForTemplate`, `SECTION_CATEGORIES` étaient strictement identiques avant et après le découpage (instantané `tests/fixtures/section-schemas.snapshot.json`, test `tests/theme-section-schemas-split.test.ts` ; l'instantané se régénère quand un schéma du cœur change volontairement).
- Ajouter les sections d'une équipe : exporter une liste (ex. `section-schemas/_t3-sections.ts` → `T3_SECTION_SCHEMAS`) puis ajouter UNE entrée dans `indexSchemas([...])`, **dans le même changement** que les types dans `SectionType` (`types.ts`) et les entrées de `render-registry.tsx` (sinon `tsc` échoue sur `SECTION_RENDERERS`). Un type en double lève une erreur au chargement. Ne jamais importer `@/lib/theme-engine/schemas` depuis un fichier de schéma (cycle).

### Clés de modèle et modèles alternatifs (`alternates.ts`)
```ts
type TemplateKey = TemplateId | `${"product"|"collection"|"page"|"article"}:${string}`; // "product", "product:luxe"
templateKey(type, suffix?): TemplateKey
parseTemplateKey(key: unknown): { base: TemplateId; suffix: string | null } | null
isTemplateKey(v): v is TemplateKey
getTemplateByKey(doc, key): Template | null
resolveTemplate(doc, type: TemplateId, suffix?: string | null): { template; key: TemplateKey; suffix: string | null }
  // rendu : alternates[type][suffix] ?? templates[type] ; suffixe invalide ou inconnu → défaut
listAlternates(doc, type?): { type; suffix; key; sections }[]
countAlternates(doc, type?): number
templateKeysOf(doc): TemplateKey[]
allTemplates(doc): { key; base; template }[]
normalizeSuffix("Luxe Été") → "luxe-ete" | null
canAddAlternate(doc, type, suffix, { perTypeLimit?: number | null }) // plafond global 20 + limite du plan
```
Même forme de clé que `issueKey` (`validate.ts`) pour les alternatifs. Rendu : suffixe lu sur `Product`, `Category`, `StorePage` ou `BlogPost.templateSuffix` ; `resolve.ts` inchangé.

### Opérations (`operations.ts`)
Toutes les opérations existantes acceptent une `TemplateKey` (un `TemplateId` reste valide). Nouvelles fonctions (lèvent `ThemeOpError`) :
```ts
setSectionAnimation(doc, template, sectionId, animation: SectionAnimation): ThemeDocument   // "inherit" retire le champ
setSectionVisibility(doc, template, sectionId, visibility: SectionVisibility | null): ThemeDocument
  // null ou aucune règle = visible pour tous ; refusée sur les sections obligatoires ; 30 personnalisées max par modèle
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
Liste sérialisable (IA, scores, éditeur, MCP `apply_theme_operations`) :
```ts
type ThemeOperation = { op: "addSection" | "duplicateSection" | "removeSection" | "moveSection" | "setSectionHidden"
  | "updateSectionSetting" | "resetSectionSettings" | "applySectionPreset" | "setSectionAnimation" | "setSectionVisibility"
  | "addBlock" | "duplicateBlock" | "removeBlock" | "moveBlock" | "setBlockHidden" | "updateBlockSetting" | "resetBlockSettings"
  | "bindDynamicSource" | "unbindDynamicSource" | "updateGlobalSetting" | "addAlternate" | "duplicateAlternate"
  | "removeAlternate" | "renameAlternate" | "insertSavedSection", … } // champs exacts : type ThemeOperation
applyOperations(doc, ops: unknown, opts?: {
  ids?; maxOps?: number /* défaut 100 ; MCP : 20 */; allow?: ThemeOperationName[]; validate?: boolean /* défaut true */;
  refs?: ThemeRefs; alternatesPerType?: number | null }):
  | { ok: true; doc; created: string[] /* ids de sections ou blocs créés, clés d'alternatifs */ }
  | { ok: false; error: string; index: number; issues?: ValidationIssue[] }
THEME_OPERATION_NAMES, DESTRUCTIVE_OPERATIONS (confirmation MCP), GLOBAL_SETTING_PATHS (liste blanche des chemins globaux)
```
Atomique (tout ou rien, aucune mutation), entrée non fiable revérifiée champ par champ, document final revalidé par `validateThemeDocument` (avec `refs`). Annulation dans l'éditeur : historique (`pushHistory`) du document précédent.

### Scores qualité (`quality.ts`)
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
Règles : `a11y.contrast.{text,muted,button,scheme}`, `a11y.alt.{section,logo,products}`, `a11y.headings.xl`, `a11y.link.label`, `perf.image`, `perf.slideshow.autoplay`, `perf.video.autoplay`, `perf.home.sections`, `seo.store.description`, `seo.share_image`, `seo.collection.description`, `seo.product.seo_title`, `conv.whatsapp`, `conv.trust`, `conv.reviews`, `conv.announcement.length`, `conv.price_hidden`. Un fait absent de `facts` = règle non évaluée. Pondération : erreur 20, avertissement 8, conseil 3, plafond par règle 2 × la plus forte pénalité. Corrections idempotentes (testées), appliquées par `applyOperations(doc, issue.fix)`. Éditeur : recalcul 500 ms après la dernière modification ; faits `images` des médias stockés non chargés (aucune table de métadonnées : règles appliquées aux seules data-URL) ; `ai_alt` et `ai_seo` ouvrent la fiche concernée en attendant le lot 4B ; `compress_image` sans écran.

### Sources dynamiques (`dynamic-sources.ts`)
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
- Valeur stockée dans le document sous `$source` (ex. `product.metafields.custom.matiere`). `MetafieldDefinitionLike = { ownerType; namespace; key; type; name?; storefrontVisible }` (sous-ensemble de `MetafieldDefinition`).
- Le chargeur serveur ne fournit que des définitions `storefrontVisible` (`getStorefrontMetafields`, `RenderData.metafields`) ; `resolveSetting` ignore de toute façon une valeur `storefrontVisible !== true`.
- Rendu : `resolveSection(section, ctx)` avant de passer la section au composant (les lecteurs `S.*` lisent des valeurs résolues) ; ne pas rendre si `hidden`. `hide_if_empty` est déclaré (case à cocher) dans le schéma des sections qui le proposent (ex. `product-specs`).
- Éditeur : `compatibleSources` puis `checkBinding` avant `bindDynamicSource` ; valeurs d'exemple issues du premier produit actif (données publiques).

### Animations (`motion.ts`)
```ts
effectiveMotion(settings.motion, env: { saveData?; lite?; reduce? }): EffectiveMotion   // enabled:false sous Save-Data, axi_lite=1, aperçu « réduire »
motionEnvFromRequest({ saveDataHeader, liteCookie, reduce })
motionRootAttrs(m)            // racine boutique : data-motion, data-motion-hover, data-motion-parallax
sectionMotionAttrs(section, m) / sectionAnimation(section, m)   // data-anim="fade-up" (inherit → fade-up)
motionItemAttrs(i) / motionItemProps(i)   // data-anim-item + --anim-i, 6 maximum par section
MOTION_CSS                    // inséré tel quel dans store-styles.tsx
```
- `MotionObserver` (`src/components/storefront/motion-observer.tsx`, client, IntersectionObserver + MutationObserver, aucun écouteur de défilement) : marque d'abord `data-in-view` sur ce qui est déjà à l'écran, puis pose `data-motion-ready` sur l'élément qui porte `data-motion`, puis `data-in-view` sur chaque `[data-anim]` qui devient visible : rien ne disparaît puis réapparaît. Sans élément `data-anim-item`, `data-anim-self` sur la section. Zoom au survol : `data-motion-hover` (cartes) et `data-hover-zoom` (conteneur d'image, look) ; parallaxe : `data-parallax` sur l'image de la bannière (CSS `animation-timeline: view()` si supporté).
- Jamais d'animation sur la première section rendue ni sur une section de modèle (fiche, collection, page, panier) : l'élément du LCP n'est jamais masqué. Sans JavaScript, rien n'est masqué.
- Désactivation (`lot4-data.ts` `requestMotionEnv`, `live-preview.tsx`) : en-tête `Save-Data: on`, cookie `axi_lite=1`, `axi:preview-options { reduceMotion: true }`, préréglage « Aucune » : pas de `data-motion`, aucun `data-anim`, pas de `MotionObserver`, animations décoratives existantes (montée, fondu, bandeau défilant) coupées.
- Tout le CSS est sous `@media (prefers-reduced-motion: no-preference)`, transform et opacity uniquement, 200 à 600 ms, jamais `transition: all` (test `tests/motion-css.test.ts`).
- Éditeur : Thème › Animations (`settings.motion` : intensité Aucune, Sobre ou Vive, apparition au défilement, parallaxe, zoom au survol) ; réglage de section `animation` (`inherit`, `none`, fondu vers le haut, fondu, zoom léger, glissement).

### Audiences (`audience.ts`)
```ts
evaluateVisibility(visibility, ctx: AudienceContext): boolean   // robots (ctx.isBot) → audience par défaut
type AudienceContext = { city?; customer?: CustomerSegment[]; source?; locale?; device?; now?: Date; timeZone?; isBot? }
visibleSectionIds(template, ctx): string[]
evaluateRule, matchesSchedule (fuseau boutique, plage passant minuit), defaultAudience
isBotUserAgent(ua), deviceFromHints({ chUaMobile, userAgent }), customerSegments({ loggedIn, orderCount, points }),
sourceFromSignals({ utmSource, ref, utmCampaign, referrer, selfHost }), parseSourceCookie(v)
disallowedRuleTypes(visibility, allowed)   // contrôle de plan côté serveur (Business : ["customer"])
```
Rendu : `evaluateVisibility` côté serveur (`lot4-data.ts` `requestAudience`, `template-renderer.tsx`) ; contexte décrit dans `docs/ARCHITECTURE.md` §7 quinquies. Éditeur : « Visible pour » (Tout le monde, Seulement si, Sauf si ; toutes ou au moins une condition : type de client, ville, provenance, appareil, jours et heures, langue) ; sections obligatoires toujours visibles.

### Édition directe (`edit-attrs.ts`)
```ts
editAttrs(ctx: { preview?: boolean } | null, { sectionId, blockId?, settingId, kind: "text" | "textarea" | "richtext" | "image" })
  // → { "data-edit": "sectionId:blockId|-:settingId", "data-edit-kind" } en aperçu seulement, {} sinon
parseEditAttr(v): { sectionId; blockId | null; settingId } | null
```

### Validation et sanitize
`validate.ts` et `src/lib/storefront/theme-doc.ts` acceptent `alternates`, `motion`, `animation`, `visibility`, `$source` (rétrocompatibles : absents d'un document antérieur, ils ne sont jamais ajoutés). Taille maximale inchangée (3,5 Mo). Tests du lot : `theme-section-schemas-split`, `theme-doc-v2-ext`, `theme-operations-apply`, `quality`, `dynamic-sources`, `alternates-resolve`, `motion-css`, `audience`, `t3-storefront-render`.

### Réglages globaux ajoutés
| Réglage | Défaut | Libellé dans l'éditeur | Effet |
|---|---|---|---|
| `motion` | préréglage du thème | Thème › Animations | intensité, apparition, parallaxe, zoom au survol (voir « Animations ») |
| `header.logoWidth` | 120 | En-tête › « Largeur du logo » | 40 à 300 px, bornés à l'identique au nettoyage, à la validation et au rendu (45 vw au plus sur mobile) |
| `header.showCurrencyPicker` | `true` | Thème › En-tête › « Afficher le sélecteur de devise » | décoché : aucun sélecteur de devise dans l'en-tête, même avec plusieurs devises (le checkout garde le sien) |

### Nouvelles sections (rendu `src/components/storefront/sections/`, schémas `section-schemas/<type>.ts` + `_t3-sections.ts`)
| Type | Nom | Catégorie, modèles | Points clés |
|---|---|---|---|
| `product-specs` | Caractéristiques du produit | Produits, `product` | mode automatique (champs personnalisés visibles du produit, triés par nom) puis lignes manuelles (libellé + valeur fixe ou donnée connectée) ; ligne vide omise ; section absente s'il ne reste rien ; `hide_if_empty` ; tableau ou grille |
| `hero-split-video` | Vidéo et texte | Mise en avant | MP4 ou WebM https direct (pas YouTube), muet, en boucle, bouton Pause/Lecture ; image de couverture obligatoire, seule en mode économie, sous Save-Data ou mouvement réduit ; vidéo chargée seulement quand la section est visible |
| `lookbook` | Look à acheter | Produits | une photo, 6 repères numérotés au plus vers des produits (hors tabulation : la liste porte les liens), liste des produits avec prix ; masquée sans produit |
| `before-after` | Avant, après | Médias | deux images au même cadrage, curseur au clavier (flèches), annoncé aux lecteurs d'écran |
| `size-guide` | Guide des tailles | Produits | 4 mesures, 12 tailles, cm ou pouces, repliable |
| `comparison-table` | Tableau comparatif | Confiance | 2 ou 3 colonnes, « oui » / « non » en coche / croix lisibles sans la couleur ; tableau défilant focalisable |
| `marquee` | Bandeau défilant | Texte | messages courts (60 caractères, lien facultatif), arrêt au survol et au focus, immobile en mouvement réduit ; un seul par page conseillé |

Bloc **`metafield`** (« Champ personnalisé ») disponible dans `main-product` et `main-collection` :
`{ type: "metafield", name: "Champ personnalisé", settings: [{ type: "text", id: "label", label: "Libellé", default: "", maxLength: 60 }, { type: "textarea", id: "value", label: "Valeur", default: "", maxLength: 500, info: "Connectez un champ personnalisé (« Connecter une donnée »). Rien ne s'affiche si la valeur est vide." }] }`.
Rendu : `product/product-main.tsx` (cas `metafield`) et `sections/main-collection.tsx` (`MetafieldLines`) ; valeur vide = rien.

### Éditeur : modèles alternatifs, sections enregistrées
- Cible d'édition `{ template, alternate }` (`editor-target.ts`) ; le sélecteur de page liste « Produit (par défaut) », « Produit · luxe »… ; bouton **Modèles** sur Produit, Collection, Page et Article. Plans : `alternateTemplatesPerType` (Business 5, Scale et Enterprise 20, plafond global 20), contrôlés dans l'éditeur et par `lot4PlanIssue` côté serveur. Renommer ou supprimer : actions serveur `renameAlternateTemplate` / `deleteAlternateTemplate` (brouillon enregistré d'abord, historique neuf ensuite, non annulable). Aucun écran n'attribue encore un modèle alternatif à une fiche (`templateSuffix`).
- Insertion d'une section enregistrée ou de la bibliothèque :
  ```ts
  const r = await getSavedSectionForInsert(storeId, id);           // ou getLibraryItemForInsert
  if (r.ok) {
    const section = clonePayload(r.data.payload, uniqueIdFactory(doc)); // ids uniques dans le document
    // puis insertSavedSection / addSection à l'index voulu, canAddSection, historique
    if (r.data.removedRefs) toast.info("Certaines références introuvables ont été retirées.");
  }
  ```
  Types : `SavedSectionDTO` (`src/lib/saved-sections/rules.ts`), `LibraryItemDTO` (`src/lib/section-library/service.ts`). Les éléments verrouillés affichent le plan requis (`requiredPlanName`) ; le contrôle réel est fait par `getLibraryItemForInsert`. Signatures complètes : `docs/ARCHITECTURE.md` §7 quinquies.
