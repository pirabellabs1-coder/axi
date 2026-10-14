# Mesures du lot 1 : preuves des critères 7 (LCP) et 8 (migration)

Date : 2026-10-11. Référence : `docs/specs/PLAN-EXECUTION.md` §4, critères 7 et 8.
Machine : Windows 11, 8 threads logiques, **partagée** avec d'autres sessions (tsc, eslint, serveur de dev, scripts de vérification). La charge CPU a été relevée pendant les mesures et elle est indiquée à chaque fois.

---

## B3 : migration `20261011160000_lot1_ventes_fidelite` testée sur une copie réaliste (critère 8) : **OK**

### Contexte
Sur la base de dev `axi`, `_prisma_migrations` indique `applied_steps_count = 0` pour le lot 1 (et pour lot1bis, lot2 et lot4). Ces migrations ont été marquées comme appliquées sans être exécutées, après un `db push`. Le SQL du lot 1 n'avait donc **jamais tourné** avant ce test.

### Méthode
1. Base temporaire `axi_migtest` (avec `axi_migtest_shadow` pour le diff), créée dans le même serveur Postgres 18.4 embarqué (port 5433).
2. Copie figée dans le scratchpad de `schema.prisma`, `migration_lock.toml` et des migrations **jusqu'à `20261011150000_low_stock_threshold_changed_at` incluse**. Les migrations lot1bis, lot2 et lot4 ont été exclues. La somme SHA-256 du `migration.sql` du lot 1 copié est identique à l'original (`a8b778f3…64ea`).
3. `prisma migrate deploy` (Prisma 6.19.3), exécuté sur `axi_migtest` : 3 migrations appliquées.
4. Copie des données de `axi`, en lecture seule (transaction `REPEATABLE READ READ ONLY`). Les binaires `pg_dump`/`psql` ne sont pas fournis par embedded-postgres sous Windows. La copie a donc été faite table par table avec le module `pg` : `json_agg` côté source, puis `json_populate_recordset` côté cible, sur les colonnes communes, avec `session_replication_role = replica`.
   - **61 tables, 5 052 lignes**, comptes source et cible identiques sur chaque table, aucune colonne de l'état « avant lot 1 » absente de la source. Volumes notables : 299 commandes, 619 lignes de commande, 1 644 événements de commande, 57 clients, 58 produits, 11 boutiques.
5. Photographie « avant » : nombre de lignes et empreinte MD5 du contenu de chaque table, calculée sur toutes les colonnes préexistantes.
6. Ajout de la migration du lot 1, puis nouveau `prisma migrate deploy`.
7. Photographie « après » et `prisma migrate diff --from-url axi_migtest --to-migrations <dossier jusqu'au lot 1> --shadow-database-url axi_migtest_shadow --exit-code`.
8. Suppression de `axi_migtest` et de `axi_migtest_shadow` (`DROP DATABASE … WITH (FORCE)`). Leur absence a été revérifiée après chacun des deux redémarrages de l'application.

### Résultats
| Vérification | Résultat |
|---|---|
| Exécution réelle | `applied_steps_count = 1`, `rolled_back_at = null`, pas de logs d'erreur |
| Durée de la migration (`finished_at - started_at`) | **256 ms** (2,08 s pour l'appel CLI complet, démarrage de Prisma compris) |
| Tables | 61 avant, 74 après (+13 : AutomaticDiscount, CartOffer, CustomerAddress, CustomerFavorite, CustomerOtp, CustomerSession, GiftCard, GiftCardTransaction, OrderDiscount, ReturnEvent, ReturnItem, ReturnRequest, StoreCreditTransaction) |
| Lignes | 5 052 avant, 5 052 après, **0 écart** de compte |
| Contenu des colonnes préexistantes | **0 écart** d'empreinte MD5 sur les 61 tables |
| Dérive de schéma (`migrate diff --exit-code`) | « No difference detected. », code de sortie 0 |
| Valeurs par défaut sur l'existant | `Order` : les 4 nouveaux montants à 0, `buyerVerified = false`, `amountDue` NULL pour les 299 commandes historiques (géré : `src/app/s/[slug]/merci/[token]/page.tsx:42` utilise `order.amountDue ?? order.total`). `Customer.storeCreditBalance = 0`. `Store.accountsEnabled = true` pour les 11 boutiques |
| Nettoyage | Seules `postgres`, `axi`, `template0` et `template1` subsistent. La base `axi` n'a pas été modifiée (7 lignes dans `_prisma_migrations`, inchangées) |

Remarque : la migration contient `ALTER TYPE "FulfillmentType" ADD VALUE 'DIGITAL'` dans la même transaction que le reste. Cela passe sur PG 18, car la valeur n'est pas utilisée dans cette transaction. Ce serait un problème si une future migration utilisait `DIGITAL` dans le même fichier.

**Verdict critère 8 : satisfait.** La migration s'applique proprement, en environ 0,3 s sur une copie réaliste, sans perte de données et sans dérive de schéma.

---

## B5 : LCP sur le build de production (critère 7) : **NON atteint**

### Méthode
- Build de production en cours sur `http://localhost:3100` (BUILD_ID `28lpFCWbBORz8Jcsio4y4`, inchangé pendant toute la session, y compris après les deux redémarrages de l’application).
- Playwright 1.64 avec le Chrome système, en headless. Un **contexte neuf par mesure**, avec cache vide (`Network.clearBrowserCache` et `setCacheDisabled`).
- CDP `Network.emulateNetworkConditions` : 9 Mbps en réception, 1,5 Mbps en émission, 150 ms de RTT. `Emulation.setCPUThrottlingRate` : 4.
- Viewport 390x844, `isMobile`, DPR 2, user-agent Android.
- LCP lu par `PerformanceObserver` de type `largest-contentful-paint` avec `buffered` (dernière entrée, 4 s après `load`). FCP, TTFB, octets et long tasks sont relevés en complément.
- Une navigation d’échauffement non mesurée par page, puis 5 mesures. Médiane et p75 par interpolation linéaire.
- Fiche produit : `robe-wax-abomey`, premier lien `/p/` de l’accueil dans l’ordre du DOM. Deux autres fiches ont été mesurées en complément.
- Charge de l’hôte pendant la mesure de référence : environ 35 à 56 % de CPU.

### Résultats de référence (seuil : LCP < 2 500 ms)
| Page | LCP médiane | LCP p75 | min / max | Élément LCP | Poids transféré |
|---|---|---|---|---|---|
| `/s/dantokpa-mode` | **3 060 ms** | **3 488 ms** | 2 668 / 3 516 | image hero Unsplash 828w (50 Ko) | 990 Ko, 38 requêtes |
| `/s/chez-aicha` | **2 932 ms** | **3 064 ms** | 2 384 / 3 868 | image hero Unsplash 828w | 1 085 Ko, 38 requêtes |
| `/s/dantokpa-mode/p/robe-wax-abomey` | **3 728 ms** | **5 280 ms** | 2 876 / 10 348 (a) | image de galerie 828w (158 Ko) | 837 Ko, 32 requêtes |
| `/s/dantokpa-mode/p/chemise-wax-homme` (complément) | 2 448 ms | 2 708 ms | 1 740 / 2 760 | image de galerie 828w | 695 Ko |
| `/s/chez-aicha/p/beignets-souffles-x10` (complément) | 2 768 ms | 3 360 ms | 2 416 / 6 540 | image de galerie 828w | 805 Ko |

(a) Le run à 10,3 s comporte 9,3 s de long tasks : c’est une saturation de l’hôte, pas l’application. Sans ce run, la médiane est d’environ 3,4 s, toujours au-dessus du seuil.

TTFB : 30 à 50 ms (serveur chaud). Le serveur n’est pas en cause.

**Verdict critère 7 : non satisfait.** Les médianes sont entre 2,9 et 3,7 s, et les p75 jusqu’à 5,3 s, sur l’accueil comme sur la fiche produit.

### Diagnostic (chronologie réseau, trace Chrome et profil CPU, accueil dantokpa-mode)
- HTML (45 Ko gzip, **353 Ko bruts**) entièrement reçu à **469 ms**. Image hero (préchargée) reçue à **2 280 ms**. Pourtant le FCP est à **3 196 ms** et `domInteractive` à **3 297 ms**. Le premier paint à 724 ms ne contient que le squelette.
- **Cause 1 : tout le contenu est rendu masqué derrière la frontière Suspense de `loading.tsx`.** Header, `main` et hero sont dans un `div hidden id="S:…"`. Le script `$RC` qui les révèle se trouve à l’octet 352 230 sur 352 876, c’est-à-dire à la toute fin du document. Rien n’est donc visible avant que le navigateur ait parsé les 353 Ko de HTML (dont **148 Ko de payload RSC inline** et 141 SVG inline), entrecoupés de l’exécution du JS. C’est pourquoi FCP = LCP dans presque tous les runs, alors que les données sont prêtes dès le premier octet.
- **Cause 2 : le thread principal** (CPU x4). Environ 2,6 s de travail avant 3,6 s : hydratation (`FunctionCall`) 754 ms, `EvaluateScript` 395 ms (chunk `2eww-h44zf1q7.js` à lui seul : 277 ms), recalcul de style 379 ms, layout 336 ms, commit 371 ms. Les long tasks bloquent pendant 0,8 à 1,6 s par chargement. Le JS pèse 257 Ko gzip, sur 14 chunks.
- **Cause 3 (fiche produit) : l’image principale est téléchargée deux fois.** La visionneuse plein écran (`dialog` fermé) rend une balise `img` brute avec l’URL `w=900`, chargée immédiatement. React 19 la précharge automatiquement (`link rel=preload as=image href=…w=900`), en plus du `srcset` de next/image qui retient la 828w. On télécharge donc **176 Ko + 158 Ko pour la même photo**, et ces deux requêtes se disputent la bande passante.
- **Cause 4 : l’image LCP n’est pas priorisée.** Elle part en priorité `Low`, sans `fetchpriority`, depuis un domaine tiers (`images.unsplash.com`, qui demande une connexion TLS supplémentaire). Sur l’accueil, la grille charge en plus des vignettes en 640w (jusqu’à 141 Ko pièce, 530 à 630 Ko d’images au total).
- Écartés par la mesure : les polices (`display: swap`, sans blocage du texte), le CSS (37 Ko, reçu à 495 ms) et le TTFB.

### Expériences « what-if » (HTML réécrit à la volée dans le navigateur, aucun fichier modifié)
Bras entrelacés run par run, 5 mesures chacun. Attention : l’hôte était saturé pendant cette série (**CPU moyen de 79 %**, 171 relevés). Les valeurs absolues sont gonflées : **seuls les écarts relatifs entre bras sont interprétables**.

| Page | Variante | FCP médiane | LCP médiane | LCP p75 |
|---|---|---|---|---|
| dantokpa-mode | contrôle | 5 764 | 5 764 | 8 400 |
| | contenu non masqué (simule l’absence de `loading.tsx`) | **1 436 (-75 %)** | 5 420 (-6 %) | 5 896 |
| chez-aicha | contrôle | 6 940 | 6 940 | 9 080 |
| | contenu non masqué | **1 712 (-75 %)** | 8 452 (bruit) | 8 736 |
| robe-wax-abomey | contrôle | 6 344 | 6 344 | 7 292 |
| | contenu non masqué | 1 964 | 6 128 | 6 604 |
| | sans l’image 900w de la visionneuse | 4 544 | **4 904 (-23 %)** | 5 900 |
| | les deux | 3 048 | 5 100 | 6 260 |

Lecture des résultats :
- Supprimer le masquage par Suspense ramène le FCP sous 2 s de façon systématique (texte, header et prix deviennent visibles tôt). Mais le LCP reste alors **limité par l’arrivée et la peinture de l’image** : il faut donc traiter la priorité et le poids des images en même temps.
- Supprimer le doublon 900w est le gain de LCP le plus net sur la fiche produit (-23 % en médiane).
- Une première tentative de démasquage par CSS était invalide et a été écartée. Tailwind v4 pose `[hidden]{display:none !important}` dans `@layer base`, et une règle `!important` en couche l’emporte sur une règle hors couche. La variante retenue retire donc l’attribut `hidden` du HTML.

### Correctifs proposés (non appliqués), classés par gain attendu
1. **Retirer ou cibler les squelettes de route** `src/app/s/[slug]/loading.tsx` et `src/app/s/[slug]/p/[productSlug]/loading.tsx` (fichiers entiers). Sur ces pages, les données sont prêtes au premier octet, et le squelette force le masquage de toute la page jusqu’à la fin du document. Si un état de chargement reste souhaité pour la navigation client, le placer en `Suspense` autour des seules sections réellement lentes, pas autour de toute la page. Gain mesuré : FCP -75 %.
2. **Ne plus rendre l’image de la visionneuse tant qu’elle est fermée** : `src/components/storefront/product/gallery.tsx:158`. Conditionner la balise `img` à l’ouverture du `dialog` (état `open`), ou au minimum lui donner `loading="lazy"` et la même URL que l’image affichée. Gain mesuré : LCP -23 % sur la fiche, et environ 176 Ko économisés.
3. **Prioriser l’image LCP.** Ajouter `fetchPriority="high"` (prop next/image) quand `priority` est vrai, dans `src/components/storefront/product-image.tsx:34`, ce qui couvre le hero (`src/components/storefront/sections/hero-banner.tsx:50` et `:54`) et la galerie (`src/components/storefront/product/gallery.tsx:203`). Ajouter aussi un `link rel="preconnect"` vers `https://images.unsplash.com` (avec `crossOrigin`) dans le `head` de `src/app/layout.tsx:32`, ou mieux, servir les médias depuis le domaine ou CDN de la plateforme. À valider par une mesure après correctif.
4. **Alléger les images de la grille d’accueil** : les vignettes partent en 640w (jusqu’à 141 Ko). Avec `sizes` à `50vw` et un DPR de 2, la largeur utile est d’environ 390 px. Ajouter un palier de 400 à `images.imageSizes` dans `next.config` et baisser la qualité des vignettes : `src/components/storefront/product-card.tsx:14` et `:135`.
5. **Réduire le HTML et le JS d’hydratation** : 148 Ko de payload RSC inline et 141 SVG inline sur l’accueil. Il faut passer moins de props aux composants client (DTO minimaux pour les cartes produit) et identifier, avec un analyseur de bundle, ce que contient le chunk `2eww-h44zf1q7.js` (71 Ko gzip, 277 ms d’évaluation à CPU x4), pour le différer s’il n’est pas critique.

Ordre conseillé : 1 + 2 + 3 ensemble, puis nouvelle mesure avec le même protocole, **sur un hôte au repos**. Les points 4 et 5 ne sont à faire que si le seuil n’est toujours pas atteint.

### Reproductibilité
Scripts (hors dépôt) dans le scratchpad de session, dossier `lcp/` : `lcp.cjs` (mesure de référence), `ab.cjs` (expériences), `trace.cjs` (chronologie réseau) et `cpu.cjs` (profil CPU et trace). Les données brutes sont dans `run1.json` et `run2.json`.

---

## Après correctifs (équipe T3, vague 2, 11/10/2026)

### Correctifs appliqués
1. **Squelettes de route supprimés** : `src/app/s/[slug]/loading.tsx` et `src/app/s/[slug]/p/[productSlug]/loading.tsx`. Les données sont prêtes au premier octet ; plus aucune frontière Suspense ne masque la page jusqu'à la fin du HTML. Aucun segment lent ne justifiait un squelette (les `loading.tsx` de `commander/` et `compte/`, propres à leurs segments, sont inchangés).
2. **Visionneuse plein écran** (`src/components/storefront/product/gallery.tsx`) : la balise `img` n'est rendue qu'à l'ouverture du `dialog` (état `viewerOpen`, remis à faux à la fermeture). Le doublon 900w disparaît.
3. **Image LCP priorisée** (`src/components/storefront/product-image.tsx`) : `fetchPriority="high"` dès que `priority` est vrai (bannière de l'accueil, première image de la galerie, première section). Les logos d'en-tête gardent le préchargement mais en priorité `auto` pour ne pas concurrencer l'image LCP. **Préconnexion** (`src/app/s/[slug]/layout.tsx`, `preconnect` de React, rendu dans le `head`) vers `https://images.unsplash.com` et l'origine de `STORAGE_PUBLIC_URL` si elle est en https et distincte.
4. **Vignettes de grille** (`src/components/storefront/product-card.tsx`) : `sizes` à la largeur réelle de colonne (`calc(50vw - 22px)` sur mobile, `calc(33vw - 24px)` sur tablette, largeur fixe au-delà). À 390 px et DPR 2 : palier 384w au lieu de 640w, sans modifier `next.config`.
5. Non traité : réduction du payload RSC et du JS hydraté au-dessus de la ligne de flottaison (point 5 du diagnostic), qui demande un analyseur de bundle et un build.

Côté rendu lot 4 (T3), aucune régression du LCP : la première section rendue et les sections de modèle (fiche, collection) ne sont **jamais** animées (pas d'opacité 0 sur l'élément du LCP) ; la vidéo d'ambiance ne remplace pas l'image de couverture, qui reste l'élément du LCP.

### Méthode
Même protocole que B5 (Playwright, Chrome système, contexte neuf et cache vide par mesure, 9 / 1,5 Mbps, 150 ms RTT, CPU x4, 390x844 DPR 2 Android, 1 échauffement puis 5 mesures, médiane et p75 par interpolation linéaire), avec deux écarts imposés par l'environnement :
- **serveur de développement** (`http://localhost:3000`, JS non minifié, environ 1,5 à 1,9 Mo transférés par page) : `next build` est interdit pendant la vague. **Seuls les écarts avant / après sont interprétables** ; la mesure de référence sur build sera refaite après le prochain build ;
- l'événement `load` n'arrivant pas en 300 s sur dev saturé, la navigation attend le premier octet, puis `DOMContentLoaded` (plafond 120 s) et 5 s ; LCP et FCP sont lus par `PerformanceObserver` (dernière entrée).
- **Hôte saturé** : CPU à 100 % au début et à la fin des deux séries (10 équipes en parallèle). Deux mesures « avant » de chez-aicha n'ont rien peint dans la fenêtre (valeur 0) et sont exclues.

### Résultats (dev, ms)
| Page | FCP médiane avant | FCP médiane après | LCP médiane avant | LCP p75 avant | LCP médiane après | LCP p75 après | Transféré avant / après |
|---|---|---|---|---|---|---|---|
| `/s/dantokpa-mode` | 3 940 | **2 204** | 6 300 | 6 980 | **4 068** (-35 %) | 4 572 | 1 891 / 1 653 Ko |
| `/s/chez-aicha` (avant : 3 mesures valides) | 5 524 | **2 804** | 5 524 | 6 040 | **3 412** (-38 %) | 4 052 | 1 935 / 1 507 Ko |
| `/s/dantokpa-mode/p/robe-wax-abomey` | 7 964 | **1 368** | 10 236 | 10 512 | **2 640** (-74 %) | 3 296 | 1 724 / 1 538 Ko |

Élément LCP après correctifs : l'image hero (accueil) ou l'image principale de la galerie (fiche), toutes deux avec `fetchpriority="high"`. Avant, FCP = LCP dans 5 mesures valides sur 13, et le FCP restait tardif (3,9 à 8 s) car la page était masquée jusqu'à la fin du document ; après, le texte, l'en-tête et le prix sont peints nettement avant l'image (FCP -44 % à -83 %).

### Lecture
- Les correctifs 1 à 4 réduisent le LCP de 35 à 74 % et le poids transféré de 186 à 428 Ko par page, sur un hôte saturé et en dev.
- Les valeurs absolues de dev ne disent rien du seuil de 2,5 s sur build ; **la vérification du critère 7 reste à refaire sur le prochain build** (port 3100), hôte au repos, avec le même protocole. Si le seuil n'est pas atteint sur l'accueil, la piste suivante est le point 5 (payload RSC et JS d'hydratation).

### Reproductibilité
Scripts dans le scratchpad de session de T3 : `lcp2.cjs` (protocole ci-dessus), données brutes `avant.jsonl` et `apres.jsonl`.
