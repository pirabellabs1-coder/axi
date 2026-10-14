# T3 Rendu boutique (lot 4A) : animations, modèles alternatifs, sources dynamiques, audiences, nouvelles sections

> Consolidé dans `docs/GUIDE-BOUTIQUE.md`, `docs/RECETTE.md`, `docs/ARCHITECTURE.md`, `docs/CONSTRUCTEUR-BOUTIQUE.md`, `docs/FEUILLE-DE-ROUTE.md`. Ce fichier reste comme historique.

Équipe T3, vague 2 (11/10/2026). Contrats du moteur : `docs/vague2/T1-moteur.md`. Spécification : `docs/specs/LOT-4-personnalisation.md` §2, §4, §5, §6, §12.

## 1. Ce qui est livré

| Sujet | Où | Comportement |
|---|---|---|
| Animations (§2) | `store-frame.tsx`, `ui.tsx` (`sectionAnimAttrs`, `animItem`), `motion-observer.tsx`, `store-styles.tsx` (`MOTION_CSS` de T1) | Racine : `motionRootAttrs`. Section : `data-anim` (+ `data-anim-self`, ou éléments `data-anim-item` 6 au maximum). Jamais sur la première section rendue ni sur une section de modèle (fiche, collection, page, panier) : l'élément du LCP n'est jamais masqué. Un seul composant client `MotionObserver` (IntersectionObserver + MutationObserver, aucun écouteur de défilement) ; il marque d'abord `data-in-view` ce qui est déjà à l'écran, puis pose `data-motion-ready` : rien ne disparaît puis réapparaît. Sans JavaScript, rien n'est masqué. Parallaxe : `data-parallax` sur l'image de la bannière (CSS `animation-timeline: view()` si supporté). Zoom au survol : `data-motion-hover` (cartes) et `data-hover-zoom` (look). |
| Désactivation | `lot4-data.ts` (`requestMotionEnv`), `live-preview.tsx` | En-tête `Save-Data: on`, cookie `axi_lite=1`, option d'aperçu « Réduire les animations » (`axi:preview-options` `{ reduceMotion: true }`), préréglage « Aucune » : pas de `data-motion`, aucun `data-anim`, pas de `MotionObserver`, et les animations décoratives existantes (montée, fondu, bandeau défilant) sont coupées. `prefers-reduced-motion: reduce` : tout le CSS d'animation est sous `no-preference`. |
| Modèles alternatifs (§6) | `storefront-view.tsx`, `lot4-data.ts` (`loadTemplateSuffix`), `template-renderer.tsx` | Suffixe lu sur `Product` / `Category` / `StorePage.templateSuffix`, rendu `resolveTemplate(doc, type, suffix)` (suffixe inconnu = modèle par défaut). Les réglages lus par `loadRenderData` (avis, référence, produits par page) viennent du modèle réellement rendu. Aperçu : `?template=product:luxe` (clé de modèle de T1). Aucune modification de `resolve.ts`. |
| Sources dynamiques (§5) | `dynamic-context.ts`, `template-renderer.tsx`, `lot4-data.ts` (`loadRenderMetafields`) | `resolveSection` (T1) sur chaque section avant son composant ; `hidden` (réglage `hide_if_empty` + source vide) = section non rendue. Contexte : produit, variante (demandée ou première), collection, boutique, page ; références résolues vers `/s/{slug}/p/…` ou `/collections/…`. Champs personnalisés : `getStorefrontMetafields` (équipe D), définitions `storefrontVisible` uniquement, `RenderData.metafields`. |
| Audiences (§12) | `lot4-data.ts` (`requestAudience`), `template-renderer.tsx` | `evaluateVisibility` (T1) côté serveur. Contexte : session acheteur (`getBuyer` : segments nouveau / récurrent / fidèle / points, ville de l'adresse par défaut), cookie `axi_city`, en-tête `x-vercel-ip-city`, cookie `axi_src`, `Accept-Language`, appareil (`Sec-CH-UA-Mobile`, sinon agent). Robots et agent vide : audience par défaut. Sans contexte : visiteur anonyme en accès direct. Jamais de prix masqué ou modifié. |
| Audience simulée (aperçu) | `preview-audience.ts`, `live-preview.tsx` | Message `{ type: "axi:preview-audience", audience: { city?, customer?, source?, device?, locale? } \| null }` (même origine, fenêtre parente), lecture défensive. |
| Nouvelles sections | `sections/{product-specs,hero-split-video,lookbook,before-after,size-guide,comparison-table,marquee}.tsx`, schémas `section-schemas/<type>.ts` + `_t3-sections.ts` | Voir §2. Enregistrées par une ligne dans `SectionType`, une ligne dans l'agrégateur (`...T3_SECTION_SCHEMAS`) et le registre de rendu. |
| Bloc « Champ personnalisé » | `product/product-main.tsx` (cas `metafield`), `sections/main-collection.tsx` (`MetafieldLines`) | Libellé + valeur (texte, en général liée par « Connecter une donnée ») ; valeur vide = rien. **Schéma à ajouter par T1**, voir §4. |
| Devise d'affichage | `store-header.tsx`, `store-frame.tsx`, `storefront-view.tsx` | `CurrencyPicker` (équipe C) dans les outils de l'en-tête, données `getCurrencyPickerData` (serveur), rien si la boutique n'a qu'une devise ; absent de l'aperçu et des cadres réduits (commande). |
| Logo | `store-header.tsx` | Plafond de rendu aligné sur la validation (300 px), 45 vw maximum sur mobile. |

## 2. Sections (guide commerçant)
- **Caractéristiques du produit** (`product-specs`, modèle produit) : en mode automatique, tous les champs personnalisés du produit visibles sur la boutique (triés par nom), puis vos lignes (libellé + valeur fixe ou donnée connectée). Ligne vide omise ; section absente s'il ne reste rien ; « Masquer la section si une donnée connectée est vide » (`hide_if_empty`). Tableau ou grille.
- **Vidéo et texte** (`hero-split-video`) : fichier MP4/WebM https direct (pas YouTube), sans son, en boucle, bouton Pause/Lecture. L'image de couverture est indispensable : elle s'affiche d'abord (et reste seule en mode économie, sous Save-Data, ou si le visiteur réduit les animations). La vidéo n'est téléchargée que lorsque la section est visible.
- **Look à acheter** (`lookbook`) : une photo, jusqu'à 6 repères numérotés vers des produits, et la liste des produits avec leur prix à côté. Sans produit choisi : section masquée.
- **Avant, après** (`before-after`) : deux images au même cadrage, curseur utilisable au clavier (flèches) et annoncé par les lecteurs d'écran.
- **Guide des tailles** (`size-guide`) : jusqu'à 4 mesures, 12 tailles, cm ou pouces, éventuellement replié.
- **Tableau comparatif** (`comparison-table`) : 2 ou 3 colonnes, « oui » / « non » affichés en coche / croix (lisibles sans la couleur). N'affirmez que ce que vous pouvez prouver.
- **Bandeau défilant** (`marquee`) : messages courts ; arrêté au survol et au focus, immobile si le visiteur réduit les animations. Un seul par page conseillé.

## 3. Scénarios de recette
1. Accueil d'une boutique : sections sous la ligne de flottaison qui apparaissent en fondu au défilement ; bannière jamais animée. `curl -H "Save-Data: on"` ou cookie `axi_lite=1` : ni `data-motion` sur `[data-store]`, ni `data-anim` sur les sections.
2. Préférence système « Réduire les animations » : rien ne bouge (y compris le bandeau défilant).
3. Produit avec `templateSuffix = "luxe"` et `alternates.product.luxe` publié : la fiche utilise ce modèle ; suffixe supprimé du thème : modèle par défaut, sans erreur.
4. Champ personnalisé « Matière » (produit, visible sur la boutique) + section Caractéristiques : la valeur s'affiche ; définition passée à « non visible » : elle disparaît.
5. Section visible pour « clients fidèles » : invisible en navigation anonyme et pour Googlebot ; visible connecté avec 3 commandes ; dans l'aperçu, avec `axi:preview-audience` `{ customer: ["loyal"] }`.
6. Clavier : curseur avant/après (flèches), repères du look hors tabulation (la liste porte les liens), tableaux défilants focalisables, bouton Pause de la vidéo.

Captures : `docs/captures/vague2-rendu-*.png` (375 et 1440 px).

## 4. Demandes à T1 (fichiers du moteur, non modifiés par T3)
- Bloc `metafield` à déclarer dans `section-schemas/main-product.ts` (une ligne dans `blocks`) et `section-schemas/main-collection.ts` (`blocks: [...]`), puis régénérer l'instantané `tests/fixtures/section-schemas.snapshot.json` (le test exige des schémas du cœur identiques, d'où l'abstention de T3) :
  `{ type: "metafield", name: "Champ personnalisé", settings: [{ type: "text", id: "label", label: "Libellé", default: "", maxLength: 60 }, { type: "textarea", id: "value", label: "Valeur", default: "", maxLength: 500, info: "Connectez un champ personnalisé (« Connecter une donnée »). Rien ne s'affiche si la valeur est vide." }] }`
  Le rendu est déjà prêt dans les deux sections.
- Protocole d'aperçu : ajouter à `preview-messages.ts` les constantes `axi:preview-audience` et l'option `reduceMotion` d'`axi:preview-options` (lecture actuelle : `src/components/storefront/preview-audience.ts`).
- Logo : le sanitize (`theme-doc.ts`) borne `logoWidth` à 260 alors que la validation et l'éditeur vont à 300.
- Réglage d'en-tête « Afficher le sélecteur de devise » : non ajouté (champ de `GlobalSettings.header` et sanitize à créer par T1) ; aujourd'hui le sélecteur s'affiche dès que la boutique propose au moins deux devises.

## 5. Tests
`tests/t3-storefront-render.test.ts` (rendu réel de `TemplateRenderer`) : enregistrement des 7 types, `product-specs` (automatique, manuel, masquage), sources dynamiques (résolution, champ absent, champ non public jamais exposé, `hide_if_empty`, références), audience (fidèles, robots, défaut, message d'aperçu), animations (Save-Data, mode économie, aperçu réduit, première section et sections de modèle jamais animées), modèles alternatifs, données des sections premium (guide, comparatif, bandeau, vidéo, avant/après).
