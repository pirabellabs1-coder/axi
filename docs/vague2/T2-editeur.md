# T2 Éditeur de thème (lot 4A) : guide, protocole, recette

> Consolidé dans `docs/GUIDE-BOUTIQUE.md`, `docs/RECETTE.md`, `docs/ARCHITECTURE.md`, `docs/CONSTRUCTEUR-BOUTIQUE.md`, `docs/FEUILLE-DE-ROUTE.md`. Ce fichier reste comme historique.

Périmètre : `src/components/theme-editor/**`, `src/app/app/[storeId]/apparence/**`, plus deux fichiers neufs
`src/lib/theme/alternate-actions.ts` (actions serveur) et `src/lib/theme/editor-plan.ts` (règles de plan pures).
Moteur consommé (T1) : `alternates.ts`, `operations.ts` (clés `product:luxe`, `applyOperations`, `insertSavedSection`,
`bindDynamicSource`…), `quality.ts`, `audience.ts`, `motion.ts`, `dynamic-sources.ts`.
Données consommées (D) : `src/lib/saved-sections/actions.ts`, `src/lib/section-library/{actions,service}.ts`,
`src/lib/metafields/read.ts`.

## 1. Guide commerçant

### Qualité
Colonne de gauche, onglet **Qualité** (score global sur l'onglet). Quatre jauges : accessibilité, performance,
référencement, conversion (score sur 100 + libellé « Bon / À améliorer / Faible »). Cliquer une jauge filtre la liste.
Chaque problème indique sa gravité (Important, À améliorer, Conseil) et propose :
- **Corriger** : la correction est appliquée au brouillon en une seule étape, annulable par Ctrl+Z ou le bouton
  « Annuler » de la notification ;
- **Ouvrir** (nouvel onglet) quand la correction se fait hors du thème (fiche produit, paramètres, collections) ;
- **Voir** : sélectionne la section concernée (ou bascule sur le bon modèle de page).
Les scores sont recalculés 500 ms après la dernière modification.

### Animations
Onglet **Thème** → **Animations** : intensité (Aucune / Sobre / Vive), apparition au défilement, parallaxe, zoom au
survol. Chaque section a un réglage **Animation d'apparition** (Selon le thème, Aucune, Fondu vers le haut, Fondu, Zoom
léger, Glissement). Dans l'aperçu, la case **Réduire les animations** coupe toutes les animations (aperçu seulement).

### Modèles de page alternatifs
Sur Produit, Collection ou Page, le bouton **Modèles** (icône calques, à côté du sélecteur de page) ouvre la gestion :
créer par duplication (« Partir de »), renommer, supprimer (avertissement avec la liste des éléments qui l'utilisent ;
ils retrouvent le modèle par défaut). Le sélecteur de page liste « Produit (par défaut) », « Produit · luxe »…
Dans l'aperçu d'un modèle alternatif, **Aperçu avec** affiche une fiche réelle qui l'utilise. Plan : Business 5 par type,
Scale et Enterprise 20 (plafond global 20).

### Données dynamiques
Sous les champs compatibles (texte, zone de texte, texte enrichi, image, lien, couleur) : **Connecter une donnée**.
Le sélecteur propose les données du produit, de la variante, de la collection, de la page ou de la boutique selon la
page éditée, ainsi que les champs personnalisés marqués visibles en boutique. Chaque choix montre une valeur d'exemple
(premier produit actif). Une donnée connectée s'affiche en carte (« Produit · Matière », exemple) avec **Changer** et
**Déconnecter** (la valeur par défaut du réglage revient).

### Sections enregistrées et bibliothèque
Dans l'inspecteur d'une section : icône **Enregistrer cette section** (nom unique). « Ajouter une section » a trois
onglets : **Sections**, **Mes sections** (insérer, supprimer), **Bibliothèque** (compositions Axi, groupées par
catégorie, badge Premium, cadenas et plan requis). Plans : sections enregistrées Starter 20, Business et plus illimité ;
bibliothèque pour tous, premium à partir de Business (contrôle serveur à l'insertion par D).

### Visible pour (audience)
En bas des réglages d'une section : **Visible pour** = Tout le monde / Seulement si / Sauf si, conditions combinées
(toutes / au moins une) : type de client, ville, provenance, appareil, jours et heures, langue. Business : type de
client seulement ; Scale et plus : tout. Les sections principales (fiche produit, panier…) restent visibles pour tous.
Dans l'aperçu, **Simuler un visiteur** (client, provenance, ville, jour, heure ; appareil = taille d'aperçu).

## 2. Protocole d'aperçu (ajouts lot 4)

| Sens | Message | Effet |
|---|---|---|
| éditeur → aperçu | `{ type: "axi:theme-preview", doc }` | inchangé ; `doc` est désormais la **vue d'aperçu** (voir ci-dessous) |
| éditeur → aperçu | `{ type: "axi:preview-audience", audience: SimulatedAudience \| null }` | audience simulée (`customer`, `source`, `city`, `device`, `locale`, `day` 0-6, `time` HH:MM) ; `null` = règles ignorées. Envoyé à chaque changement et après `axi:preview-ready`. Facultatif pour T3 |

Vue d'aperçu (`src/components/theme-editor/preview-doc.ts`, jamais enregistrée) :
- modèle alternatif édité : `templates[type]` = `alternates[type][suffixe]`, donc l'aperçu le montre même pour un
  produit exemple qui ne l'utilise pas (aucune dépendance au `templateSuffix` côté rendu) ;
- audience simulée : sections exclues rendues `disabled: true` puis `visibility` retirée de toutes les sections (le rendu
  ne réévalue pas avec l'audience réelle du marchand). Sans simulation : toutes les sections visibles ;
- « Réduire les animations » : `settings.motion = { preset: "none", … false }` et `animation: "none"` partout.
Fiche réelle : l'iframe charge `/s/{slug}{path}?preview=1` (`/p/…`, `/collections/…`, `/pages/…`).
Proposition à T1 : ajouter `audience: "axi:preview-audience"` à `PREVIEW_MESSAGES` (constante locale
`PREVIEW_AUDIENCE_MESSAGE` en attendant).

## 3. Architecture
- `editor-target.ts` : cible d'édition `{ template, alternate }`, `targetKey` → clé moteur, `projectTarget` → vue lue par
  l'arbre, l'inspecteur, la fenêtre d'ajout et l'aperçu ; les opérations reçoivent la clé.
- `quality-fix.ts` / `quality-panel.tsx` : `scoreTheme(doc, facts)` sur le document après anti-rebond ;
  `applyIssueFix` = `applyOperations` (document revalidé) → un seul `commit` = une entrée d'historique.
- `motion-panel.tsx`, `audience-panel.tsx`, `dynamic-source-picker.tsx` (`compatibleSources`, `checkBinding` avant
  `bindDynamicSource`), `alternate-picker.tsx`, `saved-sections.tsx` + `saved-sections-bridge.ts`, `preview-toolbar.tsx`.
- `apparence/lot4-data.ts` (serveur) : règles de plan, fiches utilisant un modèle alternatif, définitions publiques de
  champs personnalisés, valeurs d'exemple (données publiques), sections enregistrées, bibliothèque, faits de qualité.
- Serveur :
  - `lot4PlanIssue` (editor-plan.ts), appelé par `parseDocument` de `actions.ts` (UNE ligne ajoutée + import) : à
    l'enregistrement et à la publication, refuse d'augmenter le nombre de modèles alternatifs par type au-delà du plan
    ou d'ajouter des règles d'audience non incluses ; l'existant (plan rétrogradé) est conservé ;
  - `renameAlternateTemplate` / `deleteAlternateTemplate` (alternate-actions.ts) : `theme.manage`, zod, brouillon ET
    thème publié revalidés et modifiés dans la même transaction que les `templateSuffix` des fiches (Product,
    Category, StorePage, BlogPost, filtrés par `storeId`), audit `theme.alternate_renamed` / `theme.alternate_deleted`.
    L'éditeur enregistre d'abord le brouillon, puis repart d'un historique neuf (opération non annulable, annoncée).

## 4. Recette manuelle (chez-aicha, /app/{id}/apparence)
1. Qualité : passer la couleur du texte à `#CFCFCF` → après ~0,5 s la jauge Accessibilité baisse, un problème
   « contraste » apparaît ; « Corriger » le règle ; Ctrl+Z le rétablit ; la jauge suit.
2. Animations : Thème → Animations → Vive ; une section → Zoom léger ; cocher « Réduire les animations » : l'aperçu
   n'anime plus rien.
3. Modèle Produit → Modèles → « Luxe » → Créer : le sélecteur affiche « Produit · luxe », l'aperçu le montre ; masquer
   une section dans ce modèle ne change pas « Produit (par défaut) ». Renommer en « prestige », puis supprimer
   (avertissement). Plan Gratuit : création refusée avec lien vers les plans (et refus serveur si contourné).
4. Produit → bannière → « Connecter une donnée » → Produit · Nom : carte avec exemple ; Déconnecter.
5. Section → Enregistrer cette section → « Bannière test » ; Ajouter une section → Mes sections → insérer ; Bibliothèque.
6. Section → Visible pour → Seulement si → Type de client : fidèle ; Simuler un visiteur : non connecté (section
   masquée dans l'aperçu), puis fidèle (visible).
7. Clavier : tout est atteignable (Tab), fenêtres fermables par Échap, focus rendu au bouton d'origine ; mobile 375 px :
   onglets Sections / Réglages / Aperçu, barre d'aperçu repliée sur plusieurs lignes.

## 5. Écarts connus
- Faits `images` de qualité (poids et dimensions des médias du stockage objet) non chargés : aucune table ne conserve
  ces métadonnées ; les règles correspondantes ne s'appliquent qu'aux data-URL. Corrections IA (`ai_alt`, `ai_seo`) :
  redirigent vers la fiche concernée en attendant l'équipe IA (4B) ; `compress_image` sans écran.
- Modèles alternatifs « article » : gérés côté serveur (renommer / supprimer) mais l'éditeur n'édite pas encore le
  modèle Article (absent d'`EDITABLE_TEMPLATES`, fichier T1).
- Le rendu de l'audience et des sources dynamiques dans la boutique relève de T3.
