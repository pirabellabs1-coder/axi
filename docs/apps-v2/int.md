# App Store v2 — Intégration des applications externes (équipe INT)

Contrat **exact** entre Axi et une application hébergée par un développeur sur son propre serveur. L'équipe DEV documente le portail à partir de ce document. Toutes les URL sont relatives à la base publique d'Axi `AXI` (`NEXT_PUBLIC_APP_URL`, par ex. `https://axi.africa`).

Code de référence : `src/lib/apps/install-signing.ts`, `install-flow.ts`, `session-token.ts`, `lifecycle-webhooks.ts`, `src/lib/apps/actions.ts`, `src/lib/mcp/oauth.ts` (extension), `src/app/api/apps/session/verify/route.ts`, `src/app/app/[storeId]/applications/[slug]/ouvrir/page.tsx`. Application de recette : `e2e/apps-int-test-app.ts`.

## 1. Identifiants d'une app

| Élément | Origine | Usage |
|---|---|---|
| `client_id` (`axi_cli_…`) | portail développeur (`App.oauthClientId`) | échange du code, rafraîchissement, vérification de session |
| `client_secret` (`axi_cs_…`) | portail, affiché **une seule fois** (stocké haché) | idem ; il fait de l'app un **client confidentiel** |
| URI de redirection | portail (`OAuthClient.redirectUris`) | la **première** URI web (`https://…`, ou `http://localhost` / `127.0.0.1` en dev) reçoit l'installation |
| **Secret de signature** (`whsec_…`, 43 car. base64url) | `appSigningSecret(app.id, clientSecretHash)`, affiché par le portail (onglet Identifiants) | vérifier le `hmac` de la redirection et les webhooks de cycle de vie |
| `appUrl` | portail | page embarquée (iframe) |
| `webhookUrl` | portail | webhooks de cycle de vie |

Secret de signature = `"whsec_" + base64url(HMAC-SHA256(APP_SECRET, "axi-app-signing:v2:" + app.id + ":" + OAuthClient.clientSecretHash))`. Il est recalculable (aucune colonne, schéma gelé). **Rotation :** il dépend de l'empreinte du `client_secret` ; **régénérer le client_secret dans le portail renouvelle aussi ce secret** (redirections et webhooks de cycle de vie sont aussitôt signés avec le nouveau). Le développeur doit mettre à jour les deux ensemble.

Choix du flux, à l'installation :
- **Installation OAuth** (redirection vers l'app) si l'app a un `client_id`, un secret, et au moins une URI de redirection web.
- **Installation directe** dans tous les autres cas (comportement historique : aucune redirection, aucun jeton).

## 2. Installation (lancée depuis l'admin Axi)

Le marchand ouvre `AXI/app/{storeId}/applications/{slug}`, clique sur **Installer**, voit l'écran de consentement des scopes, puis clique sur **Autoriser et installer**. Il faut la capacité `integrations.manage`, c'est-à-dire être propriétaire de la boutique.

Ce que fait Axi, dans une seule transaction :
1. Il crée ou réactive `AppInstallation` (`ACTIVE`). Les scopes accordés sont **scopes demandés ∩ scopes du plan**.
2. Il crée un `OAuthGrant` (client de l'app, boutique, installateur) qui porte ces scopes. Il est référencé par `AppInstallation.oauthGrantId`.
3. Il crée un **code d'autorisation** (`axi_code_…`) : haché en base, valable **60 s**, à usage unique, lié au grant de l'installation.
4. Il redirige le navigateur (HTTP 302 côté client) vers :

```
GET {redirect_uri}?code=axi_code_…&host=https%3A%2F%2Faxi.africa&shop=chez-aicha&state=…&timestamp=1791872406&hmac=<64 hex>
```

| Paramètre | Contenu |
|---|---|
| `code` | code d'autorisation, à échanger sous 60 s |
| `shop` | slug de la boutique (identifiant public stable) |
| `state` | valeur opaque aléatoire générée par Axi (24 octets base64url). Elle n'est liée à **aucune** session de l'app : voir §2.2 |
| `timestamp` | horodatage Unix (secondes) de la redirection |
| `host` | base publique d'Axi (où appeler l'API) |
| `hmac` | signature, voir §2.1 |

Les paramètres déjà présents dans l'URI enregistrée (par ex. `?ref=x`) sont conservés **et signés**.

### 2.1 Vérification du `hmac` (obligatoire côté app)

1. Prendre **tous** les paramètres de la requête reçue **sauf** `hmac` (et `signature` s'il est présent), avec leurs valeurs **décodées**.
2. Les trier par nom (ordre des codes de caractères UTF-16).
3. Les **réencoder** en `application/x-www-form-urlencoded` : `new URLSearchParams(pairesTriées).toString()` (espaces en `+`, `&`, `=`, `/`, `:` encodés). Chaîne non ambiguë : une valeur contenant `&` ou `=` ne peut pas imiter un autre paramètre. Exemple : `code=axi_code_x&host=https%3A%2F%2Faxi.africa&shop=chez-aicha&state=st&timestamp=1791872406`.
4. Calculer `hex(HMAC-SHA256(secret de signature, chaîne))` et comparer **en temps constant** avec `hmac`.
5. Refuser si `|maintenant − timestamp| > 300 s`.

Référence : `verifyInstallQuery()` dans `install-signing.ts`. Il en existe une version autonome dans `e2e/apps-int-test-app.ts`. Axi n'émet qu'une valeur par nom de paramètre.

### 2.2 `state` d'installation : ne pas s'en servir pour lier une session

L'installation est lancée **depuis Axi** : le `state` n'a été ni généré ni stocké par l'app, il n'est donc lié à aucune session côté app. Le `hmac` prouve que la redirection vient d'Axi, **pas** que le navigateur qui la suit est celui du marchand (un lien de redirection peut être transmis à un tiers dans les 60 s).

Règle pour l'app :
- **ignorer (ou remplacer)** ce `state` : ne jamais rattacher la boutique à un compte/session déjà ouvert chez l'app sur la seule foi de cette redirection ;
- pour lier un compte de l'app à la boutique, utiliser **son propre** `state` (aléatoire, stocké dans la session de l'utilisateur) en relançant `AXI/oauth/authorize` (PKCE), ou identifier l'utilisateur par le jeton de session de la page embarquée (§5).

## 3. Échange du code (serveur à serveur)

```
POST AXI/api/oauth/token
Content-Type: application/x-www-form-urlencoded     (JSON accepté)

grant_type=authorization_code&code=axi_code_…&client_id=axi_cli_…&client_secret=axi_cs_…
```

- Les identifiants peuvent aussi être envoyés en `Authorization: Basic base64(client_id:client_secret)`.
- **Pas de PKCE** pour un code d'installation : le `client_secret` est **obligatoire** et vérifié.
- `redirect_uri` est facultative. Si elle est fournie, elle doit être identique à l'URI utilisée.

Réponse 200 :

```json
{ "access_token": "axi_oat_…", "token_type": "Bearer", "expires_in": 3600, "refresh_token": "axi_ort_…", "scope": "store:read catalog:read" }
```

Erreurs (format RFC 6749) :

| Cas | Réponse |
|---|---|
| secret absent ou faux | `401 invalid_client` (le code n'est **pas** consommé) |
| code inconnu, expiré, d'un autre client, `redirect_uri` différente, app désinstallée entre-temps | `400 invalid_grant` |
| code présenté une seconde fois | `400 invalid_grant` **et** révocation de l'accès produit (détection de vol) |
| boutique sur un plan sans OAuth (Gratuit / Starter) | `400 invalid_grant` (« … require the Business plan … ») |

Rafraîchissement : `grant_type=refresh_token&refresh_token=…` avec les mêmes identifiants client. Le jeton de rafraîchissement est à usage unique (rotation) ; une réutilisation révoque l'accès. Le rafraîchissement est refusé (`invalid_grant`) si l'installation n'est plus `ACTIVE` ou si l'app est **suspendue**.

Durées de vie : accès **1 h**, rafraîchissement **30 jours**.

## 4. Appels API

```
GET AXI/api/v1/products?limit=1
Authorization: Bearer axi_oat_…
```

`/api/v1/**` (référence : `docs/API-REST.md`) accepte le jeton d'accès d'une app **uniquement** s'il est lié au grant de l'installation `ACTIVE` de cette app sur la boutique. Les jetons OAuth des connecteurs IA (sans app) restent refusés par l'API REST, comme avant.

Portée effective, recalculée à chaque requête : **scopes du grant ∩ scopes accordés à l'installation ∩ plan ∩ rôle de l'installateur**.

Mêmes niveaux d'API REST par plan (`REST_API_ACCESS` : Business = lecture, Scale et plus = lecture et écriture) et mêmes quotas, avec un compteur par minute **par grant**.

Refus 401 `unauthorized` si :
- l'app a été désinstallée (grant et jetons révoqués) ;
- l'installation n'est pas `ACTIVE` ;
- le jeton appartient à un autre grant du même client ;
- l'app est **suspendue** par Axi ;
- le client est désactivé.

Le serveur MCP (`/api/mcp`) applique exactement la même règle aux jetons d'app.

## 5. App embarquée (iframe)

Le marchand accède à l'app embarquée par **« Ouvrir l'application »**, présent sur la fiche de l'app et sur chaque carte de « Mes applications » quand `appUrl` existe. Ce lien mène à `AXI/app/{storeId}/applications/{slug}/ouvrir`. Il faut un membre de la boutique (`store.view`) et une installation `ACTIVE` ; une app suspendue n'est pas chargée.

L'iframe charge :

```
{appUrl}?shop=chez-aicha&host=https%3A%2F%2Faxi.africa&session=axs1.<charge>.<signature>
```

### 5.1 Jeton de session

Format : `axs1.<charge base64url>.<signature base64url de 43 car.>`.

| Élément | Valeur |
|---|---|
| charge (JSON) | `{ iss, aud, app, shop, sid, sub, iat, exp, jti }` : `iss` = base d'Axi, `aud` = `client_id`, `app` = id de l'app, `sid` = storeId, `sub` = userId, `jti` aléatoire |
| signature | `HMAC-SHA256(clé, "axs1." + charge)` |
| clé | `HMAC-SHA256(APP_SECRET, "axi-app-session:v1:" + app.id)`, propre à chaque app et **jamais divulguée** |
| durée de vie | **5 minutes**. La page est rendue dynamiquement : chaque ouverture produit un jeton neuf |

### 5.2 Vérification (serveur de l'app)

```
POST AXI/api/apps/session/verify
Authorization: Basic base64(client_id:client_secret)      (ou client_id / client_secret dans le corps)
Content-Type: application/json
{ "token": "axs1.…" }                                     (alias : "session" ; form-urlencoded accepté)
```

Réponse 200 :

```json
{ "active": true, "shop": "chez-aicha", "storeId": "…", "userId": "…", "appId": "…", "scopes": ["store:read", "catalog:read"], "iat": 1791872406, "exp": 1791872706 }
```

Erreurs :

| Code | Cas |
|---|---|
| `401 invalid_client` | identifiants faux, client sans secret, app suspendue |
| `400 invalid_request` | `token` manquant ou corps illisible |
| `401 invalid_token` | jeton malformé, falsifié, d'une autre app ou expiré ; app désinstallée ; membre retiré ; boutique archivée |
| `429` | débit dépassé : 120 req/min par IP, 30 échecs d'authentification par minute |

Il n'y a pas de CORS : l'appel se fait de serveur à serveur.

### 5.3 Sûreté de l'iframe

- Attribut `sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads"` : l'app ne peut **pas** naviguer la page Axi (pas de `allow-top-navigation`).
- `referrerPolicy="no-referrer"` et `allow=""` (aucune permission matérielle).
- Une `appUrl` sur l'origine d'Axi est refusée, sinon le sandbox serait annulé.
- Les cookies d'Axi (HttpOnly, origine Axi) ne sont ni lisibles ni envoyés par l'app.
- CSP : seule la route `/app/:storeId/applications/:slug/ouvrir` élargit `frame-src` à `https:` (plus `http://localhost:*` hors production), dans `next.config.ts`. Les liens « Ouvrir » sont des `<a>` (navigation complète), parce que la CSP propre à cette route ne s'applique qu'au chargement du document.
- Si l'app veut être encadrée, **son** serveur doit autoriser `frame-ancestors AXI`.

## 6. Webhooks de cycle de vie

À l'installation et à la désinstallation, Axi envoie un `POST {webhookUrl}` avec un corps JSON :

```json
{ "id": "evt_app_installed_<installationId>_<unix>", "type": "app.installed", "created_at": "…", "api_version": "2026-10",
  "app_id": "…", "store_id": "…", "shop": "chez-aicha", "installation_id": "…",
  "data": { "scopes": ["store:read", "catalog:read"], "status": "ACTIVE", "installed_at": "…", "uninstalled_at": null } }
```

`type` vaut `app.installed` ou `app.uninstalled`. Pour une désinstallation, `scopes` vaut `[]`.

En-têtes :

| En-tête | Valeur |
|---|---|
| `Axi-Webhook-Id` | identique à `id`, **stable** : il sert à dédupliquer, car la livraison est « au moins une fois » |
| `Axi-Webhook-Topic` | `app.installed` ou `app.uninstalled` |
| `Axi-Webhook-Shop` | slug de la boutique |
| `Axi-Webhook-Timestamp` | horodatage Unix de l'envoi |
| `Axi-Webhook-Api-Version` | `2026-10` |
| `Axi-Webhook-Signature` | `t=<unix>,v1=<hex(HMAC-SHA256(secret de signature, t + "." + corps brut))>` |

Le format de signature est le même que celui des webhooks de boutique : on vérifie sur le **corps brut** et on refuse si `|maintenant − t| > 300 s`. Fonction de référence : `verifySignature()` de `src/lib/webhooks/sign.ts`.

Transport : `sendSignedRequest` des webhooks sortants est réutilisé tel quel :
- contrôle anti-SSRF et résolution DNS juste avant l'envoi, puis adresse imposée à la connexion ;
- https sur les ports 443 ou 8443 uniquement ;
- 10 s maximum, aucune redirection suivie.

Toute réponse 2xx vaut succès.

Envoi : il a lieu après la réponse HTTP (`after()`), avec 3 tentatives (0 s, 5 s, 30 s). Un envoi bloqué par l'anti-SSRF n'est pas réessayé.

## 7. Points ouverts (décisions et accords requis)

1. **Relances durables (`src/lib/jobs.ts`, fichier protégé)** : les jobs `app.installed` / `app.uninstalled` sont déjà écrits dans l'outbox (même transaction), mais leurs gestionnaires sont vides. Les gestionnaires sont prêts dans `lifecycle-webhooks.ts` (`handlers`). Les brancher demande de remplacer 2 lignes, sous réserve d'accord :
   ```ts
   "app.installed": async (p) => (await import("@/lib/apps/lifecycle-webhooks")).handlers["app.installed"](p),
   "app.uninstalled": async (p) => (await import("@/lib/apps/lifecycle-webhooks")).handlers["app.uninstalled"](p),
   ```
   Une fois branchés, on peut retirer `scheduleLifecycleWebhook` d'`actions.ts`. Sinon l'id stable permet au destinataire de dédupliquer.
2. **Plan** : l'accès API d'une app suit la règle OAuth existante (Business ou plus) et le niveau REST du plan. L'installation reste possible sur un petit plan ; la fiche affiche alors un avertissement. Rendre l'App Store indépendant du plan est une **décision produit**.
3. **Secret de signature** : dérivé de l'empreinte du `client_secret` ; il tourne avec lui (pas de période de recouvrement : l'ancien cesse immédiatement). Une colonne dédiée permettrait une rotation indépendante avec chevauchement.
4. **Portail DEV** : il affiche `appSigningSecret(app.id, clientSecretHash)` (fonction pure de `src/lib/apps/install-signing.ts`).

## 8. Durcissements (audit sécurité du 13/10/2026)

- Une app **publiée** qui change l'origine de `appUrl` ou de `webhookUrl` (en plus des scopes et URI de redirection) repasse `IN_REVIEW` et est délistée (`requiresReReview`).
- Réinstallation : l'ancien grant de l'installation et ses jetons sont révoqués avant création du nouveau.
- Le flux `/oauth/authorize` (PKCE) n'utilise jamais le grant d'une installation : il crée un grant séparé.
- Installation de test : réservée aux OWNER de la boutique (ou collaborateurs actifs `apps.test_install`).
- Révocation d'un collaborateur : chaque installation de test retirée écrit `app.uninstalled` dans l'outbox.
