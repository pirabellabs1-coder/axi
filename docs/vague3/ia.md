# Équipe IA — lot 4B (vague 3)

Kit de marque automatique (§7), édition directe dans l'aperçu (§8), boutique générée par l'IA (§9),
assistant de design conversationnel (§10). Référence : `docs/specs/LOT-4-personnalisation.md`.

## 1. Kit de marque (§7) — gratuit, sans crédit

| Fichier | Rôle |
|---|---|
| `src/lib/brand-kit/extract.ts` | Pur : pixels utiles (transparents et quasi blancs ignorés), quantification « median cut » déterministe, palette hex |
| `src/lib/brand-kit/client.ts` | `"use client"` : lecture du logo par canvas (réduit à 128 px), aucune image envoyée au serveur pour analyse |
| `src/lib/brand-kit/palette.ts` | Pur : HSL, `pickPrimary` / `pickAccent` / `tintedNeutrals`, correction AA par ajustement de luminance, `buildBrandKit`, `contrastReport`, `applyBrandKit`, `brandKitSchema`, `parseBrandKit` |
| `src/lib/brand-kit/actions.ts` | `saveBrandKit` / `getBrandKit` (capacité `theme.manage`, logo vérifié par `checkImageWrite`, audit `brand.kit_saved`) |

- Forme stockée dans `Store.brandKit` : `{ logoUrl, palette[], primary, accent, fontPair, voice: { tone, formal }, colors, schemes, updatedAt }`.
- Le serveur **reconstruit** le kit à partir des couleurs reçues (`buildBrandKit`) : le client ne décide jamais de la palette finale.
- Seuils : 4,5:1 (texte) et 3:1 (boutons, composants). `usableButtonColor` garantit en plus qu'une couleur de bouton
  peut porter un texte lisible. `parseBrandKit` recorrige un kit ancien ou modifié à la main.
- Schémas produits : `marque` et `sombre` (la boutique reste en thème clair ; le sombre est un schéma de section).
- Réutilisation : `compileBrief` (§9) applique le kit avant la direction artistique ; `applyBrandKit(settings, kit)` est
  disponible pour les campagnes et les visuels de statut (§15).

## 2. Édition directe dans l'aperçu (§8)

- Protocole étendu dans `src/lib/theme-engine/preview-messages.ts` (ajout additif) :
  `axi:inline-mode`, `axi:inline-change`, `axi:inline-reject`, `axi:image-drop`, `axi:section-action`,
  avec constructeurs et parseurs défensifs (`parseInlineTarget`, `parseInlineChange`, `parseImageDrop`,
  `parseSectionAction`, `isAcceptedInlineImage`) : identifiants `^[\w-]{1,64}$`, valeur ≤ 5 000 caractères,
  `File` contrôlé (jpeg/png/webp/avif, ≤ 5 Mo, revérifié par le serveur au téléversement).
- Côté aperçu : `src/components/storefront/inline-edit.tsx` + `inline-edit-targets.ts`, montés par `live-preview.tsx`.
  Le marquage `data-edit` / `data-edit-kind` est produit par `editAttrs` (T1) **en aperçu uniquement** : les cibles sont
  calculées depuis le document et `SECTION_SCHEMAS`, puis associées à l'élément du DOM qui affiche la valeur.
  Aucun composant de section n'a été modifié.
- Comportement : `contenteditable="plaintext-only"` au clic (ou F2 au clavier), Entrée valide, Échap annule, la perte de
  focus valide ; phase `input` à chaque frappe et `commit` à la validation. `richtext` et champs liés à une source
  dynamique ne sont pas éditables en place (bulle d'explication). Dépôt d'image sur une section (contour « Déposer pour
  remplacer »). Barre d'actions flottante (monter, descendre, dupliquer, masquer, ajouter après, supprimer).
- Côté éditeur : `src/components/theme-editor/inline-check.ts` (pur) revalide la valeur contre le schéma du champ
  (type, `maxLength`, source dynamique) ; `inline-bridge.ts` applique `updateSectionSetting` / `updateBlockSetting`
  (une entrée d'historique par champ), téléverse l'image déposée (compression navigateur puis `/api/stores/[id]/media`,
  `alt` = titre de la section) et confirme la suppression par une boîte de dialogue.
- Interrupteur « Modifier dans l'aperçu » dans la barre de l'aperçu (désactivé par défaut, plan `inlineEditing`).
- Accessibilité : contour de focus visible, `aria-label` « Modifier : <libellé> », alternative clavier F2,
  boutons de la barre ≥ 44 px.

## 3. Boutique générée par l'IA (§9)

`src/lib/ai/design/` :

| Fichier | Rôle |
|---|---|
| `schema.ts` | `STORE_DESIGN_BRIEF_SCHEMA` (JSON Schema, 3 directions) + schéma zod, liste blanche `ALLOWED_HOME_SECTIONS`, blocs produit |
| `prompts.ts` | `DESIGN_SYSTEM` (directeur artistique, inventions interdites), `buildDesignPrompt` (données en balises neutralisées), `designModel()` = `AI_MODEL_DESIGN` sinon `AI_MODEL`, prompts de l'assistant |
| `guards.ts` | `cleanCopy` (tidy + stripForbidden), `filterSections` (liste blanche, faux avis), `ensureAccessibleColors`, `colorsAreAccessible` |
| `compile.ts` | `compileBrief(direction, data)` déterministe : préréglage du secteur → kit de marque → direction → sections par préréglage + `COPY_MAP` → indices résolus en identifiants réels → validation avec repli sûr |
| `store-data.ts` | Données réelles (nom, slogan, 20 produits, collections, paiements, zones, horaires, avis, kit) |
| `credits.ts` | Coûts (10 / 15 / 4 / 1 / 2), `grantOnboardingGift` (20 crédits, 30 jours, une fois par boutique), débit limité 5/h |
| `fake.ts` | Client IA simulé (`AI_FAKE=1` **et** hors production) |
| `actions.ts` | `getDesignStatus`, `generateStoreDesign`, `regenerateDirection`, `chooseDirection`, `runDesignAssistant` |
| `jobs.ts` | `ai.generation_purge` : supprime les `ThemeGeneration` expirées (7 jours) |

- L'IA produit un **brief**, jamais un document. Tout le document vient de `compileBrief`.
- Garde-fous : contraste AA garanti, textes filtrés (prix, promesse, délai, garantie, promotion),
  **aucun faux témoignage ni faux avis** (sans avis réels les sections sont retirées ; avec avis réels,
  « témoignages » devient la section « Avis clients vérifiés » alimentée par la base), liste blanche de sections,
  polices limitées à `FontId`, validation finale (`validateThemeDocument`) avec retrait des sections fautives
  puis repli « préréglage du secteur + palette ».
- Écran `/app/[storeId]/apparence/generer` : kit de marque, formulaire (phrase ≤ 500, audience, mots interdits,
  6 photos réduites à 1 024 px), puis **3 aperçus côte à côte** (iframes `LivePreview` alimentées par
  `axi:theme-preview`) — rien n'est enregistré. « Choisir » écrit le brouillon après une `ThemeVersion`
  « Avant génération IA » (`publishedAt: null`) ; **jamais de publication automatique**.
- `ThemeGeneration` conserve l'entrée, les 3 candidats compilés, le choix, le modèle, les jetons et les crédits.
- Audit : `ai.store_design` (ok, modèle, crédits, jetons, photos, replis), `ai.store_design_chosen`.

## 4. Assistant de design (§10)

- `src/lib/ai/design/assistant.ts` (pur) : `parseAssistantResponse`, `sanitizeAssistantOperations`
  (textes repassés par les garde-fous), `ASSISTANT_OPERATIONS` (liste blanche : ni modèles alternatifs, ni sections
  enregistrées, ni sources dynamiques), `applyAssistantOperations` (≤ 20 opérations, revalidation, tout ou rien).
- `runDesignAssistant` : 2 crédits, essaie les opérations côté serveur et ne renvoie que des opérations applicables ;
  l'éditeur les applique au brouillon en **une entrée d'historique** (bouton « Annuler » dans le message de succès).
- Refus explicite hors cadre (code, script, contenu trompeur, faux avis, promesse) : aucune opération et
  **remboursement des 2 crédits** (choix d'implémentation, plus favorable que la spec).
- UI : `src/components/theme-editor/design-assistant.tsx`, en bas de la colonne gauche de l'éditeur,
  avec le lien « Générer la boutique avec l'IA ».

## 5. Tests

| Test | Contenu |
|---|---|
| `tests/brand-palette.test.ts` | 15 cas : pixels ignorés, median cut déterministe, primaire / accent / neutres, AA après correction, kit déterministe, lecture défensive |
| `tests/preview-messages-inline.test.ts` | 23 cas : parseurs défensifs des 5 messages, `File` refusé, `editAttrs` hors aperçu, cibles éditables, contrôle éditeur de la valeur |
| `tests/design-compile.test.ts` | 17 cas dont la propriété « 200 briefs valides → 200 documents valides » (graine fixe), indices hors bornes, sections interdites, AA garanti, blocs produit réordonnés |
| `tests/design-guards.test.ts` | 23 cas : prix / promesses / promotions retirés, liste blanche, faux avis, AA idempotent, liste blanche des opérations de l'assistant |
| `tests/design-credits.test.ts` | 9 cas sur la base locale (client simulé) : offre unique de 20 crédits, débit 10, remboursement sur sortie invalide, brouillon + version de sauvegarde sans publication, isolation entre boutiques, assistant 2 crédits, refus gratuit, solde insuffisant |

Client simulé : `AI_FAKE=1` n'a d'effet que si `NODE_ENV !== "production"` (`isFakeAi`, point d'entrée unique).

## 5 bis. Vérification réelle (http://localhost:3000, client simulé)

Boutique de démonstration « Chez Aïcha Pâtisserie » (`cmv2hxxra0002ibks5nrleed0`), compte demo@axi.africa.
Captures dans `docs/captures/vague3-ia-*.png`.

| Étape | Résultat |
|---|---|
| Kit de marque | Logo importé, couleurs extraites dans le navigateur, palette affichée, **8 contrôles AA tous au vert** (16,16:1 / 4,67:1 / 16,95:1 / 6,65:1 / 6,34:1 / 3,15:1 / 6,65:1 / 15,67:1), « Kit de marque enregistré » → `Store.brandKit` écrit (primary `#326744`, accent `#C76BC6`, schémas `marque` et `sombre`) |
| Génération | 3 directions, 3 aperçus côte à côte (3 iframes de la boutique), noms et justifications ; audit `ai.store_design` (ok, 10 crédits, simulé) |
| Choix | `ThemeVersion` « Avant génération IA » (`publishedAt: null`) puis brouillon écrit ; `themeDoc` (publié) inchangé ; `ThemeGeneration.chosenIndex = 1` |
| Sections produites | hero-banner, collection-list, featured-collection, image-with-text, faq, whatsapp-cta, reviews (la boutique a de vrais avis ; sinon la section est refusée) |
| Édition en place | Titre du héros modifié dans l'aperçu (« Titre modifie en place »), répercuté dans l'arborescence et enregistré dans le brouillon ; barre d'actions flottante visible |
| Dépôt d'image | `POST /api/stores/…/media` → 201, toast « Image remplacée », réglage `image` de la section = `/media/stores/…/….webp` |
| Assistant | Instruction « Rends l'accueil plus luxe » → opérations appliquées au brouillon, message d'explication, 2 crédits |

Corrections issues de cette recette : mise en attente du document pendant la frappe (sinon le curseur sautait),
marquage rejoué (temporisations + `MutationObserver`) quand les sections arrivent après le document,
et `grantOnboardingGiftSafe` (transaction 15 s, erreur transitoire non bloquante pour la page).

## 6. Variables d'environnement

| Variable | Rôle |
|---|---|
| `AI_MODEL_DESIGN` | Modèle de direction artistique et d'assistant ; défaut `AI_MODEL` |
| `AI_FAKE` | `1` = client IA simulé (développement et tests uniquement) |

`AI_FAKE=1` a été ajouté au `.env` local (serveur de développement) pour la recette, la clé `ANTHROPIC_API_KEY`
étant vide sur cette machine. À retirer dès qu'une clé réelle est configurée ; sans effet en production.

## 7. Écarts et points d'attention

- **Marquage sans toucher aux composants de section** : les attributs `data-edit` sont posés par une passe cliente
  (document + `SECTION_SCHEMAS` + correspondance du texte affiché) au lieu d'appels `editAttrs` dans chaque section
  (fichiers de l'équipe Rendu, hors périmètre de cette vague). Conséquence : un texte transformé à l'affichage
  (ex. mis en majuscules par CSS reste détecté, mais un texte tronqué par le composant ne l'est pas) n'est pas
  éditable en place ; il reste modifiable dans l'inspecteur. Si l'équipe Rendu ajoute les appels `editAttrs`,
  ils sont honorés tels quels (même format d'attribut).
- `regenerateDirection` demande 3 nouvelles directions au modèle et n'en retient qu'une (4 crédits) ;
  `rewriteSectionCopy` (1 crédit) n'est pas livré.
- Les 20 crédits offerts sont accordés **paresseusement** (ouverture de l'écran de génération ou appel de
  `getDesignStatus` / `generateStoreDesign`) et non à la création de la boutique : aucun fichier d'onboarding
  (propriété d'une autre équipe) n'a été modifié. Idempotent par verrou consultatif + `reason: "onboarding_gift"`.
- `PACK_AI_1000` n'a pas été ouvert au plan Starter (`src/config/plans.ts`, zone partagée) : à faire par l'équipe
  qui possède les plans (§22).
- Pas d'entrée de menu dans `src/components/app/app-shell.tsx` : l'écran de génération est accessible depuis
  l'éditeur (lien « Générer la boutique avec l'IA »). Ligne à insérer si souhaité :
  `{ href: \`/app/\${storeId}/apparence/generer\`, label: "Générer avec l'IA" }`.
- Outils MCP `generate_store_design` / `apply_theme_operations` : non livrés (zone partagée `src/lib/mcp/**`).
