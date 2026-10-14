# Lot 1 : ventes et fidélité (spécification d'implémentation)

Références : `docs/FEUILLE-DE-ROUTE.md` (lot 1), `docs/ARCHITECTURE.md`, `docs/CONVENTIONS.md`, `docs/API-MCP.md`.
Code existant concerné : `src/lib/commerce/{pricing,orders,order-state}.ts`, `src/lib/storefront/actions.ts` (`previewTotals`, `placeOrder`), `src/lib/coupons/actions.ts`, `src/lib/loyalty/{config,service}.ts`, `src/lib/payments/service.ts` (`requestRefund`), `src/lib/credits.ts`, `src/lib/jobs.ts`.

> Prérequis : accord du porteur pour modifier `prisma/schema.prisma`, `src/lib/commerce/*`, `src/lib/payments/*`, `src/lib/jobs.ts` (CLAUDE.md) : **accordé le 11/10/2026**.

## 0. Décisions transverses (normatives pour les lots 1 à 4)

### 0.1 Pipeline de prix unique
Nouveau module pur `src/lib/commerce/checkout-pipeline.ts` : `priceCart(input: PipelineInput): PricedCart`. Seule source de vérité pour `previewTotals`, `createOrder`, la caisse (lot 3), le MCP et les retours. `computeTotals` (pricing.ts) reste exporté pour compatibilité et délègue au pipeline.

`PipelineInput` : lignes (`PricedLine` + `productId`, `collectionIds`, `isGiftCard`, `onSale`), livraison, coupon (`CouponInput` étendu), remises automatiques actives (déjà filtrées par boutique et par date), fidélité demandée (`points`), cartes cadeaux (soldes verrouillés), avoir disponible, `now`, `currency`.
`PricedCart` : `lines[]` (avec `discountAllocated`), `discounts[]` (`{ source, id, label, amount, allocations }`), `subtotal`, `discount`, `automaticDiscount`, `loyaltyDiscount`, `deliveryFee`, `taxTotal` (0 au lot 1), `total`, `tenders[]` (`{ kind: "gift_card" | "store_credit", id, amount }`), `amountDue`, `messages[]` (progression des paliers, code non cumulable…), `couponApplied`, `couponError`.

### 0.2 Ordre d'application (normatif)
1. **Prix unitaire** : prix de variante, sinon promo datée (`effectivePrice`), sinon prix ; plus les suppléments (`priceDelta`).
2. **Remises automatiques de ligne** (`PRODUCT_AMOUNT`, `BUY_X_GET_Y`, `BUNDLE`) : une unité reçoit au plus UNE remise automatique de ligne. Évaluation déterministe : remises triées par `priority` décroissante, puis économie estimée décroissante, puis `id` ; chaque remise consomme les unités qu'elle utilise (achetées ou offertes). Les lignes `isGiftCard` ne sont jamais éligibles. Par défaut (`excludeOnSale: true`), une unité déjà en promo datée n'est pas éligible.
3. **Remise automatique de panier** (`CART_TIER`) : une seule, la plus avantageuse atteinte, calculée sur le sous-total net après l'étape 2 (hors cartes cadeaux).
4. **Code promo** : `minSubtotal` comparé au net après les étapes 2 et 3. `appliesTo` restreint l'assiette. Si le coupon n'est pas combinable (`combinesWithAutomatic = false`) ou si une remise automatique appliquée a `combinesWithCoupons = false`, on calcule les deux scénarios (remises automatiques seules / coupon seul) et on garde **le plus favorable à l'acheteur**, avec le message « Ce code n'est pas cumulable avec les offres en cours : la meilleure offre a été appliquée. »
5. **Fidélité** (points convertis) : uniquement pour un acheteur connecté (§1). Paliers entiers de `rewardPoints` vers `rewardValue`, plafonnés à `maxRedeemPercent` (nouveau, défaut 50 %) du net marchandise après l'étape 4.
6. **Livraison** : `freeAbove` est désormais comparé au **net marchandise après remises automatiques et coupon, mais AVANT les points de fidélité** (étape 5) : utiliser ses points ne fait jamais perdre la livraison offerte (décision du 11/10/2026). Changement de comportement, `tests/pricing.test.ts` et `tests/checkout-pipeline.test.ts` mis à jour. Un coupon `FREE_DELIVERY` ou un palier « livraison offerte » met les frais à 0.
7. **Taxes** : 0 au lot 1 (lot 2, calculées sur les montants nets alloués).
8. **Total** = net marchandise + livraison (+ taxes si prix HT, lot 2), jamais négatif.
9. **Moyens de règlement internes** (tenders) : ils ne modifient ni le total ni les remises.
   - Cartes cadeaux : 3 maximum, de l'expiration la plus proche à la plus lointaine, puis du plus petit au plus grand solde.
   - Puis avoir (acheteur connecté).
   - `amountDue = total − Σ tenders`.
   - Ni les cartes cadeaux ni l'avoir ne peuvent payer une ligne `isGiftCard` : l'assiette des tenders est `total − Σ lignes carte cadeau`.

### 0.3 Arrondis et répartition
- Montants entiers dans la devise de la boutique (XOF : 1 FCFA). Pourcentages : `Math.round` (moitié vers le haut), comme aujourd'hui.
- Toute remise de niveau commande est **répartie sur les lignes éligibles** au prorata de leur net, par la **méthode du plus fort reste** (`allocateProRata(amount, weights): number[]`, égalités départagées par l'index de ligne). Invariant : `Σ allocations = amount`. Elle sert aux retours, aux taxes (lot 2) et aux conversions (lot 2).
- `BUY_X_GET_Y` : les unités offertes sont **les moins chères** parmi les unités « get » éligibles.
- Plafonds : une remise ne rend jamais une ligne négative ; `Σ remises ≤ sous-total`.

### 0.4 Concurrence et idempotence
Compteurs (`usesCount`), soldes de cartes et d'avoir : décrément conditionnel `updateMany({ where: { …, balance: { gte: amount } } })` dans la transaction de `createOrder` ; échec, puis `CheckoutError` lisible. Lignes de cartes cadeaux verrouillées (`SELECT … FOR UPDATE`) avant lecture du solde.

## 1. F1 : Compte client acheteur

### Parcours acheteur
1. Icône « Compte » dans l'en-tête (réglage `header.showAccount`), lien `/compte`. Non connecté : `/compte/connexion`.
2. Saisie du téléphone (indicatif du pays de la boutique) ou de l'e-mail. Bouton « Recevoir un code ». Message identique dans tous les cas : « Si ce numéro peut recevoir des messages, un code vient d'être envoyé. »
3. Code à 6 chiffres, valable 10 min, 5 essais. Succès : session de 90 jours (glissante). Nouveau numéro : fiche `Customer` créée (`storeId`, `phone`, nom demandé à l'écran suivant).
4. Espace compte :
   - **Commandes** : liste, détail, statut, lien de suivi, « Commander à nouveau ».
   - **Adresses** : 10 maximum, une par défaut, zone de livraison associée.
   - **Favoris** : 200 maximum, cœur sur les cartes produit et la fiche.
   - **Avoir et points** : solde, historique, valeur en FCFA.
   - **Cartes cadeaux** reçues (dernier groupe de 4 caractères, solde).
   - **Retours** (lot 1 F4).
   - **Préférences** : consentement marketing WhatsApp, journalisé en `Consent`, source `account`.
   - **Déconnexion** et « Déconnecter tous mes appareils ».
   - « Supprimer mon compte » : révoque les sessions, retire le consentement marketing et crée une demande visible du commerçant, qui anonymise via `deleteCustomer`.
5. Checkout connecté :
   - nom et téléphone préremplis, téléphone verrouillé (vérifié) ;
   - choix d'une adresse ;
   - cases « Utiliser X points (−Y FCFA) » et « Utiliser mon avoir (Z FCFA) ».
   - Non connecté : lien « Connectez-vous pour utiliser vos points ou votre avoir ». La commande invitée reste le mode par défaut, jamais imposée.
6. « Commander à nouveau » reconstruit un panier à partir des `OrderItem` :
   - suppléments retrouvés par nom dans le groupe ;
   - articles indisponibles ignorés avec un avertissement ;
   - prix recalculés.

### Parcours commerçant
- Paramètres, puis « Comptes clients » : activer/désactiver (`Store.accountsEnabled`), canal d'envoi du code (WhatsApp de la boutique, e-mail), texte d'accueil.
- Fiche client : badge « Compte vérifié le … », sessions actives, bouton « Déconnecter tous les appareils » (`customers.manage`, audit `customer.sessions_revoked`). Modifier le téléphone d'un client révoque ses sessions.

### Parcours admin plateforme
- `/admin/connecteurs-ia` (même console d'arrêt d'urgence) : `PlatformSetting` `buyer_accounts.kill_switch` (codes refusés, sessions existantes conservées en lecture).
- Indicateurs : codes envoyés, taux de réussite, échecs par canal (`UsageCounter`, métrique `otp:<canal>`, période jour).

### Règles métier
- **Canal d'envoi**, par ordre :
  1. WhatsApp Cloud de la boutique (`Integration` `whatsapp_cloud` active), modèle utilitaire « code d'authentification », débit 1 crédit `WA_UTILITY` via `debitCredits`, remboursé en cas d'échec ;
  2. expéditeur plateforme si `AXI_OTP_WHATSAPP_PHONE_ID` et `AXI_OTP_WHATSAPP_TOKEN` sont configurés (coût plateforme) ;
  3. e-mail (`sendMail`) si l'identifiant est un e-mail.
  - SMS : point d'intégration (enum prévu, non branché).
- **Code** : `HMAC-SHA256(clé dérivée APP_SECRET « buyer-otp », storeId:destination:code)` ; comparaison en temps constant ; `attempts` incrémenté de façon conditionnelle ; jamais dans `Notification.payload`.
- **Débits** (`rateLimitAll`) : 3 codes par destination / 15 min ; 10 par IP / h ; 300 par boutique / h ; 5 vérifications échouées par code.
- **Session** :
  - jeton aléatoire de 32 octets, `sha256` en base (`CustomerSession.tokenHash`) ;
  - cookie `axi_buyer`, `HttpOnly`, `Secure` en production, `SameSite=Lax` ; `Path=/` sur un sous-domaine ou un domaine personnalisé, `Path=/s/{slug}` sur le domaine principal ;
  - à chaque lecture : `session.storeId === store.id`, non révoquée, non expirée ;
  - `lastSeenAt` mis à jour au plus toutes les 10 minutes.
- **Historique** : commandes où `customerId = session.customerId` (le code prouve la possession du numéro, donc les commandes passées en invité avec ce numéro sont légitimement visibles).
- **Connexion par e-mail** : seulement si UNE fiche de la boutique a cet e-mail avec `emailVerifiedAt`. Sinon : « Connectez-vous avec votre numéro. » L'e-mail est vérifié par un code depuis l'espace compte.
- Boutique `CLOSED_TEMPORARILY` : compte en lecture seule. `SUSPENDED` / `ARCHIVED` : 404.

### Cas limites
- Numéro saisi dans un autre format : `normalizePhone`.
- Fiche supprimée par le commerçant : sessions supprimées en cascade.
- Deux connexions simultanées : deux sessions, aucun conflit.
- Favori sur un produit archivé : masqué dans la liste, pas supprimé.
- Adresse liée à une zone désactivée : zone à resélectionner au checkout.
- Code demandé pour un numéro jamais vu : le message est le même, la fiche n'est créée qu'à la vérification.

## 2. F2 : Remises automatiques, lots, ventes croisées et montées en gamme

### Types (`AutomaticDiscount.kind`, configuration validée par zod dans `src/lib/discounts/schema.ts`)

| Type | Configuration (`config`) | Exemple |
|---|---|---|
| `PRODUCT_AMOUNT` | `{ target: { all } \| { productIds } \| { collectionIds }, value: { type: "PERCENT" \| "FIXED_AMOUNT", amount }, perUnit: boolean, minQuantity?, excludeOnSale }` | −15 % sur la collection Wax |
| `BUY_X_GET_Y` | `{ buy: { target, quantity } \| { target, minAmount }, get: { target, quantity, value: { type: "PERCENT", amount: 100 } \| { type: "PERCENT" \| "FIXED_AMOUNT", amount } }, maxApplicationsPerOrder (1..20), excludeOnSale }` | 2 achetés = 1 offert |
| `CART_TIER` | `{ tiers: [{ minSubtotal, value: { type: "PERCENT" \| "FIXED_AMOUNT" \| "FREE_DELIVERY", amount } }] (1..5, croissants), target? }` | −5 % dès 20 000, −10 % dès 50 000 |
| `BUNDLE` | `{ items: [{ productId, variantId?, quantity }] (2..6), price: { type: "FIXED_PRICE", amount } \| { type: "PERCENT", amount }, maxSets (1..10) }` | Lot « Teint parfait » 3 produits à 15 000 |

Règles :
- Dates : jour entier dans le fuseau de la boutique (comme `create_discount_code`).
- `maxUses` : nombre de commandes, incrément conditionnel. Pas de limite par client au lot 1, car un téléphone n'est pas vérifié en invité.
- Si les unités « buy » et « get » visent la même cible, il faut `buy + get` unités dans le panier. Il n'y a pas d'ajout automatique.
- Le panier affiche la progression (« Ajoutez 1 article de la collection Wax pour en recevoir 1 offert », « Plus que 3 000 FCFA pour −10 % »).
- `BUNDLE` est appliqué autant de fois que de lots complets (`maxSets`). Le prix du lot est réparti par plus fort reste sur ses lignes.
- `excludeOnSale` vaut `true` par défaut : anti-cumul avec les promos datées.
- Références (produits, collections, variantes) : vérifiées à l'enregistrement (`storeId`). À l'évaluation, une référence disparue est ignorée sans erreur.
- **Matrice de cumul** :

| | Auto de ligne | Auto de panier | Coupon | Fidélité |
|---|---|---|---|---|
| Auto de ligne | une seule par unité | oui si `combinesWithOtherAutomatic` | selon les drapeaux (§0.2-4) | oui |
| Auto de panier | oui | la meilleure seule | selon les drapeaux | oui |
| Coupon | idem | idem | un seul code | oui |

### Offres au panier (`CartOffer`)
- `placement` :
  - `PRODUCT` : bloc « Souvent achetés ensemble » dans `main-product` ;
  - `CART` : bloc dans `main-cart` et dans le tiroir ;
  - `CHECKOUT` : une ligne au-dessus du total.
- `mode` :
  - `add` : vente croisée, ajout en un clic ;
  - `replace` : montée en gamme, remplace la ligne déclencheuse par le produit proposé avec les mêmes options si elles existent, sinon ouvre la fiche.
- Sélection :
  - au moins un déclencheur dans le panier ou sur la fiche ;
  - produits proposés `ACTIVE`, pas déjà au panier, disponibles (DENY avec stock ≤ 0 exclu) ;
  - 4 maximum, triés par `position`.
- Remise liée facultative : `automaticDiscountId` vers un `PRODUCT_AMOUNT` dont `config.requiresProductsInCart` contient les déclencheurs.
- Mesure : `Order.attribution.offers[]` (ids d'offres ajoutées), puis `conversions` et `revenue` incrémentés au job `order.created`.

### Parcours commerçant
`/app/{storeId}/promotions`, onglets « Codes promo » (existant), « Remises automatiques », « Offres au panier ».
- Formulaire par type, avec résumé en phrase générée (« Pour 2 articles de la collection Wax achetés, le moins cher est offert, du 1er au 30 novembre »).
- Statut calculé : active / programmée / expirée / épuisée.
- Duplication, désactivation.
- Suppression seulement sans application (sinon désactiver, comme les coupons).

### Codes promo (extension)
`Coupon.combinesWithAutomatic` (défaut `true`), `Coupon.appliesTo` (`{ productIds?, collectionIds? }`, null = tout), `Coupon.firstOrderOnly` : contrôlé via `Customer.ordersCount = 0` pour le téléphone, et refusé si une commande non annulée existe pour ce numéro.

## 3. F3 : Cartes cadeaux et avoirs

### Carte cadeau : machine d'états
```
            (paiement confirmé de la commande d'achat, ou création manuelle)
                                 │
                                 ▼
   ┌──────────────────────► ACTIVE ◄───────────────┐
   │ réactivation           │    │ expiresAt ≤ now  │ prolongation
   │ (non expirée)          │    ▼ (job quotidien)  │ (nouvelle date)
DISABLED ◄── désactivation ─┘  EXPIRED ────────────┘
« Épuisée » = ACTIVE avec balance = 0 (affichage) ; une annulation de commande (REVERSAL) la recrédite.
```
- Transitions autorisées : `ACTIVE→DISABLED`, `DISABLED→ACTIVE` (si `expiresAt` absent ou futur), `ACTIVE→EXPIRED` (job), `EXPIRED→ACTIVE` (prolongation, nouvelle `expiresAt` future).
- Chaque transition crée une `GiftCardTransaction` (`ADJUST` avec montant 0 et note, ou `EXPIRE` / `REACTIVATE`) et un `audit()`.

### Code
- 16 caractères, alphabet Crockford base32 sans I, L, O, U (80 bits), affiché `XXXX-XXXX-XXXX-XXXX`.
- Saisie normalisée : majuscules, sans espaces ni tirets, O→0, I/L→1.
- Stockage :
  - `codeHash = HMAC-SHA256(clé « giftcard » dérivée d'APP_SECRET, storeId:code)` (unique, recherche) ;
  - `codeEnc = encryptSecret(code)` (renvoi au destinataire et révélation auditée) ;
  - `last4`.
- Révélation du code en clair : `giftcards.manage`, audit `giftcard.code_revealed`.

### Achat d'une carte cadeau (produit)
- `Product.isGiftCard` ; les variantes sont les valeurs faciales (prix = valeur), bornées entre 1 000 et 500 000 FCFA (équivalents en centimes pour l'EUR). Pas de suivi de stock.
- Au plus 5 cartes et 1 000 000 FCFA de cartes par commande (anti-blanchiment).
- Formulaire sur la fiche : nom, téléphone ou e-mail du destinataire, message (300 caractères), date d'envoi facultative.
- Exclusions : pas de remise ni de coupon, pas de points de fidélité, et une carte ou un avoir ne peut pas payer une carte.
- Panier composé uniquement de cartes : mode `DIGITAL` (nouvelle valeur de `FulfillmentType`), sans livraison.
- Émission : job `giftcard.issue`, déclenché par `payment.succeeded` ou `confirmManualPayment`. Une carte par unité, idempotence `@@unique([sourceOrderItemId, sequence])`. Jamais avant paiement confirmé, donc paiement à la livraison refusé pour une commande contenant une carte.
- `expiresAt` = émission + `giftCardValidityDays` (défaut 365, minimum 180).
- Envoi au destinataire (WhatsApp de la boutique si actif, sinon e-mail, sinon lien `wa.me` prérempli affiché à l'acheteur sur `/merci`). L'acheteur voit le dernier groupe de 4 caractères et « Renvoyer ».

### Utilisation au checkout
- Champ « Carte cadeau » (replié), 3 cartes maximum. `previewTotals` renvoie `[{ last4, applied, remainingAfter }]`. Le solde n'est visible que par qui connaît le code.
- `createOrder` :
  1. verrou des cartes ;
  2. contrôles (`ACTIVE`, non expirée, `currency = store.currency`, `balance > 0`) ;
  3. débit conditionnel ;
  4. `GiftCardTransaction REDEEM` (`balanceAfter`) ;
  5. `PaymentAttempt { provider: "gift_card", status: CONFIRMED, amount }`.
- `amountDue = 0` : `paymentStatus = PAID` dès la création. Sinon, le reste suit le moyen choisi.
- Annulation de commande (`transitionOrder` vers `CANCELLED`) : recrédit automatique dans la même transaction (`REVERSAL`), ainsi que de l'avoir.
- Commande impayée depuis plus de 72 h avec carte débitée : listée dans les notifications du commerçant (job quotidien). Pas d'annulation automatique au lot 1.

### Avoir (store credit)
- Compte par client : solde dénormalisé `Customer.storeCreditBalance` et journal `StoreCreditTransaction`. Pas d'expiration au lot 1 (documenté).
- Sources :
  - geste commercial (`GRANT`, motif obligatoire) ;
  - résolution d'un retour (`REFUND_TO_CREDIT`) ;
  - remboursement vers l'avoir (`requestRefund` avec `destination: "store_credit"`).
- Utilisation :
  - acheteur **connecté par code** (jamais en invité, puisque le téléphone serait saisi librement) ;
  - ou commerçant (`customers.manage`) dans une commande manuelle ou à la caisse (lot 3).
- Débit conditionnel `storeCreditBalance >= amount`.

### Remboursements (extension de `requestRefund`, équipe B)
Paramètre `destination: "original" | "store_credit"`. Pour `original`, l'ordre est :
1. le paiement externe à hauteur du montant payé hors tenders ;
2. les cartes cadeaux (`REVERSAL`, au prorata des montants débités) ;
3. l'avoir.

`Refund.method` et `Refund.returnId` sont renseignés.

**Règles de sortie d'argent (revue « argent » du 11/10/2026, normatives)** — `src/lib/commerce/refunds.ts` :
- **Remboursable unique** `refundableRemaining(tx, order)` = total − Σ `Refund` non refusés − Σ REVERSAL (cartes, avoir) non rattachés à un `Refund` (recrédits d'annulation) − Σ retours RESOLVED en STORE_CREDIT/EXCHANGE − Σ retours RESOLVED/REFUND encore sans `refundId` (réservés) − valeur déjà dépensée des cartes cadeaux achetées par la commande. Utilisé par `requestRefund` (les deux destinations), `quoteReturn`, l'annulation et l'affichage « remboursable » de la fiche commande.
- **Rattachement** : chaque REVERSAL créé par un remboursement porte `refund:<refundId>` dans sa note (sans migration). Part externe déjà rendue = Σ `Refund` − Σ REVERSAL rattachés.
- **Destination `store_credit`** : les tenders retournent d'abord à leurs instruments (cartes, avoir), seule la part externe est créditée en avoir.
- **Annulation** : ne recrédite que les tenders encore débités, plafonnés par le remboursable (une valeur déjà rendue ne l'est jamais deux fois). Pas de refus d'annulation nécessaire.
- **Cartes achetées** : jamais émises pour une commande annulée ou remboursée (revérifié sous verrou) ; l'annulation retire leur solde et les désactive ; un remboursement porte d'abord sur le reste de la commande puis retire le solde non dépensé des cartes (refusé tant que toutes les cartes ne sont pas émises).
- **Échange** : le crédit d'échange est matérialisé en avoir (crédit puis débit sur la commande d'échange) ; annuler ou rembourser la commande d'échange le rend au client.
- **Points de fidélité** : base = net marchandise hors lignes carte cadeau, hors livraison, moins cartes et avoir utilisés (`src/lib/commerce/loyalty-base.ts`).

### Parcours
- **Commerçant** : `/app/{storeId}/cartes-cadeaux`.
  - Liste avec filtres (statut, recherche par 4 derniers caractères, client).
  - Création manuelle : valeur, expiration, destinataire, note ; code affiché une fois.
  - Fiche : journal, désactiver/réactiver, prolonger, ajuster le solde avec motif (audit), révéler, renvoyer.
  - Fiche client : panneau « Avoir » (créditer/débiter avec motif, journal).
- **Acheteur** : `/s/{slug}/carte-cadeau` (vérifier un solde, débit limité) ; `/compte` (avoir et cartes rattachées à `customerId`).
- **Admin** : `PlatformSetting` `giftcards.kill_switch` (utilisation au checkout suspendue). Alerte si plus de 200 codes invalides en 1 h sur une boutique.

## 4. F4 : Retours et échanges

### Politique (`Store.returnPolicy`, zod `src/lib/returns/policy.ts`)
`{ enabled: false, windowDays: 7 (1..90, depuis deliveredAt), allowRefund: true, allowStoreCredit: true, allowExchange: true, storeCreditBonusPercent: 0 (0..20), restockingFeePercent: 0 (0..30), nonReturnableTags: [], requirePhotos: false, returnShippingPaidBy: "customer" | "merchant", instructions: "" (1000) }`

### Machine d'états (`ReturnStatus`)
```
REQUESTED ──approuver──► APPROVED ──réception──► RECEIVED ──résoudre──► RESOLVED (terminal)
    │  └──refuser──► REJECTED (terminal)
    └──annuler (acheteur ou commerçant)──► CANCELLED ◄──annuler (commerçant)── APPROVED
Création par le commerçant (retour en boutique) : directement APPROVED ou RECEIVED.
```
`canTransitionReturn(from, to)` dans `src/lib/returns/state.ts` est la seule source de vérité. Chaque transition :
- est conditionnelle sur le statut lu (`updateMany where status = from`) ;
- écrit un `ReturnEvent` et un `audit()` ;
- crée le job `return.status_changed` (notification à l'acheteur).

### Effets par transition
- **APPROVED** : instructions envoyées, adresse du dépôt (étiquette au lot 3).
- **REJECTED** : motif obligatoire.
- **RECEIVED** : par article, quantité reçue, état (`neuf`, `ouvert`, `abîmé`) et remise en stock oui/non. Remise en stock : `InventoryMovement` `RETURN` et incrément conditionnel (variante supprimée : ignorée, comme le restock d'annulation).
- **RESOLVED** :
  - `REFUND` : `requestRefund(amount, returnId)`. Impossible si la commande n'est pas payée, il ne reste alors que l'avoir, l'échange ou aucune résolution.
  - `STORE_CREDIT` : `GRANT REFUND_TO_CREDIT` de `montant × (1 + bonus %)`. La fiche client est créée par téléphone si absente.
  - `EXCHANGE` : commande d'échange via `createExchangeOrder` (exportée par l'équipe B, canal `MANUAL`, stock décrémenté, prix courant). La valeur des articles retournés devient un tender « avoir d'échange ». Une différence positive est due par l'acheteur ; une différence négative va en avoir ou en remboursement.
  - Fidélité : retrait proportionnel `revokeLoyaltyPartial(orderId, refundedNetMerch)` = points × montant remboursé / net marchandise, arrondi à l'inférieur, solde jamais négatif.

### Montant remboursable par article
`(lineTotal − discountAllocated) × qtyRetournée / qtyCommandée` (répartition par plus fort reste si plusieurs articles), moins les frais de remise en stock (%, arrondis), plus la livraison si `refundShipping` et retour total. Plafond cumulé : total payé − remboursements déjà faits.

### Éligibilité
- Commande `DELIVERED` et `deliveredAt + windowDays ≥ now`.
- Ni ligne carte cadeau, ni étiquette non retournable.
- Quantité restante = commandée − retours non annulés ou refusés.

### Cas limites
- Retours partiels multiples.
- Article d'un lot : la remise est répartie, donc le remboursement est juste.
- Produit supprimé : retour possible grâce à l'instantané `OrderItem`.
- Deux demandes simultanées : verrou de la commande (`FOR UPDATE`) à la création et à la résolution.
- Retour total remboursé : `paymentStatus REFUNDED` et commande `REFUNDED` (logique existante).
- Paiement à la livraison non encaissé : pas de remboursement monétaire.

### Parcours
- **Acheteur** : bouton « Retourner des articles » sur `/compte/commandes/{reference}` et `/suivi/{token}` (le jeton de suivi prouve la possession). Formulaire : articles et quantités, motif (taille, défaut, non conforme, changé d'avis, autre), résolution souhaitée, variante d'échange, note, 3 photos (stockage objet). Le suivi du retour se fait sur la même page.
- **Commerçant** : `/app/{storeId}/retours` (onglets par statut, compteur dans la barre latérale) et fiche (actions selon la machine d'états, calcul suggéré, journal). Bouton « Créer un retour » sur la fiche commande.
- **Admin** : aucune action directe (isolation). Volumes visibles dans les indicateurs globaux.

## 5. Modèle de données (diff Prisma exact, additif)

```prisma
// ─────────── Nouveaux enums ───────────
enum OtpChannel {
  WHATSAPP
  SMS
  EMAIL
}

enum DiscountKind {
  PRODUCT_AMOUNT
  BUY_X_GET_Y
  CART_TIER
  BUNDLE
}

enum CartOfferPlacement {
  PRODUCT
  CART
  CHECKOUT
}

enum GiftCardStatus {
  ACTIVE
  DISABLED
  EXPIRED
}

enum GiftCardSource {
  PURCHASE
  MANUAL
  REFUND
  RETURN
}

enum GiftCardTxKind {
  ISSUE
  REDEEM
  REVERSAL
  ADJUST
  EXPIRE
  REACTIVATE
}

enum StoreCreditTxKind {
  GRANT
  REDEEM
  REVERSAL
  ADJUST
  REFUND_TO_CREDIT
}

enum ReturnStatus {
  REQUESTED
  APPROVED
  REJECTED
  RECEIVED
  RESOLVED
  CANCELLED
}

enum ReturnResolution {
  NONE
  REFUND
  STORE_CREDIT
  EXCHANGE
}

// ─────────── Enums existants : valeurs ajoutées ───────────
enum FulfillmentType {
  PICKUP
  DELIVERY
  WHATSAPP
  DIGITAL // + panier composé uniquement de cartes cadeaux
}

// ─────────── Modèles existants : champs ajoutés ───────────
model Store {
  // …
  accountsEnabled Boolean @default(true) // + comptes acheteurs
  returnPolicy    Json?                  // + politique de retours (src/lib/returns/policy.ts)

  customerOtps            CustomerOtp[]
  customerSessions        CustomerSession[]
  customerAddresses       CustomerAddress[]
  customerFavorites       CustomerFavorite[]
  automaticDiscounts      AutomaticDiscount[]
  orderDiscounts          OrderDiscount[]
  cartOffers              CartOffer[]
  giftCards               GiftCard[]
  giftCardTransactions    GiftCardTransaction[]
  storeCreditTransactions StoreCreditTransaction[]
  returnRequests          ReturnRequest[]
}

model Customer {
  // …
  phoneVerifiedAt    DateTime? // +
  emailVerifiedAt    DateTime? // +
  lastLoginAt        DateTime? // +
  storeCreditBalance Int       @default(0) // + solde d'avoir dénormalisé (journal : StoreCreditTransaction)

  otps                    CustomerOtp[]
  sessions                CustomerSession[]
  addresses               CustomerAddress[]
  favorites               CustomerFavorite[]
  giftCards               GiftCard[]
  storeCreditTransactions StoreCreditTransaction[]
  returnRequests          ReturnRequest[]

  @@index([storeId, email]) // +
}

model Product {
  // …
  isGiftCard           Boolean @default(false) // +
  giftCardValidityDays Int?                    // + null = 365

  favorites CustomerFavorite[]
}

model Coupon {
  // …
  combinesWithAutomatic Boolean @default(true)  // +
  appliesTo             Json?                   // + { productIds?: string[], collectionIds?: string[] } ; null = tout
  firstOrderOnly        Boolean @default(false) // +

  orderDiscounts OrderDiscount[]
}

model Order {
  // …
  automaticDiscount     Int  @default(0) // + part des remises automatiques incluse dans `discount`
  loyaltyDiscount       Int  @default(0) // + part fidélité incluse dans `discount`
  loyaltyPointsRedeemed Int  @default(0) // +
  giftCardAmount        Int  @default(0) // + réglé par cartes cadeaux
  storeCreditAmount     Int  @default(0) // + réglé par avoir
  amountDue             Int?             // + total − tenders ; null = commandes antérieures (= total)
  buyerVerified         Boolean @default(false) // + commande passée par un acheteur connecté par code
  attribution           Json?            // + { offers?: string[], source?: …, experiments?: … } (lots 1 et 4)

  discounts            OrderDiscount[]
  giftCardTransactions GiftCardTransaction[]
  returnRequests       ReturnRequest[]
}

model OrderItem {
  // …
  isGiftCard        Boolean @default(false) // +
  discountAllocated Int     @default(0)     // + part des remises de niveau commande et de ligne (plus fort reste)

  returnItems ReturnItem[]
}

model Refund {
  // …
  method   String  @default("original") // + original | store_credit
  returnId String?                      // + référence logique vers ReturnRequest
}

model DeliveryZone {
  // …
  addresses CustomerAddress[]
}

model Cart {
  // …
  attribution Json? // + offres ajoutées, source (lot 4)
}

// ─────────── Nouveaux modèles ───────────
model CustomerOtp {
  id          String     @id @default(cuid())
  storeId     String
  customerId  String?
  channel     OtpChannel
  destination String // E.164 sans '+' ou e-mail en minuscules
  codeHash    String
  attempts    Int        @default(0)
  expiresAt   DateTime
  usedAt      DateTime?
  ip          String?
  createdAt   DateTime   @default(now())
  store       Store      @relation(fields: [storeId], references: [id], onDelete: Cascade)
  customer    Customer?  @relation(fields: [customerId], references: [id], onDelete: Cascade)

  @@index([storeId, destination, createdAt])
  @@index([expiresAt])
}

model CustomerSession {
  id         String    @id @default(cuid())
  storeId    String
  customerId String
  tokenHash  String    @unique
  userAgent  String?
  ip         String?
  expiresAt  DateTime
  lastSeenAt DateTime  @default(now())
  revokedAt  DateTime?
  createdAt  DateTime  @default(now())
  store      Store     @relation(fields: [storeId], references: [id], onDelete: Cascade)
  customer   Customer  @relation(fields: [customerId], references: [id], onDelete: Cascade)

  @@index([customerId])
  @@index([storeId, expiresAt])
}

model CustomerAddress {
  id             String        @id @default(cuid())
  storeId        String
  customerId     String
  label          String? // Maison, Bureau
  recipientName  String?
  phone          String?
  address        String
  landmark       String?
  city           String?
  deliveryZoneId String?
  isDefault      Boolean       @default(false)
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt
  store          Store         @relation(fields: [storeId], references: [id], onDelete: Cascade)
  customer       Customer      @relation(fields: [customerId], references: [id], onDelete: Cascade)
  deliveryZone   DeliveryZone? @relation(fields: [deliveryZoneId], references: [id], onDelete: SetNull)

  @@index([customerId])
}

model CustomerFavorite {
  id         String   @id @default(cuid())
  storeId    String
  customerId String
  productId  String
  createdAt  DateTime @default(now())
  store      Store    @relation(fields: [storeId], references: [id], onDelete: Cascade)
  customer   Customer @relation(fields: [customerId], references: [id], onDelete: Cascade)
  product    Product  @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@unique([customerId, productId])
  @@index([storeId, productId])
}

model AutomaticDiscount {
  id                         String          @id @default(cuid())
  storeId                    String
  title                      String // affiché à l'acheteur
  kind                       DiscountKind
  config                     Json // src/lib/discounts/schema.ts
  priority                   Int             @default(0)
  combinesWithCoupons        Boolean         @default(true)
  combinesWithOtherAutomatic Boolean         @default(true)
  startsAt                   DateTime?
  endsAt                     DateTime?
  active                     Boolean         @default(true)
  maxUses                    Int?
  usesCount                  Int             @default(0)
  createdAt                  DateTime        @default(now())
  updatedAt                  DateTime        @updatedAt
  store                      Store           @relation(fields: [storeId], references: [id], onDelete: Cascade)
  applications               OrderDiscount[]
  cartOffers                 CartOffer[]

  @@index([storeId, active])
}

model OrderDiscount {
  id                  String             @id @default(cuid())
  orderId             String
  storeId             String
  source              String // automatic | coupon | loyalty
  automaticDiscountId String?
  couponId            String?
  label               String
  amount              Int
  allocations         Json? // [{ lineIndex, orderItemId?, amount }]
  createdAt           DateTime           @default(now())
  order               Order              @relation(fields: [orderId], references: [id], onDelete: Cascade)
  store               Store              @relation(fields: [storeId], references: [id], onDelete: Cascade)
  automaticDiscount   AutomaticDiscount? @relation(fields: [automaticDiscountId], references: [id], onDelete: SetNull)
  coupon              Coupon?            @relation(fields: [couponId], references: [id], onDelete: SetNull)

  @@index([orderId])
  @@index([storeId, automaticDiscountId])
}

model CartOffer {
  id                   String             @id @default(cuid())
  storeId              String
  title                String
  placement            CartOfferPlacement
  mode                 String             @default("add") // add | replace
  triggerProductIds    String[]           @default([])
  triggerCollectionIds String[]           @default([])
  offerProductIds      String[]
  automaticDiscountId  String?
  position             Int                @default(0)
  active               Boolean            @default(true)
  conversions          Int                @default(0)
  revenue              Int                @default(0)
  createdAt            DateTime           @default(now())
  updatedAt            DateTime           @updatedAt
  store                Store              @relation(fields: [storeId], references: [id], onDelete: Cascade)
  automaticDiscount    AutomaticDiscount? @relation(fields: [automaticDiscountId], references: [id], onDelete: SetNull)

  @@index([storeId, active, placement])
}

model GiftCard {
  id                String                @id @default(cuid())
  storeId           String
  codeHash          String                @unique // HMAC-SHA256(APP_SECRET dérivée, storeId:code)
  codeEnc           String // encryptSecret(code) : renvoi et révélation auditée
  last4             String
  currency          String
  initialValue      Int
  balance           Int
  status            GiftCardStatus        @default(ACTIVE)
  source            GiftCardSource
  expiresAt         DateTime?
  customerId        String?
  sourceOrderId     String?
  sourceOrderItemId String?
  sequence          Int                   @default(0)
  recipientName     String?
  recipientPhone    String?
  recipientEmail    String?
  message           String?
  sendAt            DateTime?
  deliveredAt       DateTime?
  disabledReason    String?
  createdById       String?
  createdAt         DateTime              @default(now())
  updatedAt         DateTime              @updatedAt
  store             Store                 @relation(fields: [storeId], references: [id], onDelete: Cascade)
  customer          Customer?             @relation(fields: [customerId], references: [id], onDelete: SetNull)
  transactions      GiftCardTransaction[]

  @@unique([sourceOrderItemId, sequence])
  @@index([storeId, status])
  @@index([storeId, last4])
  @@index([customerId])
  @@index([status, expiresAt])
}

model GiftCardTransaction {
  id           String         @id @default(cuid())
  storeId      String
  giftCardId   String
  kind         GiftCardTxKind
  amount       Int // signé : + crédit, − débit
  balanceAfter Int
  orderId      String?
  returnId     String?
  actorId      String?
  note         String?
  createdAt    DateTime       @default(now())
  store        Store          @relation(fields: [storeId], references: [id], onDelete: Cascade)
  giftCard     GiftCard       @relation(fields: [giftCardId], references: [id], onDelete: Cascade)
  order        Order?         @relation(fields: [orderId], references: [id], onDelete: SetNull)

  @@index([giftCardId, createdAt])
  @@index([storeId, orderId])
}

model StoreCreditTransaction {
  id           String            @id @default(cuid())
  storeId      String
  customerId   String
  kind         StoreCreditTxKind
  amount       Int // signé
  balanceAfter Int
  orderId      String?
  returnId     String?
  actorId      String?
  note         String?
  createdAt    DateTime          @default(now())
  store        Store             @relation(fields: [storeId], references: [id], onDelete: Cascade)
  customer     Customer          @relation(fields: [customerId], references: [id], onDelete: Cascade)

  @@index([storeId, customerId, createdAt])
  @@index([orderId])
}

model ReturnRequest {
  id                String           @id @default(cuid())
  storeId           String
  orderId           String
  customerId        String?
  reference         String // RT-XXXXXX, unique par boutique
  status            ReturnStatus     @default(REQUESTED)
  resolution        ReturnResolution @default(NONE)
  requestedBy       String // customer | merchant
  reason            String
  customerNote      String?
  merchantNote      String?
  rejectionReason   String?
  photos            Json? // [{ url }] max 3
  restockingFee     Int              @default(0)
  refundShipping    Boolean          @default(false)
  refundAmount      Int              @default(0)
  storeCreditAmount Int              @default(0)
  exchangeOrderId   String?          @unique // référence logique vers Order (sans relation Prisma)
  refundId          String?
  approvedAt        DateTime?
  receivedAt        DateTime?
  resolvedAt        DateTime?
  cancelledAt       DateTime?
  createdAt         DateTime         @default(now())
  updatedAt         DateTime         @updatedAt
  store             Store            @relation(fields: [storeId], references: [id], onDelete: Cascade)
  order             Order            @relation(fields: [orderId], references: [id], onDelete: Cascade)
  customer          Customer?        @relation(fields: [customerId], references: [id], onDelete: SetNull)
  items             ReturnItem[]
  events            ReturnEvent[]

  @@unique([storeId, reference])
  @@index([storeId, status, createdAt])
  @@index([orderId])
}

model ReturnItem {
  id                String        @id @default(cuid())
  returnId          String
  orderItemId       String
  quantity          Int
  reason            String?
  condition         String? // neuf | ouvert | abime
  restock           Boolean       @default(true)
  restockedQty      Int           @default(0)
  exchangeVariantId String?
  returnRequest     ReturnRequest @relation(fields: [returnId], references: [id], onDelete: Cascade)
  orderItem         OrderItem     @relation(fields: [orderItemId], references: [id], onDelete: Cascade)

  @@unique([returnId, orderItemId])
}

model ReturnEvent {
  id            String        @id @default(cuid())
  returnId      String
  actorId       String?
  actorLabel    String
  fromStatus    ReturnStatus?
  toStatus      ReturnStatus?
  message       String?
  createdAt     DateTime      @default(now())
  returnRequest ReturnRequest @relation(fields: [returnId], references: [id], onDelete: Cascade)

  @@index([returnId, createdAt])
}
```
Migration : `prisma/migrations/<horodatage>_lot1_ventes_fidelite/migration.sql` (générée, aucune donnée réécrite ; `amountDue` reste null pour l'existant).

## 6. Fichiers, actions, routes

### Nouvelles capacités (`src/lib/auth/permissions.ts`)
`giftcards.manage` (OWNER, MANAGER), `returns.manage` (OWNER, MANAGER), `returns.receive` (OWNER, MANAGER, STAFF). Les remises automatiques et les offres réutilisent `coupons.manage`.

### Jobs (`src/lib/jobs.ts`, uniquement l'union `JobType` et un registre paresseux)
`giftcard.issue`, `giftcard.deliver`, `giftcard.expire_sweep`, `return.status_changed`, `tenders.unpaid_sweep`. Les gestionnaires vivent dans `src/lib/giftcards/jobs.ts` et `src/lib/returns/jobs.ts` (import dynamique depuis jobs.ts).

### Actions serveur (pattern `guard` + `parseForm` + `requireStore` + `audit` + `enqueue` en transaction)

| Fichier | Actions |
|---|---|
| `src/lib/buyer/actions.ts` (publique : slug, débits, session) | `requestOtp`, `verifyOtp`, `logoutBuyer`, `logoutAllDevices`, `saveAddress`, `deleteAddress`, `setDefaultAddress`, `toggleFavorite`, `reorder`, `updateBuyerConsent`, `requestAccountDeletion`, `verifyBuyerEmail` |
| `src/lib/buyer/merchant-actions.ts` | `updateAccountSettings` (`store.settings`), `revokeBuyerSessions` (`customers.manage`, audit) |
| `src/lib/discounts/actions.ts` | `upsertAutomaticDiscount`, `toggleAutomaticDiscount`, `deleteAutomaticDiscount`, `upsertCartOffer`, `toggleCartOffer`, `deleteCartOffer` (`coupons.manage`, audit `discount.*` et `offer.*`) |
| `src/lib/giftcards/actions.ts` | `createGiftCard`, `disableGiftCard`, `enableGiftCard`, `extendGiftCard`, `adjustGiftCardBalance`, `revealGiftCardCode`, `resendGiftCard` (`giftcards.manage`, audit `giftcard.*`) ; publique : `checkGiftCardBalance` (débit limité) |
| `src/lib/store-credit/actions.ts` | `grantStoreCredit`, `deductStoreCredit` (`customers.manage`, audit `store_credit.*`) |
| `src/lib/returns/actions.ts` | marchand : `createReturn`, `approveReturn`, `rejectReturn`, `receiveReturn` (`returns.receive`), `resolveReturn`, `cancelReturn` ; publique (jeton de suivi ou session) : `requestReturn`, `cancelMyReturn` |
| `src/lib/orders/actions.ts` (équipe B) | `refundOrder` : paramètre `destination` |

### Services purs (testés)
- `src/lib/commerce/checkout-pipeline.ts`, `src/lib/commerce/allocation.ts`, `src/lib/discounts/{schema,evaluate}.ts`
- `src/lib/giftcards/{code,state}.ts`
- `src/lib/returns/{state,policy,amounts}.ts`
- `src/lib/buyer/otp.ts`

### Services serveur
- `src/lib/buyer/{session,senders}.ts`
- `src/lib/giftcards/service.ts` (`redeemGiftCardsTx`, `reverseGiftCardsTx`, `issueGiftCardsForOrder`)
- `src/lib/store-credit/service.ts` (`redeemStoreCreditTx`, `reverseStoreCreditTx`, `grantTx`)
- `src/lib/returns/service.ts`
- `src/lib/loyalty/service.ts` (`revokeLoyaltyPartial`, `redeemPointsTx`)

### Routes
- Boutique :
  - `src/app/s/[slug]/compte/{page,connexion/page,commandes/page,commandes/[reference]/page,adresses/page,favoris/page}.tsx`
  - `src/app/s/[slug]/compte/retours/{page,[reference]/page}.tsx`
  - `src/app/s/[slug]/carte-cadeau/page.tsx`
  - `src/app/suivi/[token]/retour/page.tsx`
- Marchand :
  - `src/app/app/[storeId]/promotions/{automatiques,offres}/**` (onglets dans `page.tsx`)
  - `src/app/app/[storeId]/cartes-cadeaux/{page,[id]/page,loading,error}.tsx`
  - `src/app/app/[storeId]/retours/{page,[id]/page,loading,error}.tsx`
  - `src/app/app/[storeId]/parametres/comptes-clients/page.tsx`
  - `src/app/app/[storeId]/parametres/retours/page.tsx`
  - panneaux `src/app/app/[storeId]/clients/[customerId]/{buyer-account-panel,store-credit-panel}.tsx`

### Thème (extension de `src/lib/theme-engine/types.ts` et `schemas.ts`)
- `GlobalSettings.header.showAccount: boolean` (défaut `true`), `GlobalSettings.cards.showFavorite: boolean` (défaut `false`) : sanitize et validate à étendre avec valeurs par défaut.
- Blocs `main-product` :
  - `complementary` (« Souvent achetés ensemble », `limit 1`, réglages `heading`, `max` 1..4) ;
  - `gift_card_form` (`limit 1`) ;
  - `discount_badges` (« Offres disponibles », `limit 1`).
- `main-cart` : réglages `show_offers` (checkbox), `show_tier_progress` (checkbox), `show_gift_card_field` (checkbox).
- Nouvelle section `cart-progress` (« Barre d'offres », catégorie Mise en avant, templates `cart` et `home`) : messages de palier, schéma de couleurs.
- Composants : `src/components/storefront/sections/cart-progress.tsx` et blocs dans `src/components/storefront/product/*`, enregistrés dans `render-registry.tsx`.

### MCP (`src/lib/mcp/merchant/promotions.ts`, nouveau fichier, enregistré dans `server.ts`)

| Outil | Scope | Écrit | Confirmation |
|---|---|---|---|
| `list_automatic_discounts` | marketing:write ou analytics:read | | |
| `create_automatic_discount` | marketing:write | oui | `PERCENT > 50`, `FIXED > panier moyen 30 j`, `BUNDLE` à moins de 50 % de la somme |
| `set_automatic_discount_active` | marketing:write | oui | |
| `list_gift_cards` | orders:read | | (4 derniers caractères seulement) |
| `issue_gift_card` | `giftcards:write` (nouveau, Business+) | oui | toujours |
| `grant_store_credit` | `giftcards:write` + customers:read | oui | toujours |
| `list_returns` / `get_return` | orders:read | | textes acheteur sous `untrusted_customer_input` |
| `update_return_status` | orders:write | oui | via `canTransitionReturn` ; motif obligatoire pour refuser |

## 7. Plans (`src/config/plans.ts`)
Nouvelles clés `PlanFeatures` : `customerAccounts`, `automaticDiscounts`, `advancedDiscounts`, `cartOffers`, `giftCards`, `storeCredit`, `returnsPortal`.

| Fonction | Gratuit | Starter | Business | Scale | Enterprise |
|---|---|---|---|---|---|
| Comptes acheteurs (historique, adresses, favoris, réachat) | oui | oui | oui | oui | oui |
| Remises automatiques `PRODUCT_AMOUNT`, `CART_TIER` | non | oui | oui | oui | oui |
| `BUY_X_GET_Y`, `BUNDLE`, offres au panier | non | non | oui | oui | oui |
| Fidélité utilisable au checkout | non | non | oui (`loyalty`) | oui | oui |
| Cartes cadeaux, avoirs | non | non | oui | oui | oui |
| Retours en libre-service | non | non | oui (`refunds`) | oui | oui |

Upsell : message clair avec lien `/app/{storeId}/abonnement`. La désactivation reste toujours possible après une baisse de plan, et les cartes déjà émises restent utilisables (obligation envers l'acheteur). Lignes du COMPARATIF à ajouter.

## 8. Sécurité
- **Isolation** : toute requête filtrée par `storeId` ; session acheteur liée à la boutique ; `codeHash` inclut `storeId` (une carte de la boutique A est inutilisable sur B).
- **Fraude cartes cadeaux** :
  - 80 bits d'entropie ;
  - débits limités (10 vérifications / 15 min / IP, 5 échecs / panier, alerte à 200 échecs / h / boutique) ;
  - message unique « Carte cadeau invalide » ;
  - émission uniquement après paiement confirmé ; pas de paiement à la livraison ;
  - plafonds par commande ;
  - une carte ne paie pas une carte ;
  - révélation et ajustements audités ;
  - arrêt d'urgence plateforme.
- **Abus de remises** :
  - recalcul serveur intégral ;
  - aucune remise client acceptée ;
  - `excludeOnSale` par défaut ;
  - `maxUses` conditionnel ;
  - avoir et points réservés aux acheteurs vérifiés ;
  - `firstOrderOnly` contrôlé par téléphone (limite connue : un nouveau numéro contourne ; documenté).
- **Codes** : HMAC, temps constant, expiration, essais bornés, jamais journalisés ni dans `Notification`.
- **Injection** : zod sur toutes les entrées ; `config` des remises validée par union discriminée ; textes acheteur (motifs, notes, messages de cartes) échappés au rendu et marqués `untrusted_customer_input` dans le MCP ; photos de retour via le pipeline de stockage (type MIME vérifié, taille ≤ 5 Mo).
- **Données personnelles** (loi béninoise 2017-20, RGPD pour la zone Monde) :
  - adresses et favoris supprimés en cascade avec la fiche ;
  - demande de suppression journalisée ;
  - IP des codes purgée à 30 jours (job `otp.purge`) ;
  - pas de numéro complet dans les journaux.

## 9. Tests

### Vitest (`tests/`)
- `checkout-pipeline.test.ts` :
  - ordre d'application ;
  - cumul et non-cumul (meilleur scénario) ;
  - `excludeOnSale` ;
  - livraison sur net ;
  - fidélité plafonnée ;
  - tenders et `amountDue` ;
  - lignes carte cadeau exclues ;
  - total jamais négatif.
- `allocation.test.ts` : propriété `Σ = montant`, égalités, poids nuls, 1 FCFA réparti.
- `discounts-evaluate.test.ts` : `BUY_X_GET_Y` (moins chers offerts, même cible, `maxApplications`), `CART_TIER` (meilleur palier), `BUNDLE` (lots multiples), références disparues.
- `discounts-schema.test.ts` : configurations invalides refusées.
- `giftcard-code.test.ts` : format, normalisation, HMAC par boutique. `giftcard-state.test.ts` : transitions.
- `giftcard-redeem.test.ts` (fake-db) : débit conditionnel concurrent, expirée, désactivée, devise, recrédit à l'annulation, idempotence d'émission.
- `store-credit.test.ts` : solde jamais négatif, refus en invité.
- `returns-state.test.ts`, `returns-amounts.test.ts` : prorata, frais, plafond cumulé, retours multiples.
- `buyer-otp.test.ts` : hachage, expiration, essais, débits, anti-énumération, session liée à la boutique.
- `loyalty-partial.test.ts`.
- `security-lot1.test.ts` : isolation entre boutiques pour chaque action (carte, avoir, retour, favori, adresse).
- `plans.test.ts` : nouvelles clés.
- Mise à jour de `tests/pricing.test.ts` (`freeAbove` sur net).

### E2E (`e2e/08-lot1.spec.ts`, build de production)
1. Connexion acheteur par code (canal e-mail de test), historique, réachat.
2. Remise « 2 achetés = 1 offert » visible au panier puis sur la commande.
3. Achat d'une carte cadeau, paiement confirmé par le commerçant, utilisation partielle sur une seconde commande, annulation et recrédit.
4. Demande de retour acheteur, approbation, réception avec remise en stock, résolution en avoir, avoir utilisé au checkout connecté.
5. Plan Gratuit : pages de remises automatiques en upsell.

## 10. Équipes et vague de schéma

### Vague de schéma S1 (unique, 2 à 3 jours, responsable unique : équipe S)
Propriété exclusive :
- `prisma/schema.prisma`, `prisma/migrations/*_lot1_*`, `prisma/seed.ts` (données de démo) ;
- `src/config/plans.ts` ;
- `src/lib/auth/permissions.ts` ;
- `src/lib/jobs.ts` (union et registre paresseux vers des modules vides créés avec `export const handlers = {}`) ;
- `src/lib/mcp/scopes.ts` (scope `giftcards:write`) ;
- extension des types de thème (`types.ts` : `showAccount`, `showFavorite`) avec les défauts dans `defaults.ts`, `validate.ts` et `theme-doc.ts`.

Livrable : `pnpm prisma generate && pnpm typecheck` vert, publié avant le démarrage des équipes.

### Équipes parallèles (propriété de fichiers disjointe)

| Équipe | Propriété exclusive | Dépend de |
|---|---|---|
| A. Comptes acheteurs | `src/lib/buyer/**`, `src/app/s/[slug]/compte/**` sauf `compte/retours/**`, `src/components/storefront/account/**`, `src/app/app/[storeId]/parametres/comptes-clients/**`, `src/app/app/[storeId]/clients/[customerId]/buyer-account-panel.tsx` | S1 |
| B. Moteur de prix et remises (seule propriétaire du cœur commerce) | `src/lib/commerce/**` (pipeline, allocation, `orders.ts`, `pricing.ts`, `createExchangeOrder`), `src/lib/storefront/actions.ts`, `src/lib/payments/service.ts` (`requestRefund`), `src/lib/orders/actions.ts`, `src/lib/discounts/**`, `src/lib/coupons/actions.ts`, `src/app/app/[storeId]/promotions/**` | S1 ; intègre les fonctions transactionnelles de C et D |
| C. Cartes cadeaux et avoirs | `src/lib/giftcards/**`, `src/lib/store-credit/**`, `src/app/app/[storeId]/cartes-cadeaux/**`, `src/app/s/[slug]/carte-cadeau/**`, `src/app/app/[storeId]/clients/[customerId]/store-credit-panel.tsx`, `src/components/storefront/gift-card-input.tsx` | S1 ; fournit `redeemGiftCardsTx` et les autres fonctions à B au jour 5 |
| D. Retours | `src/lib/returns/**`, `src/lib/loyalty/**`, `src/app/app/[storeId]/retours/**`, `src/app/app/[storeId]/parametres/retours/**`, `src/app/s/[slug]/compte/retours/**`, `src/app/suivi/[token]/retour/**` | S1 ; `createExchangeOrder` de B |
| E. Vitrine, thème et MCP | `src/app/s/[slug]/commander/**` (intègre les composants de A et C), `src/components/storefront/sections/cart-progress.tsx`, `src/components/storefront/product/**`, `src/lib/theme-engine/schemas.ts` (ajouts du lot), `render-registry.tsx`, `src/lib/mcp/merchant/promotions.ts`, `src/lib/mcp/merchant/server.ts` | B (interface du pipeline figée au jour 3) |

Contrats figés au jour 3 : types `PipelineInput` et `PricedCart`, signatures `redeemGiftCardsTx(tx, storeId, codes, maxAmount)`, `redeemStoreCreditTx(tx, storeId, customerId, amount)`, `createExchangeOrder(tx, …)`, `getBuyer(store)`.

Intégration (B, jours 15 à 18), puis revue, audit sécurité, E2E et GO/NO-GO.
