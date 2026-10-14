# Connecteurs IA : serveur MCP, jetons API et OAuth

Axi expose ses boutiques aux assistants IA (Claude, ChatGPT, Cursor, agents maison) via le **Model Context Protocol** (MCP, spécification `2025-06-18`), transport **Streamable HTTP en mode sans état**.

| Point d'accès | Rôle | Authentification |
|---|---|---|
| `POST /api/mcp` | Serveur MCP **marchand** : gérer UNE boutique | `Authorization: Bearer` jeton API (`axi_live_…`) ou jeton d'accès OAuth (`axi_oat_…`) |
| `POST /api/mcp/store/{slug}` | Serveur MCP **vitrine public** (commerce agentique) | Aucune (limité par IP) |
| `GET /s/{slug}/llms.txt` | Description de la boutique pour les IA | Aucune |
| `GET /.well-known/oauth-protected-resource[/api/mcp]` | Métadonnées de ressource (RFC 9728) | Aucune |
| `GET /.well-known/oauth-authorization-server` | Métadonnées du serveur d'autorisation (RFC 8414) | Aucune |
| `POST /api/oauth/register` | Enregistrement dynamique de client (RFC 7591) | Aucune (limité par IP) |
| `GET /oauth/authorize` | Page de consentement Axi | Session marchand |
| `POST /api/oauth/token` | `authorization_code` (+ PKCE S256), `refresh_token` (rotation) | Client public ou secret |
| `POST /api/oauth/revoke` | Révocation (RFC 7009) | Client |

Code : `src/lib/mcp/**` (protocole `protocol.ts`, transport `http.ts`, auth `auth.ts`, OAuth `oauth.ts`, outils `merchant/*`, vitrine `public/*`), interface `src/app/app/[storeId]/integrations/ia`, console `src/app/admin/connecteurs-ia`.

## 1. Transport

- `POST` d'un message JSON-RPC 2.0 avec `Content-Type: application/json`. **Lots (tableaux) refusés (`-32600`, HTTP 400) dès que la version négociée est `2025-06-18` ou plus** ; acceptés (20 messages max) pour les versions antérieures, chaque message étant alors décompté du quota. Sans en-tête `MCP-Protocol-Version`, la version supposée est `2025-03-26` (spécification). Réponse `application/json` (jamais de flux SSE). Notifications seules : `202` sans corps.
- `GET` et `DELETE` : `405` (pas de session `Mcp-Session-Id`, pas de flux serveur).
- En-tête `MCP-Protocol-Version` : versions acceptées `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05` ; autre valeur : `400`.
- Méthodes : `initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call`, `resources/list`, `resources/read`, `resources/templates/list`, `prompts/list`, `prompts/get` (et `logging/setLevel`, `completion/complete` sans effet).
- Erreurs : `-32700` JSON invalide, `-32600` requête invalide, `-32601` méthode inconnue, `-32602` paramètres / outil inconnu, `-32603` erreur interne, `-32001` non autorisé (HTTP 401/403), `-32029` quota (HTTP 429 + `Retry-After`), `-32030` arrêt d'urgence (HTTP 503).
- Une erreur **métier** d'un outil (produit introuvable, scope manquant, transition impossible, arguments invalides) est un résultat `{ isError: true }` lisible par le modèle, pas une erreur JSON-RPC.
- Résultats : `content[0].text` (résumé lisible), `content[1].text` (JSON) et `structuredContent` (objet).
- CORS ouvert (`*`) sans cookie : l'authentification est uniquement par en-tête.

## 2. Jetons API

Créés par le **propriétaire** (capacité `integrations.manage`) dans *Boutique › Connecteurs IA* :

- format `axi_live_` + 40 caractères (240 bits) ; préfixe visible `axi_live_xxxxxxxx` ; **seul le hachage SHA-256 est stocké** ; le secret n'est affiché qu'une fois ;
- recherche par préfixe puis comparaison du hachage **en temps constant** ;
- expiration (7, 30, 90, 365 jours ou jamais), révocation immédiate, rotation (nouveau secret, mêmes droits, l'ancien cesse aussitôt) ;
- vérifiés à **chaque requête** : non révoqué, non expiré, créateur toujours membre de la boutique, boutique non archivée ; `lastUsedAt` / `lastUsedIp` mis à jour au plus une fois par minute.

La boutique est **toujours déduite du jeton** : aucun paramètre d'outil ne permet d'en viser une autre.

## 3. Scopes

| Scope | Accès | Plan minimal |
|---|---|---|
| `store:read` | Informations et indicateurs de la boutique | Gratuit |
| `catalog:read` | Produits, variantes, stock, collections | Gratuit |
| `orders:read` | Commandes, paiements, historique | Gratuit |
| `customers:read` | Données personnelles des clients | Gratuit |
| `analytics:read` | Rapports de ventes | Gratuit |
| `catalog:write` | Créer et modifier produits, prix, collections | Starter |
| `inventory:write` | Ajuster le stock | Starter |
| `orders:write` | Statut et notes des commandes | Starter |
| `marketing:write` | Codes promo, remises automatiques | Business |
| `giftcards:write` | Émettre des cartes cadeaux, créditer un avoir (rôles OWNER et MANAGER) | Business |
| `content:write` | Articles de blog (brouillons) | Starter |
| `webhooks:write` | Webhooks sortants et leurs livraisons (rôle OWNER uniquement) | Business |
| `theme:write` | Thème de la boutique, sections enregistrées | Business |

**Portée effective = scopes du jeton ∩ scopes du plan ∩ scopes du rôle** du membre (STAFF : `store:read`, `orders:read`, `orders:write` ; SUPPORT : lecture sans écriture), recalculée à chaque requête. `tools/list` ne présente que les outils utilisables ; un appel hors portée renvoie `isError` avec la raison (plan ou scope). Sans `customers:read`, noms, téléphones et adresses sont masqués dans les commandes.

## 4. Plans et quotas (`src/config/plans.ts`, `MCP_LIMITS`)

| Plan | Scopes | Jetons actifs | OAuth | Appels / min | Appels d'outils / jour |
|---|---|---|---|---|---|
| Gratuit | lecture | 1 | non | 20 | 300 |
| Starter | lecture + catalogue, stock, commandes | 3 | non | 60 | 3 000 |
| Business | tous | 10 | oui | 120 | 20 000 |
| Scale | tous | illimité | oui | 300 | 100 000 |
| Enterprise | tous | illimité | oui | 600 | illimité |

Débit par minute : par boutique **et** par jeton/application (`RateLimit`, fenêtre fixe, multi-instances), **compté par message JSON-RPC** (un lot de N messages consomme N unités). Quota journalier : par boutique, sur chaque `tools/call`. MCP vitrine : 60 messages / min et 600 / h par IP (comptés par message), 10 liens de panier / 10 min par IP, tous plans.

## 5. Outils du serveur marchand (`/api/mcp`)

Montants : **entiers dans la plus petite unité de la devise** de la boutique (XOF/XAF sans décimales : `5000` = 5 000 FCFA ; EUR en centimes). Chaque montant renvoyé est accompagné de `formatted`.

| Outil | Scope | Écrit | Résumé |
|---|---|---|---|
| `get_store_overview` | store:read | | Identité, plan, ventes jour/7 j/30 j, panier moyen, à traiter, meilleures ventes |
| `search_products` | catalog:read | | Texte, statut, étiquette, collection ; pagination `cursor` |
| `get_product` | catalog:read | | Variantes, options, suppléments, stock, collections ; `inventory_policy` (`deny`/`continue`, produit et variantes), `barcode`, `low_stock_threshold` (null = seuil boutique), `effective_low_stock_threshold`, `oversold` |
| `create_product` | catalog:write | oui | Produit simple, **brouillon par défaut**, quota produits et photos du plan ; `inventory_policy`, `low_stock_threshold`, `barcode` facultatifs |
| `update_product` | catalog:write | oui | Titre, description, prix, prix barré, promo datée, statut, étiquettes, collections manuelles |
| `update_variant_price_stock` | catalog:write / inventory:write | oui | Prix (catalog:write) ; stock absolu, `inventory_policy` (`deny`/`continue`, par variante ou produit simple) et `low_stock_threshold` (niveau produit, `null` = seuil boutique ; `variant_id` non exigé pour le seuil seul) en inventory:write, avec verrou de ligne et mouvement d'inventaire |
| `list_collections` | catalog:read | | Manuelles / automatiques, nombre de produits |
| `add_products_to_collection` | catalog:write | oui | Collection manuelle uniquement (verrou `lockStoreCategories`) |
| `adjust_inventory` | inventory:write | oui | Retrait conditionnel (`stock >= -delta`, jamais négatif), réassort toujours appliqué (même après survente), motif, mouvement `ADJUSTMENT` ; `inventory_policy` et `low_stock_threshold` facultatifs |
| `list_low_stock` | catalog:read | | Articles au plus à leur seuil (produit, sinon boutique), ruptures et surventes d'abord, variantes désactivées exclues ; `threshold` facultatif = seuil unique imposé ; chaque ligne : `threshold`, `inventory_policy`, `oversold`. Modifier `low_stock_threshold` horodate le seuil (pas d'alerte pour des passages antérieurs) |
| `list_orders` | orders:read | | Statut, paiement, période, référence ; pagination |
| `get_order` | orders:read | | Articles, montants, livraison, paiement, historique, statuts suivants |
| `update_order_status` | orders:write | oui | **Via `transitionOrder`** (machine d'états, restock à l'annulation, outbox, notification) ; motif obligatoire pour annuler |
| `add_order_note` | orders:write | oui | `OrderEvent` de type `note` |
| `list_customers` | customers:read | | Recherche, tri récence / valeur |
| `get_customer` | customers:read | | Coordonnées, consentement WhatsApp marketing, fidélité, 20 dernières commandes |
| `create_discount_code` | marketing:write | oui | PERCENT / FIXED / FREE_DELIVERY, dates (jour entier dans le fuseau de la boutique), limites |
| `list_discount_codes` | marketing:write ou analytics:read | | Validité et utilisations |
| `sales_report` | analytics:read | | Par jour / semaine (fuseau boutique) / produit, comparaison période précédente, 366 jours max |
| `list_automatic_discounts` | marketing:write ou analytics:read | | Remises automatiques (lot 1) : type, résumé en phrase (`describeDiscount`), statut calculé, utilisations, autorisée ou non par le plan |
| `create_automatic_discount` | marketing:write | oui | `PRODUCT_AMOUNT`, `CART_TIER` (Starter+), `BUY_X_GET_Y`, `BUNDLE` (Business+) ; `config` validée par `parseDiscountConfig`, références vérifiées dans la boutique, dates en jours entiers (fuseau boutique), 200 remises max ; capacité `coupons.manage` |
| `set_automatic_discount_active` | marketing:write | oui | Désactivation toujours possible ; activation contrôlée par le plan |
| `list_gift_cards` | orders:read | | Statut affiché, solde, expiration ; **4 derniers caractères seulement**, nom du destinataire sous `untrusted_customer_input` (masqué sans customers:read) |
| `issue_gift_card` | giftcards:write | oui | Carte manuelle (`createGiftCardRecord`, journal `ISSUE`) ; **confirmation toujours requise** ; le code n'est **jamais** renvoyé (envoi par e-mail via `giftcard.deliver` si `send_now`, sinon révélation auditée dans le tableau de bord) ; capacité `giftcards.manage`, fonctionnalité `giftCards` |
| `grant_store_credit` | giftcards:write **et** customers:read | oui | `grantTx` (`GRANT`, motif obligatoire), **confirmation toujours requise** ; capacité `customers.manage`, fonctionnalité `storeCredit` |
| `list_returns` | orders:read | | Retours par statut, prochains statuts ; nom et note de l'acheteur sous `untrusted_customer_input` |
| `get_return` | orders:read | | Articles, motif, résolution, montants, historique ; note, motifs par article et messages sous `untrusted_customer_input` (photos : nombre seulement) |
| `update_return_status` | orders:write | oui | **Via `canTransitionReturn`** puis les services de l'équipe D (`approveReturn`, `rejectReturn` avec motif obligatoire, `cancelReturn`, `receiveReturn` totalité reçue avec ou sans remise en stock, `resolveReturn` `STORE_CREDIT` ou `REFUND` au montant suggéré) ; capacités `returns.manage` / `returns.receive` (+ `payments.confirm` pour rembourser) ; résolution : **confirmation toujours requise** |
| `get_catalog_sync_status` | catalog:read | | Lot 1 bis : URL des flux activés (Meta, Google, TikTok), état de la synchronisation du catalogue WhatsApp, compteurs, articles refusés par Meta et motif (20 par défaut, 50 max) |
| `trigger_catalog_sync` | catalog:write | oui | Synchronisation forcée du catalogue WhatsApp ; plan `catalogSync` (Business+), 6 par heure et par boutique, audit `api.catalog.sync_requested` |
| `list_webhook_deliveries` | webhooks:write | | Lot 2 : livraisons des webhooks sortants (statut, essais, code HTTP, extrait de réponse sous `untrusted_customer_input`) ; filtres `endpoint_id`, `status[]`, `event` ; Business+, propriétaire |
| `list_blog_posts` | content:write | | Lot 2 : articles (statut, date, catégorie, étiquettes, adresse publique) |
| `create_blog_post` | content:write | oui | Lot 2 : **brouillon** uniquement (jamais publié), Markdown limité sans image, quota d'articles du plan |
| `set_metafield` | catalog:write | oui | Lot 4A : valeur d'un champ personnalisé (produit, variante, collection) validée par type ; `null` efface ; Starter+ ; audit `api.metafield.values.update` |
| `list_saved_sections` | store:read ou theme:write | | Lot 4A : sections de thème enregistrées, pages compatibles, usage, limite du plan |
| `get_tax_settings` | store:read | | Lot 2 : TVA collectée ou non, TTC / HT, régime (TVA, TPS, autre), identité fiscale (raison sociale, IFU/NIF, RCCM), taux par pays et catégorie, émission automatique des factures, nombre de factures et d'avoirs ; aucun conseil fiscal |
| `list_digital_downloads` | orders:read | | Vague 2 : accès de téléchargement des produits numériques (téléchargements utilisés, limite, expiration, dernier téléchargement, e-mail envoyé) ; filtres `order_id`, `product_id`, `state` ; **jamais de lien ni de jeton** |
| `list_product_files` | catalog:read | | Vague 2 : fichiers vendus d'un produit numérique (nom, taille, type, version) ; jamais de clé de stockage ni de lien |

Vague 2 : `search_products` et `get_product` renvoient `kind` (`physical`, `digital`, `service`, `gift_card`), plus les blocs `digital` (fichiers, limites) et `service` (durée, lieu, à distance) ; `create_product` accepte `kind: physical | digital | service` (les fichiers se téléversent dans Axi, jamais par l'API).

Les écritures catalogue (`create_product`, `update_product`, `update_variant_price_stock`, `adjust_inventory`) émettent leurs événements de webhook (`product.*`, `inventory.updated`) dans leur transaction, avec `source: "mcp"` (ou `"api"` quand l'outil est exécuté par l'API REST).

Ressources : `axi://store/overview`, `axi://catalog/low-stock`. Prompts : `weekly_summary`, `restock_plan`, `weekend_promo` (argument `percent`), `orders_to_process`.

### Données saisies par les acheteurs (injection de prompt)

Tout texte saisi par un acheteur ou un tiers (nom, e-mail, adresse, note de commande, messages de l'historique) est regroupé sous **`untrusted_customer_input`** (avec un avertissement `notice`) et cité entre guillemets dans les résumés texte. Les `instructions` du serveur imposent au modèle de les traiter comme des données, jamais comme des consignes. Sans `customers:read`, sont aussi masqués : `customer_id`, référence de paiement, note interne et messages d'historique.

### Confirmation humaine

`create_discount_code`, `create_automatic_discount`, `issue_gift_card`, `grant_store_credit`, `update_return_status`, `update_product` et `update_variant_price_stock` sont annoncés `destructiveHint: true`. Sont refusés (`isError`, code `confirmation_required`) tant que l'appel ne porte pas `confirm: true` : remise `PERCENT` > 50 % (code promo ou remise automatique, y compris « article offert » à 100 %), remise `FIXED` supérieure au panier moyen des 30 derniers jours (ou sans vente récente), lot `BUNDLE` à prix fixe inférieur à 50 % de la somme de ses articles, **toute** émission de carte cadeau, **tout** crédit d'avoir, **toute** résolution de retour, variation de prix > 50 % (prix de base, prix de variante, ou prix promo à moins de 50 % du prix). Le modèle doit demander l'accord explicite du marchand avant de renvoyer l'appel.

Lot 1 : les outils de `merchant/promotions.ts` vérifient en plus la **capacité du rôle** du membre qui a créé la connexion (`roleHas`), en complément de l'intersection scopes ∩ plan ∩ rôle.

Erreurs de `update_order_status` : seules les erreurs métier connues de `transitionOrder` sont transmises ; toute autre erreur renvoie un message générique (détail dans les journaux serveur).

Écritures : boutique `SUSPENDED` refusée ; `audit()` avec l'action `api.*`, l'acteur (`actorId` = membre propriétaire du jeton ou de l'autorisation) et `metadata.actor` = `api:<nom du jeton>` ou `oauth:<application>` ; les événements de commande portent ce libellé.

## 6. MCP vitrine public (`/api/mcp/store/{slug}`)

Boutique `PUBLISHED` (ou `CLOSED_TEMPORARILY` en lecture, comme la vitrine) **et** option *Ouvrir ma boutique aux assistants IA* (`Store.aiAgentsEnabled`, activée par défaut, réglage dans Connecteurs IA). Outils : `get_store_info`, `search_catalog`, `get_product`, `check_availability`, `get_delivery_options`, `create_checkout_link`.

Seules les informations déjà visibles sur la vitrine publique sont exposées (vérifié champ par champ : description, adresse, téléphone, e-mail et horaires de contact, moyens de paiement, zones et créneaux, collections publiées, produits actifs, variantes et suppléments) ; ni prix d'achat, ni stock exact, ni date de fin de promotion. `check_availability` répond seulement disponible (`availability: "in_stock"`), disponible en précommande (`availability: "preorder"` : article en « continuer à vendre » dont le stock est nul ou négatif, expédition différée ; une quantité au-delà d'un stock positif reste `in_stock` pour ne pas révéler le niveau de stock) ou indisponible, 20 unités maximum par ligne ; `search_catalog` et `get_product` exposent un booléen `preorder`, jamais la quantité. Les photos téléversées (`/media/...`) sont exposées en URL absolue.

**Statistiques** : les appels publics ne sont pas journalisés ligne par ligne ; un compteur par boutique, outil et jour (`UsageCounter`, métrique `mcp_public:<outil>`, période `AAAA-MM-JJ`, purge à 90 jours) alimente le total « consultations sur 30 jours » de la page Connecteurs IA. Le journal du marchand ne contient que ses propres jetons et applications.

`create_checkout_link` crée un **brouillon de panier** (`Cart`, sans coordonnées) et renvoie `/s/{slug}?panier={jeton}` : la boutique restaure le panier (`loadCartDraft`) et **l'acheteur finalise lui-même**. Aucune commande, aucun paiement, aucune donnée client ; ni prix d'achat ni stock exact.

## 7. OAuth 2.1 (connexion en un clic, plan Business et plus)

1. Le client appelle `/api/mcp` sans jeton → `401` + `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource/api/mcp"`.
2. Il lit les métadonnées, s'enregistre (`/api/oauth/register` : `redirect_uris` en https, `http://localhost|127.0.0.1|[::1]` ou schéma d'application native ; client public par défaut, secret haché si `client_secret_post|basic`).
3. `/oauth/authorize?response_type=code&client_id=…&redirect_uri=…&code_challenge=…&code_challenge_method=S256&scope=…&state=…&resource=…/api/mcp` : connexion si besoin (demande conservée 15 min dans un cookie HttpOnly), choix de la boutique (propriétaire ou gestionnaire, plan avec OAuth), scopes affichés en clair, Autoriser / Refuser. **Aucune redirection vers l'application avant session et décision de l'utilisateur** : toute erreur de demande (client, URI, PKCE, scope, ressource) est affichée sur la page Axi. Réponse avec `code`, `state` et `iss` (RFC 9207). **Scope absent : lecture seule** (`store:read catalog:read orders:read customers:read analytics:read`).
   - **Application vérifiée** : URI de retour sur `claude.ai`, `claude.com`, `chatgpt.com`, `chat.openai.com`, bouclage `localhost` / `127.0.0.1`, ou schémas `cursor:` / `vscode:` → badge « Application vérifiée ». Sinon bandeau « Application non vérifiée » et URI de retour complète affichée sous le nom.
   - **Marques réservées** (Claude, Anthropic, ChatGPT, OpenAI, Cursor, Axi ; insensible à la casse, aux accents et aux séparateurs) : refusées à l'enregistrement et au consentement pour un client non vérifié.
4. `/api/oauth/token` : code haché, **60 s, usage unique** (une réutilisation révoque l'autorisation produite), `redirect_uri` identique, **PKCE S256 obligatoire**, `resource` identique. Consommation du code, création de l'autorisation, `grantId` et jetons sont écrits **dans une seule transaction, ligne du code verrouillée** ; un échec de vérification consomme quand même le code. Jeton d'accès 1 h, jeton de rafraîchissement 30 jours **à usage unique** (rotation ; réutilisation d'un refresh consommé → révocation de toute l'autorisation). Un refresh avec un `scope` réduit n'émet que ce scope et **restreint définitivement** l'autorisation (pas de colonne de scope par jeton).
5. Le marchand voit et révoque les applications dans Connecteurs IA ; l'admin peut révoquer une autorisation ou désactiver un client.

L'autorisation (`OAuthGrant`) mémorise les scopes **effectifs au moment du consentement** : une montée de plan n'élargit pas silencieusement un accès accordé.

## 8. Exemples curl

```bash
TOKEN=axi_live_...                 # créé dans Connecteurs IA
URL=https://axi.africa/api/mcp

curl -s $URL -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "MCP-Protocol-Version: 2025-06-18" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'

curl -s $URL -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

curl -s $URL -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"sales_report","arguments":{"group_by":"product","from":"2026-10-01"}}}'

# Vitrine publique, sans jeton
curl -s https://axi.africa/api/mcp/store/chez-aicha -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_catalog","arguments":{"query":"gâteau"}}}'
```

Clients : `claude mcp add --transport http axi $URL --header "Authorization: Bearer $TOKEN"` ; Cursor `~/.cursor/mcp.json` → `{"mcpServers":{"axi":{"url":"…/api/mcp","headers":{"Authorization":"Bearer …"}}}}` ; Claude Desktop sans OAuth : `npx -y mcp-remote …/api/mcp --header "Authorization:${AXI_AUTH}"`.

## 9. Exploitation et sécurité

- **Arrêts d'urgence lot 1** (même console, `settings.manage`) : `giftcards.kill_switch` (utilisation des cartes au checkout et vérification publique suspendues ; journal `admin.giftcards.kill_switch`) et `buyer_accounts.kill_switch` (codes de connexion refusés, écritures du compte bloquées, sessions conservées en lecture ; journal `admin.buyer_accounts.kill_switch`). Le message saisi est affiché aux acheteurs.
- **Arrêt d'urgence** : console `/admin/connecteurs-ia` (permission `settings.manage`), `PlatformSetting` `mcp.kill_switch` ; effet sous 10 s (cache par instance) sur `/api/mcp`, la vitrine, les `llms.txt`, l'enregistrement, la page `/oauth/authorize`, l'approbation et le point de jeton (HTTP 503 ou message sur la page). Rien n'est supprimé.
- **Révocation toujours possible** : un jeton ou une application peut être révoqué même si la boutique est suspendue (contrôles de membre et de capacité conservés). Le plafond de jetons est compté dans la transaction de création, boutique verrouillée (`SELECT … FOR UPDATE`).
- **Révocations admin** (`stores.moderate`) : jeton, autorisation OAuth, désactivation d'un client ; journal `admin.mcp.*`.
- **Journal** `ApiRequestLog` (outil, acteur, statut, durée, IP), 50 derniers appels visibles par le marchand, purge à 30 jours par `/api/jobs/run` (étape `mcpPurge`) et de façon opportuniste ; codes et jetons OAuth expirés purgés après 7 jours.
- Échecs d'authentification répétés : 30 / min / IP puis `429`.
- Données : aucun secret en clair (SHA-256 pour jetons, codes, secrets clients), CORS sans cookie, page de consentement protégée par `X-Frame-Options`, actions serveur Next (contrôle d'origine), `/oauth/` exclu de l'indexation.
- Limites connues : mode sans état uniquement (pas de notifications serveur → client) ; pas de restriction d'IP par jeton ; les quotas comptent les appels, pas le volume de données ; la description des outils est en anglais (destinée aux modèles), les données gardent les libellés français.

## 10. Tests

`tests/mcp-auth.test.ts` (jetons, PKCE, URI, scopes, plans), `tests/mcp-protocol.test.ts` (JSON-RPC, lots selon la version), `tests/mcp-oauth.test.ts` (code à usage unique et transaction, rotation, scope réduit, applications vérifiées, marques réservées), `tests/mcp-hardening.test.ts` (quotas par message, `untrusted_customer_input`, masquage, confirmations, erreurs masquées, vitrine binaire et agrégée), `tests/mcp-actions.test.ts` (révocation en boutique suspendue, plafond sous verrou), `tests/mcp-isolation.test.ts` (isolation entre boutiques, quotas), `tests/mcp-reference.test.ts` (référence publique = serveur), `e2e/07-mcp.spec.ts` (jeton créé dans l'interface, appels réels, révocation).
