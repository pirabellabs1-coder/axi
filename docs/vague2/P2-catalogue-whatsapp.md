# P2 : catalogue WhatsApp et flux (lot 1 bis)

> Consolidé dans `docs/GUIDE-BOUTIQUE.md`, `docs/RECETTE.md`, `docs/ARCHITECTURE.md`, `docs/CONSTRUCTEUR-BOUTIQUE.md`, `docs/DEPLOIEMENT.md`, `docs/FEUILLE-DE-ROUTE.md`. Ce fichier reste comme historique.

Objectif P0 (analyse concurrentielle §7 O3, §8.2) : Axi devient la **source du catalogue** de WhatsApp et de l'agent IA de Meta (Meta Business Agent), et **récupère les commandes** passées depuis WhatsApp, au lieu d'être concurrencé par eux.

## 1. Guide commerçant

Écran : **Intégrations > Catalogue WhatsApp** (`/app/{storeId}/integrations/whatsapp-catalogue`, lien « Catalogue WhatsApp » du menu). Lecture pour propriétaire et gérant, modification réservée au propriétaire (capacité `integrations.manage`).

1. **Flux Meta** : activez le flux Meta, copiez l'adresse. Dans Commerce Manager, créez un catalogue « E-commerce », puis Sources de données > Flux de données > Flux programmé : collez l'adresse, mise à jour toutes les heures.
2. **Relier au numéro** : Gestionnaire WhatsApp > Outils du compte > Catalogue : choisissez ce catalogue. Les clients le voient dans le profil WhatsApp et l'agent de Meta peut recommander les produits.
3. **Synchronisation directe (facultatif)** : avec l'API WhatsApp officielle connectée (page WhatsApp), saisissez l'identifiant du catalogue Meta et cochez « Synchroniser automatiquement ». Le jeton doit avoir la permission `catalog_management`. Pour un même catalogue, utilisez **soit** le flux, **soit** la synchronisation.
4. **Commandes** : un panier envoyé depuis WhatsApp reçoit en réponse un lien vers la boutique (livraison, paiement). La conversation est dans **Conversations**.
5. **Google et TikTok** : activez leur flux et collez l'adresse dans Merchant Center ou TikTok Ads Manager (y renseigner les frais de livraison).

L'écran affiche : nombre d'articles publiables, articles **exclus** (sans photo publique https, prix nul) avec lien vers la fiche, articles sur WhatsApp, articles **refusés par Meta** avec le motif, date de dernière synchronisation, prochaine, échecs consécutifs, bouton « Synchroniser maintenant » (6 par heure). Options : marque affichée, publier ou non les articles en rupture.

Plans (`src/config/plans.ts`) : flux = `catalogFeeds`, synchronisation = `catalogSync` (Business et plus). Contrôle côté serveur dans les actions, les routes de flux, le job et les outils MCP ; `PlanGate` dans l'écran.

## 2. Flux publics

| URL | Format |
|---|---|
| `/s/{slug}/feeds/meta.xml` | RSS 2.0, espace `g:` (Commerce Manager, catalogue WhatsApp) ; disponibilité `in stock` / `out of stock` / `preorder` |
| `/s/{slug}/feeds/google.xml` | RSS 2.0 `g:` ; disponibilité `in_stock`… ; `identifier_exists=no` sans GTIN |
| `/s/{slug}/feeds/tiktok.csv` | CSV virgule UTF-8 : `sku_id,title,description,availability,condition,price,sale_price,link,image_link,additional_image_link,brand,gtin,item_group_id,color,size,product_type` |

- Une ligne par **variante** (`id` = variantId, `item_group_id` = productId) ou par produit sans variante (`id` = productId). Même identifiant que `product_retailer_id` des paniers WhatsApp.
- Champs : titre (variante entre parenthèses), description en texte brut (Markdown et balises retirés, 5 000 caractères), lien de fiche (`?variant=` pour les variantes), image et images supplémentaires (`shareableImageUrl` : https ou média stocké, jamais de data-URL), prix + devise (`18000 XOF`, `19.99 EUR`), prix barré (`sale_price` : prix comparé ou promotion, avec `sale_price_effective_date` si datée), disponibilité selon la politique de stock (DENY → rupture, CONTINUE → précommande ; boutique fermée temporairement → rupture), marque (option > vendeur du produit > nom de boutique), GTIN (code-barres **valide** seulement, clé de contrôle vérifiée), état `new`, couleur et taille (attributs « Couleur » / « Taille »), type de produit (collection **publiée** assignée).
- **Jamais** : prix d'achat, quantité en stock, SKU, étiquettes, notes, produits non actifs, cartes cadeaux.
- Servi seulement si la boutique est publiée (ou fermée temporairement), le plan l'inclut et le flux est activé ; sinon **404** indistinct. Limite : 30 requêtes / 10 min / IP / boutique et 120 / 10 min / IP. Cache : `Cache-Control: public, max-age=3600, s-maxage=3600` et cache mémoire 1 h (clé = boutique, format, `updatedAt` des réglages, statut : activer/désactiver ou changer les options prend effet immédiatement). `X-Robots-Tag: noindex`.
- Proxy : les chemins `.xml` sont exclus du proxy de sous-domaine ; donner l'adresse `{APP_URL}/s/{slug}/feeds/...` (c'est celle affichée).

## 3. Synchronisation API (Graph Catalog Batch)

- Données : `SocialCatalogSync` channel `whatsapp` (enabled, externalCatalogId, status idle/syncing/ok/error, lastError, itemCount, lastSyncAt, lastSuccessAt, consecutiveFailures, nextSyncAt) ; `SocialCatalogItem` (retailerId, contentHash, status synced/error, lastError). Les canaux `meta`, `google`, `tiktok` de `SocialCatalogSync` servent à l'activation des flux. `settings` = `{ includeOutOfStock, brand }` (liste blanche, `readSettings`).
- Planification : balayage de `/api/jobs/run` (`catalogSync`, une ligne) → `scheduleDueCatalogSyncs()` : lignes activées échues, bail de 30 min posé dans la même transaction que `enqueue("social.sync")`. Intervalle normal : 1 h (sans changement, aucun appel Meta).
- Job `social.sync { syncId, force? }` (`src/lib/social/jobs.ts`) → `runCatalogSync()` : vérifie que la boutique du job = celle de la ligne, plan `catalogSync`, boutique publiée, identifiant de catalogue, intégration WhatsApp **active** et jeton ; verrou `syncing` (repris après 15 min) ; construit les articles, calcule le **diff** (`diffCatalog`) : nouveaux / modifiés → `UPDATE` (allow_upsert), retirés (produit supprimé, archivé, brouillon, variante supprimée) → `DELETE` ; refusés inchangés bloqués sauf « Synchroniser maintenant » (force). Lots de 500 requêtes.
- Réponses : `validation_status[].errors` rattachés au `retailer_id` (statut `error`, motif affiché) ; les autres → `synced` ; `DELETE` réussi → ligne supprimée.
- Échecs : erreur Graph (réseau, 401, code 190/10/200/100…) → ligne en `error`, `consecutiveFailures + 1`, `nextSyncAt = now + backoff` (5 min, 10, 20… plafond 24 h), job terminé normalement (pas de double backoff). Préconditions manquantes → `error` et `nextSyncAt = null` (suspendue jusqu'à correction ; l'enregistrement des réglages replanifie). Boutique non publiée : rien n'est supprimé chez Meta.
- Secrets : jeton lu dans `Integration.secretsEncrypted` (déchiffré à l'usage), jamais stocké dans la ligne de sync ; tout message passe par `sanitizeError` / `redactSecrets` (jeton exact, `EAA…`, `Bearer`, `access_token=`) avant base ou journal.

### Point d'intégration (porteur)
`src/lib/social/graph-client.ts` : `POST https://graph.facebook.com/{META_GRAPH_VERSION|v21.0}/{catalog_id}/items_batch`, corps `{ item_type: "PRODUCT_ITEM", allow_upsert: true, requests }`, `Authorization: Bearer`. **Non testé contre Meta** (pas de compte) : à valider avec le jeton système et l'ID de catalogue fournis par le porteur, en particulier le format de `additional_image_link` (chaîne séparée par des virgules) et des prix XOF sans décimales. Les erreurs asynchrones du traitement Meta restent visibles dans Commerce Manager ; le suivi `check_batch_request_status?handle=` est une extension prévue. En développement, `SOCIAL_SYNC_DRY_RUN=1` (ignoré en production) remplace l'appel par un client qui accepte tout.

## 4. Retour de commande (message « order »)

Webhook `/api/webhooks/whatsapp` (ajout minimal) : un message `type: "order"` est enregistré dans la boîte (« [Panier WhatsApp reçu] N articles ») puis `handleCatalogOrderMessage()` (`src/lib/social/whatsapp-order.ts`) :
- `product_items[].product_retailer_id` résolus **uniquement** parmi les produits ACTIFS de la boutique du numéro (routage `Integration.phoneNumberId`) ; `item_price` de Meta ignoré ; quantités ramenées aux bornes min/max ; articles indisponibles comptés.
- Panier `Cart` (attribution `{ source: "whatsapp_catalog", messageId }`) et lien `/s/{slug}?panier={jeton}`, même mécanisme que `create_checkout_link` et les relances. Prix et stock recalculés au checkout.
- Réponse dans la conversation via `queueOutboundMessage` (1 crédit `WA_UTILITY`, transaction) ; crédits insuffisants → message `LINK_ONLY` visible dans la boîte. Boutique fermée temporairement → message d'attente, pas de panier. Limite : 10 paniers / 10 min / numéro. Idempotence par l'id de message (ProviderEvent du webhook). Erreur du traitement : journalisée, sans faire échouer le webhook.
- L'envoi effectif des messages sortants WhatsApp reste le point d'intégration existant du worker `notification.send` (hors périmètre P2).

## 5. MCP (serveur marchand)

| Outil | Scope | Rôle |
|---|---|---|
| `get_catalog_sync_status` | `catalog:read` | URL des flux activés, état de la synchronisation, compteurs, articles refusés (20 par défaut, 50 max) |
| `trigger_catalog_sync` | `catalog:write` | Synchronisation forcée ; plan `catalogSync`, boutique non suspendue, 6 / h / boutique, audit `api.catalog.sync_requested` |

Enregistrés par `MERCHANT_TOOLS.push(...SOCIAL_TOOLS)` dans `server.ts` et deux lignes dans `src/lib/mcp/reference.ts`.

## 6. Scénarios de recette

1. Boutique Business publiée, flux Meta désactivé : `GET /s/{slug}/feeds/meta.xml` → 404. Activer → 200 `application/xml`, une `<item>` par variante, `&` des URL échappés, aucun SKU / stock / prix d'achat.
2. Désactiver → 404 immédiat. Boutique au plan Starter → 404 et `PlanGate` dans l'écran.
3. Produit sans photo : listé dans « Articles exclus », absent du flux. Produit en promotion datée : `g:price` = prix normal, `g:sale_price` = promo, période renseignée.
4. Variante en rupture (DENY) : `out of stock` ; (CONTINUE) : `preorder`. Option « Publier aussi les articles en rupture » décochée : absente.
5. CSV TikTok ouvert dans un tableur : un nom commençant par `=` apparaît précédé d'une apostrophe (aucune formule).
6. Synchronisation (avec `SOCIAL_SYNC_DRY_RUN=1` et une intégration active) : saisir un ID de catalogue, activer, « Synchroniser maintenant », lancer `pnpm jobs` : statut « À jour », articles sur WhatsApp = articles publiables. Archiver un produit, resynchroniser : l'article disparaît (DELETE).
7. Jeton invalide (réel) : statut « Erreur », message sans jeton, prochaine tentative à +5 min puis +10 min.
8. Webhook signé avec un message `order` contenant une variante de la boutique et un id d'une autre boutique : panier avec la seule variante de la boutique, réponse « 1 article indisponible », conversation visible.

## 7. Fichiers

`src/lib/social/{feed-items,feed-format,meta-batch,graph-client,catalog-data,sync,feeds,whatsapp-order,actions,jobs}.ts`, `src/app/s/[slug]/feeds/{meta.xml,google.xml,tiktok.csv}/route.ts`, `src/app/app/[storeId]/integrations/whatsapp-catalogue/{page,loading,catalog-forms}.tsx`, `src/lib/mcp/merchant/social.ts`, tests `tests/social-{feeds,sync,actions}.test.ts`.

Ajouts d'une ligne hors périmètre : `src/app/api/jobs/run/route.ts` (planification), `src/components/app/app-shell.tsx` (menu), `src/lib/mcp/merchant/server.ts` (import + push), `src/lib/mcp/reference.ts` (2 entrées), `src/app/api/webhooks/whatsapp/route.ts` (import, champ `order`, résumé, appel du gestionnaire).

## 8. Écarts et limites

- Pas de champ « marque » boutique ni « état » produit dans le schéma : marque = option / vendeur / nom de boutique ; état toujours `new`.
- Filtre par collections (`settings.collectionIds` prévu au §20) non implémenté : les collections automatiques exigent l'évaluation des règles ; extension possible.
- `Cart.attribution.source` n'est pas recopié sur la commande (pipeline de commande de l'équipe C) : l'origine « catalogue WhatsApp » se lit sur le panier.
- Le paramètre `?variant=` des liens n'est pas encore lu par la fiche produit (équipe T3) : le lien ouvre la fiche, variante à choisir.
