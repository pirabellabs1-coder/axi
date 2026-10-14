# Lot 4 : personnalisation sans concurrent (spécification d'implémentation)

Ambition : la boutique la plus facile à rendre unique au monde, sans code, en minutes, sur un téléphone, avec une IA qui produit des documents de thème **valides par construction**.
Socle : `src/lib/theme-engine/**` (types, schémas, validate, operations, preview-messages), `src/lib/storefront/theme-doc.ts` (sanitize, contraste), `src/components/storefront/live-preview.tsx`, `src/components/theme-editor/**`, `src/lib/ai/**`, `src/lib/credits.ts`.
Principe non négociable : **aucun HTML ni JS marchand ou IA** ; tout passe par `ThemeDocument` v2, `validateThemeDocument` et `sanitizeThemeDocument`.

## 0. Vue d'ensemble : valeur, effort, ordre

| # | Fonction | Valeur | Effort | Sous-vague |
|---|---|---|---|---|
| 1 | Préréglages d'animation sobres | Moyenne (image premium) | S | 4A |
| 2 | Scores en direct dans l'éditeur, correction en un clic | Très haute (qualité moyenne des boutiques) | M | 4A |
| 3 | Sections enregistrées | Haute | S | 4A |
| 4 | Bibliothèque de sections premium | Haute (revenus, différenciation) | M | 4A |
| 5 | Champs personnalisés et sources dynamiques | Très haute (parité Shopify OS 2.0) | L | 4A |
| 6 | Modèles alternatifs (produit, collection, page, article) | Haute | M | 4A |
| 7 | Kit de marque automatique (logo vers palette AA) | Haute | S | 4B |
| 8 | Édition directe dans l'aperçu (texte, image glissée, barre d'actions) | Très haute (mobile-first) | M | 4B |
| 9 | Boutique générée par l'IA (3 directions) | Exceptionnelle (acquisition, effet waouh) | L | 4B |
| 10 | Assistant de design conversationnel (« rends l'accueil plus luxe ») | Exceptionnelle | M | 4B |
| 11 | Thèmes programmés (Tabaski, Noël, soldes) | Haute (marché local) | M | 4C |
| 12 | Personnalisation par audience | Haute | M | 4C |
| 13 | Tests A/B de sections | Haute (Shopify ne le fait pas nativement) | L | 4C |
| 14 | Boutique installable (PWA) et mode économie de données | Très haute (réseaux lents) | M | 4D |
| 15 | Partage en statut WhatsApp (visuel produit généré) | Très haute (canal n° 1 en Afrique) | S | 4D |
| 16 | Flux catalogues Meta, Google, TikTok et synchronisation du catalogue WhatsApp | Haute | M | 4D |
| 17 | Vidéos et stories achetables | Haute | M | 4D |
| 18 | Live shopping | Moyenne à haute | L | 4D |
| 19 | Notifications push | Moyenne | M | 4D |

Ordre : 4A (fondations dont dépendent l'IA et les audiences) → 4B → 4C → 4D. Dans 4B, 7 et 8 précèdent 9, puis 10.

## 1. Évolutions du contrat de thème (équipe Moteur, `types.ts`, `validate.ts`, `theme-doc.ts`, `operations.ts`)
Ajouts **rétrocompatibles** (tous facultatifs, avec valeurs par défaut au sanitize) :
```ts
// SettingValue : source dynamique
type DynamicSource = { $source: string }; // ex. "product.metafields.custom.matiere"
type SettingValue = … | DynamicSource;

// GlobalSettings
motion?: { preset: "none" | "subtle" | "lively"; reveal: boolean; parallax: boolean; hoverZoom: boolean };

// SectionInstance
visibility?: { match: "all" | "any"; mode: "show" | "hide"; rules: AudienceRule[] }; // §12
animation?: "inherit" | "none" | "fade-up" | "fade" | "zoom-in" | "slide-left";

// ThemeDocument
alternates?: Partial<Record<"product" | "collection" | "page" | "article", Record<string /* suffixe ^[a-z0-9-]{1,24}$ */, Template>>>;
```
- `themeDocumentSchema` (strict) : accepte `alternates`.
- `MAX_DOCUMENT_BYTES` inchangé (3,5 Mo).
- Plafonds : 20 modèles alternatifs au total, 10 règles par section, 30 sections personnalisées par modèle.
- Nouvelles opérations pures dans `operations.ts` : `addAlternate`, `duplicateAlternate`, `removeAlternate`, `setSectionVisibility`, `bindDynamicSource`, `unbindDynamicSource`, `insertSavedSection`, `applyOperations(doc, ops: ThemeOperation[])`. Cette dernière est l'union sérialisable utilisée par l'IA, les scores et l'éditeur, avec liste blanche des chemins globaux.

**Refactor d'enregistrement (à faire en premier, jour 1, par Moteur)** : `schemas.ts` importe `src/lib/theme-engine/section-schemas/<type>.ts` (un fichier par section), pour que chaque équipe possède ses propres schémas sans conflit. `render-registry.tsx` reste un fichier unique tenu par l'équipe Rendu ; les autres équipes demandent l'ajout d'une ligne.

## 2. Préréglages d'animation (S, 4A)
- `GlobalSettings.motion` (défaut `{ preset: "subtle", reveal: true, parallax: false, hoverZoom: true }`) et champ partagé `ANIMATION` (sélecteur) dans les sections de mise en avant.
- Rendu :
  - attributs `data-anim` ;
  - CSS dans `store-styles.tsx` : transform et opacity uniquement, 200 à 600 ms, `cubic-bezier(0.2, 0, 0, 1)`, décalage ≤ 60 ms, 6 éléments animés maximum par section ;
  - apparition via un seul composant client `MotionObserver` (IntersectionObserver, `data-in-view`) ;
  - parallaxe en CSS `animation-timeline: view()` si supporté, sinon statique (aucun écouteur de défilement).
- Désactivation totale : `prefers-reduced-motion: reduce`, en-tête `Save-Data`, mode économie de données (§14), aperçu avec la case « Réduire les animations ».
- Tests : tout CSS d'animation est sous `@media (prefers-reduced-motion: no-preference)` ; aucun `transition: all`.

## 3. Scores qualité en direct (M, 4A)
- Module pur `src/lib/theme-engine/quality.ts` : `scoreTheme(doc, facts): { scores: { accessibility, performance, seo, conversion } (0..100), issues: Issue[] }` avec `Issue = { id, category, severity: "error" | "warning" | "tip", message, target?: { template, sectionId?, blockId?, settingId? }, fix?: ThemeOperation[] | { action: "ai_alt" | "compress_image" | "open_product", … } }`.
- `facts` (chargés côté serveur une fois par session d'éditeur, rafraîchissables) : métadonnées des images (taille, dimensions, format, depuis le stockage objet ; data-URL : longueur), produits sans texte alternatif, description de boutique, pages, nombre d'avis, moyens de contact.
- **Règles** (au lancement, extensibles) :

| Catégorie | Contrôle | Correction en un clic |
|---|---|---|
| Accessibilité | texte/fond < 4,5:1 (AA), boutons < 4,5:1, schémas de couleurs | `readableOn` appliqué (opération) |
| Accessibilité | image sans `alt` (section, bloc, produit) | alt = titre de la section ou nom du produit ; IA 1 crédit pour 10 alt |
| Accessibilité | plusieurs titres « très grand » en tête, lien sans libellé | taille ajustée |
| Performance | image > 400 Ko, > 2 500 px, non WebP/AVIF | recompression via le pipeline de stockage |
| Performance | diaporama > 3 diapositives en lecture auto, vidéo en lecture auto sur mobile, > 15 sections à l'accueil | désactiver la lecture auto, masquer des sections |
| SEO | description de boutique < 50 caractères, pas d'image de partage, collection sans description, `seoTitle` > 60 | proposition IA (1 crédit) |
| Conversion | pas d'appel WhatsApp, pas de garanties, avis existants non affichés, annonce > 120 caractères, prix masqué | ajouter la section (préréglage) |

- Pondération documentée dans le module. Calcul côté client à chaque modification (anti-rebond 500 ms).
- Panneau « Qualité » de l'éditeur : 4 jauges, liste triée, correction annulable (historique).
- Plans : scores pour tous ; corrections IA consomment des crédits.

## 4. Sections enregistrées et bibliothèque premium (S puis M, 4A)
- `SavedSection` : « Enregistrer cette section » dans l'inspecteur (nom unique par boutique), insertion dans tout modèle compatible. Clonage avec de nouveaux identifiants (`uniqueIdFactory`) ; références (collection, produit, menu) vérifiées et retirées si absentes.
- `SectionLibraryItem` (plateforme) : compositions conçues par Axi (réglages et blocs d'un type existant, ou nouveaux types premium : `hero-split-video`, `lookbook`, `before-after`, `size-guide`, `comparison-table`, `marquee`, `editorial-grid`, `cart-progress`…).
  - Aucune référence d'identifiant dans les charges (des emplacements à remplir).
  - `premium` et `minPlan`.
  - Gérée dans `/admin/bibliotheque` (`settings.manage`, audit `admin.library.*`).
  - Aperçu par image statique.
- Plans : sections enregistrées Starter (20) et Business et plus (illimité) ; bibliothèque gratuite pour tous ; éléments premium Business et plus.

## 5. Champs personnalisés et sources dynamiques (L, 4A)
- **Définitions** (`MetafieldDefinition`) :
  - propriétaires `PRODUCT`, `VARIANT`, `COLLECTION`, `CUSTOMER`, `ORDER`, `STORE`, `PAGE`, `BLOG_POST` ;
  - `namespace.key` (`^[a-z0-9_]{1,32}$` et `^[a-z0-9_]{1,64}$`) ;
  - types `single_line_text`, `multi_line_text`, `rich_text` (Markdown limité), `integer`, `decimal`, `boolean`, `date`, `color`, `url`, `image`, `product_reference`, `collection_reference`, `list_single_line_text`, `rating`, `dimension`, `weight`, `money` ;
  - validations (`min`, `max`, `regex` limité, `choices`) ;
  - `storefrontVisible` ; épinglage dans les formulaires.
- **Valeurs** (`MetafieldValue`) : JSON validé par type, `@@unique([definitionId, ownerId])` ; propriétaire vérifié dans la même boutique ; références vérifiées (même boutique, existantes).
- **Édition** : composant générique `<MetafieldsEditor ownerType ownerId />` inséré dans les formulaires produit, collection, page et client par leurs équipes propriétaires ; import et export CSV (colonnes `metafield:custom.matiere`).
- **Sources dynamiques** :
  - un réglage peut valoir `{ "$source": "…" }` ;
  - grammaire en liste blanche `^(product|variant|collection|store|page|article)\.(title|vendor|description|type|tags|price|compare_at_price|image|url|metafields\.[a-z0-9_]{1,32}\.[a-z0-9_]{1,64})$` ;
  - matrice de compatibilité (champ `text` ← texte, nombre, date formatée ; `image` ← image ; `url` ← url, référence ; `color` ← color ; `richtext` ← rich_text, multi_line) ;
  - résolution au rendu par `resolveSetting(settings, id, renderCtx)`, qui repasse la valeur par `sanitizeFieldValue` ; valeur absente : défaut du champ, ou section masquée si le réglage `hide_if_empty` est vrai.
- **Éditeur** : bouton « Connecter une donnée » à côté des champs compatibles ; aperçu avec un produit exemple.
- **Nouveaux éléments** : bloc `metafield` (libellé et valeur) dans `main-product` et `main-collection` ; section `product-specs` (tableau de champs choisis).
- Plans : Starter 10 définitions, Business 100, Scale et plus illimité.

## 6. Modèles alternatifs (M, 4A)
- `ThemeDocument.alternates.product["luxe"]`, etc. `Product.templateSuffix`, `Category.templateSuffix`, `StorePage.templateSuffix`, `BlogPost.templateSuffix`.
- Rendu : `alternates[type][suffix] ?? templates[type]`.
- Éditeur :
  - sélecteur de modèle « Produit (par défaut) / Produit · luxe / … », créer par duplication, renommer, supprimer ;
  - suppression : les produits liés retombent sur le défaut et le suffixe est remis à null par l'action, avec audit ;
  - aperçu avec un produit qui utilise ce modèle.
- Attribution : liste « Modèle de page » dans les formulaires produit, collection, page et article, et action groupée « Appliquer le modèle » sur une sélection de produits.
- Plans : Business 5 par type, Scale 20, Enterprise 20.

## 7. Kit de marque automatique (S, 4B)
- Envoi du logo, puis extraction **côté client** (canvas, quantification « median cut » sur 5 couleurs, pixels transparents et quasi blancs ignorés), puis validation serveur (hex).
- Génération :
  - `primary` = couleur la plus saturée et utilisable ;
  - `primaryText` = `readableOn(primary)` ;
  - `accent` complémentaire ;
  - neutres teintés ;
  - schémas `marque`, `sombre` (la boutique reste en thème clair forcé ; le « sombre » est un schéma de section).
- Contrôle AA affiché (4,5:1 texte, 3:1 grands titres et composants). Correction automatique par ajustement de la luminance HSL jusqu'au seuil.
- `Store.brandKit` (`{ logoUrl, palette[], primary, accent, fontPair, voice: { tone: "chaleureux" | "premium" | "direct" | "festif", formal: true } }`), réutilisé par l'IA, les campagnes et les visuels de statut (§15).
- Gratuit, sans crédit.

## 8. Édition directe dans l'aperçu (M, 4B)

### Protocole `postMessage` étendu (`src/lib/theme-engine/preview-messages.ts`, mêmes garanties d'origine et de source)

| Sens | Message | Effet |
|---|---|---|
| éditeur → aperçu | `{ type: "axi:inline-mode", enabled }` | active l'édition en place (désactivée par défaut) |
| aperçu → éditeur | `{ type: "axi:inline-change", target: { sectionId, blockId \| null, settingId }, value, phase: "input" \| "commit", template }` | texte modifié ; l'éditeur valide (schéma du champ : `maxLength`, type), applique `updateSectionSetting` / `updateBlockSetting`, ajoute à l'historique au `commit`, renvoie `axi:theme-preview` |
| éditeur → aperçu | `{ type: "axi:inline-reject", target, message }` | valeur refusée : l'aperçu restaure et affiche une bulle |
| aperçu → éditeur | `{ type: "axi:image-drop", target, file }` | `File` (clone structuré, même origine) ; types jpeg, png, webp, avif ≤ 5 Mo ; l'éditeur téléverse via `/api/stores/[storeId]/media` puis fixe `{ url, alt }` (alt = titre de la section) |
| aperçu → éditeur | `{ type: "axi:section-action", id, action: "move-up" \| "move-down" \| "duplicate" \| "hide" \| "remove" \| "insert-after" }` | barre d'actions flottante sur la section sélectionnée ; `remove` est confirmé côté éditeur |
| éditeur → aperçu | `{ type: "axi:preview-audience", audience }` | simulation d'audience (§12) |
| éditeur → aperçu | `{ type: "axi:preview-at", at }` | aperçu à une date (§11) |

### Marquage
Les composants de section appellent `editAttrs(ctx, { sectionId, blockId, settingId, kind })`, qui ne produit `data-edit` / `data-edit-kind` **qu'en aperçu** (aucun attribut dans le HTML public).

### Comportement
- `text` et `textarea` : `contenteditable="plaintext-only"` au clic sur un élément d'une section déjà sélectionnée ; Entrée valide (texte), Échap annule, perte de focus valide.
- `richtext` : focus sur le champ de l'inspecteur (v1).
- Les champs liés à une source dynamique ne sont pas éditables en place (bulle « Donnée du produit : modifiez le produit »).
- Glisser une image du système sur une section qui a un champ `image` : contour « Déposer pour remplacer ».
- Accessibilité : contour de focus visible, `aria-label` « Modifier le titre », alternative clavier (F2).
- Les parseurs (`parseInlineChange`, `parseImageDrop`, `parseSectionAction`) sont défensifs et testés : identifiants `^[\w-]{1,64}$`, valeur ≤ 5 000 caractères, `File` vérifié.

## 9. Boutique générée par l'IA (L, 4B)

### Entrées (formulaire `/app/[storeId]/apparence/generer`, aussi proposé à l'onboarding)
- Une phrase (≤ 500 caractères, ex. « Pâtisserie fine à Cotonou, gâteaux d'anniversaire sur commande, ambiance chic et chaleureuse »).
- Secteur (`Store.sector`), ville et pays, langue.
- Ton (kit de marque), audience cible (liste), mots interdits (facultatif).
- Logo (le kit de marque le précède) et jusqu'à 6 photos (stockage objet, réduites à 1 024 px pour l'analyse).
- Données réelles injectées automatiquement : nom, slogan, 20 meilleurs produits (nom, collection, a une photo), collections, moyens de paiement, zones de livraison, horaires, présence d'avis.

### Pipeline (fichiers `src/lib/ai/design/**`)
1. **Kit de marque** (§7) : palette de base déterministe, sans IA.
2. **Appel IA unique** (`callClaudeJson`, étendu pour accepter des images : `images?: { mediaType, data }[]`), sortie contrainte par JSON Schema `STORE_DESIGN_BRIEF_SCHEMA` : un **brief**, pas un document.
   ```json
   { "directions": [ {
       "id": "a", "name": "Douceur dorée (≤40)", "rationale": "≤240",
       "palette": { "background": "#…", "surface": "#…", "text": "#…", "primary": "#…", "accent": "#…" },
       "fonts": { "heading": "<FontId>", "body": "<FontId>" }, "headingWeight": 600,
       "buttons": { "radius": 0-24, "style": "solid|outline|soft" }, "cards": { "radius": 0-24, "imageRatio": "square|portrait|landscape|natural" },
       "density": "airy|balanced|compact",
       "announcement": "≤120 | null",
       "home": [ { "type": "<SectionType autorisé>", "preset": 0, "scheme": "default|surface|inverse|brand",
                   "copy": { "heading": "≤120", "subheading": "≤160", "text": "≤600", "button_label": "≤40" },
                   "image": { "photoIndex": 0 } | null, "collectionIndex": 0 | null, "productIndexes": [0,1] } ],   // 4 à 9 sections
       "product": { "gallery": "…", "variantPicker": "…", "stickyAddToCart": true, "blocks": ["title","price","…"] },
       "faq": [ { "q": "≤120", "a": "≤400" } ]   // ≤6, uniquement à partir des données fournies (livraison, paiement, horaires)
   } ] }   // exactement 3 directions contrastées
   ```
3. **Compilateur déterministe** `compileBrief(direction, storeData): ThemeDocument` :
   - part du préréglage du secteur (`defaults.ts`) ;
   - applique palette, polices et formes ;
   - construit les sections via `SECTION_SCHEMAS[type].presets[preset]` et une table `COPY_MAP` (copie vers les identifiants de réglages par type) ;
   - résout `photoIndex`, `collectionIndex` et `productIndexes` en URL et identifiants **réels** (indices hors bornes ignorés) ;
   - réinjecte les sections obligatoires ; en-tête, pied de page et menus existants.
4. **Garde-fous** :
   - `ensureAccessibleColors` (AA, `contrastRatio` de theme-doc.ts) ;
   - textes passés par `tidy` et `stripForbidden` (pas de prix, promesse, délai, garantie, promotion) ;
   - **interdiction des faux témoignages et faux avis** : les sections `testimonials` et `reviews` ne sont autorisées que si des avis réels existent, et le contenu vient de la base ;
   - liste blanche des types de sections ;
   - polices limitées à `FontId`.
5. **Validation** : `validateThemeDocument` doit passer. Sinon les sections fautives sont retirées et la validation est relancée. En dernier recours : préréglage du secteur avec la palette seule. L'IA ne peut jamais produire un document invalide.
6. **Présentation** : 3 aperçus côte à côte (3 iframes `LivePreview` alimentées par `axi:theme-preview`, rien n'est enregistré), nom et justification. « Choisir » écrit le brouillon (`saveThemeDraft`) après une `ThemeVersion` « Avant génération IA » ; jamais de publication automatique. Ajustements ensuite dans l'éditeur ou via l'assistant (§10).
7. `ThemeGeneration` conserve l'entrée, les 3 candidats compilés, le choix, le modèle, les jetons et les crédits (expire à 7 jours).

### Prompt (`src/lib/ai/design/prompts.ts`)
- Système : rôle de directeur artistique e-commerce pour l'Afrique francophone et le monde, sobriété, mobile d'abord, lisibilité, 3 directions **réellement différentes** (ex. éditorial épuré, chaleureux et coloré, premium contrasté), règles d'invention interdite (reprises de `DESCRIBE_SYSTEM`), sortie JSON uniquement.
- Données du commerçant dans des balises `<boutique>`, `<brief>`, `<catalogue>`, `<photos>` neutralisées (fermeture de balise retirée) et déclarées comme données.
- Modèle : `AI_MODEL_DESIGN` (variable d'environnement), par défaut le modèle existant `AI_MODEL` ; un modèle de gamme supérieure est recommandé pour la qualité de direction artistique.

### Coût (`src/lib/credits.ts`, débit avant appel, remboursement en cas d'échec ou de sortie invalide)

| Action | Crédits IA |
|---|---|
| Générer 3 directions (texte) | 10 |
| Avec analyse de photos (≤ 6) | 15 |
| Régénérer une direction | 4 |
| Réécrire les textes d'une section | 1 |
| Instruction de l'assistant de design (§10) | 2 |

- Offert : **20 crédits IA à la création de la boutique** (`reason: "onboarding_gift"`, expiration 30 jours, une fois par boutique, y compris en plan Gratuit), donc une génération complète accessible à tous.
- Débit limité : 5 générations par heure et par boutique.
- Audit `ai.store_design` (modèle, jetons, crédits, réussite).

## 10. Assistant de design conversationnel (M, 4B)
- Champ « Dites ce que vous voulez changer » dans l'éditeur (ex. « Rends l'accueil plus luxe », « Ajoute une FAQ sur la livraison », « Mets le bouton WhatsApp plus visible »).
- Entrée : résumé compact du document (types, ordre, réglages principaux, palette ; pas les images), modèle courant, sélection.
- Sortie JSON : `{ explanation (≤200), operations: ThemeOperation[] (≤ 20) }`.
- Opérations validées une par une (liste blanche, `applyOperations`), appliquées au brouillon dans l'éditeur, annulables en un clic (une entrée d'historique), avec un aperçu immédiat.
- Refus explicite si la demande sort du cadre (code, script, contenu trompeur).
- 2 crédits par instruction.

## 11. Thèmes programmés (M, 4B → 4C)
- `ThemeSchedule` : nom, occasion, **document complet** (copie du thème courant transformée par un préréglage d'occasion, puis éditable dans l'éditeur en mode « Thème programmé »), `startsAt` et `endsAt` (fuseau de la boutique).
- **Résolution au rendu, sans cron** : `getThemeDocument(store)` charge la programmation active (`startsAt ≤ now < endsAt`, statut `SCHEDULED` ou `ACTIVE`). Le retour au thème normal est donc exact à la seconde, sans écriture. Un job `theme.schedule_notify` (planifié à `startsAt` et `endsAt`) notifie le commerçant et met à jour le statut (`ACTIVE`, `COMPLETED`) à titre informatif.
- Chevauchements interdits (vérification sous verrou consultatif). Modifier le thème principal pendant une programmation ne l'interrompt pas. Annulation à tout moment.
- Aperçu « voir à la date » (`?preview=1&at=…`, membres).
- Préréglages d'occasion (`src/config/occasions.ts`, opérations : annonce, accent, bannière, compte à rebours) : Tabaski, Korité et Ramadan, Noël, Nouvel An, Saint-Valentin, Fête des mères, fêtes de l'indépendance (par pays), Rentrée, Black Friday, Soldes. Dates mobiles saisies par le commerçant (suggestion).
- Plans : Business 3 programmations futures, Scale et plus illimité.

## 12. Personnalisation par audience (M, 4C)
- `SectionInstance.visibility` avec règles :

| Règle | Source du signal |
|---|---|
| `city` (liste) | adresse par défaut de l'acheteur connecté, sinon cookie `axi_city` (section « Choisissez votre ville », alimentée par les zones de livraison), sinon en-tête géographique de l'hébergeur s'il existe ; aucune API tierce |
| `customer`: `anonymous` / `new` / `returning` / `loyal` (≥ 3 commandes) / `has_points` | session acheteur (lot 1) |
| `source`: whatsapp, instagram, tiktok, facebook, google, direct, campaign | cookie de premier contact `axi_src` (30 jours) posé par `src/proxy.ts` à partir de `utm_source`, `ref` ou du référent |
| `locale` | lot 2 |
| `schedule` (jours, heures, fuseau boutique) | horloge |
| `device` (mobile / ordinateur) | `Sec-CH-UA-Mobile`, sinon agent utilisateur |

- Évaluation **côté serveur** (`evaluateVisibility(visibility, audienceCtx)`, pur). Robots d'indexation : audience par défaut (anti-cloaking).
- Interdit : masquer le prix ou modifier un prix par audience (les remises restent dans le pipeline du lot 1).
- Éditeur : panneau « Visible pour » et sélecteur d'audience simulée dans l'aperçu (`axi:preview-audience`).
- Vie privée : cookies fonctionnels de premier niveau, aucune donnée personnelle, durée bornée, mentionnés dans la page de confidentialité de la boutique.
- Plans : Scale et plus (Business : règle `customer` seulement).

## 13. Tests A/B de sections (L, 4C)
- `Experiment` sur une section d'un modèle : 2 ou 3 variantes (A = section actuelle ; B, C = variante de section ou « masquée »), poids, objectif (`ADD_TO_CART`, `CHECKOUT_START`, `ORDER`).
- **Affectation déterministe** : `hash(axi_vid + experimentId) mod 10 000` comparé aux poids cumulés. Cookie `axi_vid` aléatoire de 128 bits, 1 an, posé par le proxy.
- **Exposition** comptée côté client quand la section entre dans la vue (balise `navigator.sendBeacon` vers `/api/s/[slug]/events`, dédoublonnée par visiteur et par jour, débit limité, robots ignorés).
- **Conversions** : `add_to_cart` et `checkout_start` par balise ; `order` côté serveur via `Order.attribution.experiments` (copié depuis `Cart.attribution`).
- `ExperimentStat` agrège par jour, variante et métrique (`upsert` incrémental).
- **Statistiques** (`src/lib/experiments/stats.ts`, pur) :
  - bêta-binomial, probabilité d'être la meilleure (10 000 tirages, graine fixe pour la reproductibilité des tests) ;
  - gain relatif avec intervalle ;
  - verdict seulement après 7 jours et 200 expositions par variante ;
  - avertissement contre l'arrêt prématuré.
- « Appliquer la gagnante » remplace la section dans le brouillon (puis publication par le commerçant).
- Un seul test actif par section ; tests suspendus pendant un thème programmé qui ne contient pas la section.
- Plans : Scale 3 tests simultanés, Enterprise 10.

## 14. Boutique installable (PWA) et mode économie de données (M, 4D)
- **Manifeste par boutique** : `src/app/s/[slug]/manifest.webmanifest/route.ts` (nom, nom court, `start_url` et `scope` selon l'hôte : `/` sur un sous-domaine ou un domaine propre, `/s/{slug}/` sinon ; `theme_color` = primaire ; icônes 192 et 512 générées **côté client par canvas** lors de l'envoi dans l'éditeur, deux fichiers stockés ; `Store.pwaConfig`).
- **Service worker** `src/app/s/[slug]/sw.js/route.ts` (en-tête `Service-Worker-Allowed` adapté) :
  - HTML : réseau d'abord, page hors ligne de repli (nom, contact WhatsApp, derniers produits vus) ;
  - images : cache puis revalidation (60 entrées, 30 Mo) ;
  - **jamais** en cache : `/commander`, `/compte`, actions serveur, `/api`.
- Invitation à l'installation discrète (après 2 visites ou un ajout au panier), désactivable dans le thème.
- **Économie de données** :
  - activée par `Save-Data` ou par l'interrupteur du pied de page (cookie `axi_lite=1`) ;
  - images en qualité réduite via `src/lib/image-loader.ts`, pas de lecture auto vidéo, pas d'animations, chargement paresseux strict, pas de polices décoratives (police système) ;
  - budget : page d'accueil < 300 Ko transférés en mode économie.
- Plans : PWA Starter et plus ; notifications push Business et plus.

## 15. Partage en statut WhatsApp (S, 4D)
- Bouton « Partager en statut » sur la fiche produit (marchand et acheteur) : visuel 1080×1920 composé **côté client** (canvas : photo, nom, prix formaté, logo, QR vers la fiche, couleurs du kit de marque). Partage via Web Share API niveau 2 (fichier), sinon téléchargement.
- Texte d'accompagnement prérempli (lien de la fiche avec `utm_source=whatsapp_status`).
- Aucun crédit ; tous les plans (logo Axi discret en plan Gratuit).

## 16. Flux catalogues et synchronisation sociale (M, 4D)
- Flux publics (produits actifs, informations déjà publiques, cache 1 h) :
  - `/s/[slug]/feeds/meta.xml` (RSS 2.0, espace `g:`) ;
  - `/feeds/google.xml` ;
  - `/feeds/tiktok.csv`.
  - Champs : id (variante), titre, description (nettoyée), lien, image, prix, disponibilité, marque, GTIN (`barcode`), groupe d'articles.
- Catalogue WhatsApp Business et Meta Commerce : `SocialCatalogSync` et job `social.sync` (API Graph via l'`Integration` WhatsApp Cloud ; point d'intégration documenté, statut et erreurs visibles).
- Plans : flux Business et plus ; synchronisation API Scale et plus.

## 17. Vidéos et stories achetables (M, 4D)
- **Section `shoppable-video`** :
  - vidéo MP4 (stockage objet) ou URL sûre (`isSafeVideoUrl`) ;
  - blocs « produit étiqueté » (produit et instant d'apparition) ;
  - lecture muette seulement dans la vue et sans `prefers-reduced-motion` ;
  - sous-titres facultatifs (fichier VTT) ;
  - boutons « Ajouter » et « Commander sur WhatsApp ».
- **Section `stories`** :
  - cercles façon Instagram ;
  - visionneuse plein écran accessible (clavier, Échap, `aria-modal`) ;
  - blocs story (image ou vidéo, produits, durée) ; contenu dans le document de thème.
- Plans : Business et plus.

## 18. Live shopping (L, 4D)
- `LiveEvent` : titre, date, URL de diffusion (YouTube, Facebook, TikTok en liste blanche d'intégration), produits épinglés, statut.
- Section `live-shopping` : compte à rebours, lecteur, produits épinglés mis à jour par interrogation toutes les 15 s, bouton « Me rappeler sur WhatsApp » (consentement `Consent` marketing, campagne de rappel automatique au début).
- Plans : Scale et plus.

## 19. Notifications push (M, 4D)
- `PushSubscription` (acheteur ou visiteur).
- Web Push RFC 8291 et 8292 implémenté avec `node:crypto` (ECDH P-256, HKDF, AES-128-GCM, JWT VAPID ES256), sans dépendance ; tests avec les vecteurs des RFC. Clés VAPID plateforme (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`).
- Sujets : `orders` (transactionnel, statut de commande), `marketing` (consentement : nouvelle valeur `PUSH` de `ConsentChannel`).
- Campagnes `channel = "push"` (sans crédit WhatsApp, plafond mensuel par plan) ; abonnements expirés (404 ou 410) révoqués.

## 20. Modèle de données (diff Prisma exact, additif)

```prisma
enum MetafieldOwner {
  PRODUCT
  VARIANT
  COLLECTION
  CUSTOMER
  ORDER
  STORE
  PAGE
  BLOG_POST
}

enum ThemeScheduleStatus {
  SCHEDULED
  ACTIVE
  COMPLETED
  CANCELLED
}

enum AiJobStatus {
  PENDING
  RUNNING
  SUCCEEDED
  FAILED
}

enum ExperimentStatus {
  DRAFT
  RUNNING
  PAUSED
  COMPLETED
}

enum LiveEventStatus {
  SCHEDULED
  LIVE
  ENDED
  CANCELLED
}

enum ConsentChannel {
  WHATSAPP
  SMS
  EMAIL
  PUSH // +
}

model Store {
  // …
  brandKit  Json? // +
  pwaConfig Json? // + { enabled, icon192, icon512, installPrompt, pushEnabled }

  metafieldDefinitions MetafieldDefinition[]
  metafieldValues      MetafieldValue[]
  savedSections        SavedSection[]
  themeSchedules       ThemeSchedule[]
  themeGenerations     ThemeGeneration[]
  experiments          Experiment[]
  pushSubscriptions    PushSubscription[]
  socialCatalogSyncs   SocialCatalogSync[]
  liveEvents           LiveEvent[]
}

model Product   { /* … */ templateSuffix String? } // +
model Category  { /* … */ templateSuffix String? } // +
model StorePage { /* … */ templateSuffix String? } // +
model BlogPost  { /* … */ templateSuffix String? } // + (modèle du lot 2)

model MetafieldDefinition {
  id                String          @id @default(cuid())
  storeId           String
  ownerType         MetafieldOwner
  namespace         String
  key               String
  name              String
  description       String?
  type              String // liste fermée, src/lib/metafields/types.ts
  validations       Json?
  storefrontVisible Boolean         @default(true)
  pinnedPosition    Int?
  createdAt         DateTime        @default(now())
  updatedAt         DateTime        @updatedAt
  store             Store           @relation(fields: [storeId], references: [id], onDelete: Cascade)
  values            MetafieldValue[]

  @@unique([storeId, ownerType, namespace, key])
}

model MetafieldValue {
  id           String              @id @default(cuid())
  storeId      String
  definitionId String
  ownerType    MetafieldOwner
  ownerId      String
  value        Json
  updatedAt    DateTime            @updatedAt
  store        Store               @relation(fields: [storeId], references: [id], onDelete: Cascade)
  definition   MetafieldDefinition @relation(fields: [definitionId], references: [id], onDelete: Cascade)

  @@unique([definitionId, ownerId])
  @@index([storeId, ownerType, ownerId])
}

model SavedSection {
  id          String   @id @default(cuid())
  storeId     String
  name        String
  sectionType String
  payload     Json // SectionInstance sans id
  previewUrl  String?
  usageCount  Int      @default(0)
  createdById String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  store       Store    @relation(fields: [storeId], references: [id], onDelete: Cascade)

  @@unique([storeId, name])
}

model SectionLibraryItem {
  id          String   @id @default(cuid())
  slug        String   @unique
  name        String
  description String?
  category    String
  sectionType String
  payload     Json
  previewUrl  String?
  premium     Boolean  @default(false)
  minPlan     PlanId   @default(FREE)
  tags        String[] @default([])
  published   Boolean  @default(false)
  position    Int      @default(0)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([published, category])
}

model ThemeSchedule {
  id          String              @id @default(cuid())
  storeId     String
  name        String
  occasion    String?
  document    Json
  startsAt    DateTime
  endsAt      DateTime
  status      ThemeScheduleStatus @default(SCHEDULED)
  createdById String?
  createdAt   DateTime            @default(now())
  updatedAt   DateTime            @updatedAt
  store       Store               @relation(fields: [storeId], references: [id], onDelete: Cascade)

  @@index([storeId, startsAt, endsAt])
}

model ThemeGeneration {
  id           String      @id @default(cuid())
  storeId      String
  status       AiJobStatus @default(PENDING)
  input        Json
  candidates   Json?
  chosenIndex  Int?
  model        String
  creditsUsed  Int         @default(0)
  inputTokens  Int         @default(0)
  outputTokens Int         @default(0)
  error        String?
  createdById  String?
  createdAt    DateTime    @default(now())
  expiresAt    DateTime
  store        Store       @relation(fields: [storeId], references: [id], onDelete: Cascade)

  @@index([storeId, createdAt])
  @@index([expiresAt])
}

model Experiment {
  id             String           @id @default(cuid())
  storeId        String
  name           String
  template       String // TemplateId ou "product:luxe"
  sectionId      String
  goal           String // ADD_TO_CART | CHECKOUT_START | ORDER
  status         ExperimentStatus @default(DRAFT)
  variants       Json // [{ key: "A"|"B"|"C", weight, section: SectionInstance | null }]
  winnerKey      String?
  startedAt      DateTime?
  endedAt        DateTime?
  createdById    String?
  createdAt      DateTime         @default(now())
  updatedAt      DateTime         @updatedAt
  store          Store            @relation(fields: [storeId], references: [id], onDelete: Cascade)
  stats          ExperimentStat[]

  @@index([storeId, status])
}

model ExperimentStat {
  id           String     @id @default(cuid())
  experimentId String
  variantKey   String
  day          String // AAAA-MM-JJ (fuseau boutique)
  metric       String // exposure | add_to_cart | checkout_start | order | revenue
  count        Int        @default(0)
  experiment   Experiment @relation(fields: [experimentId], references: [id], onDelete: Cascade)

  @@unique([experimentId, variantKey, day, metric])
}

model PushSubscription {
  id            String    @id @default(cuid())
  storeId       String
  customerId    String?
  endpoint      String    @unique
  p256dh        String
  auth          String
  topics        String[]  @default([])
  locale        String?
  userAgent     String?
  failures      Int       @default(0)
  lastSuccessAt DateTime?
  revokedAt     DateTime?
  createdAt     DateTime  @default(now())
  store         Store     @relation(fields: [storeId], references: [id], onDelete: Cascade)

  @@index([storeId, revokedAt])
}

model SocialCatalogSync {
  id         String    @id @default(cuid())
  storeId    String
  channel    String // meta | whatsapp | tiktok | google
  status     String    @default("idle") // idle | syncing | ok | error
  settings   Json?
  itemCount  Int       @default(0)
  lastSyncAt DateTime?
  lastError  String?
  store      Store     @relation(fields: [storeId], references: [id], onDelete: Cascade)

  @@unique([storeId, channel])
}

model LiveEvent {
  id          String          @id @default(cuid())
  storeId     String
  title       String
  startsAt    DateTime
  endsAt      DateTime?
  streamUrl   String
  productIds  String[]        @default([])
  pinnedId    String?
  status      LiveEventStatus @default(SCHEDULED)
  createdById String?
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt
  store       Store           @relation(fields: [storeId], references: [id], onDelete: Cascade)

  @@index([storeId, startsAt])
}
```
`Cart.attribution` et `Order.attribution` existent depuis le lot 1 (experiments, source, audience).

## 21. Fichiers, actions, routes, MCP
- **Moteur** :
  - `src/lib/theme-engine/{types,validate,operations,preview-messages}.ts` (extensions) ;
  - nouveaux `quality.ts`, `motion.ts`, `dynamic-sources.ts`, `audience.ts`, `alternates.ts`, `section-schemas/*.ts` ;
  - `src/lib/storefront/theme-doc.ts` (sanitize des nouveaux champs).
- **Éditeur** :
  - `src/components/theme-editor/{quality-panel,inline-bridge,audience-panel,alternate-picker,saved-sections,dynamic-source-picker,schedule-panel,experiment-panel,design-assistant}.tsx` ;
  - `src/app/app/[storeId]/apparence/{generer,programmations,tests}/**`.
- **Rendu** :
  - `src/components/storefront/{live-preview,store-styles,template-renderer,motion-observer}.tsx` ;
  - sections `product-specs`, `shoppable-video`, `stories`, `live-shopping`, sections premium ;
  - `render-registry.tsx`.
- **IA** :
  - `src/lib/ai/client.ts` (images) ;
  - `src/lib/ai/design/{prompts,schema,compile,guards,actions}.ts` (`generateStoreDesign`, `regenerateDirection`, `chooseDirection`, `rewriteSectionCopy`, `runDesignAssistant`) ;
  - `src/lib/brand-kit/{extract,palette,actions}.ts`.
- **Données** :
  - `src/lib/metafields/{types,validate,actions}.ts`, `src/components/app/metafields-editor.tsx` ;
  - `src/lib/saved-sections/actions.ts` ;
  - `src/lib/section-library/{service,admin-actions}.ts` et `/admin/bibliotheque/**` ;
  - `src/lib/theme-schedules/{service,actions}.ts` ;
  - `src/lib/experiments/{assign,stats,actions}.ts` ;
  - `src/app/api/s/[slug]/events/route.ts`.
- **Canaux** :
  - `src/app/s/[slug]/{manifest.webmanifest,sw.js}/route.ts` ;
  - `src/lib/pwa/**`, `src/lib/push/{vapid,encrypt,send,actions}.ts` ;
  - `src/app/s/[slug]/feeds/**` ;
  - `src/lib/social/**` ;
  - `src/components/storefront/status-share.tsx`.
- **Proxy** (propriétaire unique : équipe Expériences) : cookies `axi_vid` et `axi_src`.
- **Capacités** : `theme.manage` existante pour tout le lot ; bibliothèque admin `settings.manage`.
- **Jobs** : `theme.schedule_notify`, `social.sync`, `push.send`, `ai.generation_purge`.
- **MCP** (nouveau scope `theme:write`, Business+, écrit **uniquement le brouillon**) :
  - `get_theme_summary` (store:read) ;
  - `apply_theme_operations` (theme:write, ≤ 20 opérations, confirmation si suppression de sections) ;
  - `generate_store_design` (theme:write, crédits IA, confirmation toujours) ;
  - `publish_theme` (theme:write, confirmation toujours) ;
  - `list_saved_sections` ;
  - `schedule_theme` (confirmation) ;
  - `set_metafield` (catalog:write) ;
  - `get_quality_report` (store:read) ;
  - `experiment_results` (analytics:read).

## 22. Plans (`src/config/plans.ts`)
Nouvelles clés `PlanFeatures` : `aiStoreBuilder`, `designAssistant`, `inlineEditing`, `metafields`, `alternateTemplates`, `savedSections`, `premiumSections`, `scheduledThemes`, `audiencePersonalization`, `abTests`, `qualityScores`, `motionPresets`, `pwa`, `webPush`, `catalogFeeds`, `shoppableMedia`, `liveShopping`. Limites : `metafieldDefinitions`, `alternateTemplatesPerType`, `savedSections`, `scheduledThemes`, `concurrentExperiments`, `pushPerMonth`.

| Fonction | Gratuit | Starter | Business | Scale | Enterprise |
|---|---|---|---|---|---|
| Génération IA (crédits) | 1 offerte | crédits (packs) | 50 crédits/mois | 500 | sur mesure |
| Assistant de design | non | non | oui | oui | oui |
| Édition en place, scores, animations, kit de marque | oui | oui | oui | oui | oui |
| Champs personnalisés | non | 10 | 100 | illimité | illimité |
| Modèles alternatifs | non | non | 5 par type | 20 | 20 |
| Sections enregistrées | non | 20 | illimité | illimité | illimité |
| Sections premium | non | non | oui | oui | oui |
| Thèmes programmés | non | non | 3 | illimité | illimité |
| Personnalisation par audience | non | non | règle client | complète | complète |
| Tests A/B | non | non | non | 3 | 10 |
| PWA / push | non | PWA | PWA et push 2 000/mois | 20 000 | sur mesure |
| Flux / sync / vidéos / live | non | non | flux et vidéos | et sync, live | tout |

À vérifier : `PACK_AI_1000` est aujourd'hui réservé à Business et Scale. Il faut l'ouvrir à Starter pour la génération IA.

## 23. Sécurité
- Aucune sortie IA écrite sans passer par compilateur, liste blanche, `validateThemeDocument` et sanitize. Pas de publication automatique.
- Données du commerçant dans des balises de données ; filtre `stripForbidden` ; aucun faux avis.
- `postMessage` :
  - origine et source vérifiées ;
  - parseurs défensifs ;
  - `File` contrôlé (type, taille) puis revérifié côté serveur au téléversement ;
  - attributs `data-edit` absents hors aperçu.
- Sources dynamiques : grammaire fermée, champs `storefrontVisible` uniquement, sanitize après résolution ; un champ de client ou de commande n'est **jamais** exposé à la vitrine.
- Audiences et tests : cookies sans donnée personnelle, robots servis par défaut, pas de prix variable.
- Balises d'événements : débit limité par IP, dédoublonnage, plafonds par boutique ; les compteurs ne déclenchent aucune action payante.
- PWA : service worker sans cache des pages de compte, de commande ni d'API ; portée limitée à la boutique.
- Push : clés d'abonnement stockées telles que fournies (non secrètes) ; contenu marketing uniquement avec consentement `PUSH`.
- Bibliothèque premium : contrôle `minPlan` côté serveur à l'insertion.
- Flux catalogues : uniquement des informations déjà publiques (même règle que le MCP vitrine).

## 24. Tests
- **Vitest** :
  - `theme-doc-v2-ext.test.ts` : rétrocompatibilité ; documents existants inchangés au sanitize ; `alternates`, `visibility`, `$source` validés et rejetés selon les cas ; taille maximale ;
  - `theme-operations-apply.test.ts` : liste blanche, annulation ;
  - `quality.test.ts` : chaque règle et correction idempotente ;
  - `dynamic-sources.test.ts` : grammaire, compatibilité, sanitize, champ non public refusé ;
  - `metafields-validate.test.ts` ;
  - `alternates-resolve.test.ts` ;
  - `preview-messages-inline.test.ts` ;
  - `design-compile.test.ts` : propriété « tout brief valide au schéma donne un document valide » sur 200 briefs générés, indices hors bornes, sections interdites, contraste AA garanti ;
  - `design-guards.test.ts` : prix, promesses, faux avis ;
  - `design-credits.test.ts` : débit, remboursement sur échec et sortie invalide, crédits offerts une seule fois ;
  - `brand-palette.test.ts` ;
  - `schedule-resolve.test.ts` : bornes à la seconde, chevauchement refusé, fuseau ;
  - `audience.test.ts` ;
  - `experiments-assign.test.ts` (déterminisme, poids) ;
  - `experiments-stats.test.ts` (graine fixe, seuils) ;
  - `push-encrypt.test.ts` (vecteurs RFC 8291) ;
  - `vapid.test.ts` ;
  - `feeds.test.ts` (aucun champ privé) ;
  - `motion-css.test.ts` ;
  - `security-lot4.test.ts` (isolation boutique pour chaque action).
- **E2E** `e2e/11-lot4.spec.ts` :
  - génération IA avec client IA simulé (variable d'environnement de test) : 3 aperçus, choix, brouillon, publication ;
  - édition en place d'un titre et dépôt d'une image dans l'aperçu ;
  - modèle « luxe » attribué à un produit ;
  - champ personnalisé « Matière » affiché par source dynamique ;
  - thème programmé visible avec `?at=`, puis retour ;
  - section réservée aux clients fidèles invisible en anonyme ;
  - manifeste et service worker installables (contrôle Lighthouse PWA en CI) ;
  - mode économie : aucune vidéo en lecture auto.

## 25. Équipes et vague de schéma
- **S4** (unique, exécutable juste après S1) : migration `*_lot4_personnalisation` (tout le §20), `plans.ts`, `scopes.ts` (`theme:write`), `jobs.ts` (registre), `ConsentChannel.PUSH`, seed (bibliothèque de démonstration).

| Équipe | Propriété exclusive | Sous-vague |
|---|---|---|
| T1. Moteur de thème | `src/lib/theme-engine/**` (sauf `section-schemas/` des autres équipes), `src/lib/storefront/theme-doc.ts` ; refactor `section-schemas/` au jour 1 ; contrats figés au jour 3 | 4A |
| T2. Éditeur | `src/components/theme-editor/**`, `src/app/app/[storeId]/apparence/**` sauf `generer/` | 4A, 4B |
| T3. Rendu boutique | `src/components/storefront/**` (sauf `status-share.tsx` et sections de T6), `render-registry.tsx`, `src/lib/theme-engine/section-schemas/{product-specs,premium-*}.ts` | 4A |
| T4. IA et marque | `src/lib/ai/**`, `src/lib/brand-kit/**`, `src/app/app/[storeId]/apparence/generer/**` | 4B |
| T5. Données et expériences | `src/lib/metafields/**`, `src/components/app/metafields-editor.tsx`, `src/lib/saved-sections/**`, `src/lib/section-library/**`, `src/app/admin/bibliotheque/**`, `src/lib/theme-schedules/**`, `src/lib/experiments/**`, `src/app/api/s/[slug]/events/**`, `src/proxy.ts` | 4A, 4C |
| T6. Canaux | `src/lib/pwa/**`, `src/lib/push/**`, `src/lib/social/**`, `src/app/s/[slug]/{manifest.webmanifest,sw.js,feeds}/**`, `src/components/storefront/status-share.tsx`, `src/components/storefront/sections/{shoppable-video,stories,live-shopping}.tsx`, leurs fichiers `section-schemas/*` | 4D |

Les formulaires produit, collection et page (équipe Catalogue) n'insèrent que `<MetafieldsEditor>` et le sélecteur de modèle, par une modification d'une ligne relue par T5.
