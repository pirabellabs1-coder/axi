# P1 : Wave et Orange Money automatiques (lot 1 bis)

> Consolidé dans `docs/GUIDE-BOUTIQUE.md`, `docs/RECETTE.md`, `docs/ARCHITECTURE.md`, `docs/DEPLOIEMENT.md`, `docs/FEUILLE-DE-ROUTE.md`. Ce fichier reste comme historique.

Équipe P1, vague 2 (11/10/2026). Objectif P0 de l'analyse concurrentielle (§3.3, §8.2) : encaisser automatiquement **Wave, Orange Money, MTN MoMo et Moov Money** en Côte d'Ivoire et au Sénégal (et dans d'autres pays UEMOA) via un agrégateur, sur le compte du marchand, toujours à 0 % de commission Axi.

## 1. Ce qui est livré

| Agrégateur | Pays (portefeuilles) | Parcours client | Authenticité du webhook | Remboursement API |
|---|---|---|---|---|
| `paystack` | CI : Wave, Orange Money, MTN MoMo, carte (XOF) | Page Paystack hébergée | HMAC-SHA512 du corps brut (`x-paystack-signature`, clé secrète), puis relecture `GET /transaction/verify/{ref}` | Oui (`POST /refund`) |
| `pawapay` | CI : Wave, Orange, MTN · SN : Wave, Orange · BJ : MTN, Moov · BF : Moov, Orange · CM : MTN, Orange | Page de paiement pawaPay (15 min) ; demande poussée sur le téléphone (USSD) si le portefeuille et le numéro sont connus | Callback = simple déclencheur : `Content-Digest` contrôlé s'il est présent, puis relecture `GET /v2/deposits/{depositId}` avec le jeton (source de vérité) | Oui (`POST /v2/refunds`) |
| `cinetpay` | CI : Wave, Orange, MTN, Moov · SN : Wave, Orange · BF, ML, TG, BJ, CM, GN, NE | Page CinetPay hébergée (API v1) | `notify_token` (empreinte SHA-256 conservée sur la tentative, comparaison en temps constant), puis relecture `GET /v1/payment/{id}` et contrôle des identifiants | Non (l'API v1 ne propose que des transferts) : remboursement manuel |

Commun aux trois (même modèle que FedaPay, KkiaPay, Stripe) :
- clés saisies par le marchand dans **Paiements**, chiffrées au repos (`encryptSecret`), jamais renvoyées au navigateur ;
- tentative `PaymentAttempt` (CREATED → PENDING → INITIATED → CONFIRMED | FAILED | EXPIRED) ; une redirection navigateur ne vaut jamais paiement ;
- webhook idempotent (`ProviderEvent` unique par `(provider, eventId)`, `eventId` construit sur une référence propre à la tentative, donc sans collision entre boutiques) ;
- montant et devise comparés à la tentative avant toute confirmation ;
- rapprochement des tentatives `INITIATED` (cron `/api/jobs/run`, bouton admin, bouton « Vérifier les paiements en attente » de la boutique) ; une session abandonnée expire (Paystack et CinetPay après 30 min, pawaPay après 20 min) ;
- mode test / production : Paystack et CinetPay le déduisent du préfixe de clé (`sk_test_` / `sk_live_`), pawaPay a un champ « Environnement ». Le badge « Mode test » s'affiche dans la liste des moyens ;
- **remboursement** : un remboursement « vers le moyen d'origine » enregistré par le marchand (commande ou retour) déclenche, après validation en base, la demande chez Paystack ou pawaPay pour la part payée en ligne. Succès ou échec sont tracés (historique de la commande, audit) ; en cas d'échec ou pour CinetPay, une notification « Remboursement à effectuer à la main » est créée.

### Fichiers

| Fichier | Rôle |
|---|---|
| `src/lib/payments/provider.ts` | Contrat `PaymentGateway` étendu (contexte de webhook, références, `refund`, `testConnection`, `modeOf`, portefeuilles par pays) |
| `src/lib/payments/channels.ts` | Portefeuilles (wave, orange_money, mtn_momo, moov_money, card), libellés, couverture par pays, codes opérateurs (module pur, importable côté client) |
| `src/lib/payments/adapters/{paystack,pawapay,cinetpay}.ts` | Adaptateurs complets |
| `src/lib/payments/adapters/util.ts` | `fetch` borné à 15 s, conversions de montants, e-mail technique, URL ≤ 120 caractères |
| `src/lib/payments/gateways.ts` | Registre (agrégateurs en tête) ; champs « Environnement » des passerelles historiques en liste fermée |
| `src/lib/payments/service.ts` | Routage du webhook par adaptateur, recherche de la tentative bornée au fournisseur de l'URL, contexte transmis, remboursement chez le fournisseur après commit |
| `src/lib/payment-methods/gateway-config.ts` | Règles pures : fusion des identifiants, pays, devise, portefeuilles |
| `src/lib/payment-methods/actions.ts` | Enregistrement des portefeuilles (`PaymentMethod.channels`), action `testPaymentGateway` |
| `src/app/app/[storeId]/paiements/*` | Écran marchand |
| `tests/payments-aggregators.test.ts`, `tests/payments-webhooks.test.ts` | 34 tests |

## 2. Guide commerçant (écran Paiements)

1. **Paiements → Ajouter un moyen → Type : « Mobile Money et carte en ligne »** (plan Starter et plus ; sinon le choix est verrouillé avec un lien vers l'abonnement).
2. **Fournisseur** : la liste regroupe d'abord les agrégateurs avec les portefeuilles disponibles dans le pays de la boutique (« Paystack : Wave, Orange Money, MTN MoMo, Carte bancaire »). Un agrégateur qui ne couvre pas le pays est marqué « pays non couvert » et refusé à l'enregistrement avec un message clair.
3. **Moyens proposés au client** : cases à cocher (Wave, Orange Money…). Le libellé affiché au client suit automatiquement (« Wave, Orange Money ou MTN MoMo ») tant que le marchand ne l'a pas modifié.
4. **Identifiants** : clé(s) du fournisseur, environnement, pays CinetPay. Un secret laissé vide est conservé lors d'une modification.
5. **Tester la connexion** : vérifie les clés auprès du fournisseur sans rien débiter (limité à 10 essais / 10 min), rappelle l'URL de webhook à déclarer et, pour pawaPay, signale si l'URL de rappel des dépôts n'est pas celle d'Axi.
6. Copier l'**URL de webhook** et la déclarer chez le fournisseur (sauf CinetPay, qui la reçoit à chaque paiement).

## 3. Procédure pas à pas pour le porteur

URL de webhook (une par agrégateur, commune à toutes les boutiques ; la boutique est retrouvée par la tentative) :

```
POST https://axi.africa/api/webhooks/payments/paystack
POST https://axi.africa/api/webhooks/payments/pawapay
POST https://axi.africa/api/webhooks/payments/cinetpay   (transmise automatiquement, rien à déclarer)
```

En local, exposez le port 3000 en HTTPS (ex. `cloudflared tunnel --url http://localhost:3000`) et mettez cette adresse dans `NEXT_PUBLIC_APP_URL` le temps des tests. Aucune variable d'environnement nouvelle : les clés sont celles de chaque marchand, saisies dans l'interface.

### 3.1 Paystack (Côte d'Ivoire)
1. Créez un compte sur paystack.com en choisissant la Côte d'Ivoire ; le mode test est disponible immédiatement, la production après la vérification d'entreprise (KYC).
2. *Settings → API Keys & Webhooks* : copiez la **clé secrète de test** `sk_test_…` ; renseignez l'**URL de webhook de test** ci-dessus.
3. Dans Axi (boutique en Côte d'Ivoire, XOF) : ajoutez « Paystack », cochez Wave / Orange Money / MTN MoMo / carte, collez la clé, **Tester la connexion** → « Connexion Paystack réussie en mode test ».
4. Passez une commande, choisissez ce moyen → page Paystack → payez avec un moyen de test proposé par Paystack.
5. Vérifiez : `/admin/paiements` (événement `charge.success`, signature valide, traité), tentative `CONFIRMED`, commande payée, job `payment.succeeded`.
6. Production : remplacez par `sk_live_…` et déclarez l'URL de webhook *live*.

### 3.2 pawaPay (CI, SN, BJ, BF, CM)
1. Créez un compte sandbox sur dashboard.sandbox.pawapay.io (la production est ouverte après l'onboarding).
2. *System configuration → API tokens* : générez un jeton. *Callback URLs* : URL de rappel des **dépôts** = `…/api/webhooks/payments/pawapay` (et, si vous le souhaitez, celle des remboursements à la même adresse : sans effet sur les commandes).
3. Dans Axi : ajoutez « pawaPay », environnement **Test (sandbox)**, collez le jeton, **Tester la connexion** : le message liste les pays activés et avertit si l'URL de rappel manque.
4. Commande de test → page pawaPay → utilisez un **numéro de test sandbox** (docs.pawapay.io/v2/docs/test_numbers : certains numéros réussissent, d'autres échouent volontairement).
5. Vérifiez comme pour Paystack ; testez aussi un numéro « échec » (commande en échec de paiement) et l'abandon de la page (tentative expirée au rapprochement après 20 min).
6. Production : nouveau jeton production + environnement « Production ».

### 3.3 CinetPay (CI, SN et autres pays UEMOA / CEMAC)
1. Créez un compte marchand CinetPay ; récupérez pour **le pays de la boutique** la clé API (`sk_test_…` en test) et le mot de passe API.
2. Dans Axi : ajoutez « CinetPay », pays du compte = pays de la boutique (contrôlé), clé, mot de passe, **Tester la connexion** (authentification `POST /v1/oauth/login`).
3. Commande de test → page CinetPay → paiement de test. La notification arrive sur l'URL transmise ; le statut est relu chez CinetPay avant confirmation.
4. Montants acceptés : 100 à 2 500 000 XOF par paiement (message clair au client sinon). Remboursements : à faire depuis l'espace CinetPay (notification « à effectuer à la main »).

### 3.4 Scénarios de recette (pour chaque agrégateur)
| # | Scénario | Attendu |
|---|---|---|
| R1 | Paiement réussi | Tentative `CONFIRMED`, commande `PAID`, `OrderEvent` « Passerelle », job `payment.succeeded` |
| R2 | Rejeu du même webhook | HTTP 200 `duplicate`, rien ne change |
| R3 | Signature / jeton invalide (modifiez la clé) | HTTP 400, `ProviderEvent` `invalid_signature`, commande inchangée |
| R4 | Montant falsifié | `amount/currency mismatch`, commande inchangée |
| R5 | Webhook coupé, paiement fait | « Vérifier les paiements en attente » ou cron → confirmé |
| R6 | Page abandonnée | Tentative expirée au rapprochement, le client peut relancer un paiement (nouvelle tentative) |
| R7 | Remboursement « moyen d'origine » | Paystack / pawaPay : historique « Remboursement … demandé à … » ; CinetPay : notification « à effectuer à la main » |
| R8 | Test de connexion avec une fausse clé | Message d'échec clair, aucun enregistrement |
| R9 | Boutique au Bénin + Paystack | Refus « Paystack n'encaisse pas dans le pays de votre boutique » |

## 4. Points d'intégration (à confirmer avec de vraies clés)

Isolés dans des fonctions commentées « POINT D'INTÉGRATION », jamais devinés :
- **E-mail du client** (`payerEmail`, `adapters/util.ts`) : Paystack et CinetPay exigent un e-mail ; sans e-mail client, une adresse technique `client-<téléphone>@<domaine>` est utilisée. Si un fournisseur la refuse, c'est l'unique endroit à changer.
- **Montant dans `GET /v1/payment` (CinetPay)** : non documenté par les SDK officiels. S'il est présent, il fait foi ; sinon le montant fixé par notre serveur à l'initialisation est retenu (le client ne peut pas le modifier sur la page CinetPay).
- **Paiement poussé Paystack** (`POST /charge` + `mobile_money.provider`) : codes opérateurs de Côte d'Ivoire non publiés dans les sources accessibles ; la page hébergée est utilisée.
- **Signature RFC 9421 des callbacks pawaPay** (facultative) : non exigée, car la relecture authentifiée fait foi ; à ajouter en défense en profondeur si souhaité (clé publique `GET /v2/public-key/http`).
- Sources : paystack.com/docs répond 403 aux robots ; les informations Paystack viennent des dépôts officiels PaystackOSS (OpenAPI, extraits de doc, serveur MCP). docs.cinetpay.com était injoignable ; CinetPay vient des SDK officiels (`cinetpay-js`, `cinetpay-php-sdk`, API v1). pawaPay : docs.pawapay.io (v2).

## 5. Checkout (équipe C) : ajustements proposés, non réalisés

L'affichage générique suffit pour encaisser : le client voit le **libellé** du moyen (« Wave, Orange Money ou MTN MoMo », généré à la configuration), la pastille « En ligne » et la phrase « Vous serez redirigé vers une page de paiement sécurisée ». Améliorations recommandées dans `src/app/s/[slug]/commander/**` :
1. Exposer `channels` dans `paymentMethods` (`page.tsx`) et afficher les portefeuilles en pastilles (`channelLabel()` de `src/lib/payments/channels.ts`) sous le libellé.
2. Afficher `instructions` aussi pour les moyens `GATEWAY` (aujourd'hui seulement pour les moyens manuels).
3. Facultatif, pour la demande poussée pawaPay (USSD sans page) : demander au client son portefeuille et son numéro, puis renseigner `PaymentAttempt.channel` et `PaymentAttempt.payerPhone` (E.164 sans « + ») à la création de la tentative dans `createOrder`. `initiateGatewayPayment` les transmet déjà aux adaptateurs ; sans eux, la page hébergée est utilisée.

## 6. Écarts et limites
- Aucun champ de schéma manquant pour l'essentiel. Pas de colonne pour la référence de remboursement fournisseur sur `Refund` : elle est conservée dans l'`OrderEvent` et l'audit.
- Le `notify_token` CinetPay n'est jamais stocké en clair : seule son empreinte SHA-256 est gardée dans `PaymentAttempt.metadata`.
- Fichier partagé modifié par ajout d'une ligne : `tests/helpers/fake-db.ts` (relations `paymentAttempt → paymentMethod, order`).
