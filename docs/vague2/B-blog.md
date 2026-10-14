# Vague 2 · Équipe B : blog de la boutique (lot 2 D)

> Consolidé dans `docs/GUIDE-BOUTIQUE.md`, `docs/RECETTE.md`, `docs/ARCHITECTURE.md`, `docs/CONSTRUCTEUR-BOUTIQUE.md`, `docs/FEUILLE-DE-ROUTE.md`. Ce fichier reste comme historique.

Référence : `docs/specs/LOT-2-international-contenu.md` §3 (F7) et §5 (`BlogCategory`, `BlogPost`). Ce document sera consolidé dans le guide boutique, la recette et l'architecture à la clôture de la vague.

## 1. Guide commerçant

**Où ?** Menu de gauche, **Blog** (propriétaire et gérant). Inclus à partir du plan **Starter** (20 articles, tous statuts confondus), illimité à partir de **Business**. Sur le plan Gratuit, l'écran explique ce que le blog apporte et propose le changement de plan.

**Écrire un article** (`Blog` > `Nouvel article`) :
- titre, image de couverture (téléversée, compressée dans le navigateur, avec sa description pour l'accessibilité) ;
- contenu en mise en forme simple : `## intertitre`, `**gras**`, `*italique*`, `- liste`, `> citation`, `[lien](https://…)` ou lien vers la boutique `[voir](/catalogue)`, images insérées avec le bouton « Insérer une image » (une image par ligne) ;
- onglet **Aperçu** pour relire le rendu ; temps de lecture calculé automatiquement ;
- **Organisation** : résumé (affiché sur les cartes), catégorie, étiquettes (séparées par des virgules), auteur ;
- **Référencement** : adresse de l'article (si elle est déjà prise, un suffixe `-2` est ajouté), titre et description pour Google, avec un aperçu du résultat de recherche.

**Publier** : choisir *Brouillon*, *Publier maintenant*, *Programmer* (date et heure dans le fuseau de la boutique, au moins 2 minutes et au plus un an dans le futur) ou *Archiver*. Un article programmé apparaît tout seul à l'heure dite, sans action de votre part. Depuis la liste, le menu « … » publie, repasse en brouillon ou archive ; la corbeille supprime définitivement (confirmation).

**Aperçu d'un article non publié** : ouvert depuis Axi (« Aperçu »), l'article s'affiche sur la boutique avec un bandeau « Aperçu : article programmé… » visible des seuls membres. Les clients reçoivent une page introuvable.

**Catégories** (`Blog` > `Catégories`) : nom, adresse, présentation (en tête de la page de la catégorie), ordre (flèches). Supprimer une catégorie laisse ses articles publiés, sans catégorie.

**Rédiger un brouillon avec l'IA** (plan Business, 3 crédits IA) : indiquez un sujet et, si vous voulez, vos notes. L'assistant remplit titre, résumé, contenu, étiquettes et référencement ; rien n'est enregistré ni publié avant votre relecture. Il n'écrit jamais de prix, de délai, de promotion ni de garantie (phrases retirées automatiquement). En cas d'échec, les crédits ne sont pas débités. « Rétablir le texte précédent » annule la proposition.

**Sur la boutique** :
- `/blog` : liste paginée, filtre par catégorie (pastilles), filtre par étiquette (`?etiquette=`), premier article à la une, lien vers le flux RSS ;
- `/blog/categorie/{adresse}` : articles d'une catégorie ;
- `/blog/{adresse}` : l'article (fil d'Ariane, partage WhatsApp, Facebook, copie du lien, articles liés) ;
- `/blog/rss.xml` : flux RSS (30 derniers articles) ;
- `/sitemap.xml` de la boutique : accueil, catalogue, collections, produits, pages et blog.

**Apparence** (éditeur de thème) :
- modèle **Blog** : section obligatoire « Liste des articles » (titre, présentation, filtre, article à la une, grille ou liste, 2 ou 3 colonnes, articles par page, éléments des cartes) ;
- modèle **Article** : section obligatoire « Article » avec blocs réordonnables *Titre*, *Date et auteur*, *Image de couverture*, *Contenu*, *Partager*, *Articles liés* ;
- section **« Derniers articles »** ajoutable à l'accueil et aux autres modèles : 2 à 12 articles, catégorie (son adresse, vide = toutes), disposition grille / à la une / liste, colonnes, image et format, extrait, date, catégorie, lien « Tous les articles ». Masquée pour les clients tant qu'aucun article n'est publié.

## 2. Architecture

| Fichier | Rôle |
|---|---|
| `src/lib/blog/constants.ts` | Statuts, libellés, limites de longueur, coût IA (3), adresses réservées |
| `src/lib/blog/visibility.ts` | Règle de visibilité (pure) : `PUBLISHED`, ou `SCHEDULED` avec `publishedAt ≤ maintenant` ; `publicPostWhere` (Prisma), `resolvePublication` (intention → statut et date), conversions fuseau de la boutique |
| `src/lib/blog/slug.ts`, `tags.ts` | Adresses (suffixe `-2`…, adresses réservées `categorie`, `rss`…), étiquettes |
| `src/lib/blog/markdown.tsx` | Rendu React du Markdown limité (même grammaire que les pages + images, citations, liens internes préfixés), texte brut, temps de lecture, extrait automatique |
| `src/lib/blog/markdown-guard.ts` | Validation à l'écriture : `isSafeMarkdown` du moteur de thème + images https ou médias stockés, seules sur leur ligne |
| `src/lib/blog/service.ts` | Lecture serveur filtrée par `storeId`, plan (`features.blog`, `limits.blogPosts`), adresses uniques |
| `src/lib/blog/actions.ts` | `savePost`, `setPostStatus`, `deletePost`, `saveCategory`, `deleteCategory`, `moveCategory`, `draftPostWithAi` |
| `src/lib/blog/ai.ts` | Prompt (données balisées `<sujet>`), analyse et garde-fous de la sortie (réutilise `stripForbidden` et `tidy` de `src/lib/ai/parse.ts`) |
| `src/lib/blog/render-types.ts`, `render-data.ts` | `RenderData.blog` (clé facultative), données d'exemple de l'aperçu, chargement pour les routes et pour la vue générique |
| `src/lib/blog/seo.ts` | JSON-LD `BlogPosting` et `BreadcrumbList`, RSS 2.0, sitemap XML |
| `src/lib/blog/section-schemas.ts`, `section-renderers.ts` | Schémas et composants des 3 sections, ajoutés aux registres du moteur |
| `src/components/storefront/sections/{blog-posts,main-blog,main-article}.tsx` | Rendu (composants purs, aussi rendus dans l'aperçu client de l'éditeur) |
| `src/app/s/[slug]/blog/**`, `src/app/s/[slug]/sitemap.xml/route.ts` | Routes publiques (cadre et thème de la boutique, thème clair forcé) |
| `src/app/app/[storeId]/blog/**` | Liste (filtres par statut), éditeur avec aperçu, catégories |
| `src/lib/mcp/merchant/blog.ts` | Outils MCP |

**Programmation sans tâche** : aucune écriture à l'heure de publication. Toutes les lectures publiques (liste, article, RSS, sitemap, section) passent par `publicPostWhere(storeId, now)`. Le statut affiché en espace marchand est `effectiveStatus` (un programmé échu apparaît « Publié »).

**Thème** : `SectionType` gagne `blog-posts`, `main-blog`, `main-article` (une ligne dans `types.ts`). Les modèles `blog` et `article` (déjà livrés par S2) reçoivent automatiquement leur section principale via `lateMainSections` dès que le schéma existe ; les documents antérieurs sont complétés au sanitize. Modèle alternatif d'article : `BlogPost.templateSuffix` → `doc.alternates.article[suffix]` (pas encore de sélecteur dans l'éditeur d'article).

**Données de rendu** : `withBlogData` (appelée par `StorefrontView`) ne fait aucune requête si le modèle n'a pas de section « Derniers articles » et qu'il ne s'agit pas d'un aperçu. En aperçu de l'éditeur (`?preview=1&template=blog|article`), elle charge les vrais articles, ou des contenus d'exemple neutres s'il n'y en a aucun.

## 3. Sécurité
- Isolation : chaque requête filtrée par `storeId` ; catégorie, article et médias d'une autre boutique refusés (`checkImageWrite`).
- Markdown : aucun HTML, aucun `dangerouslySetInnerHTML` ; liens https ou chemins internes (`safeLink`), liens externes en `noopener noreferrer nofollow` ; images https ou médias de la boutique, jamais `data:` ni `http:`.
- JSON-LD sérialisé avec échappement de `<`, `>`, `&`, U+2028/2029 ; RSS et sitemap échappés (`xmlEscape`).
- Aperçu des articles non publics réservé aux membres actifs (`canPreviewStore`), `noindex` ; pages filtrées par étiquette en `noindex`.
- Capacité `store.settings` ; plan contrôlé côté serveur à chaque création ; suppression permise même après un passage au plan Gratuit (nettoyage).
- IA : plan Business (`aiAssistant`), débit limité (30 / 10 min par boutique, partagé avec les descriptions), crédits débités en transaction puis remboursés en cas d'échec, sortie filtrée, audit `ai.blog_draft`.
- Audit : `blog.post.created|updated|published|scheduled|draft|archived|deleted`, `blog.category.created|updated|deleted`, `api.blog.post.created` (MCP).

## 4. MCP (scope `content:write`, Starter+)
- `list_blog_posts` (lecture) : statut effectif, date, catégorie, étiquettes, URL publique ; filtre `status`, `limit`.
- `create_blog_post` : crée **uniquement un brouillon** (jamais publié), Markdown limité validé, pas d'image, catégorie par adresse, quota du plan, audit `api.blog.post.created`. Rôle du membre vérifié (`store.settings`).

## 5. Scénarios de recette
1. Plan Gratuit : `/app/{id}/blog` affiche la présentation du plan ; `/s/{slug}/blog` répond 404.
2. Starter : créer 20 articles puis tenter un 21e : refus avec message et lien vers l'abonnement ; modifier un article existant reste possible.
3. Créer une catégorie « Conseils », puis un article publié avec couverture, liste, citation, lien `/catalogue` et image dans le corps ; vérifier `/s/{slug}/blog`, `/blog/categorie/conseils`, l'article, le lien interne, le JSON-LD (outil de test des résultats enrichis).
4. Créer un second article avec le même titre : adresse `…-2`.
5. Programmer un article à +5 min : visiteur anonyme → 404 ; membre → bandeau d'aperçu ; après l'heure, l'article apparaît dans la liste, le RSS et le sitemap sans autre action.
6. Supprimer la catégorie : les articles restent visibles, sans catégorie.
7. Apparence > Accueil > Ajouter une section > « Derniers articles » ; publier ; l'accueil affiche les articles ; avec la catégorie `conseils`, seuls ses articles.
8. Corps contenant `<script>` ou `[x](javascript:…)` : enregistrement refusé.
9. MCP : `create_blog_post` crée un brouillon invisible sur la boutique ; `list_blog_posts` le liste en `DRAFT`.
10. Mobile 375 px : pastilles de catégories défilantes, cartes en une colonne, cibles ≥ 44 px, pagination utilisable au clavier.

## 6. Tests
- `tests/blog-visibility.test.ts` : visibilité programmée, `publicPostWhere`, `resolvePublication`, fuseaux.
- `tests/blog-slug-markdown.test.ts` : adresses et suffixes, Markdown sûr (validation et rendu), garde-fous IA, RSS, JSON-LD.
- `tests/blog-isolation.test.ts` : isolation entre boutiques (articles, catégories, médias, rôle), plan (Gratuit, Starter 20, Business), IA sans débit si indisponible.

## 7. Écarts et points à consolider
- Champ de réglage `blog_category` non ajouté : la catégorie de « Derniers articles » est saisie par son adresse dans un champ texte. Un type dédié demanderait un sélecteur dans l'éditeur (T2) et une validation dans le moteur (T1) ; à faire à la consolidation.
- Pas de sélecteur de modèle alternatif (`templateSuffix`) dans l'éditeur d'article ; le rendu le respecte déjà.
- Les dates d'article sont affichées en UTC sur la boutique (rendu identique serveur et aperçu client) ; écart d'au plus un jour autour de minuit pour les fuseaux non UTC.
- Les images de blog utilisent le téléversement existant avec l'usage `theme` (capacité `theme.manage`, que possèdent propriétaire et gérant).
