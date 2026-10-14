# Recette visuelle : espace marchand, site vitrine, auth

Liste « défaut → correction » tenue pendant la recette. Méthode : le panneau navigateur intégré étant masqué
(captures impossibles), chaque page est chargée dans un `<iframe>` de largeur fixe (1440, 1280, 768, 375 px)
et auditée par mesures DOM : débordement horizontal de la page, éléments hors écran (hors zones qui défilent),
textes tronqués par ellipse sans `title`, cibles < 24 px, images cassées, contrôles qui sortent de leur carte.
Les interactions (tiroir, repli, infobulles, raccourci) sont pilotées par script (clics, `pointerover`, `keydown`).
Données : boutique « Pirabel Labs » (brouillon, états vides) côté navigateur, boutique démo `chez-aicha` en `curl`
avec la session de test (200 et absence de « Un problème est survenu » sur chaque route).

Périmètre réduit en cours de mission : boutique publique, éditeur d'apparence et produits sont réécrits par
d'autres équipes (non recettés ici après le changement de périmètre).

## Défauts corrigés

| # | Écran | Défaut | Correction |
|---|---|---|---|
| 1 | Menu latéral (ordinateur) | La liste de navigation ne défilait pas : `flex-1` sans `min-h-0`, « Livraison », « Paiements »… passaient sous la carte « Plan » à 900 px de haut | `nav` en `min-h-0 flex-1 overflow-y-auto overscroll-contain`, carte Plan en `shrink-0` (mesuré : nav 72→722 px, carte à 722 px, plus de chevauchement) |
| 2 | Menu latéral (ordinateur) | Pas de repli | Rail d'icônes 64 px : bouton dans l'en-tête (infobulle « Replier le menu [ »), raccourci `[` (hors champ de saisie), état mémorisé (`localStorage` `axi-sidebar`) et posé sur `<html data-sidebar>` avant le premier rendu (aucun saut au chargement), transition `grid-template-columns` 240 ms courbe spring, libellés en fondu, pastille pour les compteurs, icônes et avatar centrés à 32 px, carte Plan remplacée par un bouton compact, infobulles en position fixe (non rognées par la zone qui défile), `prefers-reduced-motion` respecté |
| 3 | Tiroir mobile | Le menu ne se rouvrait plus après une fermeture native du `<dialog>` (deuxième Échap / CloseWatcher de Chrome : `close` sans `cancel` annulable, l'état React restait à `true`) | `Sheet` et `Dialog` écoutent `close` et resynchronisent l'état ; tiroir : bouton « Fermer le menu » visible, fermeture au clic sur un lien (même sur la page courante), à la navigation, sur Échap, au clic sur le voile et au passage en largeur ordinateur ; liens de 44 px dans le tiroir |
| 4 | Sélecteur de boutique | Largeur figée 236 px, incompatible avec le rail | Pleine largeur (`wrapperClassName` ajouté à `DropdownMenu`), libellé accessible « Boutique X, changer de boutique » |
| 5 | Layout racine | Avertissement React « Encountered a script tag while rendering React component » (script de thème) | Composant `ThemeScript` : `<script>` classique au rendu serveur (exécuté avant peinture, pas de flash), bloc de données `type="text/plain"` côté client (React ne l'exécute pas et n'avertit plus). `next/script beforeInteractive` écarté : son code inline n'est exécuté qu'après chargement du runtime Next, d'où un flash de thème |
| 6 | Apparence | Contrôles segmentés (Disposition, En-tête « Deux colonnes ») qui débordaient | `Segmented` : option `fill` (options de largeur égale, libellés qui passent à la ligne) ; grille des options en 1 colonne entre `lg` et `2xl` |
| 7 | Apparence | Cartes de modèles de hauteurs inégales, mini-aperçus tronqués (« Le m… ») dans une colonne étroite | Requêtes de conteneur (`@container`, 2 colonnes dès 512 px, 3 dès 896 px), `auto-rows-fr`, bouton en bas ; mini-aperçu sur deux lignes (titre, puis pastilles + bouton) |
| 8 | Apparence | Aperçu en direct en 404 quand la boutique n'est pas publiée ; le « brouillon » n'était jamais affiché | `getStorefront()` : boutique non publiée visible par ses seuls membres connectés, bandeau « Aperçu : boutique non publiée », `noindex,nofollow` ; thème brouillon via un cookie d'aperçu limité à `/s/<slug>` posé par l'éditeur (membres uniquement) ; vérifié : anonyme 404, propriétaire 200 + bandeau |
| 9 | Apparence | Aperçu non rechargé après « Enregistrer » ; mode « Ordinateur » tassé dans 440 px | Rechargement à chaque enregistrement réussi ; aperçu ordinateur rendu à 1280 px puis réduit (`transform: scale`) ; indicateur de chargement |
| 10 | Commandes, clients, codes promo | Colonne d'actions coupée quand le tableau défile (1280 px, barre ouverte) | `TH`/`TD` `sticky` dans le kit : colonne d'actions collée à droite, fond opaque, ombre de séparation, survol de ligne conservé |
| 12 | Tableau de bord (1024 à 1279 px) | Checklist de démarrage en deux colonnes de 165 px : libellés sur 3 lignes ; 5 KPI de 140 px avec libellés coupés | Checklist en deux zones à partir de `xl` seulement ; KPI en 2 / 3 / 5 colonnes (`sm`, `xl`) |
| 13 | Boutons « danger » (kit `Button`, confirmation `Dialog`, page Statut) | Texte blanc sur `--c-danger` sombre (#ff7b72) : contraste 2,3:1 en thème sombre | Texte `text-canvas` (clair : 5,2:1, sombre : environ 8:1) |
| 14 | Menu latéral | Titres de groupes en `text-ink-faint` 11 px sur fond canvas : contraste 3,3:1 | `text-ink-muted` |
| 11 | Facture d'abonnement | `momoNumber` non défini dans `ManualInstructions` (erreur TypeScript, rendu cassé en zone Afrique) | Numéro passé en prop |

## Branchements ajoutés

- En-tête : `NotificationBell` ; barre latérale : Collections, Notifications (Vendre), Navigation, Partager (Boutique).
- `PlatformAnnouncements` en haut du contenu de l'espace marchand (zone de facturation de l'abonnement).
- Prix effectifs (surcharges `/admin/tarifs`) : `/tarifs` (`loadActiveOverrides` + `effectiveFromRows`, revalidation 5 min, repli catalogue si base indisponible) et cartes de `/app/[id]/abonnement` (`getEffectivePlanPriceFor`, calcul serveur).

## Audit automatique (mesures DOM)

| Largeur | Pages auditées | Défauts détectés |
|---|---|---|
| 1280 px | 24 pages de l'espace marchand (tableau de bord à compte, recherche, notifications, partager) | 0 (après corrections 1, 2, 10) |
| 375 px | 17 premières pages de la même liste | 0 |

Interactions vérifiées par script : repli / dépli (bouton et `[`), mémorisation `localStorage`, infobulles du rail
(position alignée sur l'élément survolé), tiroir mobile (ouverture, bouton Fermer, clic voile, resynchronisation
après fermeture native), barre d'onglets mobile (5 onglets de 75 px, pas de débordement), aperçu brouillon (404 anonyme,
200 + bandeau pour le propriétaire).

## Reste à faire / bloquants

- **Résolu** : l'erreur de compilation de `src/lib/theme-engine/fonts.ts` (« Unexpected spread », qui faisait répondre
  500 à toutes les routes du serveur de dev) est corrigée : chaque appel `next/font` reçoit désormais un littéral
  d'objet, sans spread ni constante partagée. La recette, interrompue à ce moment, n'a pas été reprise : restent à
  auditer 375 px (abonnement à compte), 768 et 1440 px, thème sombre, site vitrine, marketplace, pages
  d'authentification (non connecté).
- Captures d'écran impossibles (panneau navigateur masqué) : contraste mesuré sur les jetons, pas sur rendu.
- `AnnouncementBanners` (équipe admin) rend `null` puis apparaît après lecture du `localStorage` : léger saut de
  mise en page en haut du contenu. Suggestion : réserver la place ou masquer côté serveur via cookie.
- Jetons `--c-ink-faint` (3,3 à 3,6:1) sous le seuil AA pour du texte : à relever dans `globals.css` (hors périmètre).
- Données réelles (tableaux remplis) vérifiées seulement en `curl` sur la boutique démo : le navigateur partagé est
  connecté en administrateur sur une boutique vide, et changer de session aurait déconnecté les autres équipes.

---

# Recette 2 : tablette (768, 1024), grand écran (1440), thème sombre

Reprend les points « reste à faire » ci-dessus : 768 / 1024 / 1440 px, thème sombre, site vitrine, marketplace,
pages d'authentification, console admin et boutique publique (thème clair forcé). Le jeton `--c-ink-faint` cité
plus haut a été relevé en sombre (n° 28) ; en clair il mesure 4,84:1 sur `canvas` et 4,74:1 sur `surface-2` (AA).

**Méthode.** Playwright sans interface avec le Chrome système, sessions réelles (`demo@axi.africa`, boutique
Chez Aïcha, et `admin@axi.africa`). 85 routes : vitrine et auth (18), espace marchand (37, toutes les entrées de la
barre latérale plus les fiches commande, client, campagne, page, collection, facture), console admin (20, dont une
fiche boutique, utilisateur et ticket), boutiques `chez-aicha` et `dantokpa-mode` (accueil, catalogue, fiche,
panier, commande). Contextes tactiles (`hasTouch`, `isMobile` sous 1024 px) jusqu'à 1024 px, `prefers-reduced-motion`.
Thème sombre posé comme par un vrai visiteur (`localStorage axi-theme=dark` **et** `prefers-color-scheme: dark`).

Sonde par page : débordement horizontal du document et élément fautif (chaîne d'ancêtres), textes tronqués sans
`title`, cibles tactiles < 24 px (hors liens étirés `after:inset-0` et cellules de tableau, couverts par
l'exception d'espacement de WCAG 2.5.8), images cassées, **contraste calculé sur le rendu** (composition réelle des
fonds translucides et des pastilles positionnées en absolu, opacité cumulée des ancêtres), chevauchements de textes,
focus visible (14 tabulations à 1440 px), fuite du thème sombre dans la boutique (`color-scheme`, fond de `<html>`
et de `<body>`). Puis captures regardées une à une (alignements, densité, cartes et ombres en sombre, graphiques).
Premier passage sur le build de prod (3100), vérification sur le serveur de dev (3000) après corrections.

## Matrice page × largeur × thème (état après corrections)

| Zone (pages) | 375 sombre | 768 clair | 768 sombre | 1024 clair | 1024 sombre | 1440 clair | 1440 sombre |
|---|---|---|---|---|---|---|---|
| Vitrine, marketplace, auth (18) | OK | OK | OK (1) | OK (1) | OK | OK | OK |
| Espace marchand (37) | OK | OK sauf produits (2) | OK (1) | OK (1) | OK sauf produits (2) | OK | OK |
| Console admin (20) | OK | OK | OK (1) | OK (1) | OK | OK | OK |
| Boutiques publiques (10) | OK, clair forcé | OK | OK, clair forcé (1) | OK (1) | OK, clair forcé | OK | OK, clair forcé |

(1) Colonne auditée avant corrections seulement (build de prod) : chaque défaut relevé y est couvert par une
correction commune revérifiée à 375, 768 clair, 1024 sombre et 1440.
(2) Liste produits : débordement horizontal, zone réservée à une autre équipe (voir plus bas).

« OK » = aucun débordement, aucune image cassée, aucun contraste sous AA sur le rendu, aucun chevauchement réel,
focus visible. Restent, assumés : troncatures volontaires (aperçus de messages, agent utilisateur des sessions avec
`title`) ; titre blanc du hero boutique sur photo (lisible grâce au voile, non mesurable automatiquement) ; liens
texte isolés de 18 à 20 px de haut (fil d'Ariane, « Gérer », « Connecter l'API ») conformes AA par l'exception
d'espacement, sous la cible projet de 44 px.

## Défauts trouvés et corrigés

| # | Écran | Défaut | Correction |
|---|---|---|---|
| 15 | Boutique publique (site en sombre) | Fuite du sombre : `<html>` restait en `color-scheme: dark` (barres de défilement sombres), fond sombre de `<html>`/`<body>` (rebond, zones hors racine), toasts rendus hors de la racine boutique en sombre, variantes `dark:` et `.bezel` sombre actives sous `data-theme="light"` | `globals.css` : bloc `:root:has([data-store-root], [data-store])` aux valeurs claires, **séparé** du bloc clair et placé après le sombre (fusionnés, Lightning CSS les réécrit en `:is()` dont la spécificité est celle de l'argument le plus fort, et le clair gagnait partout : régression vue et corrigée pendant la recette) ; variante `dark:` et `.bezel` sombre exclues des sous-arbres `data-theme="light"` et des pages boutique. Vérifié : `<html>`, `<body>` et un élément ajouté au `body` restent clairs, que le sombre vienne du système ou de la préférence mémorisée ; le reste du site reste sombre |
| 16 | Boutiques (1440 : +248 px, 1024 : +193 px) | Débordement horizontal : la piste du carrousel n'était pas positionnée, ses descendants `absolute` (sr-only, bouton « + ») échappaient au rognage | `relative` sur la piste (`storefront/carousel.tsx`), la galerie produit et la liste de collections |
| 17 | Boutiques (768 : +353 px) | Grille des avis sans piste mobile, élargie par le carrousel d'avis | `grid-cols-1` |
| 18 | 222 grilles (vitrine, marchand, admin, boutique) | Motif `grid gap-… lg:grid-cols-…` sans piste de base : piste implicite `auto` = largeur min-content (graphique SVG, bloc de code, tableau). Mesuré : tableau de bord (+267 px à 375), `/integrations/ia` (+153), `/app/compte` (+85), `/legal/*` (+297), recherche marketplace (+20), fiche utilisateur admin (+46 à 1024) | `grid-cols-1` (= `minmax(0,1fr)`) ajouté en base ; aucun effet visuel quand le contenu tient |
| 19 | `/admin/tarifs` (1024 : +13 px, 375 : +201 px) | Pistes `1.4fr/1fr` sans `minmax(0, …)` avec un tableau `min-w-[560px]` | `xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]`, une colonne en dessous |
| 20 | Entonnoir (1024 : +109 px, 375 : +542 px) | Piste kanban non positionnée, liens étirés en `absolute` hors rognage | `relative` sur la piste (`inbox/pipeline-board.tsx`) |
| 21 | Campagnes, fidélité (375 : +304 / +341 px) | `sr-only` des en-têtes de tableau échappant au wrapper `overflow-x-auto` du kit `Table` | `<Table className="relative">` sur ces deux pages (voir recommandation kit) ; `relative` préventif sur les autres pistes défilantes hors kit (rails marketplace, filtres conversations, sommaire compte, tableau cookies, facture, tarifs admin, carrousel d'accueil) |
| 22 | `/tarifs` (375 : +103 px) | `<fieldset>` a `min-width: min-content` par défaut ; sélecteur de plan non positionné ; contour de focus rogné en haut | `min-w-0` sur le fieldset ; `relative` et `py-1` sur la piste |
| 23 | En-tête du site (768) | « Créer ma boutique » sortait de l'île de navigation (628 → 827 px) | Navigation complète à partir de `lg` (1024), menu plein écran en dessous (bouton, panneau et fermeture au passage en bureau alignés sur 1024) |
| 24 | Tableau de bord, conversations récentes | Liens vers `/conversations/<id>` : route inexistante (404, préchargement en erreur dans la console) | `/conversations?c=<id>`, comme le reste de l'application |
| 25 | Boutons et en-têtes WhatsApp (sombre) | `--c-whatsapp-deep` sombre `#22b07d` sous texte blanc : 2,77:1 | `#0f7a5c` dans les deux thèmes (5,3:1) ; le jeton ne sert qu'en fond |
| 26 | Aperçus WhatsApp (clair) | « Compte WhatsApp Business » `text-white/80` (4,0:1), « Compte professionnel » `/75` (3,7:1) | `text-white/90` |
| 27 | `/developpeurs` | Mention `text-white/50` sur forêt : 4,35:1 | `text-white/65` |
| 28 | Jeton `--c-ink-faint` sombre | 4,31:1 sur `surface-2` (raccourci `[` du menu, prix barrés de la marketplace) | `#808b84` (4,67:1 sur `surface-2`, 5,47:1 sur `canvas`) |
| 29 | Cartes double-bezel (sombre) | Liseré intérieur blanc à 60 % : trait clair dur en haut de chaque carte | `--shadow-inset` à 5 % en sombre (inchangé en clair) |
| 30 | Accueil, cartes boutique | Lien étiré en `outline-none`, focus signalé par une ombre seulement (invisible en sombre) | Contour `outline-primary` sur la carte via `has-[a:focus-visible]` |
| 31 | Boutique, cartes produit (grille et liste) | Focus = soulignement seul (grille), aucun indicateur (liste) | Anneau couleur boutique sur le lien étiré |
| 32 | Boutique, répartition des avis | Lignes à 0 avis en `opacity-60` : texte à 2,7:1 | Opacité retirée (la barre vide suffit) |
| 33 | Console admin | Libellé « Abonnements et factures » tronqué dans la barre latérale ; double espace « Activer  maintenant » (`&nbsp;` + `gap`) ; lien de 36 px | Libellé « Abonnements » ; texte regroupé dans un seul `span` ; `pointer-coarse:min-h-11` |
| 34 | Tableau de bord marchand (375, 1024) | KPI « Encaissé » tronqué à 375 (« 217 180 FC… ») ; à 1024, rangée 3 + 2 avec un trou à droite | Montants en pleine largeur sur mobile, compteurs côte à côte ; « Ventes » sur deux colonnes de `sm` à `xl` (2 + 1, puis 3), cinq colonnes au-delà |
| 35 | `/admin/options` (1024) | KPI multi-devises « 32 000 FCFA + 56,00 € » tronqué | 2 colonnes jusqu'à `xl`, montant sur toute la ligne |
| 36 | Entonnoir (768), carrousel boutiques de l'accueil | Première colonne collée au bord gauche : `snap-start` sans `scroll-padding` assorti au `padding` décale le défilement de 24 px | `scroll-px-*` alignés sur `px-*` à chaque palier |
| 37 | Boutique, fiche produit | Champ quantité en `focus:outline-none` sans remplaçant | Anneau couleur boutique sur le groupe (`focus-within`) |

Esthétique vérifiée sur captures en sombre : cartes `surface` bien détachées du `canvas`, anneaux `line` visibles,
ombres noires discrètes, graphiques admin et tableau de bord lisibles (lime sur fond sombre, axes `ink-muted`),
badges lime sur lime 12 %.

## Défauts dans des zones réservées (non corrigés, à transmettre)

- **Liste produits** (`src/app/app/[storeId]/produits/`) : débordement horizontal du document de +188 à +200 px à
  768 et 1024. Cause : wrapper `hidden overflow-x-auto md:block` non positionné, d'où s'échappent les cases à cocher
  `relative z-[1]` et les liens étirés. Correctif : `relative` sur ce wrapper. Cases à cocher de sélection de 16 à
  20 px (cible < 24 px).
- **Numéros de téléphone** : regroupement des chiffres irrégulier sur les numéros ivoiriens à 10 chiffres
  (« +225 71 92 02 12 2 ») dans les listes commandes et clients : formateur à revoir (non modifié ici).
- **Médias Dantokpa** : deux images téléversées en 404 (`/media/stores/cmv2hxyeh…/2026/10/*.jpg`), zone stockage.
- **Kit `src/components/ui`** (modification soumise à accord) : `Table` devrait porter `relative` sur son wrapper
  `overflow-x-auto` (règle le motif n° 21 pour ses 30 usages) ; `ThemeToggle` a des boutons de 32 px (AA respecté,
  sous la règle projet de 44 px sur tactile : `pointer-coarse:size-11`) ; `StatCard` pourrait réduire la taille du
  chiffre par requête de conteneur au lieu de tronquer.
- **Fichiers du lot 1** modifiés **avant** la consigne de gel, uniquement par l'ajout mécanique `grid-cols-1`
  (n° 18) : `promotions/coupon-dialog.tsx`, `parametres/settings-form.tsx`, `parametres/tracking-form.tsx`.

## Captures (docs/captures/)

`recette-accueil-sombre-1440.png`, `recette-tarifs-tablette-768.png`, `recette-tableau-de-bord-sombre-1440.png`,
`recette-tableau-de-bord-tablette-1024.png`, `recette-entonnoir-sombre-768.png`, `recette-commandes-sombre-1440.png`,
`recette-console-admin-sombre-1024.png`, `recette-boutique-claire-forcee-768.png` (préférence sombre du visiteur,
boutique en clair), `recette-marketplace-sombre-375.png`.
