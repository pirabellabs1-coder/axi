# Équipe L : langues de la boutique (lot 2 A)

Spécification : `docs/specs/LOT-2-international-contenu.md` §1.1. Schéma déjà en base (`Translation`, `Store.enabledLocales`,
`Store.i18nConfig`, `Order.locale`, migration `20261011180000_lot2_international_contenu`).

## 1. Guide commerçant (`/app/{storeId}/langues`, menu « Langues »)

- **Langues** : français, anglais, portugais, espagnol, arabe (droite à gauche), wolof, fon, yoruba, haoussa, swahili,
  lingala, bambara. Quota du plan (`limits.languages`, langue principale comprise) : Gratuit 1, Starter 1, Business 2,
  Scale 5, Enterprise sans limite.
- **Langue principale** : celle de vos contenus d'origine, servie sans préfixe (`/s/ma-boutique/p/robe`).
  Chaque langue supplémentaire ajoute un préfixe (`/s/ma-boutique/en/p/robe`, ou `/en/p/robe` sur votre domaine).
- **Traductions** : tableau « source / traduction / état » par type de contenu (boutique, produits, variantes,
  suppléments, collections, pages, menus, thème, articles et catégories de blog). États : *Non traduit*,
  *Traduit*, *À revoir* (le texte d'origine a changé depuis la traduction : elle reste affichée),
  badge *Traduction automatique* pour les textes produits par l'IA.
- **Traduire par l'IA** (plan Business et plus) : 1 crédit IA par tranche de 1 500 caractères source, débité avant
  l'appel et remboursé si l'appel échoue. Les textes passent des contrôles : aucun prix, délai, stock, garantie ni
  promotion ajouté, pas de HTML, termes du **glossaire** reproduits à l'identique. Un champ refusé reste non traduit.
- **Ce que voit le client** : une barre de langues dans la boutique (vrais liens, indexables) et, si son navigateur
  ou sa dernière visite indiquent une autre langue, un bandeau « Voir la boutique en English ? ». **Aucune
  redirection automatique** : l'adresse fait foi.
- **Repli** : un champ sans traduction s'affiche dans la langue principale. Un libellé n'est jamais à moitié traduit.
- **Baisse de plan** : les langues en trop sont désactivées (leurs adresses redirigent en 302), les traductions sont
  conservées et reviennent avec un plan supérieur.
- **Commandes** : la langue d'affichage est mémorisée (`Order.locale`) ; les e-mails de suivi partent dans cette
  langue si un modèle complet existe, sinon en français.

## 2. Architecture

| Fichier | Rôle |
|---|---|
| `src/i18n/locales.ts` | Langues plateforme, direction, quota (`storeLocales`), segment d'URL (`splitLocalePath`, `withLocalePath`, `storeBasePath`), suggestion (`suggestLocale`). Module PUR, utilisable par le proxy Edge. |
| `src/i18n/dictionary.ts` | Libellés d'interface, repli clé par clé sur le français, `localizeSectorCopy`, couverture. |
| `src/i18n/storefront/{fr,en,pt,es,ar,wo,fon,yo,ha,sw,ln,bm}.ts` | Dictionnaires (fr et en complets ; les autres partiels, à valider par des locuteurs). |
| `src/proxy.ts` | Détection et retrait du segment de langue, en-têtes `x-axi-locale` et `x-axi-locale-path` (toujours écrasés), 302 vers l'URL sans préfixe pour une langue non servie. |
| `src/app/api/storefront/locales/route.ts` | Langues servies par adresse de boutique (le proxy n'importe pas Prisma), mémo 60 s. |
| `src/lib/i18n/resolve.ts` | Langue de la requête, hreflang (`localeAlternates`), chargement des traductions (filtré `storeId`), application au rendu (`localizeStorefront`), `requestOrderLocale`. |
| `src/lib/i18n/localize-theme.ts` | `localizeThemeDocument` (pur) : seuls les champs `text`, `textarea`, `richtext`, revalidés par `sanitizeFieldValue`. |
| `src/lib/i18n/resources.ts` | Ressources et champs traduisibles, clés de champ, longueurs maximales. |
| `src/lib/i18n/service.ts` | Lecture des sources, état des traductions, couverture (écran marchand). |
| `src/lib/i18n/translate-ai.ts` | Coût en crédits, lots ≤ 20 000 caractères, message, garde-fous de la réponse, glossaire. |
| `src/lib/i18n/actions.ts` | `updateLanguages`, `updateGlossary`, `upsertTranslation`, `deleteTranslation`, `translateResources`. |
| `src/lib/i18n/hash.ts` | `sourceHash` (sha256) et détection d'obsolescence. |
| `src/lib/i18n/notify.ts` | Langue des notifications d'une commande (modèle complet, sinon français). |
| `src/app/s/[slug]/layout.tsx` | `lang`, `dir` et `alternates.languages` (+ `x-default`) de la racine de la boutique. |
| `src/app/s/[slug]/sitemap/[locale]/route.ts` | Sitemap par langue, avec `xhtml:link` hreflang et `x-default`. |
| `src/components/storefront/locale-bar.tsx` | Barre de langues et bandeau de suggestion (cookie `axi_locale`). |
| `src/app/app/[storeId]/langues/**` | Écran marchand. |

### Invariants

- L'URL fait foi. `x-axi-locale` est **toujours** écrasé par le proxy ; une valeur venant du client est ignorée.
- Une langue non servie ne produit jamais de 404 : 302 vers l'URL sans préfixe (GET et HEAD seulement ; une action
  serveur en POST n'est pas redirigée).
- Toute lecture et toute écriture de `Translation` est filtrée par `storeId`.
- Les valeurs traduites du thème repassent par `sanitizeFieldValue` ; aucune URL, couleur, image, source dynamique
  ou identifiant n'est jamais remplacé.
- Options et attributs de variantes sont traduits de façon cohérente (correspondance de texte) ; la sélection d'une
  variante reste faite par identifiant.

## 3. Tests

`tests/proxy-locale.test.ts` (segment de langue, quota, suggestion), `tests/i18n-localize-theme.test.ts`
(champs texte uniquement, revalidation, `sourceHash`), `tests/i18n-dictionary.test.ts` (repli sur fr, notifications),
`tests/i18n-hreflang.test.ts` (langue de requête, hreflang, rendu traduit, isolation entre boutiques),
`tests/i18n-isolation.test.ts` (actions : quota de plan, isolation, garde-fous et crédits de l'IA).

## 4. Limites connues (à reprendre)

- Les liens construits côté client (tiroir panier, pages « compte ») ne portent pas le préfixe de langue : ils
  renvoient à la langue principale. Les liens rendus côté serveur (menus, sections, en-tête, listes, fiches) le portent.
- Les libellés de facettes de filtrage restent dans la langue d'origine (les facettes sont calculées avant traduction).
- Le blog (`src/lib/blog/render-data.ts`, équipe D) n'applique pas encore les traductions `BLOG_POST` /
  `BLOG_CATEGORY` : les champs sont traduisibles et stockés, l'application au rendu demande une ligne chez eux.
- Outils MCP `translate_content`, `list_translations_status` et ressource `axi://i18n/coverage` non livrés
  (`translationCoverage` est prêt dans `src/lib/i18n/service.ts`).
