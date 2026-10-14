# Architecture — Axi

Complète `docs/CONVENTIONS.md` (comment on code) et `docs/PRODUIT.md` (quoi et pourquoi). Ce document décrit **comment le système est construit**.

## 1. Vue d'ensemble

```
 Navigateur (mobile-first)                       Fournisseurs externes
 ┌──────────────┐  ┌──────────────┐              ┌───────────┐ ┌────────┐
 │ Boutique     │  │ Espace       │              │ Passerelle│ │ Resend │
 │ publique /s  │  │ marchand /app│              │ paiement  │ │ e-mail │
 └──────┬───────┘  └──────┬───────┘              └─────┬─────┘ └───┬────┘
        │ RSC + Server Actions                   webhook│           │
 ┌──────▼─────────────────▼─────────────────────────────▼───────────┴────┐
 │ Next.js 16 (App Router)                                              │
 │  src/proxy.ts  : {slug}.domaine → /s/{slug} ; domaine custom → /d/   │
 │  src/app/**    : pages (Server Components) + route handlers /api/**  │
 │  src/lib/**    : actions ("use server"), services, fonctions pures   │
 │     auth/permissions ─ commerce/{pricing,orders,order-state,quotas}  │
 │     payments/{gateways,service} ─ billing/platform-billing ─ jobs    │
 └──────────────────────────────┬───────────────────────────────────────┘
                                │ Prisma
                        ┌───────▼────────┐        ┌──────────────────┐
                        │ PostgreSQL     │◄───────│ Worker de jobs   │
                        │ (multi-tenant) │        │ /api/jobs/run    │
                        └────────────────┘        │ ou pnpm jobs     │
                                                  └──────────────────┘
```

Un seul déployable Next.js ; services annexes : PostgreSQL, un déclencheur cron et, en production, un bucket S3 compatible pour les images (§7 ter).

## 2. Modèle de données (`prisma/schema.prisma`)

Groupes d'entités :

| Groupe | Modèles | Notes |
|---|---|---|
| Identité | `User`, `Session`, `VerificationToken`, `Membership`, `Invitation` | `User.isPlatformAdmin` = admin plateforme ; `Membership.role` ∈ OWNER/MANAGER/STAFF/SUPPORT, `expiresAt` pour SUPPORT |
| Boutique | `Store`, `Domain` | `slug` unique, `status` (DRAFT → PUBLISHED, CLOSED_TEMPORARILY, SUSPENDED, ARCHIVED), thème JSON encadré, marketplace (`listedInMarketplace`, `isFeatured`) |
| Catalogue | `Category`, `Product`, `Variant`, `OptionGroup`, `Option`, `InventoryMovement` | promo datée, stock suivi par variante, options/suppléments avec `priceDelta`, images JSON `[{url, alt}]` |
| Vente | `Cart`, `CartItem`, `Customer`, `Consent`, `Order`, `OrderItem`, `OrderEvent`, `Coupon`, `CouponRedemption` | `Order` est un **instantané** (noms, prix, adresse) ; `OrderEvent` est immuable (historique) |
| Paiement | `PaymentMethod`, `PaymentAttempt`, `ProviderEvent`, `Refund` | clés chiffrées, événements webhook idempotents par `(provider, eventId)` |
| Livraison | `DeliveryZone`, `PickupSlot` | |
| SaaS | `Subscription`, `Invoice`, `UsageCounter` | une subscription par boutique ; compteurs mensuels `orders`, `whatsapp_messages`, `ai_credits` |
| Opérations | `Integration`, `Automation`, `Notification`, `Job`, `AuditLog`, `SupportTicket`, `Lead` | outbox, audit, support |
| Comptes acheteurs (lot 1) | `CustomerOtp`, `CustomerSession`, `CustomerAddress`, `CustomerFavorite` | code haché (HMAC), jamais en clair ; session = `sha256` du jeton ; 10 adresses et 200 favoris par client ; `Store.accountsEnabled`, `Customer.phoneVerifiedAt` / `emailVerifiedAt` / `lastLoginAt` |
| Remises et offres (lot 1) | `AutomaticDiscount`, `OrderDiscount`, `CartOffer` | `config` JSON validé par `src/lib/discounts/schema.ts` ; `OrderDiscount` = remise appliquée à une commande, avec ses `allocations` par ligne ; `CartOffer.conversions` / `revenue` ; `Coupon.combinesWithAutomatic`, `appliesTo`, `firstOrderOnly` |
| Cartes cadeaux et avoir (lot 1) | `GiftCard`, `GiftCardTransaction`, `StoreCreditTransaction` | `GiftCard.codeHash` (unique) + `codeEnc` + `last4` ; journaux signés (`amount` ±, `balanceAfter`) ; solde d'avoir dénormalisé `Customer.storeCreditBalance` ; `Product.isGiftCard`, `giftCardValidityDays` |
| Retours (lot 1) | `ReturnRequest`, `ReturnItem`, `ReturnEvent` | référence `RT-…` unique par boutique ; `ReturnEvent` = historique ; politique `Store.returnPolicy` (JSON, `src/lib/returns/policy.ts`) |
| Plateforme | `PlatformSetting` | clé/valeur : arrêts d'urgence (`mcp.kill_switch`, `buyer_accounts.kill_switch`, `giftcards.kill_switch`), réservation des balayages quotidiens (`giftcards.daily_sweep`, `fx.daily_refresh`, `api.idempotency_purge`) |
| Paiements et catalogue social (lot 1 bis) | `SocialCatalogSync`, `SocialCatalogItem` | `SocialCatalogSync` par boutique et canal (`whatsapp` = synchronisation Graph ; `meta`, `google`, `tiktok` = activation des flux), `settings` `{ includeOutOfStock, brand }` ; `SocialCatalogItem` = article synchronisé (`retailerId`, `contentHash`, statut `synced` / `error`) ; `PaymentMethod.channels` (portefeuilles proposés), `PaymentAttempt.channel` / `payerPhone` |
| Devises (lot 2) | `StoreCurrency`, `ExchangeRate`, `ProductPrice` | devises affichées par boutique (taux auto ou manuel, marge, `RoundingRule`), taux plateforme (`fetchedAt`), prix fixés par devise (`itemKey`) ; `Cart.fxQuote` (cotation verrouillée 15 min), `PaymentMethod.currencies` |
| Taxes et factures (lot 2) | `TaxRate`, `OrderInvoice` | taux par pays, `regionKey` et catégorie ; `OrderInvoice` (`InvoiceKind` `INVOICE` / `CREDIT_NOTE`, numéro unique `(storeId, number)`, instantané immuable) ; compteurs `Store.invoiceCounter` / `creditNoteCounter` ; `Store.taxesEnabled`, `pricesIncludeTax`, `taxRegistration` (JSON, dont `autoIssueInvoices`) ; `Product.taxable`, `taxCategory` |
| Blog (lot 2) | `BlogCategory`, `BlogPost` | `BlogPostStatus` `DRAFT`, `SCHEDULED`, `PUBLISHED`, `ARCHIVED` ; adresse unique par boutique ; `templateSuffix` (modèle alternatif) |
| Webhooks et API (lot 2) | `WebhookEndpoint`, `WebhookDelivery`, `ApiIdempotencyKey` | secret chiffré (`secretEnc`, trousseau avec rotation) ; `WebhookDelivery` unique `(endpointId, eventId)`, `WebhookDeliveryStatus` `PENDING`, `SUCCEEDED`, `FAILED`, `DEAD` ; clé d'idempotence unique `(storeId, key)` |
| Langues (lot 2 A, reporté) | `Translation` | `TranslatableResource`, `TranslationSource` ; `Store.enabledLocales`, `i18nConfig`, `Cart.locale`, `Order.locale`, `DeliveryZone.country` : créés par la migration, pas encore utilisés |
| Personnalisation (lot 4A) | `MetafieldDefinition`, `MetafieldValue`, `SavedSection`, `SectionLibraryItem` | `MetafieldOwner` (`PRODUCT`, `VARIANT`, `COLLECTION`, `CUSTOMER`, `ORDER`, `STORE`, `PAGE`, `BLOG_POST`) ; `templateSuffix` sur `Product`, `Category`, `StorePage`, `BlogPost` |
| Produits numériques et services (vague 2) | `DigitalAsset`, `DownloadGrant` | `ProductKind` (`PHYSICAL` défaut, `DIGITAL`, `SERVICE`, `GIFT_CARD`) sur `Product.kind` (⇔ `isGiftCard`) et `OrderItem.kind` (instantané) ; `DigitalAsset` = fichier vendu (`storageKey` jamais publique, `version` incrémentée à chaque remplacement) ; `DownloadGrant` = accès d'un acheteur (`tokenHash` HMAC unique, `@@unique([orderItemId])`, compteur, limite, expiration) ; réglages produit `downloadLimit`, `downloadValidityDays`, `service*`, `postPurchaseInstructions` ; migration `20261011200000_vague2_produits_numeriques` |
| Personnalisation (lots 4B à 4D, à venir) | `ThemeSchedule`, `ThemeGeneration`, `Experiment`, `ExperimentStat`, `PushSubscription`, `LiveEvent` | créés par la migration `20261011190000_lot4_personnalisation`, sans code applicatif ; `Store.brandKit`, `pwaConfig` |

Champs ajoutés au lot 1 : `Order.automaticDiscount`, `loyaltyDiscount`, `loyaltyPointsRedeemed`, `giftCardAmount`, `storeCreditAmount`, `amountDue` (null pour les commandes antérieures : vaut `total`), `buyerVerified`, `attribution` (`{ offers }`) ; `OrderItem.isGiftCard`, `discountAllocated` ; `Refund.method`, `returnId` ; `Cart.attribution` ; valeur `DIGITAL` de `FulfillmentType` (panier composé uniquement de cartes cadeaux).

Champs ajoutés au lot 2 (migration `20261011180000_lot2_international_contenu`) : `Order.taxTotal`, `taxesIncluded`, `taxLines`, `buyerCompany`, `buyerTaxId`, `presentmentCurrency`, `presentmentRate` (10 décimales, marge comprise), `presentmentTotal`, `presentmentAmounts` ; `OrderItem.taxAmount`, `taxRateBps`, `presentmentUnitPrice`. Les migrations de la vague 2 sont additives : `20261011170000_lot1bis_paiements_whatsapp`, `20261011180000_lot2_international_contenu`, `20261011190000_lot4_personnalisation`.

Règles :
- **Montants entiers** dans la devise de la boutique (XOF sans décimales ; EUR en centimes) — `src/lib/money.ts`.
- **Numéros** en E.164 sans `+` (`normalizePhone`).
- Suppressions en cascade depuis `Store` (archiver plutôt que supprimer ; `ARCHIVED` conserve tout).

## 3. Isolation multi-tenant

- Toute entité métier porte `storeId` (directement ou via sa commande/son produit).
- Toute lecture/écriture serveur passe par `requireStore(storeId, capability)` (`src/lib/auth/permissions.ts`) qui charge la boutique, vérifie l'appartenance (`Membership` non expirée) et la **capacité** du rôle (`ROLE_CAPS`), puis **filtre systématiquement par `storeId`** (`where: { storeId: ctx.store.id }`).
- Pages : `getStoreContext()` (redirige) ; actions : `requireStore()` (lève `AuthError`, convertie en `ActionResult` par `guard()`).
- Boutique `SUSPENDED` : lecture, export et facturation seulement.
- Admin plateforme : **aucun accès implicite** aux boutiques (il passe par la console `/admin`). Pour entrer dans une boutique, une `Membership` SUPPORT datée, motivée et auditée est créée par `grantSupportAccess` (lecture seule) ; elle ne vaut que tant que l'utilisateur garde la permission plateforme `support.access` (`storeRoleStillAllowed`).
- Boutique publique : lue par `slug` et uniquement si `PUBLISHED` ; le checkout recalcule tout côté serveur (`createOrder`), jamais de montant client.
- Suivi acheteur : `Order.trackingToken` aléatoire + `trackingExpiresAt` (lien à durée limitée, sans compte).
- Compte acheteur (lot 1) : la session est liée à une boutique (§7 quater) ; les codes de carte cadeau sont hachés avec le `storeId` (une carte de A est inutilisable sur B) ; avoir, adresses, favoris et retours sont filtrés par `storeId` et par le `customerId` de la session.

## 4. Machines d'états

### Commande (`src/lib/commerce/order-state.ts`)
```
NEW ─► CONFIRMED ─► PREPARING ─► READY ─► OUT_FOR_DELIVERY ─► DELIVERED ─► REFUNDED
 │         │            │          │  ▲            │
 └─────────┴────────────┴──────────┘  └────────────┘ (échec de livraison → READY)
                      ▼
                  CANCELLED (terminal)        REFUNDED (terminal)
```
`canTransition(from, to, opts?)` est la seule source de vérité ; chaque changement écrit un `OrderEvent` et un job `order.status_changed`. Annulation impossible après départ en livraison.
Vague 2 : une commande SANS LIGNE PHYSIQUE (numérique, service, carte cadeau) peut passer directement `NEW | CONFIRMED | PREPARING → DELIVERED` avec `{ intangible: true }` ; `transitionOrder` revérifie les lignes réelles avant d'accorder ce raccourci, et le job `digital.deliver` clôt ainsi les commandes 100 % numériques après paiement.

### Paiement (`src/lib/payments/service.ts`)
```
PaymentAttempt : CREATED → PENDING → INITIATED → CONFIRMED | FAILED | EXPIRED
Order.paymentStatus : UNPAID → PENDING → PAID → PARTIALLY_REFUNDED → REFUNDED  (ou FAILED)
```
- Manuel (espèces, Mobile Money avec référence) : `confirmManualPayment()` par un membre ayant `payments.confirm` — jamais automatique.
- Passerelle : `initiateGatewayPayment()` → redirection → webhook `handleGatewayWebhook()` → `applyAttemptStatus()`. Les statuts sont **ordonnés** (`RANK`) : un événement en retard ne rétrograde jamais ; `CONFIRMED` est définitif.
- Rapprochement : `reconcilePendingAttempts()` interroge `fetchStatus` pour les tentatives `INITIATED` anciennes (webhook manqué).
- Remboursements : `requestRefund()` cumule les `Refund`, passe `PARTIALLY_REFUNDED`/`REFUNDED`.

### Abonnement
`TRIALING` (14 j Business) → `ACTIVE` | retour `STARTER` ; `ACTIVE` → `PAST_DUE` (facture impayée) → `SUSPENDED` (J+10) ; `CANCELLED`. Le plan **effectif** (`effectivePlanId`) tombe sur `STARTER` dès que l'abonnement n'est plus actif/en essai valide, sans suppression de données (quotas appliqués à la création, commandes « hors quota » marquées, jamais refusées).

### Carte cadeau (`src/lib/giftcards/state.ts`)
```
             (paiement confirmé de la commande d'achat, ou création manuelle)
                                  │
                                  ▼
    ┌──────────────────────► ACTIVE ◄───────────────┐
    │ réactivation           │    │ expiresAt ≤ now  │ prolongation
    │ (non expirée)          │    ▼ (job quotidien)  │ (nouvelle date)
 DISABLED ◄── désactivation ─┘  EXPIRED ────────────┘
```
`canTransitionGiftCard(from, to, { expiresAt, newExpiresAt, now })` est la seule source de vérité : `ACTIVE → DISABLED` ; `DISABLED → ACTIVE` si `expiresAt` est absent ou futur ; `ACTIVE → EXPIRED` si `expiresAt ≤ now` ; `EXPIRED → ACTIVE` seulement avec une nouvelle `expiresAt` future. Toute autre transition est refusée. Les actions (`src/lib/giftcards/actions.ts`) écrivent par `updateMany` conditionnel sur le statut lu, créent une `GiftCardTransaction` (`ADJUST` de montant 0 avec note pour la désactivation et la prolongation simple, `REACTIVATE` pour la réactivation et la prolongation d'une carte expirée) et un `audit()`. Statut affiché (`displayGiftCardStatus`) : « Épuisée » = `ACTIVE` avec solde ≤ 0 ; une carte `ACTIVE` dont la date est passée est affichée « Expirée » avant le passage du job. Utilisable au paiement (`giftCardUsabilityProblem`) : `ACTIVE`, non expirée, devise de la boutique, solde > 0 ; sinon message unique « Carte cadeau invalide ».

### Retour (`src/lib/returns/state.ts`)
```
REQUESTED ──approuver──► APPROVED ──réception──► RECEIVED ──résoudre──► RESOLVED (terminal)
    │  └──refuser──► REJECTED (terminal)
    └──annuler (acheteur ou commerçant)──► CANCELLED ◄──annuler (commerçant)── APPROVED
Création par le commerçant (retour en boutique) : directement APPROVED ou RECEIVED.
```
`canTransitionReturn(from, to)` est la seule source de vérité (`REQUESTED → APPROVED | REJECTED | CANCELLED`, `APPROVED → RECEIVED | CANCELLED`, `RECEIVED → RESOLVED`) ; `canActorTransitionReturn` limite l'acheteur à `REQUESTED → CANCELLED` ; `initialReturnStatusAllowed` : `REQUESTED` pour l'acheteur, `APPROVED` ou `RECEIVED` pour le commerçant. Chaque transition (`src/lib/returns/service.ts`) est conditionnelle sur le statut lu et écrit un `ReturnEvent`, un `audit()` et le job `return.status_changed`. La création et la résolution verrouillent la commande (`SELECT … FOR UPDATE`). Les quantités encore retournables ignorent les retours `CANCELLED` et `REJECTED`. La résolution `REFUND` se fait en trois temps : réservation `RECEIVED → RESOLVED` (montant figé), `requestRefund`, finalisation ; si le remboursement échoue, compensation `RESOLVED → RECEIVED` avec un événement explicite.

## 4 bis. Prix, tenders et remboursements (lot 1)

### Pipeline de prix (`src/lib/commerce/checkout-pipeline.ts`)
`priceCart(input: PipelineInput): PricedCart` est une fonction pure et déterministe (aucune lecture de base, horloge via `input.now`), seule source des montants pour `previewTotals` (`src/lib/storefront/actions.ts`), `createOrder` (`src/lib/commerce/orders.ts`), la commande d'échange (`src/lib/commerce/exchange.ts`) et `computeTotals` (`pricing.ts`, conservé pour compatibilité, qui délègue au pipeline). Ordre normatif :

1. **Prix unitaire**, fourni par l'appelant : prix de variante, sinon promo datée (`effectivePrice`), sinon prix, plus les suppléments.
2. **Remises automatiques de ligne** (`PRODUCT_AMOUNT`, `BUY_X_GET_Y`, `BUNDLE`, évaluées par `src/lib/discounts/evaluate.ts`) : une unité reçoit au plus une remise ; ordre `priority` décroissante, puis économie estimée décroissante, puis `id` ; chaque remise consomme les unités qu'elle utilise ; lignes carte cadeau jamais éligibles ; `excludeOnSale` (défaut vrai) exclut les unités en promo datée.
3. **Remise de panier** (`CART_TIER`) : une seule, la plus avantageuse atteinte, sur le net après l'étape 2, hors cartes cadeaux.
4. **Code promo** : `minSubtotal` comparé au net hors cartes cadeaux après les étapes 2 et 3 ; assiette restreinte par `appliesTo`.
5. **Fidélité** (acheteur connecté) : paliers entiers `rewardPoints → rewardValue`, plafonnés à `maxRedeemPercent` (défaut 50 %) du net marchandise après l'étape 4.
6. **Livraison** : `freeAbove` comparé au net marchandise hors cartes cadeaux **après remises automatiques et coupon, avant fidélité** ; coupon `FREE_DELIVERY` ou palier « livraison offerte » (livraison uniquement) : frais à 0.
7. **Taxes** : 0 au lot 1 ; depuis le lot 2, `computeTaxes` (`src/lib/tax/compute.ts`) sur les nets après toutes les remises allouées (fidélité comprise), voir §7 quinquies.
8. **Total** = net marchandise + livraison (+ taxes en HT : `addToTotal`), jamais négatif. La conversion dans la devise d'affichage se fait APRÈS le pipeline (`presentCart`, §7 quinquies).
9. **Tenders** : ne modifient ni le total ni les remises (voir plus bas).

Combinaisons : le pipeline évalue l'ensemble des remises automatiques cumulables (`combinesWithOtherAutomatic`), puis chaque remise non cumulable seule, et garde le scénario au plus petit « net marchandise + livraison, avant fidélité ». Un coupon cumulable s'ajoute au scénario retenu. Si le coupon n'est pas cumulable (`combinesWithAutomatic = false`) ou si une remise retenue a `combinesWithCoupons = false`, le pipeline calcule aussi les scénarios avec coupon (coupon seul, ou avec les seules remises qui acceptent les coupons) et garde le plus favorable à l'acheteur, les remises automatiques l'emportant à égalité ; il ajoute alors `NOT_COMBINABLE_MESSAGE` (« Ce code n'est pas cumulable avec les offres en cours : la meilleure offre a été appliquée. ») et `couponSuperseded` si le code est écarté. Une configuration invalide ou une remise épuisée est ignorée : jamais d'erreur au checkout. Sortie : `lines[]` avec `discountAllocated` et `netTotal`, `discounts[]` (`{ source, id, label, amount, allocations }`), agrégats (`subtotal`, `discount`, `automaticDiscount`, `couponDiscount`, `loyaltyDiscount`, `deliveryFee`, `taxTotal`, `total`), `tenders[]`, `giftCardAmount`, `storeCreditAmount`, `amountDue`, `messages[]` (progression, non-cumul, plafond de fidélité), `appliedAutomaticIds` (incrément conditionnel de `usesCount` dans `createOrder`).

### Allocation au plus fort reste (`src/lib/commerce/allocation.ts`)
`allocateProRata(amount, weights)` répartit un montant entier au prorata de poids entiers : parts entières `⌊amount × poids / Σ poids⌋`, puis le reste, une unité à la fois, aux plus forts restes (égalités départagées par le plus petit index). Invariants : `Σ allocations = amount` ; poids négatifs ou non finis traités comme 0 ; poids nul → 0 si `Σ poids > 0` ; `Σ poids = 0` → répartition égale ; montant négatif → répartition du montant positif, signe inversé ; produits calculés en `BigInt` (exacts au-delà de 2^53). Sert aux remises de niveau commande (palier, coupon, fidélité), au prix d'un lot et à la valeur unitaire des lignes retournées (`src/lib/returns/amounts.ts`).

### Tenders et `amountDue`
- Assiette des tenders = `total − Σ net des lignes carte cadeau` : ni une carte ni l'avoir ne paient une carte cadeau.
- Cartes cadeaux : 3 au maximum, triées par expiration la plus proche (sans date en dernier), puis plus petit solde, puis `id` ; chaque carte paie `min(solde, reste)`.
- Puis avoir (acheteur connecté par code, ou commerçant `customers.manage`) : `min(avoir disponible, reste)`.
- `amountDue = total − Σ tenders`. Si `amountDue = 0`, la commande est `PAID` dès sa création (job `payment.succeeded` si `total > 0`).
- Dans `createOrder` : cartes verrouillées (`SELECT … FOR UPDATE`), débit conditionnel (`balance ≥ montant`), transaction `REDEEM` et `PaymentAttempt { provider: "gift_card", status: CONFIRMED }` ; avoir débité de façon conditionnelle avec un `PaymentAttempt { provider: "store_credit" }`. Un écart avec la répartition du pipeline lève une `CheckoutError` lisible.
- Commande contenant une carte cadeau : plafonds `giftCardOrderLimitError` (5 cartes, 1 000 000 FCFA, valeur faciale de 1 000 à 500 000 FCFA ; EUR : équivalents en centimes), paiement à la livraison refusé, `DIGITAL` réservé aux paniers composés uniquement de cartes. Émission par le job `giftcard.issue`, mis en file dans la transaction qui confirme le paiement (`confirmManualPayment`, paiement par passerelle), idempotente (`@@unique([sourceOrderItemId, sequence])`).
- Annulation (`transitionOrder` vers `CANCELLED`) : recrédit des tenders encore débités (`REDEEM − REVERSAL`), plafonné par `refundableRemaining` ; cartes achetées par la commande désactivées et solde non dépensé retiré ; points utilisés rendus.

### Montant remboursable (`src/lib/commerce/refunds.ts`)
`refundableRemaining(tx, order, { excludeReturnId })` charge le registre (`loadRefundLedger`) puis applique `computeRefundable` :
```
remaining = max(0, total
          − Σ amount des Refund dont status ≠ REJECTED
          − Σ REVERSAL (cartes cadeaux et avoir de la commande) dont la note ne contient pas « refund: »
          − Σ refundAmount des retours RESOLVED en STORE_CREDIT ou EXCHANGE
          − Σ refundAmount des retours RESOLVED en REFUND dont refundId est nul (réservés)
          − valeur dépensée des cartes cadeaux achetées par la commande)
```
Les retours sont ignorés s'ils correspondent à `excludeReturnId` (retour en cours de remboursement). La valeur dépensée des cartes achetées vaut `max(0, −Σ amount)` de leurs transactions `REDEEM` et `REVERSAL`, toutes commandes confondues. Un REVERSAL créé par un remboursement porte `refund:<refundId>` dans sa note (`refundNote`, sans migration) ; part externe déjà rendue = `externalRefunded` = Σ Refund non refusés − Σ REVERSAL rattachés. Utilisé par `requestRefund` (les deux destinations), `quoteReturn`, l'annulation et l'affichage « remboursable » de la fiche commande. `requestRefund` (`src/lib/payments/service.ts`) : destination `original` = paiement externe à hauteur du payé hors tenders non encore rendu, puis cartes cadeaux (REVERSAL au prorata), puis avoir ; destination `store_credit` = tenders rendus à leurs instruments, seule la part externe créditée en avoir (`REFUND_TO_CREDIT`). Base des points de fidélité : `loyaltyBaseAmount` (`src/lib/commerce/loyalty-base.ts`) = net marchandise hors cartes cadeaux et hors livraison, moins cartes et avoir utilisés.

## 5. Outbox et jobs (`src/lib/jobs.ts`)

- `enqueue(type, payload, { storeId, runAt }, tx)` s'appelle **dans la transaction** qui modifie la donnée → pas d'événement perdu ni fantôme.
- Types (`JobType`) : `order.created`, `order.status_changed`, `payment.succeeded`, `payment.failed`, `order.fulfilled`, `notification.send`, `subscription.changed`, `store.published`, `member.invited`, `automation.run`, `cart.check`, plus les types dont le gestionnaire vit dans un module de domaine importé à la demande (`LazyJobType`, registre `LAZY_JOB_MODULES` ; le module exporte `handlers: JobHandlers`) : lot 1 `giftcard.issue`, `giftcard.deliver`, `giftcard.expire_sweep`, `tenders.unpaid_sweep`, `return.status_changed` ; lot 2 `fx.refresh`, `webhook.fanout`, `webhook.deliver`, `idempotency.purge` ; lot 4 `theme.schedule_notify`, `social.sync`, `push.send`, `ai.generation_purge` ; vague 2 `digital.deliver`.
- Jobs du lot 1 :

| Type et charge utile | Gestionnaire | Rôle |
|---|---|---|
| `giftcard.issue` `{ orderId }` | `src/lib/giftcards/jobs.ts` → `issueGiftCardsForOrder` (`service.ts`) | émission des cartes achetées après paiement confirmé (jamais pour une commande annulée ou remboursée, revérifié sous verrou), idempotente ; met en file `giftcard.deliver` à la date d'envoi choisie ou tout de suite |
| `giftcard.deliver` `{ giftCardId, force? }` | `src/lib/giftcards/jobs.ts` → `deliverGiftCard` | e-mail au destinataire (le code ne passe jamais par `Notification`) ; sans e-mail, rien n'est envoyé : lien `wa.me` proposé à l'acheteur sur `/merci` ou au commerçant via « Renvoyer » |
| `giftcard.expire_sweep` | `src/lib/giftcards/jobs.ts` → `expireGiftCards` puis `enqueueMissingGiftCardIssues` | `ACTIVE → EXPIRED` des cartes échues, filet de sécurité de l'émission |
| `tenders.unpaid_sweep` | `src/lib/giftcards/jobs.ts` → `notifyUnpaidTenderOrders` | notification du commerçant pour les commandes impayées depuis plus de 72 h avec carte ou avoir débité (aucune annulation automatique) |
| `return.status_changed` `{ returnId, from, to, by }` | `src/lib/returns/jobs.ts` → `handleReturnStatusChanged` | e-mail à l'acheteur s'il en a laissé un (une fois par transition, clé `return:<id>:<statut>`) ; pour une nouvelle demande de l'acheteur, notification interne du commerçant |

- Jobs de la vague 2 (lot 1 bis, lot 2, lot 4A) :

| Type et charge utile | Gestionnaire | Rôle |
|---|---|---|
| `payment.succeeded` (existant) | + `src/lib/tax/jobs.ts` → `autoIssueInvoiceForOrder` | émission automatique de la facture (plan `invoices`, option `autoIssueInvoices` activée explicitement, boutique qui collecte la taxe, commande payée) ; mis en file dans la transaction qui passe la commande à `PAID` sur les trois chemins (création payée, confirmation manuelle, webhook) |
| `fx.refresh` | `src/lib/currency/jobs.ts` → `refreshPlatformRates` | parités fixes puis taux BCE ; échec réseau ou fichier illisible = job en échec (retenté puis `DEAD`), anciens taux conservés |
| `social.sync` `{ syncId, force? }` | `src/lib/social/jobs.ts` → `runCatalogSync` | synchronisation du catalogue WhatsApp (Graph Catalog Batch), §7 quinquies |
| `webhook.fanout` `{ storeId, eventId, event, data, createdAt }` | `src/lib/webhooks/jobs.ts` | une `WebhookDelivery` + un job `webhook.deliver` par point actif abonné |
| `webhook.deliver` | `src/lib/webhooks/jobs.ts` → `deliverWebhook` | envoi signé, calendrier de relances propre (1 min → 24 h, `DEAD` après 8 essais) ; ne lève pas d'exception pour un échec HTTP |
| `idempotency.purge` | `src/lib/api/jobs.ts` | purge des clés d'idempotence expirées de l'API REST |
| `digital.deliver` `{ orderId }` | `src/lib/digital/jobs.ts` → `issueDigitalDeliveriesForOrder` | vague 2 : accès de téléchargement des lignes numériques après paiement confirmé (idempotent, `@@unique([orderItemId])`, revérifié sous verrou), e-mail du lien à l'acheteur, webhook `digital.delivered`, puis clôture d'une commande sans expédition ; mis en file par le gestionnaire de `payment.succeeded` |

  Planification : `scheduleDueCatalogSyncs()` est appelée par le balayage de `/api/jobs/run` (étape `catalogSync`) ; `scheduleDailyFxRefresh()` (une fois par jour UTC, réservation `PlatformSetting` `fx.daily_refresh`) est appelée paresseusement par la vitrine quand le dernier taux BCE a plus de 24 h ; `scheduleIdempotencyPurge()` (une fois par jour, réservation `api.idempotency_purge`) est appelée de façon opportuniste par les `POST` de l'API REST. Ces deux dernières ne sont pas encore appelées par `/api/jobs/run` (§8). Types réservés aux lots 4B à 4D, sans gestionnaire actif : `theme.schedule_notify`, `push.send`, `ai.generation_purge`.

  Les deux balayages quotidiens sont mis en file une seule fois par jour UTC par `scheduleDailyGiftCardSweeps()` (`src/lib/giftcards/schedule.ts`, réservation atomique sur `PlatformSetting` `giftcards.daily_sweep`), appelée par `/api/jobs/run`. La purge des données de connexion acheteur (`purgeBuyerAuthData`, `src/lib/buyer/purge.ts`) et celle des photos de retour orphelines (`purgeOrphanReturnPhotos`) ne sont pas des jobs : ce sont des étapes du balayage de `/api/jobs/run`.
- `runJobs(limit)` : verrou optimiste (`updateMany` PENDING→RUNNING), exécution, `DONE` ou retry avec backoff exponentiel borné (2, 4, 8 puis 16 min), `DEAD` après `maxAttempts`. Sûr avec plusieurs workers.
- Notifications : les handlers créent des `Notification` (`QUEUED`) puis un job `notification.send` les envoie (e-mail) ; canaux WhatsApp/SMS → `SKIPPED` tant qu'aucune intégration n'est active (jamais « envoyé » à tort).
- Déclencheurs : `GET|POST /api/jobs/run` (cron, clé `JOBS_RUN_KEY`/`CRON_SECRET`), `pnpm jobs` (boucle dev), bouton « Exécuter maintenant » dans `/admin/taches`.

## 6. Permissions

| Rôle | Capacités principales |
|---|---|
| OWNER | tout (dont `store.delete`, `team.manage`, `billing.manage`, `payments.manage`) |
| MANAGER | gestion quotidienne (produits, commandes, clients, coupons, livraison, thème, export, `payments.confirm`, `giftcards.manage`, `returns.manage`, `returns.receive`) |
| STAFF | `store.view`, `orders.view`, `orders.manage`, `returns.receive` (préparateur / livreur, réception des retours) |
| SUPPORT | lecture (`store.view`, `orders.view`, `customers.view`), temporaire |
| Admin plateforme | flag `isPlatformAdmin` : `/admin` (double authentification obligatoire), accès aux boutiques seulement via une adhésion SUPPORT datée, actions `admin.*` auditées ; ne peut pas modifier son propre rôle |

Les quotas de plan (`src/config/plans.ts`, `src/lib/commerce/quotas.ts`) sont vérifiés côté serveur avec un message d'upsell.

Lot 1 : les remises automatiques et les offres au panier réutilisent `coupons.manage` ; l'avoir et la révocation des sessions acheteur, `customers.manage` ; les réglages des comptes clients et la politique de retours, `store.settings` ; un remboursement issu d'un retour exige en plus `payments.confirm`. Fonctions de plan : `customerAccounts` (tous les plans), `automaticDiscounts` (Starter et plus : `PRODUCT_AMOUNT`, `CART_TIER`), `advancedDiscounts` (Business et plus : `BUY_X_GET_Y`, `BUNDLE`), `cartOffers`, `giftCards`, `storeCredit`, `returnsPortal` (Business et plus). Après une baisse de plan, désactiver reste toujours possible et les cartes émises restent utilisables.

Vague 2 : moyens de paiement par agrégateur, `payments.manage` (propriétaire) ; catalogue WhatsApp, lecture `store.settings`, écriture `integrations.manage` (propriétaire) ; webhooks et API, `integrations.manage` (propriétaire) ; devises, taxes, blog et valeurs de champs personnalisés de page, boutique et article, `store.settings` ; prix fixés par devise, `products.manage` ; factures : lecture `orders.view`, émission `orders.manage` + plan `invoices` ; définitions de champs personnalisés et sections enregistrées, `theme.manage` ; valeurs de champs : produit / variante / collection `products.manage`, client `customers.manage`, commande `orders.manage` ; bibliothèque de la console : `settings.manage` (lecture seule sinon). Fonctions de plan (`src/config/plans.ts`) : `multiCurrency` + `limits.currencies`, `taxes`, `invoices`, `blog` + `limits.blogPosts`, `webhooks` + `limits.webhookEndpoints`, `REST_API_ACCESS` (none / read / full), `catalogFeeds`, `catalogSync`, `metafields` + `limits.metafieldDefinitions`, `savedSections` + `limits.savedSections`, `premiumSections`, `alternateTemplates` + `limits.alternateTemplatesPerType`, `audiencePersonalization` + `AUDIENCE_RULES_BY_PLAN` (Business : `customer` ; Scale et plus : toutes), `qualityScores`, `motionPresets`.

## 7. Sécurité

- **Auth** : Argon2id (`@node-rs/argon2`), sessions opaques (token aléatoire, `sha256` en base), cookie `HttpOnly` `SameSite=Lax` `Secure` en prod, 30 jours ; révocation par l'utilisateur et par l'admin.
- **Secrets** : `APP_SECRET` dérive la clé AES-256-GCM (`src/lib/crypto.ts`) pour les clés de passerelles ; jamais renvoyées au client.
- **Entrées** : Zod sur toutes les actions (`parseForm`), prix et stock recalculés serveur, `normalizePhone`, slugs réservés.
- **Webhooks** : signature HMAC en temps constant, corps brut, idempotence `(provider, eventId)`, contrôle montant/devise.
- **Isolation** : §3 ; aucune requête Prisma sans `storeId` dans les modules boutique.
- **Audit** : `audit()` pour toute action sensible (suspension, rôles, paiements, factures, accès support), avec IP.
- **En-têtes** : `nosniff`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` (`next.config.ts`).
- **Thème boutique** : personnalisation par composants et tokens validés (`resolveTheme` rejette les valeurs non hex) — jamais de JS/HTML marchand.
- **Admin** : `requirePlatformAdmin()` sur chaque page, `AuthError` dans les actions, `robots: noindex`.

## 7 bis. Connecteurs IA (MCP)

Détail : `docs/API-MCP.md`. Serveur MCP marchand `/api/mcp` (JSON-RPC 2.0 implémenté dans `src/lib/mcp/protocol.ts`, sans dépendance), authentifié par jeton API ou OAuth 2.1 (`ApiToken`, `OAuthClient`, `OAuthAuthorizationCode`, `OAuthGrant`, `OAuthToken`, secrets hachés SHA-256). La boutique est toujours déduite du jeton ; portée = scopes du jeton ∩ plan (`MCP_LIMITS`) ∩ rôle, recalculée à chaque requête. Les outils réutilisent les règles de domaine (`transitionOrder`, stock conditionnel, verrous de collections, `audit()` avec acteur `api:<jeton>` / `oauth:<app>`). MCP vitrine public `/api/mcp/store/{slug}` (lecture + brouillon de panier, jamais de commande). Journal `ApiRequestLog` (30 jours), quotas via `RateLimit`, arrêt d'urgence `PlatformSetting` `mcp.kill_switch`.

## 7 ter. Stockage des médias (`src/lib/storage`)

```
navigateur ─ compression (~300 Ko) ─► POST /api/stores/{id}/media?purpose=product|collection|theme (octets bruts)
   requireStore(capacité) → rateLimit → ≤ 5 Mo → octets magiques → dimensions (≤ 8000 px, ≤ 40 Mpx) → sha256
   → existe ? → réservation atomique du quota → put (remboursement si échec)
   ◄─ { url }  ── l'URL seule est enregistrée (Product.images, Variant.imageUrl, Category.imageUrl, thème…)
```
- **Pilotes** : `local` (dev ; `.local/uploads`, servi par `/media/[...key]`) et `s3` (R2, S3, Supabase, B2, MinIO ;
  signature SigV4 maison `sigv4.ts`, vérifiée par les vecteurs officiels AWS, sans SDK). Choix par `STORAGE_DRIVER`
  (`config.ts`) ; en production, pas de repli silencieux sur le disque.
- **Clés** : `stores/{storeId}/{aaaa}/{mm}/{sha256}.{ext}`, validées par une expression stricte en écriture comme en
  lecture (aucun nom fourni par le client → pas de traversée de chemin). Contenu immuable → `Cache-Control` 1 an.
- **Écriture des URL** (`write-guard.ts`) : aucune nouvelle data-URL (seulement une valeur identique à celle déjà en
  base ; schéma produit : aucune), médias d'une autre boutique refusés (`stores/{storeId}/`).
- **Sécurité** : session cookie + vérification d'origine (`Origin` comparé à l'hôte de NEXT_PUBLIC_APP_URL,
  `Sec-Fetch-Site`) ; le proxy ne s'applique pas à `/api` (pas de mise en tampon avant l'auth) ; `storeId` vérifié par
  `requireStore` ; format décidé par les octets (JPEG, PNG, WebP, AVIF, GIF), jamais le type annoncé, jamais de SVG ;
  `/media` répond avec `nosniff` et une CSP `sandbox`. Les clés S3 restent côté serveur ; le bucket est en lecture publique.
- **Quotas** : `quota.ts` (par plan + option STORAGE_10GB), usage en Kio dans `UsageCounter` (`media_kb`),
  réservé atomiquement avant l'écriture (`usage.ts`, remboursé en cas d'échec) ; bloque les nouveaux envois, jamais l'affichage.
- **URL acceptées** (`public-url.ts`) : https, `/media/…`, `STORAGE_PUBLIC_URL/…`, et data-URL héritées en lecture
  seule. Open Graph / JSON-LD : `/media` rendu absolu, data-URL jamais exposée.
- **Exploitation** : `pnpm media:migrate` (data-URL → stockage, idempotent), `pnpm media:orphans` (inventaire des fichiers
  non référencés ; pas de suppression automatique en v1).

## 7 quater. Comptes acheteurs (lot 1, `src/lib/buyer`)

- **Code** (`otp.ts`) : 6 chiffres, valable 10 minutes, 5 essais (compteur en base) ; stocké sous la forme `HMAC-SHA256(clé « buyer-otp » dérivée d'APP_SECRET, storeId:destination:code)`, comparé en temps constant ; message identique quel que soit le numéro (anti-énumération). Débits (`otpRequestRules`) : 3 codes / 15 min par couple IP et destination, 10 envois / 24 h par destination toutes boutiques confondues, 10 / h par IP, 300 / h et 500 / jour par boutique ; défi Turnstile facultatif (`challenge.ts`, actif si `TURNSTILE_SECRET_KEY` est défini). Connexion par e-mail seulement si une fiche de la boutique porte cet e-mail avec `emailVerifiedAt`.
- **Envoi** (`senders.ts`) : e-mail pour un identifiant e-mail ; sinon WhatsApp Cloud de la boutique si l'intégration est active et le canal « WhatsApp de votre boutique » choisi (1 crédit `WA_UTILITY`, remboursé si l'envoi échoue, sans repli sur la plateforme), sinon expéditeur plateforme (`AXI_OTP_WHATSAPP_PHONE_ID`, `AXI_OTP_WHATSAPP_TOKEN` ; plan Gratuit : `AXI_OTP_FREE_DAILY_PER_STORE` codes par jour, défaut 30 ; budget global `AXI_OTP_DAILY_BUDGET`, défaut 2 000, dont le dépassement active l'arrêt d'urgence), sinon point d'intégration SMS (non branché) ; en développement uniquement, code affiché dans la console du serveur.
- **Session** (`session.ts`, contrat `getBuyer(store)`) : jeton aléatoire de 32 octets, seul son `sha256` est en base (`CustomerSession.tokenHash`). Cookie `HttpOnly`, `SameSite=Lax`, `Secure` en production, `maxAge` de 90 jours ; nom `axi_buyer`, ou `__Host-axi_buyer` sur un hôte de boutique en HTTPS ; chemin `/s/{slug}` sur le domaine principal et `localhost`, `/` sur un sous-domaine ou un domaine personnalisé (`buyerCookiePath`, `buyerCookieName`, dans `otp.ts`). Validité vérifiée à chaque lecture (mise en cache par requête) : `session.storeId` égal à la boutique, session non révoquée et non expirée, `customer.storeId` égal à la boutique, `Store.accountsEnabled`, boutique `PUBLISHED` ou `CLOSED_TEMPORARILY`. Glissement de 90 jours : `lastSeenAt` et `expiresAt` réécrits au plus toutes les 10 minutes (écriture conditionnelle), cookie prolongé seulement pendant une action serveur. `destroyBuyerSession` révoque la session courante ; `revokeCustomerSessions` révoque toutes les sessions du client dans la boutique (« Déconnecter tous mes appareils », fiche client, demande de suppression).
- **Liaison à l'hôte** (`host.ts`, `foreignStorePath`, appelé par `src/proxy.ts`) : sur un sous-domaine de boutique ou un domaine personnalisé, toute URL `/s/<autre boutique>` répond 404, pour que le cookie `Path=/` de cet hôte n'accompagne jamais les pages ni les actions d'une autre boutique.
- **Arrêt d'urgence** `buyer_accounts.kill_switch` (`settings.ts`, cache de 10 s par instance) : codes refusés et écritures du compte bloquées ; les sessions existantes restent lisibles (espace client en lecture seule).
- **Purge** (`purge.ts`) : IP des codes et des sessions effacées à 30 jours ; codes expirés et sessions expirées ou révoquées depuis plus de 30 jours supprimés.

## 7 quinquies. Vague 2 : paiements, catalogue social, international, contenu, personnalisation

Rapports d'équipes d'origine (historique) : `docs/vague2/*.md`. Guide : `docs/GUIDE-BOUTIQUE.md` §13 à §20 ; recette : `docs/RECETTE.md` §4 quinquies à 4 septies.

### Paiements par agrégateur (lot 1 bis, `src/lib/payments`)

```
checkout ─► createOrder (PaymentAttempt CREATED) ─► initiateGatewayPayment ─► adaptateur.initiate ─► page hébergée / demande USSD
fournisseur ─► POST /api/webhooks/payments/{paystack|pawapay|cinetpay} ─► handleGatewayWebhook
   └─ adaptateur de l'URL ─► tentative bornée à ce fournisseur ─► authenticité ─► relecture du statut chez le fournisseur
      ─► ProviderEvent (provider, eventId) ─► contrôle montant / devise ─► applyAttemptStatus (CONFIRMED définitif)
```
- Contrat `PaymentGateway` étendu (`provider.ts`) : contexte de webhook, références, `refund`, `testConnection`, `modeOf`, portefeuilles par pays. `channels.ts` (pur, importable côté client) : portefeuilles `wave`, `orange_money`, `mtn_momo`, `moov_money`, `card`, libellés, couverture par pays, codes opérateurs. `adapters/{paystack,pawapay,cinetpay}.ts` ; `adapters/util.ts` : `fetch` borné à 15 s, conversions de montants, e-mail technique, URL ≤ 120 caractères. `gateways.ts` : registre (agrégateurs en tête), champs « Environnement » des passerelles historiques en liste fermée. `payment-methods/gateway-config.ts` (règles pures : fusion des identifiants, pays, devise, portefeuilles) et `payment-methods/actions.ts` (`PaymentMethod.channels`, action `testPaymentGateway`, 10 essais / 10 min).
- Authenticité : Paystack, HMAC-SHA512 du corps brut (`x-paystack-signature`, clé secrète) puis `GET /transaction/verify/{ref}` ; pawaPay, le callback n'est qu'un déclencheur (`Content-Digest` contrôlé s'il est présent) puis `GET /v2/deposits/{depositId}` avec le jeton (source de vérité) ; CinetPay, `notify_token` (seule son empreinte SHA-256 est conservée dans `PaymentAttempt.metadata`, comparaison en temps constant) puis `GET /v1/payment/{id}` et contrôle des identifiants.
- `eventId` construit sur une référence propre à la tentative : pas de collision entre boutiques ; la boutique est retrouvée par la tentative (une URL de webhook par agrégateur, commune à toutes les boutiques).
- Expiration au rapprochement : Paystack et CinetPay 30 min, pawaPay 20 min. Mode test déduit du préfixe de clé (`sk_test_` / `sk_live_`) pour Paystack et CinetPay, champ « Environnement » pour pawaPay.
- Remboursement : `requestRefund` (destination `original`) valide en base, puis, **après le commit**, demande chez Paystack (`POST /refund`) ou pawaPay (`POST /v2/refunds`) pour la part payée en ligne ; succès ou échec tracés (`OrderEvent`, audit) ; échec ou CinetPay (API v1 sans remboursement) : notification « Remboursement à effectuer à la main ». La référence de remboursement du fournisseur est conservée dans l'`OrderEvent` et l'audit (pas de colonne sur `Refund`).
- Dans la transaction de `requestRefund` : `issueCreditNoteForRefundTx` (avoir) puis `emitDomainEvent("order.refunded")` ; `confirmManualPayment` et `applyAttemptStatus` émettent `order.paid`.
- Demande poussée pawaPay (USSD sans page) : utilisée si `PaymentAttempt.channel` et `payerPhone` (E.164 sans « + ») sont renseignés ; `initiateGatewayPayment` les transmet déjà, mais le checkout ne les demande pas encore (page hébergée sinon).
- Tests : `tests/payments-aggregators.test.ts`, `tests/payments-webhooks.test.ts` (34 tests ; la base simulée `tests/helpers/fake-db.ts` connaît les relations `paymentAttempt → paymentMethod, order`).

### Catalogue WhatsApp et flux (lot 1 bis, `src/lib/social`)

- Modules : `feed-items`, `feed-format`, `meta-batch`, `graph-client`, `catalog-data`, `sync`, `feeds`, `whatsapp-order`, `actions`, `jobs` ; routes `src/app/s/[slug]/feeds/{meta.xml,google.xml,tiktok.csv}/route.ts` ; écran `src/app/app/[storeId]/integrations/whatsapp-catalogue/` ; outils MCP `src/lib/mcp/merchant/social.ts` (`MERCHANT_TOOLS.push(...SOCIAL_TOOLS)`). Tests `tests/social-{feeds,sync,actions}.test.ts`.
- Flux : `meta.xml` (RSS 2.0 espace `g:`, disponibilité `in stock` / `out of stock` / `preorder`), `google.xml` (`in_stock`…, `identifier_exists=no` sans GTIN), `tiktok.csv` (CSV virgule UTF-8 : `sku_id,title,description,availability,condition,price,sale_price,link,image_link,additional_image_link,brand,gtin,item_group_id,color,size,product_type` ; cellules commençant par `=` préfixées d'une apostrophe). Une ligne par variante (`id` = variantId, `item_group_id` = productId) ou par produit sans variante, même identifiant que `product_retailer_id` des paniers WhatsApp. Description en texte brut (5 000 caractères), images par `shareableImageUrl` (https ou média stocké, jamais de data-URL), prix + devise (`18000 XOF`, `19.99 EUR`), `sale_price` (+ `sale_price_effective_date` si datée), GTIN à clé de contrôle vérifiée, état `new`, attributs « Couleur » / « Taille », type = collection publiée.
- Service : boutique publiée ou fermée temporairement, plan et flux activé, sinon 404 indistinct. Débit : 30 requêtes / 10 min / IP / boutique et 120 / 10 min / IP. `Cache-Control: public, max-age=3600, s-maxage=3600`, cache mémoire 1 h (clé = boutique, format, `updatedAt` des réglages, statut), `X-Robots-Tag: noindex`. Les chemins `.xml` sont exclus du proxy de sous-domaine : l'adresse publiée est `{APP_URL}/s/{slug}/feeds/...`.
- Synchronisation : `scheduleDueCatalogSyncs()` (lignes activées échues, bail de 30 min posé dans la même transaction que `enqueue("social.sync")`, intervalle normal 1 h, aucun appel Meta sans changement). `runCatalogSync()` vérifie que la boutique du job = celle de la ligne, plan `catalogSync`, boutique publiée, identifiant de catalogue, intégration WhatsApp **active** et jeton ; verrou `syncing` (repris après 15 min) ; `diffCatalog` : nouveaux et modifiés → `UPDATE` (`allow_upsert`), retirés (produit supprimé, archivé, brouillon, variante supprimée) → `DELETE` ; articles refusés inchangés bloqués sauf synchronisation forcée ; lots de 500 requêtes. Réponse : `validation_status[].errors` rattachés au `retailer_id` (statut `error`, motif affiché), les autres `synced`, `DELETE` réussi = ligne supprimée.
- Échecs : erreur Graph (réseau, 401, codes 190 / 10 / 200 / 100…) → ligne en `error`, `consecutiveFailures + 1`, `nextSyncAt = now + backoff` (5 min, 10, 20… plafond 24 h), job terminé normalement (pas de double backoff). Préconditions manquantes → `error` et `nextSyncAt = null` (suspendue ; l'enregistrement des réglages replanifie). Boutique non publiée : rien n'est supprimé chez Meta.
- Secrets : jeton lu dans `Integration.secretsEncrypted` (déchiffré à l'usage), jamais stocké dans la ligne de synchronisation ; messages passés par `sanitizeError` / `redactSecrets` (jeton exact, `EAA…`, `Bearer`, `access_token=`) avant base ou journal.
- Retour de commande : `/api/webhooks/whatsapp` enregistre un message `type: "order"` dans la boîte puis appelle `handleCatalogOrderMessage()` : `product_items[].product_retailer_id` résolus uniquement parmi les produits ACTIFS de la boutique du numéro (`Integration.phoneNumberId`), `item_price` de Meta ignoré, quantités ramenées aux bornes, indisponibles comptés ; `Cart` (attribution `{ source: "whatsapp_catalog", messageId }`) et lien `/s/{slug}?panier={jeton}` (même mécanisme que `create_checkout_link`) ; réponse par `queueOutboundMessage` (1 crédit `WA_UTILITY`, dans la transaction ; sans crédit, message `LINK_ONLY` visible dans la boîte) ; 10 paniers / 10 min / numéro ; idempotence par l'id de message (ProviderEvent) ; une erreur est journalisée sans faire échouer le webhook. L'envoi effectif reste le point d'intégration du worker `notification.send`.
- Plans : `catalogFeeds` (flux) et `catalogSync` (synchronisation), Business et plus, contrôlés dans les actions, les routes, le job et les outils MCP.

### Devises (lot 2 B, `src/lib/currency`)

| Fichier | Rôle |
|---|---|
| `rounding.ts` | règles d'arrondi (pur, BigInt) |
| `convert.ts` | taux = fraction exacte BigInt (10 décimales en entrée), parités fixes, pivot EUR, marge, conversion, cotation `Cart.fxQuote` |
| `present.ts` | `presentCart(priced, fx, { fixedUnitPrices, tax })` : conversion APRÈS le pipeline ; `presentPrice`, `presentCompareAt` |
| `payment.ts` | `chargePlan`, mention « Vous serez débité de… », drapeau `GATEWAY_PRESENTMENT_CHARGE` |
| `pick.ts` | devise de l'acheteur : cookie `axi_cur` → `x-vercel-ip-country` → `Accept-Language` → devise boutique |
| `ecb.ts`, `rates.ts` | analyse du XML BCE (pur) ; lecture des taux (mémo 60 s), devises actives par plan, `refreshPlatformRates`, `scheduleDailyFxRefresh` |
| `display.ts`, `actions.ts`, `jobs.ts` | devise courante et `getCurrencyPickerData(store)` ; actions commerçant et admin ; gestionnaire `fx.refresh` |

```
taux effectif = taux × (10 000 + markupBps) / 10 000        (fraction exacte, aucun flottant)
brutMinor     = montantMinor × taux effectif × 10^(décimales cible − décimales base)
prix, livraison : règle d'arrondi ; remises, avoir : au plus proche (Math.round) ; taxes : recalculées
```
- XOF → EUR = 1000 / 655957 exactement (655 957 FCFA = 1 000,00 € ; 6 560 FCFA = 10,00 €). `presentCart` : ligne = unitaire converti × quantité ; chaque remise convertie puis répartie au prorata de ses allocations d'origine (plus fort reste), plafonnée par le reste de la ligne ; total affiché = Σ nets + livraison (+ taxes si HT), somme exacte des éléments affichés.
- `createOrder` : montants toujours calculés et enregistrés en devise boutique (`total`, `amountDue`, rapports inchangés) ; instantané `presentmentCurrency`, `presentmentRate`, `presentmentTotal`, `presentmentAmounts` = `PresentedCart` + `source` + `charge` (devise, montant, mention d'encaissement). Devise relue côté serveur (cookie), jamais du formulaire. `Cart.fxQuote` est écrite par l'aperçu quand un panier serveur existe (après saisie du téléphone), valable 15 min et relue par `createOrder` ; sinon taux courant. Devise désactivée ou taux périmé pendant le checkout : repli en FCFA avec message, commande sans instantané. `PaymentAttempt` : devise et montant du `chargePlan` (aujourd'hui toujours la devise boutique).
- Taux : parités fixes (EUR, XOF = XAF), BCE quotidienne (`https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml`, HTTPS, sans clé, 10 s, pas de redirection), manuels (jamais périmés). Taux automatique de plus de 72 h inutilisé. Prix fixés : produits sans variantes (le modèle `ProductPrice.itemKey` accepte déjà les variantes).
- Actions : `addStoreCurrency`, `updateStoreCurrency`, `removeStoreCurrency` (`store.settings` + plan, audit `currency.enabled|updated|removed`) ; `upsertProductPrice`, `deleteProductPrice` (`products.manage`, audit `product.price_fixed|unfixed`) ; `adminSetPlatformRate`, `adminRefreshFxRates` (admin `settings.manage`, audit `admin.fx.rate_set`, `admin.fx.refresh`), sans écran admin pour l'instant.
- Sélecteur (`src/components/storefront/currency-picker.tsx`) : cookie puis `router.refresh()` ; placé dans les outils de l'en-tête par `getCurrencyPickerData` (serveur), rien avec une seule devise, absent de l'aperçu et des cadres réduits (commande) ; masqué si `GlobalSettings.header.showCurrencyPicker` est faux. Cartes et fiches : `getDisplayCurrency(store)`, `presentPrice`, `presentCompareAt`, `formatMoney(amount, fx.quote)`.
- Tests : `tests/currency-convert.test.ts`, `tests/checkout-pipeline-taxes.test.ts`, `tests/checkout-lot2.test.ts`.

### Taxes et factures (lot 2 C, `src/lib/tax`, `src/config/taxes.ts`)

- `computeTaxes({ lines: [{ net, taxable, taxCategory }], delivery: { amount }, settings: { enabled, pricesIncludeTax, rates } })` → `{ perLine: [{ taxAmount, taxRateBps }], shippingTax, shippingTaxRateBps, taxTotal, taxLines: [{ name, rateBps, base, amount }], taxesIncluded, addToTotal }`. `net` = `PricedCartLine.netTotal`. TTC : `round(net × bps / (10 000 + bps))` ; HT : `round(net × bps / 10 000)` ; arrondi par ligne, demi-unité vers le haut, arithmétique entière. Ligne non taxable, catégorie `exempt` ou sans taux : 0 et `taxRateBps` null. Livraison taxée au taux `standard` si `appliesToShipping`. `taxLines.base` = base hors taxe ; `Σ taxLines.amount = taxTotal`. `addToTotal` = `taxTotal` en HT, 0 en TTC. Cartes cadeaux toujours exonérées ; les tenders couvrent les taxes, jamais les lignes carte cadeau. Écart d'arrondi ≤ 1 unité par ligne (assumé).
- `loadTaxSettings(storeId, tx?)` / `taxSettingsForStore(client, store)` (`src/lib/tax/settings.ts`) : **source unique** des réglages de taxe (pipeline ET factures). Taux actifs du pays de la boutique (`Store.country`, normalisé en majuscules, `regionKey "*"`) ; `enabled = false` si les taxes sont désactivées, si le régime est TPS ou si le plan n'inclut pas `features.taxes` (boutique rétrogradée). Le pipeline (`checkout-context.ts`, étape 7 de `checkout-pipeline.ts`) écrit `Order.taxTotal`, `taxesIncluded`, `taxLines` et `OrderItem.taxAmount`, `taxRateBps` depuis `perLine`.
- Factures (`invoice.ts`) : `issueInvoiceTx(tx, { storeId, orderId, actorId })` verrouille `Order` (`FOR UPDATE`), renvoie la facture existante (idempotent), exige `PAID` / `PARTIALLY_REFUNDED` / `REFUNDED`, puis verrouille `Store`, incrémente le compteur, écrit l'instantané, l'`OrderEvent`, `audit("invoice.issued")` et les avoirs des remboursements antérieurs. `issueCreditNoteForRefundTx(tx, { storeId, refundId })` : un avoir par remboursement `DONE` (idempotent par `refundId`), seulement si la commande a une facture (sinon `null`, aucun numéro consommé) ; TVA au prorata de la facture, ventilée par taux ; le remboursement qui solde la commande solde exactement la TVA.
- **Sans trou** : compteur incrémenté dans la transaction qui insère le document (un échec annule l'incrément), unicité `(storeId, number)`, compteur continu, année = année d'émission dans le fuseau de la boutique. **Ordre des verrous** : Order puis Store, identique à `requestRefund` : pas d'interblocage. Transactions `maxWait 10 s / timeout 15 s` (les émissions d'une boutique se sérialisent sur la ligne Store ; constaté sur la vraie base avec le défaut Prisma de 2 s).
- Instantané immuable (`snapshot.ts`, version 1) : vendeur (raison sociale, IFU/NIF, RCCM, régime), acheteur (dont `buyerCompany`, `buyerTaxId`), lignes HT / taxe / TTC, livraison, totaux par taux, paiement, mentions ; les pages lisent exclusivement l'instantané (`invoice-document.tsx`). Taxes d'une commande : celles figées par le pipeline (`Order.taxLines` non nul) ; sinon, en TTC, ventilation « dont TVA » calculée à l'émission (`taxSource: "computed"`, total inchangé) ; en HT sans taxes figées, aucune taxe.
- Accès : page commerçant `getStoreContext(storeId, "orders.view")` + commande filtrée par `storeId` ; page acheteur `documentsForTrackingToken` (format du jeton, existence, expiration). Pas d'unicité en base « une facture par commande » ni « un avoir par remboursement » : garanties sous le verrou de la commande. Émission automatique rangée dans `Store.taxRegistration.autoIssueInvoices` : **défaut `false` sans identité fiscale enregistrée** (aucune facture immuable émise sans activation explicite ; l'écran /parametres/taxes propose la case cochée à la première configuration) et refusée si la boutique ne collecte pas la taxe. L'émission manuelle reste disponible.
- Actions (`actions.ts`) : `updateTaxSettings`, `upsertTaxRate`, `deleteTaxRate`, `applyTaxPreset`, `updateProductTax`, `issueInvoiceAction`, `issueMissingCreditNotesAction` ; audit `tax.settings_updated`, `tax.rate_created|updated|deleted`, `invoice.issued`, `invoice.credit_note_issued`.
- Tests : `tests/tax-compute.test.ts`, `tests/invoice-numbering.test.ts` (numérotation, concurrence avec verrous simulés, échec sans trou, avoirs, immutabilité, accès par jeton, isolation, plans).

### Blog (lot 2 D, `src/lib/blog`)

| Fichier | Rôle |
|---|---|
| `constants.ts` | statuts, libellés, limites de longueur, coût IA (3), adresses réservées |
| `visibility.ts` | règle pure : `PUBLISHED`, ou `SCHEDULED` avec `publishedAt ≤ maintenant` ; `publicPostWhere` (Prisma), `resolvePublication` (intention → statut et date), conversions fuseau de la boutique |
| `slug.ts`, `tags.ts` | adresses (suffixe `-2`…, adresses réservées `categorie`, `rss`…), étiquettes |
| `markdown.tsx`, `markdown-guard.ts` | rendu React du Markdown limité (grammaire des pages + images, citations, liens internes préfixés), texte brut, temps de lecture, extrait ; validation à l'écriture (`isSafeMarkdown` du moteur + images https ou médias stockés, seules sur leur ligne) |
| `service.ts`, `actions.ts` | lecture filtrée par `storeId`, plan (`features.blog`, `limits.blogPosts`) ; `savePost`, `setPostStatus`, `deletePost`, `saveCategory`, `deleteCategory`, `moveCategory`, `draftPostWithAi` |
| `ai.ts` | prompt (données balisées `<sujet>`), analyse et garde-fous (`stripForbidden`, `tidy` de `src/lib/ai/parse.ts`) |
| `render-types.ts`, `render-data.ts`, `seo.ts` | `RenderData.blog`, données d'exemple de l'aperçu ; JSON-LD `BlogPosting` et `BreadcrumbList`, RSS 2.0, sitemap XML |
| `section-schemas.ts`, `section-renderers.ts` | schémas et composants de `blog-posts`, `main-blog`, `main-article` (`src/components/storefront/sections/`) |

- Routes publiques `src/app/s/[slug]/blog/**` et `src/app/s/[slug]/sitemap.xml/route.ts` (cadre et thème de la boutique, thème clair forcé) ; espace marchand `src/app/app/[storeId]/blog/**` ; MCP `src/lib/mcp/merchant/blog.ts`.
- **Programmation sans tâche** : aucune écriture à l'heure de publication ; toutes les lectures publiques (liste, article, RSS, sitemap, section) passent par `publicPostWhere(storeId, now)` ; l'espace marchand affiche `effectiveStatus` (un programmé échu apparaît « Publié »).
- Thème : modèles `blog` et `article` avec section principale ajoutée par `lateMainSections` (documents antérieurs complétés au sanitize) ; modèle alternatif d'article `BlogPost.templateSuffix` → `doc.alternates.article[suffix]`. `withBlogData` (appelée par `StorefrontView`) ne fait aucune requête sans section « Derniers articles » hors aperçu ; en aperçu (`?preview=1&template=blog|article`), vrais articles ou contenus d'exemple neutres. Réglage `blog_category` (liste des catégories de la boutique) pour « Derniers articles » ; une adresse texte déjà saisie reste lue.
- Images : téléversement existant, usage `theme` (capacité `theme.manage`).
- Tests : `tests/blog-visibility.test.ts`, `tests/blog-slug-markdown.test.ts`, `tests/blog-isolation.test.ts`.

### Webhooks sortants et API REST (lot 2 E, `src/lib/webhooks`, `src/lib/api`)

Référence développeur : `docs/API-REST.md` ; OpenAPI 3.1 `public/api/openapi-2026-10.json` (servie à `/api/openapi-2026-10.json`).

| Fichier | Rôle |
|---|---|
| `webhooks/emit.ts` | **contrat** `emitDomainEvent(tx, storeId, event, data)` : job `webhook.fanout` dans la transaction (outbox) ; accepte aussi `db` pour une écriture déjà validée |
| `webhooks/events.ts` | catalogue des 16 événements, libellés (pur) |
| `webhooks/service.ts` | points (créer, lister, modifier, supprimer, rotation), livraisons (lister, rejouer, test), `fanoutEvent`, `deliverWebhook`, désactivation automatique ; sans dépendance Next (chargé par `pnpm jobs`) |
| `webhooks/sign.ts`, `keyring.ts` | secret, `Axi-Signature`, vérification ; trousseau chiffré `{ current, previous, previousUntil }` (rotation 24 h) dans `secretEnc` |
| `webhooks/ssrf.ts`, `deliver.ts` | contrôle d'URL (plages interdites IPv4 / IPv6, résolution DNS) ; envoi avec adresse validée imposée (option `lookup`), 10 s, sans redirection, 4 Ko lus |
| `webhooks/policy.ts`, `actions.ts`, `jobs.ts` | relances, désactivation, filtrage des données personnelles, corps, rôles ; actions de l'écran (`integrations.manage`) ; `webhook.fanout`, `webhook.deliver` |
| `api/{auth,handler,problem,pagination,idempotency,resources,serializers}.ts`, `api/jobs.ts` | socle REST, `idempotency.purge` |
| `src/app/api/v1/**` | routes (+ `[...path]` : 404 problem+json) |

- Flux : `emitDomainEvent` → `webhook.fanout` (boutique non archivée, plan `webhooks`) → pour chaque point **actif abonné**, `WebhookDelivery` (`createMany skipDuplicates` sur `(endpointId, eventId)` : rejouer ne duplique rien) + job `webhook.deliver`, une transaction par point. Données personnelles retirées sauf si le point les demande **et** que son créateur est toujours membre avec `customers.view`. `webhook.deliver` : réclamation optimiste (`PENDING` ou `FAILED`, `nextAttemptAt ≤ maintenant`, bail de 2 min), signature avec les secrets actifs ; succès `SUCCEEDED` (compteur d'échecs à 0) ; échec `FAILED` + nouveau job (1 min → 24 h) ou `DEAD` après 8 essais. Désactivation automatique après 50 échecs consécutifs pendant plus de 72 h (début de série déduit de la plus ancienne livraison non réussie depuis `lastSuccessAt`). Livraison au moins une fois, ordre non garanti.
- Émetteurs : commandes (`commerce/orders.ts`, `exchange.ts`, charge `orderEventData` de `src/lib/commerce/domain-events.ts`, sans coordonnées : id, référence, statuts, montants, devises, canal, mode, date) : `createOrder` émet `order.created`, plus `order.paid` si la commande est réglée entièrement par carte cadeau ou avoir ; `createExchangeOrder` émet `order.created` (+ `order.paid` si l'avoir d'échange la couvre) ; `transitionOrder` émet `order.status_changed`, plus `order.cancelled` à l'annulation ; `order.paid` et `order.refunded` (`payments/service.ts`) ; produits `product.created` / `product.updated` (`saveProduct`, dans la transaction), `product.deleted` / `product.updated` (archivage / restauration), `inventory.updated` (ajustement de stock) dans `src/lib/products/actions.ts` ; API REST : `product.*` et `inventory.updated` après l'écriture (`data.source = "api"`).
- REST : écritures = exécution des outils MCP (`create_product`, `update_product`, `adjust_inventory`, `update_order_status`) via `runTool` (mêmes règles, quotas, confirmations `?confirm=true`, audit `api.*`, champs inconnus refusés en 400) ; lectures = sérialiseurs dédiés (montants entiers + `currency`). Jetons OAuth refusés (audience MCP). Idempotence : réservation par insertion (unique `storeId,key`), 409 si en cours, 422 si corps différent, 5xx libère la clé, 4xx mémorisées.
- SSRF : `https` uniquement, adresses privées, réservées, internes et ports non standard refusés ; dérogation de test `AXI_WEBHOOKS_ALLOW_LOCALHOST=1` (ignorée en production) limitée au bouclage.

### Personnalisation de la boutique (lot 4A)

**Moteur (`src/lib/theme-engine`, modules purs)** : schémas un fichier par section, modèles alternatifs (`alternates.ts`), opérations sérialisables (`operations.ts`, `applyOperations`), scores qualité (`quality.ts`), sources dynamiques (`dynamic-sources.ts`), animations (`motion.ts`), audiences (`audience.ts`), édition directe (`edit-attrs.ts`). Contrats détaillés : `docs/CONSTRUCTEUR-BOUTIQUE.md`.

**Éditeur (`src/components/theme-editor`, `src/app/app/[storeId]/apparence`)** : `editor-target.ts` (cible `{ template, alternate }`, `targetKey`, `projectTarget`), `quality-fix.ts` / `quality-panel.tsx` (`scoreTheme` après anti-rebond, `applyIssueFix` = `applyOperations` → un seul `commit` = une entrée d'historique), `motion-panel.tsx`, `audience-panel.tsx`, `dynamic-source-picker.tsx` (`compatibleSources`, `checkBinding` avant `bindDynamicSource`), `alternate-picker.tsx`, `saved-sections.tsx` + `saved-sections-bridge.ts`, `preview-toolbar.tsx`, `preview-doc.ts`. `apparence/lot4-data.ts` (serveur) : règles de plan, fiches utilisant un modèle alternatif, définitions publiques de champs personnalisés, valeurs d'exemple (données publiques), sections enregistrées, bibliothèque, faits de qualité. Serveur : `lot4PlanIssue` (`src/lib/theme/editor-plan.ts`), appelé par `parseDocument` à l'enregistrement et à la publication, refuse d'augmenter le nombre de modèles alternatifs par type au-delà du plan ou d'ajouter des règles d'audience non incluses (l'existant d'un plan rétrogradé est conservé) ; `renameAlternateTemplate` / `deleteAlternateTemplate` (`src/lib/theme/alternate-actions.ts`) : `theme.manage`, zod, brouillon ET thème publié revalidés et modifiés dans la même transaction que les `templateSuffix` des fiches (`Product`, `Category`, `StorePage`, `BlogPost`, filtrés par `storeId`), audit `theme.alternate_renamed` / `theme.alternate_deleted`.

**Rendu (`src/components/storefront`)** : `storefront-view.tsx`, `template-renderer.tsx`, `lot4-data.ts` (`loadTemplateSuffix`, `loadRenderMetafields`, `requestMotionEnv`, `requestAudience`), `dynamic-context.ts`, `motion-observer.tsx`, `preview-audience.ts`, `live-preview.tsx`. Modèle rendu = `resolveTemplate(doc, type, suffix)` ; les réglages lus par `loadRenderData` (avis, référence, produits par page) viennent du modèle réellement rendu. Sources dynamiques : `resolveSection` sur chaque section avant son composant (`hidden` = non rendue), contexte produit, variante (demandée ou première), collection, boutique, page, références résolues vers `/s/{slug}/p/…` ou `/collections/…`. Audience : `evaluateVisibility` côté serveur avec la session acheteur (`getBuyer` : segments nouveau / récurrent / fidèle / points, ville de l'adresse par défaut), cookie `axi_city`, en-tête `x-vercel-ip-city`, cookie `axi_src`, `Accept-Language`, appareil (`Sec-CH-UA-Mobile`, sinon agent) ; robots et agent vide : audience par défaut ; sans contexte : visiteur anonyme en accès direct ; jamais de prix masqué ou modifié. Animations : jamais sur la première section rendue ni sur une section de modèle (l'élément du LCP n'est jamais masqué) ; un seul `MotionObserver` (IntersectionObserver + MutationObserver, aucun écouteur de défilement), qui marque d'abord `data-in-view` ce qui est déjà à l'écran puis pose `data-motion-ready`. Fiche produit : `?variant={variantId}` présélectionne la variante. Tests : `tests/t3-storefront-render.test.ts`.

**Données (`src/lib/metafields`, `src/lib/saved-sections`, `src/lib/section-library`)** :
- Un seul chemin d'écriture des valeurs, `writeOwnerMetafields` (éditeur, MCP, CSV), tout ou rien par élément : propriétaire revérifié dans la boutique, définition de la boutique ET du même type d'élément, références de la même boutique, image https ou média de la boutique.
- Quotas sans course : verrou consultatif par boutique (`pg_advisory_xact_lock`) pour la création de définitions et de sections enregistrées.
- Expressions régulières de validation : 100 caractères, ni références arrière, ni assertions, ni quantificateurs imbriqués ou alternatives quantifiées ; valeurs testées ≤ 255 caractères.
- Suppression d'une définition : valeurs supprimées (cascade), sources dynamiques retombées sur leur défaut.
- Lecture boutique : `getStorefrontMetafields(storeId, ownerType, ownerIds)` (`read.ts`, server-only) → `{ [ownerId]: { ["namespace.key"]: { namespace, key, name, type, value, text, url, image, validations } } }`, `pickStorefrontMetafield(map, ownerId, namespace, key)` ; définitions `storefrontVisible` seulement, `CUSTOMER` et `ORDER` toujours `{}` ; 500 propriétaires par appel, 2 requêtes + 1 par type de référence (un appel par page avec tous les ids) ; références vers un produit `ACTIVE` ou une collection publiée seulement, `url` = chemin interne. Correspondance source ↔ `MetafieldOwner` : product → PRODUCT, variant → VARIANT, collection → COLLECTION, store → STORE (ownerId = storeId), page → PAGE, article → BLOG_POST. Réglage ← valeur : `text` ← `text`, `image` ← `image`, `url` ← `url`, `color` ← `value`, `richtext` ← `value` (rich_text / multi_line_text), toujours repassé par `sanitizeFieldValue`.
- Sections enregistrées (`saved-sections/actions.ts`, `theme.manage`, `ActionResult<T>`) : `saveSection(storeId, { name, section })` (ids ignorés, `removedRefs`), `listSavedSections` (`items`, `used`, `limit`, `enabled`), `getSavedSectionForInsert` (incrémente `usageCount`, renvoie `payload`, `removedRefs`, `templates`), `renameSavedSection`, `deleteSavedSection`. Bibliothèque (`section-library/actions.ts`) : `listSectionLibrary` (`locked`, `lockReason`, `requiredPlanName`), `getLibraryItemForInsert` (refus si premium ou `minPlan` non atteint ; contrôle réel toujours ici). Fonctions pures `saved-sections/payload.ts` : `SectionPayload`, `clonePayload` (nouveaux ids), `toPayload`, `compatibleTemplates`, `validateSectionPayload`. `SavedSection.previewUrl` n'est pas alimenté.
- Console `/admin/bibliotheque` : `settings.manage` (lecture seule sinon), audit `admin.library.create|update|publish|unpublish|reorder|preview|delete` ; création depuis un JSON de section validé par le moteur, **sans identifiant** de produit ou de collection, images https publiques uniquement (pas de média de boutique, pas de data-URL), revalidé à la publication ; élément premium = plan effectif minimal Business (même si `minPlan` est plus bas) ; aperçu téléversé (2 Mo) sous `stores/axilibrary/…` ; `seedLibrary(db)` (`seed.ts`) ajoute 6 éléments (4 gratuits dont 1 Starter, 2 premium), idempotent par slug.
- CSV produit : fonctions pures `metafields/csv.ts` (`mapMetafieldColumns`, `metafieldCsvCells`, `metafieldEntriesFromRow`) et pont serveur `csv-server.ts` (`productMetafieldCsv`, `prepareProductMetafieldImport`, `importProductMetafieldRow`, colonnes `metafield:` inconnues listées dans `mapping.unknown`) ; cellules : vide = inchangé, liste séparée par `|`, oui/non `true`/`false`, date `AAAA-MM-JJ`, « 12,5 cm », « 2 kg », montant entier, produit ou collection liés par slug. Pas encore raccordé à l'export ni à l'import du catalogue (§8).

### Outils MCP ajoutés (détail : `docs/API-MCP.md`)
`list_blog_posts`, `create_blog_post` (brouillon seulement, `content:write`, Starter et plus, audit `api.blog.post.created`) ; `get_catalog_sync_status` (`catalog:read`), `trigger_catalog_sync` (`catalog:write`, 6 / h, audit `api.catalog.sync_requested`) ; `list_webhook_deliveries` (`webhooks:write`, Business et plus, propriétaire, réponses tierces sous `untrusted_customer_input`) ; `set_metafield` (`catalog:write`, Starter et plus, PRODUCT / VARIANT / COLLECTION, audit `api.metafield.values.update`) ; `list_saved_sections` (`store:read` ou `theme:write`).

### Sécurité (vague 2)
- Isolation : chaque requête filtrée par `storeId` (articles, catégories, médias via `checkImageWrite`, métachamps, sections enregistrées, synchronisation sociale : la boutique du job doit être celle de la ligne ; paniers WhatsApp résolus uniquement dans la boutique du numéro).
- Markdown du blog : aucun HTML, aucun `dangerouslySetInnerHTML`, liens https ou chemins internes (`safeLink`), liens externes `noopener noreferrer nofollow`, images https ou médias de la boutique (jamais `data:` ni `http:`) ; JSON-LD échappé (`<`, `>`, `&`, U+2028/2029) ; RSS, sitemap et flux échappés (`xmlEscape`) ; aperçu des articles non publics réservé aux membres actifs (`canPreviewStore`), `noindex`, pages filtrées par étiquette en `noindex`.
- IA du blog : plan Business (`aiAssistant`), 30 appels / 10 min par boutique (partagés avec les descriptions), crédits débités en transaction puis remboursés en cas d'échec, sortie filtrée, audit `ai.blog_draft`.
- Secrets : clés d'agrégateurs chiffrées (`encryptSecret`), jamais renvoyées au navigateur ; `notify_token` CinetPay jamais en clair ; jeton Meta jamais journalisé ; secret de webhook affiché une fois, trousseau chiffré.
- Audit : `blog.post.created|updated|published|scheduled|draft|archived|deleted`, `blog.category.created|updated|deleted`, `currency.*`, `product.price_fixed|unfixed`, `admin.fx.*`, `tax.*`, `invoice.*`, `theme.alternate_*`, `admin.library.*`, `api.*`.

## 8. Limites connues

- Médias : pas de suppression automatique des fichiers orphelins (v1 : `pnpm media:orphans` les liste) ; pas de
  redimensionnement serveur (une seule taille, ~300 Ko, compressée par le navigateur) ; deux envois simultanés
  d'une même image peuvent la compter deux fois dans le quota.
- Passerelles de paiement historiques (FedaPay, KkiaPay, PayDunya, Stripe) et facturation en ligne des abonnements : structure complète, appels HTTP à finaliser et tester en sandbox (`docs/DEPLOIEMENT.md` §7).
- WhatsApp : lien `wa.me` prérempli (clic journalisé comme tentative). L'API Meta Cloud (notifications, modèles) est prévue (`Integration`) mais non branchée.
- Limitation de débit applicative à fenêtre fixe, persistée dans la table `RateLimit` (`src/lib/rate-limit.ts`), sur les points sensibles (connexion, codes acheteurs, cartes cadeaux, offres au panier, avis, MCP, OAuth…) ; pas de limitation globale par requête : à poser au reverse proxy.
- Double authentification TOTP (`src/lib/auth/mfa.ts`, `src/lib/admin/mfa-server.ts`) obligatoire pour l'équipe plateforme ; tout compte qui l'a activée est challengé à la connexion (`/double-authentification`), mais aucun écran ne permet encore à un marchand de l'activer.
- Lot 1 : `firstOrderOnly` est contrôlé par numéro de téléphone (un nouveau numéro le contourne) ; les cartes cadeaux et les notifications de retour ne partent pas par WhatsApp (e-mail ou lien `wa.me`) ; aucun écran ne permet encore de marquer un produit comme carte cadeau (`Product.isGiftCard`).
- Vague 2, paiements : adaptateurs Paystack, pawaPay et CinetPay écrits d'après les sources officielles accessibles, à confirmer avec de vraies clés (points d'intégration dans `docs/DEPLOIEMENT.md` §7.1 bis) ; encaissement toujours en FCFA (`GATEWAY_PRESENTMENT_CHARGE = false`) ; le remboursement au prorata de `presentmentAmounts` n'est pas implémenté (l'instantané contient les données) ; le checkout n'affiche pas encore les portefeuilles en pastilles (`channels`, `channelLabel()`), ni les `instructions` des moyens `GATEWAY`, ni la saisie du portefeuille et du numéro pour la demande poussée pawaPay.
- Vague 2, catalogue social : client Graph non testé contre Meta (format de `additional_image_link`, prix XOF sans décimales à valider) ; erreurs asynchrones visibles seulement dans Commerce Manager (suivi `check_batch_request_status` prévu) ; pas de champ « marque » boutique ni « état » produit (marque = option / vendeur / nom de boutique, état toujours `new`) ; filtre par collections (`settings.collectionIds`) non implémenté ; `Cart.attribution.source` (`whatsapp_catalog`) n'est pas recopié sur la commande.
- Vague 2, devises et taxes : prix fixés limités aux produits sans variantes ; `scheduleDailyFxRefresh()` n'est pas appelé par `/api/jobs/run` (seulement par la vitrine) ; pas d'écran admin pour `adminSetPlatformRate` / `adminRefreshFxRates` ; pages merci et suivi sans `presentmentTotal` ; carte « Taxes » de la fiche produit (`ProductTaxFields`), bouton « Facture » de la fiche commande et lien « Ma facture » du suivi acheteur pas encore insérés ; outil MCP `get_tax_settings` non livré.
- Vague 2, blog et API : dates d'article affichées en UTC (écart d'au plus un jour autour de minuit) ; `scheduleIdempotencyPurge()` pas encore appelé par `/api/jobs/run` (purge opportuniste, clés expirées ignorées) ; écritures produit via les outils MCP (`catalog.ts`), `bulkUpdateProducts`, `duplicateProduct` et `importCatalog` n'émettent pas d'événement `product.*` ; `customer.*`, `return.*`, `giftcard.issued`, `order.updated` non émis ; l'audit des écritures REST porte `metadata.via = "mcp"` ; listes `/v1/products` et `/v1/customers` triées par `createdAt` sans index `(storeId, createdAt)`.
- Vague 2, personnalisation : faits `images` de qualité (poids et dimensions des médias stockés) non chargés, faute de table de métadonnées (règles appliquées aux seules data-URL) ; corrections `ai_alt` et `ai_seo` redirigées vers la fiche en attendant le lot 4B, `compress_image` sans écran ; aucun écran n'attribue un modèle alternatif (`templateSuffix`) à une fiche ; champs personnalisés absents de l'import et de l'export CSV du catalogue ; validations modifiées non réappliquées en masse aux valeurs existantes ; `SavedSection.previewUrl` non alimenté.
- Vague 2, produits numériques : pas de calendrier ni de réservation de créneaux pour les services ; compteur de téléchargements par ACCÈS (ligne de commande) et non par fichier ; fichier retiré d'un produit = fiche supprimée mais objet conservé dans le stockage (`pnpm media:orphans` n'inventorie pas encore `stores/{id}/files/`) ; contenu relayé par le serveur (pas d'URL signée de courte durée) et pas de reprise (`Range`) ; un produit numérique sans fichier reste publiable (signalé dans la liste). Détail : `docs/vague2/N-produits-numeriques.md`.
- Worker de jobs mono-processus suffisant pour des milliers de commandes/jour ; au-delà, passer à une file dédiée (pg-boss, Redis).
- `cacheComponents` désactivé : toutes les pages app/admin sont dynamiques (simple, mais pas de cache RSC).
- Tests automatisés limités aux modules purs ; la recette E2E est manuelle (`docs/RECETTE.md`).
