# Équipe W — API REST et webhooks sortants (lot 2 E)

> Consolidé dans `docs/GUIDE-BOUTIQUE.md`, `docs/RECETTE.md`, `docs/ARCHITECTURE.md`, `docs/DEPLOIEMENT.md`, `docs/FEUILLE-DE-ROUTE.md`. Ce fichier reste comme historique.

Référence développeur complète : [`docs/API-REST.md`](../API-REST.md). OpenAPI 3.1 : `public/api/openapi-2026-10.json` (servie à `/api/openapi-2026-10.json`).

## 1. Guide commerçant

*Intégrations › Webhooks et API* (`/app/[storeId]/integrations/webhooks`, propriétaire ; lien « Webhooks et API » du menu).

- **Ajouter un point** : URL https de votre logiciel, événements à recevoir, option « données personnelles » (désactivée par défaut). Le **secret** `whsec_…` s'affiche **une seule fois** : copiez-le dans votre logiciel.
- **Envoyer un test** : événement `app.ping` immédiat.
- **Mettre en pause / Réactiver** ; un point qui échoue 50 fois de suite pendant plus de 72 h est **désactivé automatiquement** (notification + e-mail). Réactivez-le après correction.
- **Nouveau secret** : rotation sans coupure, l'ancien secret reste valide 24 h.
- **Livraisons** : statut (Livré, Nouvel essai prévu, Abandonné, En attente), code HTTP, durée, extrait de la réponse ; filtres ; **Rejouer**.
- **API REST** : base `…/api/v1`, jetons de *Connecteurs IA*. Business : lecture ; Scale+ : lecture et écriture. Webhooks : Business (2 points), Scale (10), Enterprise (illimité).

## 2. Architecture

| Fichier | Rôle |
|---|---|
| `src/lib/webhooks/emit.ts` | **Contrat** `emitDomainEvent(tx, storeId, event, data)` : crée dans la transaction un job `webhook.fanout` (outbox). Accepte aussi `db` pour une écriture déjà validée. |
| `src/lib/webhooks/events.ts` | Catalogue des 16 événements, libellés (pur, importable côté client). |
| `src/lib/webhooks/service.ts` | Points (créer, lister, modifier, supprimer, rotation), livraisons (lister, rejouer, test), `fanoutEvent`, `deliverWebhook`, désactivation automatique. Partagé par actions, REST et MCP. **Sans dépendance Next** (chargé par le worker `pnpm jobs`). |
| `src/lib/webhooks/sign.ts` | Secret, `Axi-Signature`, vérification (référence destinataire). |
| `src/lib/webhooks/keyring.ts` | Trousseau chiffré `{ current, previous, previousUntil }` (rotation 24 h). |
| `src/lib/webhooks/ssrf.ts` | Contrôle d'URL, plages interdites IPv4/IPv6, résolution DNS. |
| `src/lib/webhooks/deliver.ts` | Envoi HTTP : adresse validée imposée (option `lookup`), 10 s, sans redirection, 4 Ko lus. |
| `src/lib/webhooks/policy.ts` | Calendrier de relances, désactivation, filtrage des données personnelles, corps, rôles (miroir de permissions.ts). |
| `src/lib/webhooks/actions.ts` | Actions serveur de l'écran (`integrations.manage`). |
| `src/lib/webhooks/jobs.ts` | `webhook.fanout`, `webhook.deliver`. |
| `src/lib/api/{auth,handler,problem,pagination,idempotency,resources,serializers}.ts` | Socle REST. |
| `src/lib/api/jobs.ts` | `idempotency.purge`. |
| `src/app/api/v1/**` | Routes (+ `[...path]` : 404 problem+json). |
| `src/lib/mcp/merchant/content.ts` | Outil MCP `list_webhook_deliveries`. |

### Flux d'un événement

1. Le domaine appelle `emitDomainEvent(tx, …)` dans sa transaction → `Job webhook.fanout { storeId, eventId: evt_…, event, data, createdAt }`.
2. `webhook.fanout` : boutique non archivée, plan avec `webhooks` ; pour chaque point **actif abonné**, une `WebhookDelivery` (`createMany skipDuplicates` sur `@@unique([endpointId, eventId])` : rejouer le job ne duplique rien) + un job `webhook.deliver`, dans une transaction par point. Données personnelles retirées sauf si le point les demande **et** que son créateur est toujours membre avec `customers.view`.
3. `webhook.deliver` : réclamation optimiste (`status ∈ {PENDING, FAILED}` et `nextAttemptAt ≤ maintenant`, bail de 2 min), signature avec les secrets actifs, envoi. Succès : `SUCCEEDED`, compteur d'échecs remis à 0. Échec : `FAILED` + nouveau job à `nextAttemptAt` (1 min → 24 h) ou `DEAD` après 8 essais ; le gestionnaire ne lève pas d'exception pour un échec HTTP (notre calendrier, pas celui du worker générique).

### Émetteurs branchés

- Équipe C : `order.created`, `order.paid`, `order.status_changed`, `order.cancelled` (`src/lib/commerce/orders.ts`, `exchange.ts`, charge `orderEventData` sans coordonnées).
- Équipe W, `src/lib/products/actions.ts` : `product.created` / `product.updated` (`saveProduct`, dans la transaction), `product.deleted` / `product.updated` (archivage / restauration), `inventory.updated` (ajustement de stock, dans la transaction).
- API REST : `product.created`, `product.updated`, `product.deleted` (PATCH status ARCHIVED), `inventory.updated`, émis après l'écriture (`data.source = "api"`).

### REST : décisions

- Écritures REST = **exécution des outils MCP** (`create_product`, `update_product`, `adjust_inventory`, `update_order_status`) via `runTool` : mêmes règles métier, quotas, confirmations (`?confirm=true`), audit `api.*`. Champs inconnus refusés (400).
- Lectures REST = sérialiseurs dédiés (montants entiers + `currency`, pas de forme « pour modèle »).
- Jetons OAuth refusés (audience MCP). Plans : `REST_API_ACCESS` (none / read / full).
- Idempotence : réservation par insertion (unique `storeId,key`), 409 si en cours, 422 si corps différent, 5xx libère la clé, 4xx mémorisées. Purge : `scheduleIdempotencyPurge()` (une fois par jour, réservation `PlatformSetting api.idempotency_purge`) appelée de façon opportuniste par les POST.

## 3. Scénarios de recette

1. Business, propriétaire : ajouter `https://exemple.com/hook` → secret affiché une fois ; `http://…`, `https://10.0.0.1`, `https://x.internal`, port 8080 → refus explicite.
2. Envoyer un test → ligne « Test (ping) » ; sans serveur : « Nouvel essai prévu », prochain essai à +1 min.
3. Récepteur local (voir §5) : passer une commande sur la vitrine → `order.created` reçu, `Axi-Signature` vérifiée, corps sans nom ni téléphone.
4. Nouveau secret → pendant 24 h, deux `v1` dans l'en-tête.
5. Rejouer une livraison abandonnée → nouvel envoi, mêmes `Axi-Webhook-Id` / `Axi-Delivery-Id`.
6. Gérant / employé : pas d'accès à l'écran (menu masqué, redirection).
7. `curl /api/v1/products` sans jeton → 401 problem+json ; jeton Business → 200 ; `POST` → 403 `plan_required` ; `?limit=500` → 400 ; curseur forgé → 400 ; `/api/v1/nope` → 404 problem+json.
8. Scale : `POST /api/v1/products` sans `Idempotency-Key` → 400 ; même clé et même corps → réponse rejouée (`Idempotent-Replayed: true`) ; même clé, autre corps → 422.

## 4. MCP

`list_webhook_deliveries` (scope `webhooks:write`, Business+, propriétaire) : filtres `endpoint_id`, `status[]`, `event`, pagination. Erreurs et extraits de réponse des serveurs tiers sous `untrusted_customer_input`.

## 5. Test local de bout en bout

Variable **`AXI_WEBHOOKS_ALLOW_LOCALHOST=1`** (ignorée si `NODE_ENV=production`) : accepte `http(s)://localhost|127.0.0.1|[::1]` sur tout port, uniquement le bouclage. Elle doit être présente dans le processus qui **crée** le point (serveur Next, ou script) et dans celui qui **livre** (`pnpm jobs` ou `/api/jobs/run`). Le récepteur doit écouter en double pile (`::`) car `localhost` se résout d'abord en `::1`.

## 6. Écarts et limites

- **Schéma** : pas de colonne pour l'ancien secret → trousseau JSON chiffré dans `secretEnc` (`keyring.ts`). Pas de colonne « début de la série d'échecs » → déduit de la plus ancienne livraison non réussie depuis `lastSuccessAt`.
- `idempotency.purge` n'est pas encore appelé par `/api/jobs/run` (fichier hors périmètre) : programmation opportuniste quotidienne depuis les POST ; les clés expirées sont de toute façon ignorées. **À consolider** : appeler `scheduleIdempotencyPurge()` dans `/api/jobs/run`.
- Écritures produit via **MCP** (`catalog.ts`, hors périmètre) : pas d'événement `product.*` ; à brancher à la consolidation. Idem `bulkUpdateProducts`, `duplicateProduct`, `importCatalog` (une seule ligne d'ajout par opération autorisée ; seules création/mise à jour, archivage et stock sont branchés). `customer.*`, `return.*`, `giftcard.issued`, `order.updated`, `order.refunded` : à émettre par les équipes propriétaires.
- L'audit des écritures REST passe par `auditApi` du MCP : `metadata.via = "mcp"` (fichier hors périmètre) ; l'acteur `api:<jeton>` et l'action `api.*` sont corrects.
- Livraison au moins une fois, ordre non garanti ; un worker arrêté pendant un envoi laisse la livraison réclamée 2 min (bail), puis le job générique la retente.
- Liste `/v1/products` et `/v1/customers` triée par `createdAt` sans index `(storeId, createdAt)` sur ces tables : suffisant au volume d'une boutique, à indexer si besoin.
