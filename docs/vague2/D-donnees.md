# Équipe D (lot 4A, T5) : champs personnalisés, sections enregistrées, bibliothèque

> Consolidé dans `docs/GUIDE-BOUTIQUE.md`, `docs/RECETTE.md`, `docs/ARCHITECTURE.md`, `docs/CONSTRUCTEUR-BOUTIQUE.md`, `docs/FEUILLE-DE-ROUTE.md`. Ce fichier reste comme historique.

Spécification : `docs/specs/LOT-4-personnalisation.md` §4, §5, §20 à §24. Modèles Prisma utilisés tels quels (`MetafieldDefinition`, `MetafieldValue`, `SavedSection`, `SectionLibraryItem`), aucune modification de schéma.

## 1. Guide commerçant

### Champs personnalisés (Paramètres › Champs personnalisés, `/app/{storeId}/parametres/champs`)
- Créez un champ (ex. « Matière », texte sur une ligne) pour les produits, collections, pages, clients, variantes, commandes, la boutique ou les articles.
- 17 types : texte (ligne, paragraphes, mis en forme, liste), nombre entier / décimal, note, dimension, poids, montant, oui / non, date, couleur, lien, image, produit lié, collection liée.
- Validations : longueur ou valeur minimale / maximale, liste de choix, format imposé (expression régulière courte, sans quantificateurs imbriqués).
- « Visible dans la boutique » : le champ peut être affiché par le thème (sources dynamiques). Les champs **clients et commandes restent toujours privés**.
- « Épingler » : le champ est toujours affiché dans le formulaire ; les autres sont repliés sous « Afficher les autres champs ». Ordre réglable (flèches).
- Saisie : bloc « Champs personnalisés » en bas des fiches produit, collection, page et client (bouton « Enregistrer les champs », indépendant du formulaire principal).
- Plans : Starter 10 champs, Business 100, Scale et plus illimité. Après une baisse de plan, les valeurs restent affichées mais ne sont plus modifiables.

### Sections enregistrées et bibliothèque (éditeur de thème, intégration T2)
- « Enregistrer cette section » : nom unique dans la boutique ; réutilisable sur toute page compatible. Starter 20, Business et plus illimité.
- Bibliothèque Axi : compositions prêtes à l'emploi, gratuites pour tous ; les éléments **premium** sont réservés au plan Business et plus.

## 2. Contrats pour T2 (éditeur) : signatures

Toutes les actions renvoient `ActionResult<T>` (`src/lib/action.ts`), capacité `theme.manage`, boutique vérifiée côté serveur.

```ts
// src/lib/saved-sections/actions.ts ("use server")
saveSection(storeId: string, input: { name: string; section: unknown /* SectionInstance du brouillon, ids ignorés */ })
  : Promise<ActionResult<{ id: string; name: string; removedRefs: number }>>   // fieldErrors.name | fieldErrors.section
listSavedSections(storeId: string)
  : Promise<ActionResult<{ items: SavedSectionDTO[]; used: number; limit: number | null; enabled: boolean }>>
getSavedSectionForInsert(storeId: string, id: string)
  : Promise<ActionResult<{ id; name; payload: SectionPayload; removedRefs: number; templates: TemplateId[] }>> // usageCount + 1
renameSavedSection(storeId: string, id: string, name: string): Promise<ActionResult>
deleteSavedSection(storeId: string, id: string): Promise<ActionResult>

// src/lib/section-library/actions.ts ("use server")
listSectionLibrary(storeId: string): Promise<ActionResult<{ items: LibraryItemDTO[] }>>  // locked, lockReason, requiredPlanName
getLibraryItemForInsert(storeId: string, itemId: string)
  : Promise<ActionResult<{ item: LibraryItemDTO; payload: SectionPayload; removedRefs: number }>> // refus si premium / minPlan

// src/lib/saved-sections/payload.ts (pur, importable côté client)
type SectionPayload = Omit<SectionInstance, "id" | "blocks"> & { blocks: Omit<BlockInstance, "id">[] };
clonePayload(payload: SectionPayload, nextId: IdFactory): SectionInstance   // NOUVEAUX ids
toPayload(section: SectionInstance): SectionPayload
compatibleTemplates(type: SectionType): TemplateId[]
validateSectionPayload(raw: unknown): { ok: true; payload } | { ok: false; errors: string[] }
```

Insertion dans le brouillon (côté éditeur) :
```ts
const r = await getSavedSectionForInsert(storeId, id);           // ou getLibraryItemForInsert
if (r.ok) {
  const section = clonePayload(r.data.payload, uniqueIdFactory(doc)); // ids uniques dans le document
  // puis l'opération d'ajout du moteur (T1 : insertSavedSection / addSection à l'index voulu), canAddSection, historique
  if (r.data.removedRefs) toast.info("Certaines références introuvables ont été retirées.");
}
```
Types : `SavedSectionDTO` dans `src/lib/saved-sections/rules.ts`, `LibraryItemDTO` dans `src/lib/section-library/service.ts`. Les éléments verrouillés s'affichent avec le plan requis (`requiredPlanName`) ; le contrôle réel est toujours fait par `getLibraryItemForInsert`.

## 3. Contrats pour T3 (rendu boutique)

```ts
// src/lib/metafields/read.ts (server-only)
getStorefrontMetafields(storeId: string, ownerType: MetafieldOwnerType, ownerIds: string[]): Promise<StorefrontMetafields>
// StorefrontMetafields = { [ownerId]: { ["namespace.key"]: StorefrontMetafield } }
// StorefrontMetafield = { namespace, key, name, type, value, text, url: string | null, image: { url, alt? } | null, validations }
pickStorefrontMetafield(map, ownerId, namespace, key): StorefrontMetafield | undefined
```
- Uniquement les définitions `storefrontVisible` ; `CUSTOMER` et `ORDER` renvoient toujours `{}`.
- 500 propriétaires maximum par appel ; 2 requêtes + 1 par type de référence. Appeler une fois par page avec tous les ids (grille, fiche).
- Références : seulement vers un produit `ACTIVE` ou une collection publiée ; `url` = chemin interne (`/p/{slug}`, `/collections/{slug}`).
- Source dynamique `product.metafields.custom.matiere` : réglage `text` ← `text` ; `image` ← `image` ; `url` ← `url` ; `color` ← `value` ; `richtext` ← `value` (rich_text / multi_line_text). Repasser par `sanitizeFieldValue`.
- Types MetafieldOwner ↔ préfixes de source : product → PRODUCT, variant → VARIANT, collection → COLLECTION, store → STORE (ownerId = storeId), page → PAGE, article → BLOG_POST.

## 4. Import / export CSV produit (module catalogue)

Fonctions pures : `src/lib/metafields/csv.ts` (`mapMetafieldColumns`, `metafieldCsvCells`, `metafieldEntriesFromRow`). Pont serveur : `src/lib/metafields/csv-server.ts`.

Lignes d'intégration à ajouter par le propriétaire du CSV produit :
- Export (`src/app/app/[storeId]/produits/export/route.ts`) : `const mf = await productMetafieldCsv(storeId, productIds);` puis ajouter `...mf.headers` aux en-têtes et `...mf.cells.get(product.id)` à chaque ligne.
- Import (action d'import du catalogue) : une fois par fichier `const mfCtx = await prepareProductMetafieldImport(storeId, ctx.store.currency, ctx.planId, headers);`, puis dans la transaction de chaque produit `const mfRes = await importProductMetafieldRow(tx, mfCtx, product.id, row);` et ajouter `Object.values(mfRes.errors)` aux erreurs de la ligne. `mfCtx.mapping.unknown` liste les colonnes `metafield:` inconnues (à signaler).

Cellules : vide = inchangé ; liste séparée par `|` ; oui/non `true`/`false` ; date `AAAA-MM-JJ` ; « 12,5 cm », « 2 kg » ; montant entier ; produit / collection liés par slug.

## 5. MCP (serveur marchand)
- `set_metafield` (scope `catalog:write`, plan Starter+) : PRODUCT, VARIANT, COLLECTION ; valeur JSON validée par type ; `null` efface ; audit `api.metafield.values.update`.
- `list_saved_sections` (scopes `store:read` ou `theme:write`) : nom, type, modèles compatibles, usage, limite du plan.

## 6. Console plateforme `/admin/bibliotheque`
- Permission `settings.manage` (lecture seule sinon). Audit : `admin.library.create | update | publish | unpublish | reorder | preview | delete`.
- Création depuis un JSON de section : validé par le moteur ; **aucun identifiant** de produit / collection ; images https publiques uniquement (pas de média de boutique, pas de data-URL). Revalidé à la publication.
- Élément premium : plan effectif minimal Business (même si `minPlan` est plus bas).
- Aperçu : image téléversée (2 Mo) dans le stockage objet sous `stores/axilibrary/…`.
- Seed : `seedLibrary(db)` (`src/lib/section-library/seed.ts`) ajoute 6 éléments (4 gratuits dont 1 Starter, 2 premium), idempotent par slug.

## 7. Sécurité et architecture
- Un seul chemin d'écriture des valeurs : `writeOwnerMetafields` (éditeur, MCP, CSV). Tout ou rien par élément. Propriétaire revérifié dans la boutique, définition de la boutique ET du même type d'élément, références de la même boutique, image https ou média de la boutique.
- Quotas sans course : verrou consultatif par boutique (`pg_advisory_xact_lock`) pour la création de définitions et de sections enregistrées.
- Expressions régulières : 100 caractères, ni références arrière, ni assertions, ni quantificateurs imbriqués ou alternatives quantifiées ; valeurs testées ≤ 255 caractères.
- Suppression d'une définition : valeurs supprimées (cascade) ; les sources dynamiques retombent sur leur défaut.
- Capacités : définitions `theme.manage` ; valeurs selon l'élément (produit / variante / collection `products.manage`, client `customers.manage`, commande `orders.manage`, page / boutique / article `store.settings`).

## 8. Recette
1. Paramètres › Champs personnalisés : créer « Matière » (Produits, texte sur une ligne, visible, épinglé).
2. Produit « Robe wax Abomey » de Dantokpa Mode : bloc Champs personnalisés, saisir « Wax hollandais », Enregistrer : toast, valeur conservée au rechargement.
3. Saisir une couleur invalide sur un champ couleur : message sous le champ, rien n'est enregistré.
4. Compte Starter : créer un 11e champ : refus avec le message de limite.
5. Champ client : la case « Visible dans la boutique » est absente (champ privé).
6. `/admin/bibliotheque` (admin avec double authentification) : les 6 éléments de démonstration (7 avec « nos-engagements » du seed complet), publication, ordre, aperçu.
7. Éditeur (après intégration T2) : enregistrer une section, l'insérer sur une autre page : identifiants différents.

## 9. Points ouverts
- Pas de lien « Champs personnalisés » dans la page Paramètres (fichier hors périmètre) : accès par le bloc des fiches (« Gérer les champs ») et par l'URL ; une ligne à ajouter lors de la consolidation.
- `SavedSection.previewUrl` n'est pas alimenté (pas d'aperçu image généré côté éditeur).
- Modification des validations d'un champ : les valeurs existantes ne sont pas revalidées en masse (elles le sont à la prochaine modification).
