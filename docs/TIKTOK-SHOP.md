# TikTok Shop — paiement sans quitter TikTok

Axi agit comme **application partenaire TikTok Shop** : le marchand relie sa boutique TikTok Shop, Axi y publie ses
produits (variantes, prix convertis, stock, images), importe les commandes payées dans TikTok comme commandes Axi
(stock commun) et remonte les expéditions (transporteur + numéro de suivi). Les produits en ligne apparaissent dans la
vitrine TikTok ; l'épinglage dans une vidéo ou un live se fait dans l'application TikTok, par le vendeur.

> **Statut de vérification.** L'implémentation suit l'Open API TikTok Shop « 202309 » (versionnée, toujours en
> vigueur pour les ressources utilisées) telle que documentée sur le Partner Center (`partner.tiktokshop.com/docv2`).
> Points vérifiés contre le SDK de référence (voir « Sources de vérification » en fin de document) ; les éléments restants
> doivent être vérifiés dans la console avant la mise en production. Tout ce qui dépend de TikTok est isolé derrière
> l'interface `TiktokShopApi` (`src/lib/tiktok-shop/types.ts`) avec un client simulé (`TIKTOK_SHOP_FAKE=1`).

## 1. Devenir partenaire (démarches côté TikTok)

1. **Créer le compte partenaire** sur <https://partner.tiktokshop.com> (type « Independent Software Vendor / App
   developer »), avec l'entité juridique qui opère Axi. Vérification de l'entreprise (documents d'immatriculation).
2. **Créer l'application** : *App & Service → Create app* → type **Custom / Public app** (« Public » pour être proposée
   à tous les vendeurs ; nécessite la revue de TikTok). Choisir les **régions** ciblées (global et/ou US : l'app US
   est distincte).
3. **Renseigner** :
   - **Redirect URL (callback)** : `https://<domaine-axi>/api/tiktok-shop/callback`
   - **Webhook URL** : `https://<domaine-axi>/api/webhooks/tiktok-shop`
   - Événements webhook à cocher : **Order status change** (type 1), **Product status change** / audit produit,
     **Seller deauthorization** (type 6). Types vérifiés : 1 ORDER_STATUS_CHANGE, 2 REVERSE_ORDER_STATUS_CHANGE, 3 RECIPIENT_ADDRESS_UPDATE, 4 PACKAGE_UPDATE, 5 PRODUCT_STATUS_CHANGE, 6 SELLER_DEAUTHORIZATION, 7 UPCOMING_AUTHORIZATION_EXPIRATION, 12 RETURN_STATUS_CHANGE (source : SDK EcomPHP `src/Webhook.php`).
4. **Demander les permissions (scopes / API packages)** :
   - *Authorization* : `seller.authorization.info` (boutiques autorisées, `shop_cipher`)
   - *Product* : `seller.product.basic`, `seller.product.write` (catégories, attributs, images, création, stock)
   - *Order* : `seller.order.info`
   - *Fulfillment / Logistics* : `seller.fulfillment.basic`, `seller.logistics` (entrepôts, transporteurs, expédition)
5. Récupérer **App key**, **App secret** et **Service ID** (lien d'autorisation) → variables d'environnement (§3).
6. **Tester** avec un compte vendeur de test (*sandbox / test shop* du Partner Center), puis **soumettre l'app à la
   revue** (description, captures d'écran du parcours de connexion, politique de confidentialité, gestion des données
   acheteurs) avant toute publication pour des vendeurs réels.

## 2. Parcours marchand

Intégrations → **TikTok Shop** (`/app/{storeId}/integrations/tiktok-shop`) :

1. **Connecter TikTok Shop** (propriétaire uniquement, capacité `integrations.manage`) → page d'autorisation TikTok →
   retour sur le callback. Si plusieurs boutiques TikTok sont autorisées, le marchand choisit la sienne.
2. Par produit : **catégorie TikTok** (recherche par mot-clé, catégories feuilles uniquement) → **attributs
   obligatoires** → **Publier**. Le produit passe « En revue TikTok » puis « En ligne » (ou « Refusé », motif affiché).
3. Réglages : majoration de prix (commission, change), poids et dimensions de colis par défaut, quantité annoncée sans
   suivi de stock, synchronisation automatique.

## 3. Variables d'environnement

| Variable | Rôle |
| --- | --- |
| `TIKTOK_SHOP_APP_KEY` | App key (Partner Center). Absente : écran « Bientôt disponible », webhook en 503. |
| `TIKTOK_SHOP_APP_SECRET` | App secret : signature des requêtes et vérification des webhooks. Jamais côté client. |
| `TIKTOK_SHOP_SERVICE_ID` | Service ID du lien d'autorisation vendeur. |
| `TIKTOK_SHOP_API_BASE` | Défaut `https://open-api.tiktokglobalshop.com`. |
| `TIKTOK_SHOP_AUTH_BASE` | Défaut `https://auth.tiktok-shops.com` (échange / rafraîchissement des jetons). |
| `TIKTOK_SHOP_AUTHORIZE_BASE` | Défaut `https://services.tiktokshop.com` (`services.tiktokshops.us` pour une boutique aux États-Unis — app US distincte, Partner Center partner.us.tiktokshop.com). |
| `TIKTOK_SHOP_FAKE` | `1` = client simulé (dev / recette). **Ignoré si `NODE_ENV=production`.** |

Le cron `/api/jobs/run` planifie `tiktok_shop.sweep` toutes les 10 minutes (sans effet si l'app n'est pas configurée).

## 4. Marchés couverts

TikTok Shop n'accepte que des vendeurs enregistrés (entité, compte bancaire, adresse d'expédition) dans ses marchés :
États-Unis (USD), Royaume-Uni (GBP), France, Allemagne, Italie, Espagne, Irlande (EUR), Mexique (MXN), Brésil (BRL),
Japon (JPY), Indonésie (IDR), Malaisie (MYR), Thaïlande (THB), Viêt Nam (VND), Philippines (PHP), Singapour (SGD).
Liste dans `src/lib/tiktok-shop/markets.ts`, à tenir à jour.

**Aucun marché d'Afrique subsaharienne n'est ouvert** (Bénin compris). L'écran l'explique au marchand ; il peut relier
une boutique TikTok ouverte par sa société dans un marché couvert. La région de la boutique TikTok fait foi, et fixe la
devise : les prix Axi sont **convertis** (taux plateforme BCE / parité fixe XOF-EUR, rafraîchis chaque jour, refus au-delà
de 72 h) puis majorés selon le réglage, arrondis au centime supérieur du marché (IDR, VND, JPY sans décimales).

## 5. Fonctionnement technique

| Sujet | Implémentation |
| --- | --- |
| Signature | HMAC-SHA256(app_secret, secret + chemin + paramètres triés hors `sign`/`access_token` + corps JSON + secret), hex. Jeton dans `x-tts-access-token`, `shop_cipher` sur toute ressource de boutique (`sign.ts`, `client.ts`). |
| Jetons | `GET /api/v2/token/get` (code) et `/api/v2/token/refresh`. Chiffrés (`encryptSecret`) dans `Integration.secretsEncrypted` ; échéances dans `config`. Rafraîchis 5 min avant échéance ou sur erreur 1050xx (une fois). Refus → connexion « erreur », reconnexion demandée. |
| State OAuth | HMAC (clé dérivée d'`APP_SECRET`) de `{storeId, userId, nonce, exp}` + nonce en cookie httpOnly limité au callback ; même utilisateur exigé, 10 min. |
| Quotas / erreurs | Délai 15 s ; reprises bornées (2, backoff, `Retry-After`) sur 429 / 5xx / réseau, **uniquement** pour les opérations idempotentes. Erreurs typées `TiktokShopError` (auth, rate_limit, validation…). |
| Produits | `POST /product/202309/products` (création), `PUT …/products/{id}` (modification), `POST /product/202309/images/upload` (multipart, URI mémorisée par URL), `GET /product/202309/categories`, `GET …/categories/{id}/attributes`, `POST …/products/search` (retrouver un produit créé dont la réponse a été perdue, par `seller_sku`), `GET …/products/{id}` (état de revue). |
| Stock | `POST /product/202309/products/{id}/inventory/update` (entrepôt de vente par défaut, `GET /logistics/202309/warehouses`). Seuls les écarts avec la dernière quantité envoyée partent : tout mouvement Axi (vente, caisse, ajustement, retour, annulation) est répercuté au passage suivant (≤ 10 min) et immédiatement après chaque import de commande. |
| Commandes | Webhook (job `tiktok_shop.order`, relecture `GET /order/202309/orders?ids=`) + relève `POST /order/202309/orders/search` (chevauchement 10 min). Import des statuts payés (`ON_HOLD` et suivants) ; `CANCELLED` → annulation Axi (restock exact). Idempotence par `Order.idempotencyKey = "tiktok_shop:{id}"` (unique par boutique). |
| Montants | Tels que payés dans TikTok, convertis en devise boutique ; instantané `presentment*` = montants TikTok. Invariant `total = sous-total − remises + livraison (+ taxe hors US)`. Commande `CONFIRMED`, `PAID`, reste dû 0. |
| Expéditions | Expédition saisie dans Axi avec numéro de suivi → `POST /fulfillment/202309/orders/{id}/packages` (« Mark package as shipped », corps `tracking_number`, `shipping_provider_id`, `order_line_item_ids` — vérifié, SDK EcomPHP `Fulfillment::markPackageAsShipped` ; vendeurs en expédition par la plateforme : non applicable) avec le transporteur TikTok correspondant (`GET /logistics/202309/delivery_options/{id}/shipping_providers`, correspondance par nom). Une seule fois par expédition (marqueur dans l'historique). |
| Webhooks | En-tête `Authorization` = HMAC-SHA256(app_secret, app_key + corps brut) ; `ProviderEvent(provider="tiktok_shop", eventId=tts_notification_id)` dans la même transaction que le job. |

## 6. Limites connues

- **Canal de commande** : l'énumération `OrderChannel` n'a pas de valeur TikTok (schéma non modifiable sans accord).
  Les commandes sont en canal `MANUAL`, référence `TT-…`, `attribution.source = "tiktok_shop"`, moyen « TikTok Shop ».
  Ajouter `TIKTOK_SHOP` à l'énumération est recommandé (migration additive).
- **Stockage des liens produits** dans `Integration.config` (JSON, verrou optimiste) : plafonné à 1 000 produits par
  boutique. Au-delà, prévoir une table dédiée.
- **Coordonnées acheteur** : TikTok masque souvent le téléphone ; la fiche client n'est créée qu'avec un numéro complet.
  L'e-mail acheteur n'est pas conservé (contact hors plateforme interdit par TikTok).
- **Expédié par TikTok (FBT)** : commande importée sans décrément de stock ni expédition à saisir.
- **Unicité boutique TikTok ↔ boutique Axi** : contrôlée à la sélection (contrôle applicatif, pas de contrainte en base).
- **Retours / remboursements** : gérés dans TikTok ; seule l'annulation complète est répercutée automatiquement.
- **Promotions TikTok**, frais de service, étiquettes d'expédition TikTok (`shipping_type = TIKTOK`) : non gérés dans
  cette version (le vendeur imprime l'étiquette dans Seller Center).
- **Live / vidéos** : l'API ne permet pas d'épingler un produit dans un live ; le vendeur le fait dans l'app TikTok.

## 7. Recette (mode simulé)

`TIKTOK_SHOP_FAKE=1` + `pnpm dev` : « Connecter TikTok Shop » relie deux boutiques fictives (FR, UK) ; catégories
« Robes », « Soins du visage »… ; attribut obligatoire « Matière » ; le produit devient « En ligne » à la deuxième
lecture de son état. Les commandes simulées s'injectent par `injectFakeOrder()` (`src/lib/tiktok-shop/fake.ts`).
Tests : `pnpm exec vitest run tests/tiktok-shop`.

## Sources de vérification (14/10/2026)

Les pages `partner.tiktokshop.com/docv2` sont rendues en JavaScript et non lisibles hors navigateur connecté ; la
vérification s'appuie sur le SDK PHP de référence qui les cite :
- Signature des requêtes (chemin + paramètres triés hors `sign`/`access_token`/`x-tts-access-token`, corps brut sauf
  GET et multipart, encadrement par l'app_secret, HMAC-SHA256 hex), en-tête `x-tts-access-token`, `content-type:
  application/json`, `shop_cipher` absent pour `/authorization/*` et `/product/*/images/upload` :
  <https://github.com/EcomPHP/tiktokshop-php/blob/master/src/Client.php> (réf. <https://partner.tiktokshop.com/doc/page/274638>).
- Jetons : `GET https://auth.tiktok-shops.com/api/v2/token/get?app_key&app_secret&auth_code&grant_type=authorized_code`
  et `/api/v2/token/refresh?…&refresh_token&grant_type=refresh_token` : <https://github.com/EcomPHP/tiktokshop-php/blob/master/src/Auth.php>.
- Webhooks : `Authorization` = HMAC-SHA256(app_secret, app_key + corps brut) hex ; numéros de type :
  <https://github.com/EcomPHP/tiktokshop-php/blob/master/src/Webhook.php>.
- Chemins 202309 (shops, categories, attributes, images/upload, products, inventory/update, products/search,
  orders/search, orders, orders/{id}/packages) : `src/Resources/*.php` du même dépôt.
- Lien d'autorisation `services.tiktokshop.com/open/authorize?service_id=…` (et `services.tiktokshops.us` pour les
  apps US) : <https://example-code.com/nodejs/tiktok_shop_oauth2.asp>,
  <https://fivetran.com/docs/connectors/applications/tiktok-shop-partner-center/api-configuration>.

**Encore non vérifiable sans compte partenaire** : durées de vie exactes des jetons (lues dans la réponse,
`access_token_expire_in` / `refresh_token_expire_in`), liste à jour des marchés ouverts, chemin
`/logistics/202309/delivery_options/{id}/shipping_providers` (absent du SDK consulté).
