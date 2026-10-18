# Commerce social : Facebook, Instagram, TikTok, YouTube

État vérifié le **14/10/2026** d'après la documentation officielle des plateformes (sources en fin de page).
Code : `src/lib/social/**`, flux `src/app/s/[slug]/feeds/**`, écrans `/app/{storeId}/integrations/whatsapp-catalogue`
et `/app/{storeId}/integrations/instagram-produits`, section vitrine « Direct » (`live-shopping`).

Ce que fait Axi : il tient le catalogue (produits, variantes, prix dans la **devise de la boutique**, stock, photos)
et le publie vers chaque plateforme. La **vente se conclut toujours sur la boutique Axi** (ou par WhatsApp) : aucune
plateforme ne propose le paiement intégré pour des marchands d'Afrique de l'Ouest (voir « Ce qui n'est pas possible »).

## 1. Ce qu'Axi publie (commun à toutes les plateformes)

| Adresse | Pour | Format |
| --- | --- | --- |
| `/s/{slug}/feeds/meta.xml` | Commerce Manager (Facebook, Instagram, catalogue WhatsApp) | RSS 2.0 `g:`, un champ par ligne |
| `/s/{slug}/feeds/google.xml` | Google Merchant Center (Google Shopping, annonces sur YouTube) | RSS 2.0 `g:` |
| `/s/{slug}/feeds/tiktok.csv` | TikTok Ads Manager, catalogue | CSV UTF-8, virgules |
| API `items_batch` | Catalogue Meta relié au numéro WhatsApp | JSON (synchronisation directe) |

Champs émis et règles (testés dans `tests/social-feeds-conformity.test.ts`) :

- **Obligatoires** : `id` (variante, sinon produit), `title`, `description` (texte brut), `availability`,
  `condition` (= `new`), `price`, `link`, `image_link`, `brand` (réglage, sinon vendeur, sinon nom de la boutique).
  Google : `identifier_exists=no` quand il n'y a pas de GTIN valide (jamais de code inventé).
- **Prix** : « nombre + espace + code ISO 4217 », point décimal, montant de la devise de la boutique :
  `18000 XOF`, `19.99 EUR`, `1500 JPY`. Prix barré → `price` = prix de référence et `sale_price` = prix payé ;
  promotion datée → `sale_price_effective_date` = `2026-10-01T00:00Z/2026-10-31T23:59Z`.
- **Disponibilité** (jamais de quantité) : en stock / rupture ; un article vendu en rupture (politique « continuer
  à vendre ») est publié `backorder` chez Google (`preorder` y exigerait une date de disponibilité), `in stock` chez
  Meta (seules valeurs de flux acceptées : `in stock` / `out of stock`), `available for order` chez TikTok.
- **Variantes** : une ligne par variante, `item_group_id` = produit (jamais égal à un `id`), `color` / `size` lus
  dans les attributs de la variante, lien `…/p/{slug}?variant={id}`.
- **Liens** : domaine personnalisé **vérifié** de la boutique s'il existe (principal d'abord), sinon
  `https://{domaine Axi}/s/{slug}`. Meta et Google demandent un domaine que le marchand peut revendiquer : un
  marchand qui veut vendre sur Facebook / Instagram ou être validé dans Merchant Center doit connecter son domaine.
- **Images** : Google accepte le WebP et reçoit l'image d'origine. Meta et TikTok exigent du **JPEG ou PNG** : les
  photos téléversées (compressées en WebP par Axi) leur sont servies converties en JPEG par
  `/s/{slug}/feeds/img/{clé}.jpg` (`src/lib/social/feed-image.ts`, sharp, cache d'un an, débit limité).
  1 image principale + 10 supplémentaires (limite Google et TikTok).
- **Catégorie Google** (réglage facultatif « Catégorie Google ») : `google_product_category` dans les trois flux et
  l'API Meta ; utile à Google Shopping / YouTube et au classement Meta et TikTok.
- **Échappement / encodage** : UTF-8, caractères interdits en XML retirés, `& < > " '` échappés ; CSV RFC 4180 avec
  neutralisation des formules. Titres ≤ 150 (Google), ≤ 100 dans l'API Meta ; descriptions ≤ 5 000.
- **Exclus** : cartes cadeaux, produits non actifs, articles sans photo publique ou à prix nul (listés à l'écran).
- **Confidentialité** : jamais de prix d'achat, SKU interne, étiquette, note ni quantité en stock.

### Synchronisation directe Meta (`items_batch`)

`POST https://graph.facebook.com/{META_GRAPH_VERSION|v26.0}/{catalog_id}/items_batch`, corps
`{ item_type: "PRODUCT_ITEM", allow_upsert: true, requests: [{ method: "UPDATE" | "DELETE", data }] }`,
`additional_image_link` en **tableau JSON**. Lots de 500 requêtes (Meta : 5 000 maximum, moins de 3 000 recommandé,
28 Mo). Synchronisation incrémentale (empreinte par article), backoff 5 min → 24 h, quota Meta (erreur 80014)
relancé automatiquement.

Le traitement Meta est **asynchrone** : chaque envoi planifie un suivi `check_batch_request_status`
(`load_ids_of_invalid_requests=true`) à 1, 2, 5, 15, 30 puis 60 min. Lot terminé : les articles refusés passent en
erreur avec le message de Meta (écran « Articles refusés par Meta ») ; lot annulé ou en erreur côté Meta : les
articles du passage sont remis en attente et renvoyés.

Jeton : celui de l'intégration WhatsApp Cloud de la boutique (chiffré, jamais journalisé), avec la permission
**`catalog_management`**. Version Graph : `META_GRAPH_VERSION` (défaut `v26.0`). Utiliser **soit** le flux Meta,
**soit** la synchronisation directe pour un même catalogue.

## 2. Facebook

**Ce qui marche** : catalogue Meta alimenté par Axi (flux ou synchronisation) ; produits visibles dans le catalogue
WhatsApp du numéro ; annonces catalogue (Advantage+) ; section « Direct » de la boutique avec lecteur Facebook
intégré pour une vidéo ou un direct **public** de Page ; réservation par commentaire (« commenter pour acheter »,
`docs/LIVE-COMMERCE.md`).

**Activer (marchand)** :
1. Axi : *Intégrations > Catalogue WhatsApp et flux* → activer « Meta », copier l'adresse.
2. Commerce Manager → *Catalogue > Sources de données > Flux de données > Flux programmé* → coller l'adresse,
   mise à jour toutes les heures. (Ou : identifiant du catalogue + synchronisation directe dans Axi.)
3. Gestionnaire WhatsApp → *Outils du compte > Catalogue* → relier le catalogue au numéro.
4. Pour une Boutique Facebook : Commerce Manager → créer la boutique, **vérifier le domaine** (domaine personnalisé
   connecté dans Axi), attendre l'examen de Meta.

**Dépend d'une approbation Meta** : Boutique Facebook (critères d'éligibilité commerce : conformité, domaine
représenté, **pays pris en charge**, ancienneté / confiance, politique de retour visible) ; examen de chaque produit
(refus visibles dans Commerce Manager > Problèmes et, en synchronisation directe, dans Axi).

## 3. Instagram

**Ce qui marche** : les produits du catalogue Meta (le même que Facebook) ; la Boutique Instagram et l'onglet Boutique
si Meta l'approuve ; lecteur intégré dans la section « Direct » pour une **publication ou un Reel** (`/p/…`,
`/reel/…`).

**Identification de produits sur les publications / Reels** (nouveau, derrière le drapeau
`SOCIAL_IG_PRODUCT_TAGGING=1`, écran *Intégrations > Produits sur Instagram*) :
1. Prérequis : compte Instagram **professionnel** (pas Créateur) relié à la Page ; catalogue Meta alimenté par Axi ;
   **Boutique Instagram approuvée** ; jeton avec `instagram_basic`, `instagram_shopping_tag_products`,
   `catalog_management` (et `ads_management` selon le rôle) ; ces permissions exigent l'**App Review** de Meta pour
   l'application Axi.
2. Le marchand saisit l'identifiant numérique du compte ; Axi vérifie `shopping_product_tag_eligibility` et choisit
   le catalogue (`available_catalogs`, de préférence celui de la synchronisation).
3. Il choisit une publication récente (Stories et Live exclus) et 1 à 5 produits ; Axi retrouve chaque produit dans le
   catalogue Meta par son `retailer_id` (`catalog_product_search`) puis appelle `POST /{media-id}/product_tags`.
   Un produit non encore approuvé par Meta est identifié mais n'apparaît qu'après approbation.
Limites Meta : 25 publications identifiées par 24 h (appliquée aussi par Axi), 20 identifications par publication,
30 par Reel.

**Dépend d'une approbation Meta** : Boutique Instagram, examen des produits, App Review des permissions. **Depuis le
10/08/2023, Meta retire l'identification de produits aux entreprises sans boutique avec paiement intégré dans la
plupart des cas** (note officielle du guide « Product Tagging ») : pour un marchand béninois, l'éligibilité renverra
très probablement `false`. La fonction reste donc désactivée par défaut.

## 4. TikTok

**Ce qui marche** : flux CSV `tiktok.csv` conforme aux « Catalog Product Parameters » (9 champs obligatoires, images
JPEG, `available for order` pour la vente en rupture) ; section « Direct » : lecteur intégré pour une **vidéo** TikTok
(`/@compte/video/{id}`, lecteur `tiktok.com/player/v1/{id}`).

**Activer** : Axi → activer « TikTok », copier l'adresse → TikTok Ads Manager → *Ressources > Catalogues > Ajouter des
produits > Flux de données* → coller l'adresse, mise à jour planifiée.

**Dépend de TikTok** : les catalogues produits (Video Shopping Ads) ne sont ouverts qu'aux **comptes gérés situés dans
un marché lancé** (mention officielle de la page des paramètres). TikTok Shop (vente dans l'application) relève de
l'intégration dédiée (`src/lib/tiktok-shop/**`, autre équipe) et n'existe que dans les pays où TikTok Shop est ouvert.

## 5. YouTube

**Ce qui marche** : le flux `google.xml` alimente Google Merchant Center, donc les fiches gratuites Google Shopping et
les annonces Shopping diffusées notamment sur YouTube (via Google Ads) ; lecteur YouTube intégré dans la section
« Direct » pour une vidéo ou un direct (`watch?v=`, `/live/{id}`, `youtu.be/…`, `/channel/UC…/live`), servi par
`youtube-nocookie.com`.

**Activer** : Axi → activer « Google Merchant Center », copier l'adresse → Merchant Center → *Produits > Sources de
données > Fichier récupéré à heure fixe* ; renseigner pays de vente, **frais de livraison** (obligatoires pour
plusieurs pays) et politique de retour ; revendiquer le domaine de la boutique.

**Pas possible aujourd'hui : la « boutique YouTube » (YouTube Shopping)**. Relier une boutique à une chaîne exige un
**plateforme ou revendeur partenaire** (Shopify, Wix, Spring, Fourthwall, SHOPLINE…) : Axi n'en fait pas partie (un
partenariat se négocie avec YouTube). La chaîne doit en outre être dans le Programme Partenaire YouTube, et les
spectateurs ne voient les produits que dans les pays pris en charge. Les champs Merchant Center utiles à YouTube
Shopping (titre, prix, disponibilité, images, `item_group_id`, `google_product_category`) sont déjà émis.

## 6. Ce qui n'est pas possible (ou pas pour un marchand d'Afrique de l'Ouest)

- **Paiement natif Meta** (achat sans quitter Facebook / Instagram) : réservé aux boutiques avec paiement intégré,
  non ouvert aux marchands d'Afrique de l'Ouest ; le « direct checkout » mentionné par la spécification Meta « n'est
  pas encore disponible pour tous ». Les produits renvoient donc vers la boutique Axi.
- **Identification de produits Instagram** sans boutique avec paiement intégré : retirée par Meta depuis 2023 (§3).
- **Intégrer un DIRECT TikTok ou Instagram** sur la boutique : aucun lecteur officiel ; la section « Direct » propose
  « Ouvrir sur TikTok / Instagram ». Une page `youtube.com/@chaîne/live` (sans identifiant) n'est pas intégrable non
  plus : coller le lien de la vidéo du direct.
- **Boutique YouTube** reliée à Axi (§5).

## 7. Section « Direct » de la vitrine

- Lecteur officiel intégré **pendant** le direct (réglage « Afficher le lecteur vidéo », activé par défaut), chargé
  seulement au clic du client (aucun traceur tiers avant, données mobiles économisées), format 16:9 ou vertical 9:16.
- CSP : `frame-src` n'autorise que `www.youtube-nocookie.com`, `www.youtube.com`, `www.facebook.com`,
  `www.tiktok.com`, `www.instagram.com` (next.config.ts, test `tests/social-live-embed.test.ts`) ; aucun script tiers
  ajouté.
- Produit épinglé en tête et rafraîchi toutes les 15 s (section visible et onglet actif seulement), annoncé aux
  lecteurs d'écran ; bouton **« Ajouter »** au panier sans quitter le direct pour un produit simple (sans variante ni
  option, vendable), sinon lien vers la fiche ; cibles de 44 px au moins.

## 8. Non vérifiable sans compte réel

- Ingestion effective des flux par Commerce Manager, Merchant Center et TikTok (diagnostics de chaque plateforme).
- Réponses réelles de `items_batch` / `check_batch_request_status` avec le jeton système et le catalogue du porteur.
- Éligibilité Instagram et App Review des permissions `instagram_shopping_tag_products` / `catalog_management`.
- Rendu des lecteurs avec de vrais directs (vidéo privée ou restreinte : la plateforme affiche son propre message).
- Le lecteur TikTok v1 n'a pas pu être revérifié en ligne (page de documentation rendue en JavaScript).

## Sources (consultées le 14/10/2026)

- Google Merchant Center, *Product data specification* : https://support.google.com/merchants/answer/7052112
- Meta, *Product data specifications for catalogs in Commerce Manager* : https://www.facebook.com/business/help/120325381656392
- Meta, *Product image specifications* : https://www.facebook.com/business/help/686259348512056
- Meta, *Commerce eligibility requirements* : https://www.facebook.com/business/help/2347002662267537
- Meta for Developers, *Product Catalog Items Batch* : https://developers.facebook.com/docs/marketing-api/catalog-batch/reference
- Meta for Developers, *Check Batch Request Status* : https://developers.facebook.com/docs/marketing-api/reference/product-catalog/check_batch_request_status/
  et https://developers.facebook.com/docs/marketing-api/reference/check-batch-request-status
- Meta for Developers, *Product Tagging* (Instagram) : https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login/product-tagging
- Meta for Developers, *IG Media Product Tags* : https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-media/product_tags
- Meta for Developers, *Embedded Video & Live Video Player* : https://developers.facebook.com/docs/plugins/embedded-video-player
- TikTok Ads Manager, *Catalog Product Parameters* : https://ads.tiktok.com/help/article/catalog-product-parameters
- YouTube Help, *Get started with Shopping on YouTube* : https://support.google.com/youtube/answer/12257682
- YouTube Help, *Connect, manage & disconnect your store on YouTube* : https://support.google.com/youtube/answer/12258186
