# API REST et webhooks sortants (version 2026-10)

Axi expose chaque boutique à vos serveurs de deux façons :

- **API REST** `/api/v1` : lire et modifier produits, stock, commandes, clients et webhooks ;
- **webhooks sortants signés** : Axi appelle votre serveur à chaque événement (commande créée, payée, produit modifié…).

Spécification machine : [`/api/openapi-2026-10.json`](../public/api/openapi-2026-10.json) (OpenAPI 3.1, servie publiquement). Code : `src/lib/api/**`, `src/app/api/v1/**`, `src/lib/webhooks/**`.

## 1. Accès par plan

| Plan | API REST | Webhooks |
|---|---|---|
| Gratuit, Starter | non | non |
| Business | lecture seule (GET) | 2 points |
| Scale | lecture et écriture | 10 points |
| Enterprise | lecture et écriture | illimité |

## 2. Authentification

```
Authorization: Bearer axi_live_…
```

- Jetons API de la boutique, créés par le propriétaire dans *Intégrations › Connecteurs IA* (les mêmes que pour le serveur MCP). Les jetons OAuth `axi_oat_…` (audience : serveur MCP) sont refusés.
- La boutique est **toujours déduite du jeton** : aucun paramètre ne permet d'en viser une autre.
- **Portée effective = scopes du jeton ∩ plan ∩ rôle du créateur**, recalculée à chaque requête. Un STAFF n'a pas le catalogue, un gérant n'a pas `webhooks:write` (propriétaire seulement).
- Quotas partagés avec le MCP (`MCP_LIMITS`) : appels par minute (boutique et jeton) et par jour (boutique). Dépassement : `429` + `Retry-After`.
- Journal : chaque appel apparaît dans le journal de *Connecteurs IA* (`ApiRequestLog`, méthode `REST GET /v1/orders`).
- Boutique suspendue : lecture et `DELETE` seulement.
- **CORS fermé** : aucune en-tête `Access-Control-*`, l'API est destinée aux serveurs. Ne mettez jamais un jeton dans un navigateur.

## 3. Ressources

| Méthode | Route | Scope |
|---|---|---|
| GET | `/products`, `/products/{id}` | catalog:read |
| POST | `/products` | catalog:write |
| PATCH | `/products/{id}` (`?confirm=true` pour une variation de prix > 50 %) | catalog:write |
| POST | `/inventory/adjustments` | inventory:write |
| GET | `/orders`, `/orders/{id}` | orders:read |
| POST | `/orders/{id}/transitions` | orders:write |
| GET | `/customers`, `/customers/{id}` | customers:read |
| GET, POST | `/webhooks` ; GET, DELETE `/webhooks/{id}` | webhooks:write |

Règles métier identiques au MCP (les écritures exécutent les mêmes outils) : produit créé en brouillon par défaut, quotas du plan, retrait de stock conditionnel (jamais négatif), transitions de commande via `transitionOrder` (machine d'états, remise en stock à l'annulation, motif obligatoire pour annuler, notification du client), audit `api.*`.

Montants : **entiers dans la plus petite unité** (`currency`) : `5000` = 5 000 FCFA, EUR en centimes. Dates ISO 8601 UTC. Sans `customers:read`, `order.customer` vaut `null`.

### Pagination

`?limit=1..100` (20 par défaut) et `?cursor=` (opaque). Réponse :

```json
{ "data": [ … ], "page": { "next_cursor": "YzE6Y2x4…", "has_more": true } }
```

Tri stable : plus récents d'abord. Filtres : `status`, `q`, `updated_since` (produits) ; `status`, `payment_status`, `created_since`, `created_until`, `updated_since`, `reference` (commandes) ; `q`, `updated_since` (clients).

### Erreurs (RFC 9457)

`Content-Type: application/problem+json` :

```json
{ "type": "https://axi.africa/docs/api/errors/insufficient_scope", "title": "Insufficient scope", "status": 403,
  "detail": "This operation requires the orders:read scope…", "code": "insufficient_scope", "required_scope": "orders:read",
  "instance": "/api/v1/orders", "request_id": "req_Q2…" }
```

Codes : `unauthorized` 401 · `forbidden`, `insufficient_scope`, `plan_required`, `plan_limit`, `store_suspended` 403 · `not_found` 404 · `invalid_request`, `validation_failed`, `unsupported_api_version`, `idempotency_key_required` 400 · `unsupported_media_type` 415 · `payload_too_large` 413 · `confirmation_required`, `idempotency_in_progress` 409 · `unprocessable`, `idempotency_key_reused` 422 · `rate_limited` 429 · `internal_error` 500 (aucun détail interne ; `request_id` à transmettre au support). Champ inconnu dans un corps : 400.

### Idempotence

`Idempotency-Key` **obligatoire sur tout POST** (UUID v4 conseillé, 255 caractères max), conservée 24 h par boutique :

- même clé, même requête (méthode, chemin avec requête, corps JSON canonique) : la réponse enregistrée est rejouée avec `Idempotent-Replayed: true`, sans nouvelle exécution ;
- même clé, requête différente : `422 idempotency_key_reused` ;
- requête en cours avec la même clé : `409 idempotency_in_progress` + `Retry-After: 1` ;
- erreur 5xx : la clé est libérée (réessayez avec la même) ; erreurs 4xx métier : mémorisées et rejouées ;
- après une réponse `409 confirmation_required`, renvoyez avec `?confirm=true` **et une nouvelle clé**.

### Version

En-tête `Axi-Api-Version: 2026-10` (facultatif, valeur par défaut ; toute autre valeur : 400). Chaque réponse porte `Axi-Api-Version` et `X-Request-Id`.

### Exemples

```bash
TOKEN=axi_live_...
BASE=https://axi.africa/api/v1

curl -s "$BASE/products?status=ACTIVE&limit=10" -H "Authorization: Bearer $TOKEN"
curl -s "$BASE/orders?status=NEW,CONFIRMED" -H "Authorization: Bearer $TOKEN"

curl -s -X POST "$BASE/products" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" -d '{"name":"Bissap 1 L","price":1500,"status":"ACTIVE"}'

curl -s -X POST "$BASE/orders/ORDER_ID/transitions" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" -d '{"status":"CONFIRMED"}'

curl -s -X POST "$BASE/inventory/adjustments" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" -d '{"product_id":"PRODUCT_ID","delta":12,"reason":"Réassort fournisseur"}'
```

## 4. Webhooks sortants

### Créer un point

Dans *Intégrations › Webhooks et API* (propriétaire) ou `POST /api/v1/webhooks` :

- URL **https** uniquement, ports **443 ou 8443**, adresse publique (voir SSRF) ;
- secret `whsec_…` (32 octets aléatoires) **affiché une seule fois**, stocké chiffré (AES-256-GCM) ;
- choix des événements ; données personnelles **désactivées par défaut** (activables seulement par un membre ayant `customers.view`, avec avertissement).

### Événements

`order.created`, `order.updated`, `order.status_changed`, `order.paid`, `order.refunded`, `order.cancelled`, `product.created`, `product.updated`, `product.deleted` (archivage : Axi ne supprime pas les produits), `inventory.updated`, `customer.created`, `customer.updated`, `return.created`, `return.status_changed`, `giftcard.issued`, `digital.delivered` (accès de téléchargement émis après paiement : identifiants, limite et expiration, jamais de lien ni de jeton), `app.ping` (bouton « Envoyer un test »).

### Requête envoyée

```
POST <votre URL>
Content-Type: application/json
User-Agent: Axi-Webhooks/2026-10
Axi-Webhook-Id: evt_3f2a…        (identifiant de l'événement : dédupliquez dessus)
Axi-Event: order.created
Axi-Delivery-Id: clx…            (livraison vers CE point)
Axi-Api-Version: 2026-10
Axi-Signature: t=1760184000,v1=5f2b…[,v1=… pendant une rotation]

{ "id": "evt_3f2a…", "type": "order.created", "created_at": "2026-10-11T12:00:00.000Z",
  "store_id": "…", "api_version": "2026-10", "data": { "id": "…", "reference": "AX-7K3P9Q", "status": "NEW", "total": 12500, … } }
```

`data` est **minimal** (identifiants, statuts, montants) : pour le détail, relisez la ressource par l'API (`GET /orders/{id}`).

### Vérifier la signature

`v1 = hex(HMAC-SHA256(secret, t + "." + corps_brut))`, la clé HMAC étant la chaîne complète `whsec_…`. Refusez si aucun `v1` ne correspond ou si `|maintenant - t| > 300 s`. Calculez sur le **corps brut** reçu, jamais sur un JSON re-sérialisé ; comparez en temps constant.

```js
import crypto from "node:crypto";
export function verifyAxiSignature(rawBody, header, secret, toleranceSec = 300) {
  const parts = header.split(",").map((p) => p.split("="));
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  if (!t || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = Buffer.from(crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex"), "hex");
  return parts.filter(([k]) => k === "v1").some(([, v]) => {
    const sig = Buffer.from(v ?? "", "hex");
    return sig.length === expected.length && crypto.timingSafeEqual(sig, expected);
  });
}
```

```php
function axi_verify(string $raw, string $header, string $secret, int $tol = 300): bool {
  parse_str(str_replace(',', '&', $header), $p); // n'obtient qu'un v1 : préférez un découpage manuel si rotation
  $t = (int)($p['t'] ?? 0);
  if (!$t || abs(time() - $t) > $tol) return false;
  return hash_equals(hash_hmac('sha256', "$t.$raw", $secret), $p['v1'] ?? '');
}
```

Référence exécutable : `verifySignature()` dans `src/lib/webhooks/sign.ts` (tests : `tests/webhook-sign.test.ts`).

### Réponse attendue, relances

- Répondez **2xx en moins de 10 s** (traitez en arrière-plan). Les redirections ne sont pas suivies (3xx = échec) ; seuls 4 Ko de votre réponse sont lus et conservés.
- Échec (non-2xx, délai, connexion, adresse refusée) : relances à **1 min, 5 min, 30 min, 2 h, 6 h, 12 h, 24 h**, puis `DEAD` (8 tentatives).
- **Désactivation automatique** après 50 échecs consécutifs sur plus de 72 h : notification dans l'espace marchand et e-mail au contact de la boutique. Réactivez le point après correction, puis rejouez les livraisons abandonnées.
- **Rejouer** : depuis l'historique des livraisons (mêmes `Axi-Webhook-Id` et `Axi-Delivery-Id`, nouveau cycle de relances).
- Livraison au moins une fois : un même événement peut arriver plusieurs fois ; l'ordre n'est pas garanti.

### Rotation du secret

« Nouveau secret » : le nouveau secret est affiché une fois ; pendant **24 h**, chaque envoi porte deux `v1` (nouveau et ancien). Déployez le nouveau secret sur votre serveur pendant cette fenêtre.

### SSRF (sécurité)

Avant **chaque** envoi : résolution DNS, refus si **une** des adresses est privée (10/8, 172.16/12, 192.168/16), de bouclage, lien-local (169.254/16, dont les métadonnées cloud 169.254.169.254), CGNAT (100.64/10), réservée, multicast, IPv6 ULA (fc00::/7, dont fd00:ec2::254), lien-local, ou IPv4 encapsulée (::ffff:, NAT64, 6to4) vers ces plages. La connexion est **imposée à l'adresse validée** (le DNS rebinding n'a pas d'effet) et le certificat TLS est vérifié sur le nom d'origine. Noms internes (`localhost`, `*.local`, `*.internal`…) refusés.

**Test local** (jamais en production) : `AXI_WEBHOOKS_ALLOW_LOCALHOST=1` dans l'environnement du **worker** (et du serveur qui crée le point) accepte `http(s)://localhost|127.0.0.1|[::1]` sur tout port. Ignorée si `NODE_ENV=production`.

## 5. MCP

Outil `list_webhook_deliveries` (scope `webhooks:write`, plan avec webhooks) : livraisons récentes filtrables par point, statut et événement. Les réponses des serveurs tiers sont placées sous `untrusted_customer_input`.
