# Audits de sécurité : 10 et 11 octobre 2026

## Statut des constats (vérifié dans le code le 11/10/2026)

Légende : **corrigé** (correctif en place), **partiel** (reste un point mineur), **ouvert** (non traité).

| Constat | Statut | Où le vérifier |
|---|---|---|
| B1 Force brute des codes | corrigé | `src/lib/auth/actions.ts` : `checkCode` (essai compté avant comparaison, `attempts < 5`, `safeEqual`), limites d'émission par e-mail et par IP |
| B2 Plan et crédits avant paiement | corrigé | `src/lib/billing/actions.ts` (montée de gamme = facture OPEN), `src/lib/billing/rules.ts` (`monthlyCreditsPlan`, `graceEndsAt`), `src/lib/credits.ts` |
| M1 Zone tarifaire | corrigé | `src/lib/billing/rules.ts` `billingZone` : `subscription.zone` prime |
| M2 `phoneNumberId` WhatsApp | corrigé | `src/lib/whatsapp/actions.ts` (unicité), `src/app/api/webhooks/whatsapp/route.ts` (intégration active uniquement) |
| M3 Accès SUPPORT implicite | corrigé | `src/lib/auth/permissions.ts` `loadStoreContext` : rôle issu de la seule `Membership` non expirée |
| M4 E-mails `console` et `smtp` | corrigé | `src/lib/email.ts` refuse `console` en production (sauf `ALLOW_CONSOLE_EMAIL=1` avec une URL localhost) ; `smtp` retiré de la documentation et de `.env.example` |
| M5 Limitation de débit | corrigé | `src/lib/rate-limit.ts` appliqué à connexion, inscription, demande de code, réinitialisation, `placeOrder`, `previewTotals`, avis, contact, `/api/marketplace/suggest` ; message promo unique. `verifyEmail` (`src/lib/auth/actions.ts`) a sa limite propre : `verify:email:{hash}` 10 / 15 min et `verify:ip:{ip}` 30 / 15 min, message neutre « Trop de tentatives… », en plus de B1 (5 essais par code) ; test `tests/security-verify-email.test.ts` |
| M6 Double débit passerelle | corrigé | `src/lib/payments/service.ts` (tentative `INITIATED` réutilisée après `fetchStatus`, événement `payment_duplicate` et notification) |
| m1 Redirection ouverte | corrigé | `src/lib/auth/redirect.ts` |
| m2 Sessions au changement de mot de passe | corrigé | `src/lib/auth/actions.ts` `changePassword`, `resetPassword` |
| m3 Énumération | corrigé | `src/lib/auth/actions.ts` (hash factice, message neutre) |
| m4 `marketplaceBlocked`, longueurs | corrigé | `src/lib/store/actions.ts`, `src/lib/marketplace/data.ts`, `.max()` sur description et note |
| m5 Coupon `maxUses` atomique | corrigé | `src/lib/commerce/orders.ts` (`updateMany` conditionnel) |
| m6 `maxQty` agrégé | corrigé | `src/lib/commerce/orders.ts` (quantités par produit et par variante) |
| m7 Transition conditionnelle | corrigé | `src/lib/commerce/orders.ts` (`updateMany where status`) |
| m8 Fiche client, créneau de retrait | corrigé | `src/lib/commerce/orders.ts` |
| m9 `emailVerified` exigé | corrigé | `src/lib/auth/permissions.ts` (`requireUserOrThrow`, `requireStore`) |
| m10 Base fixe du proxy | corrigé | `src/proxy.ts` |
| m11 CSP et HSTS | corrigé | `next.config.ts` (HSTS en production ; la CSP conserve `'unsafe-inline'` pour les scripts) |
| m12 `CONFIRMED` sans montant | corrigé | `src/lib/payments/service.ts` |
| m13 PayDunya par API de statut | corrigé | `src/lib/payments/gateways.ts` `paydunyaConfirm` |
| m14 Échantillon des webhooks invalides | corrigé | `src/lib/payments/service.ts`, `src/app/api/webhooks/billing/[provider]/route.ts` |
| m15 `/api/health`, clé du worker | corrigé | `src/app/api/health/route.ts`, `src/app/api/jobs/run/route.ts` (en-tête `x-jobs-key` ou `Bearer CRON_SECRET`) |
| m16 Secrets `change-me` | corrigé | `src/lib/crypto.ts` `isPlaceholderSecret` (contrôle à l'utilisation, pas au démarrage) |
| Domaines non vérifiés après 7 j | corrigé | `src/lib/domains/expiry.ts`, `src/lib/domains/actions.ts` (purge à l'ajout ou à la vérification d'un domaine, pas par cron) |
| Seed en production | corrigé | `prisma/seed.ts` (refus si `NODE_ENV=production`) |
| Audits du 11/10 | corrigé | voir la section suivante |
| Audits du lot 1 | corrigé (un point ouvert assumé) | voir la section « Audits du lot 1 (11/10/2026) » |

## Audits du 11/10/2026

Trois audits complémentaires ont été menés le 11/10. Leurs correctifs sont en place et couverts par les tests Vitest
cités ; les identifiants sont ceux des tests.

### Revue de code (catalogue et commandes) : corrigé

- Constat 1, stock de la fiche produit appliqué en **delta** et non en valeur absolue (une vente pendant l'édition
  n'est plus écrasée ; conflit signalé si le stock deviendrait négatif) : `src/lib/products/stock-sync.ts`,
  `tests/catalog-stock-delta.test.ts`.
- Constat 2, variante désactivée non commandable : `src/lib/storefront/variants.ts` `pickOrderVariant`,
  `tests/order-variant-availability.test.ts`.
- Constat 3, produits archivés conservés dans une collection manuelle : `src/lib/collections/rules.ts`
  `mergeArchivedMembers`, `tests/collections-archived-and-rules.test.ts`.
- Constats 4 et 5, import CSV : mise à jour à partir de la fiche existante, prix des variantes sans prix :
  `src/lib/products/import-payload.ts` `draftToPayload`, `tests/catalog-import-merge.test.ts`.
- Constat 11, mêmes règles de collection automatique dans l'espace marchand et sur la boutique :
  `src/lib/collections/rules.ts`, `src/lib/storefront/catalog.ts`, `tests/collections-archived-and-rules.test.ts`.

Les constats 6 à 10 de cette revue ne sont rattachés à aucun test ni commentaire de code et aucun rapport écrit n'a
été conservé : leur statut n'est pas vérifiable ici.

### Sécurité (console d'administration) : corrigé

- M1, **double authentification obligatoire** pour l'équipe plateforme : `adminMfaRequired` et `adminMfaGate`
  (`src/lib/admin/roles.ts`), appliqués aux pages (redirection vers `/admin/equipe?mfa=requise#securite`) et à toutes
  les actions (`requireAdminPermission`, `src/lib/admin/context.ts`). Dérogation `ADMIN_MFA_OPTIONAL=1` réservée à la
  démo locale (ignorée en production sauf si `NEXT_PUBLIC_APP_URL` est sur localhost).
- M2, **adhésion SUPPORT résiduelle** : une `Membership` SUPPORT ne vaut que si l'utilisateur a encore la permission
  `support.access` (`storeRoleStillAllowed`) ; retirer les droits d'administration supprime ces adhésions
  (`setPlatformAdmin`, `src/lib/admin/actions.ts`). L'accès implicite n'existe plus (M3 ci-dessus).
- m3, compte à e-mail non vérifié sans accès à la console (`src/lib/admin/context.ts`).
- m6, codes promo d'abonnement : limite de tentatives et message unique (`src/lib/pricing/coupons.ts`).
- m8, identifiants bruts validés en tête d'action (`badIds`, `src/lib/action.ts`).
- m9, liens Markdown des descriptions produit filtrés (`src/lib/products/markdown.ts`).
- Tests : `tests/admin-mfa-required.test.ts`, `tests/security-ids-coupons-links.test.ts`.

### Connecteur MCP et OAuth : corrigé

Référence fonctionnelle : [`API-MCP.md`](API-MCP.md).

- M1, **lots JSON-RPC** refusés (`-32600`, HTTP 400) dès la version `2025-06-18` ; quotas comptés par message
  (`src/lib/mcp/protocol.ts`, `src/lib/mcp/http.ts`, `src/lib/mcp/runtime.ts`).
- M2, applications vérifiées et **marques réservées** refusées à l'enregistrement et au consentement
  (`src/lib/mcp/tokens.ts`, `src/lib/mcp/oauth.ts`).
- M3 et m2, **injection de prompt** : saisies des acheteurs regroupées sous `untrusted_customer_input` avec consignes
  du serveur ; données personnelles masquées sans `customers:read` (`src/lib/mcp/merchant/`).
- M3, **confirmation humaine** (`confirm: true`) pour les remises fortes et les variations de prix de plus de 50 %
  (`requireConfirmation`, `src/lib/mcp/merchant/common.ts`).
- m4, erreurs de `update_order_status` masquées, hors erreurs métier connues.
- M1 et m5, MCP vitrine : disponibilité binaire, 20 unités maximum, statistiques agrégées par jour.
- **Consentement vérifié** : aucune redirection vers l'application avant session et décision de l'utilisateur ;
  demande revalidée côté serveur à l'approbation comme au refus (`src/app/oauth/authorize/page.tsx`,
  `src/lib/mcp/oauth-actions.ts`) ; scope absent = lecture seule.
- n1, code d'autorisation à usage unique, consommé dans une transaction verrouillée ; n2, rotation du jeton de
  rafraîchissement avec détection de réutilisation, réduction de scope définitive (`src/lib/mcp/oauth.ts`).
- m3, révocation possible même en boutique suspendue ; n4, plafond de jetons compté sous verrou
  (`src/lib/mcp/actions.ts`).
- Tests : `tests/mcp-hardening.test.ts`, `tests/mcp-oauth.test.ts`, `tests/mcp-actions.test.ts`,
  `tests/mcp-protocol.test.ts`, `e2e/07-mcp.spec.ts`.

## Audits du lot 1 (11/10/2026)

Trois audits du lot 1, complétés par un contrôle d'isolation entre boutiques (ventes et fidélité, spécification [`specs/LOT-1-ventes-fidelite.md`](specs/LOT-1-ventes-fidelite.md),
§0.2, §3 « Règles de sortie d'argent », §8). Chaque ligne a été relue dans le code. Aucun rapport écrit de ces audits
n'a été conservé : les gravités sont attribuées à la rédaction, selon l'impact (argent perdu ou rendu deux fois :
bloquant). Les identifiants M1, m1 à m6 de l'audit des comptes acheteurs sont ceux des tests et des commentaires.
« Sans test dédié » signifie que le correctif est en place mais qu'aucun test Vitest ne le vérifie directement.

### Revue de code (flux de sortie d'argent) : corrigé

| Constat | Gravité | Statut | Fichier(s) corrigé(s) et test(s) |
|---|---|---|---|
| Plafonds de remboursement calculés à plusieurs endroits, de façon divergente. Source unique `refundableRemaining` : total − `Refund` non refusés − REVERSAL (cartes, avoir) non rattachés à un `Refund` − retours RESOLVED en STORE_CREDIT ou EXCHANGE − retours RESOLVED/REFUND sans `refundId` − valeur dépensée des cartes achetées par la commande ; jamais négatif | bloquant | corrigé | `src/lib/commerce/refunds.ts` (`computeRefundable`, `loadRefundLedger`) ; usages : `requestRefund` (`src/lib/payments/service.ts`, les deux destinations), `quoteReturn` (`src/lib/returns/service.ts`), annulation (`transitionOrderTx`, `src/lib/commerce/orders.ts`), fiche commande (`src/app/app/[storeId]/commandes/[orderId]/page.tsx`) ; `tests/money-flows.test.ts` (« computeRefundable (pur) ») |
| Rattachement d'un REVERSAL à son remboursement : la note porte `refund:<refundId>` (sans migration) ; part externe déjà rendue = Σ `Refund` − Σ REVERSAL rattachés (`externalRefunded`) | majeur | corrigé | `src/lib/commerce/refunds.ts` (`refundNote`, `isRefundReversal`, `externalRefunded`) ; `tests/money-flows.test.ts` (« part externe déjà rendue… ») |
| `requestRefund` sérialisé : verrou `SELECT … FOR UPDATE` de la commande avant le calcul du plafond ; en destination `store_credit`, les tenders retournent d'abord à leurs instruments, seule la part externe est créditée en avoir (`REFUND_TO_CREDIT`) | majeur | corrigé | `src/lib/payments/service.ts` ; `tests/money-flows.test.ts` (« remboursement en avoir puis annulation ») |
| Cartes cadeaux achetées par une commande annulée : solde non dépensé retiré (ADJUST) et toutes les cartes désactivées (`disableAll`) ; émission future bloquée | bloquant | corrigé | `src/lib/giftcards/service.ts` (`neutralizePurchasedGiftCardsTx`), appel dans `src/lib/commerce/orders.ts` ; `tests/money-flows.test.ts` (« annulation : cartes désactivées, solde retiré… ») |
| Crédit d'échange matérialisé en avoir : min(crédit, total) crédité (`REFUND_TO_CREDIT`) puis débité (REDEEM) sur la commande d'échange ; annuler ou rembourser la commande d'échange rend ce crédit par les REVERSAL d'avoir. Excédent (`surplus`) à verser par l'appelant ; idempotence `exchange:{returnId}` | majeur | corrigé | `src/lib/commerce/exchange.ts` (`createExchangeOrder`) ; `tests/money-flows.test.ts` (« commande d'échange ») |
| Options d'échange : options des articles reprises par nom (`optionNames`, `withOptionIds`) et contrôlées comme au checkout (`resolveLinesTx`) ; carte cadeau refusée en échange | mineur | corrigé, sans test dédié | `src/lib/commerce/exchange.ts`, `src/lib/returns/service.ts` (noms lus dans `OrderItem.options`) |
| Base des points de fidélité : net marchandise hors lignes carte cadeau (`lineTotal − discountAllocated`), hors livraison, moins cartes et avoir utilisés ; jamais négative ; commandes antérieures au lot 1 : `discount` global retranché | majeur | corrigé | `src/lib/commerce/loyalty-base.ts` (`loyaltyBaseAmount`) ; `tests/money-flows.test.ts` (« base des points de fidélité ») |
| `freeAbove` comparé au net marchandise après remises automatiques et coupon, AVANT les points (étape 6 de §0.2), hors lignes carte cadeau (une carte n'ouvre pas la livraison offerte) | mineur | corrigé | `src/lib/commerce/checkout-pipeline.ts` (`netBeforeLoyalty`, `deliveryBase`) ; `tests/checkout-pipeline.test.ts` (« freeAbove évalué AVANT la fidélité… », « freeAbove hors lignes carte cadeau… ») |
| Non-cumul coupon / remises automatiques : en cas de conflit de drapeaux, scénarios « automatiques seules » et « coupon » calculés, le total le plus bas (net + livraison) est retenu, avec le message unique de non-cumul ; coupon cumulable sous son minimum : message dédié, jamais « non cumulable » | majeur | corrigé | `src/lib/commerce/checkout-pipeline.ts` (`priceCart`, `NOT_COMBINABLE_MESSAGE`, `MIN_WITH_OFFERS_MESSAGE`) ; `tests/checkout-pipeline.test.ts` (« cumul et non-cumul », « coupon cumulable sous son minimum… ») |
| BUNDLE : articles à variante précise servis d'abord (un article générique ne prend jamais l'unité d'une variante exigée) ; prix du lot réparti au plus fort reste ; aucune remise si le prix du lot dépasse la somme ; `maxSets` borne les lots | mineur | corrigé | `src/lib/discounts/evaluate.ts` (`evalBundle`) ; `tests/discounts-evaluate.test.ts` (« BUNDLE »), `tests/checkout-pipeline.test.ts` (« lot générique + variante précise… ») |
| Verrous coupon : `usesCount` incrémenté par `updateMany` conditionnel (`usesCount < maxUses`), idem pour les remises automatiques ; `maxUsesPerCustomer` et `firstOrderOnly` sérialisés par un verrou consultatif `pg_advisory_xact_lock` (coupon + téléphone), pas par `FOR UPDATE`. Les cartes cadeaux, elles, sont verrouillées par `SELECT … FOR UPDATE` avant lecture du solde | majeur | corrigé ; verrous coupon sans test dédié | `src/lib/commerce/orders.ts` (`createOrder`) ; cartes : `src/lib/giftcards/service.ts` (`lockGiftCardsTx`), `tests/giftcard-redeem.test.ts` (« verrouille les lignes (SELECT … FOR UPDATE)… », « débit conditionnel… ») |

### Audit « argent » : corrigé

| Constat | Gravité | Statut | Fichier(s) corrigé(s) et test(s) |
|---|---|---|---|
| Double recrédit (annulation puis remboursement, ou l'inverse) : l'annulation ne recrédite que les tenders encore débités (REDEEM − REVERSAL), plafonnés par `refundableRemaining` ; les recrédits d'annulation sont déduits du remboursable ensuite. La transition d'annulation est conditionnelle sur le statut lu (`updateMany where status`) | bloquant | corrigé | `src/lib/commerce/orders.ts`, `src/lib/commerce/refunds.ts` ; `tests/money-flows.test.ts` (« remboursement en avoir puis annulation », « annulation entre deux remboursements “original” » : le total rendu n'excède jamais le total) |
| Retour + remboursement : un retour RESOLVED/REFUND sans `refundId` réserve son montant (le retour en cours ne se réserve pas lui-même, `excludeReturnId`) ; retours en avoir ou échange déduits. Résolution sous verrou de la commande, compensation RESOLVED → RECEIVED si `requestRefund` échoue | bloquant | corrigé | `src/lib/commerce/refunds.ts`, `src/lib/returns/service.ts` (`resolveWithRefund`) ; `tests/money-flows.test.ts` (« le retour en cours de remboursement ne se réserve pas lui-même », « retour résolu en avoir puis remboursement ») |
| Cartes achetées et remboursement : jamais émises pour une commande annulée, remboursée ou non `PAID` (revérifié sous `SELECT … FOR UPDATE` de la commande dans `issueGiftCardsForOrder`) ; remboursement refusé tant que toutes les cartes ne sont pas émises ; il porte d'abord sur le reste de la commande, puis retire le solde non dépensé des cartes (carte désactivée à 0) ; la valeur dépensée n'est jamais remboursable | bloquant | corrigé | `src/lib/giftcards/service.ts`, `src/lib/payments/service.ts` ; `tests/money-flows.test.ts` (« cartes cadeaux achetées par la commande », 5 cas), `tests/giftcard-redeem.test.ts` (« jamais avant paiement confirmé ») |
| Outils MCP `issue_gift_card` et `grant_store_credit` plafonnés par connexion (jeton ou autorisation OAuth) sur 24 h, réservation atomique et conditionnelle dans la transaction d'écriture : 5 cartes et 10 crédits ; montant cumulé par type limité à la valeur faciale maximale d'une carte (500 000 FCFA ; en euros, 76 225 centimes, soit 762,25 €). En plus : confirmation `confirm: true` toujours exigée, valeur de carte 1 000 à 500 000 FCFA, validité 5 ans au plus, avoir 10 000 000 au plus par opération, `customers:read` exigé pour l'avoir | majeur | corrigé ; plafonds journaliers sans test dédié | `src/lib/mcp/merchant/promotions.ts` (`MCP_DAILY_CAPS`, `mcpDailyAmountCap`, `reserveDailyTx`), `src/lib/giftcards/state.ts` (`giftCardLimits`), `src/lib/store-credit/rules.ts` ; `tests/lot1-storefront-mcp.test.ts` (confirmation, plan, scope `customers:read`) |
| Vérification des cartes : 10 vérifications / 15 min par IP (et par IP et boutique) avant toute recherche de code, 5 échecs par panier sur 1 h, alerte au-delà de 200 codes invalides / h / boutique (notification et audit `giftcard.invalid_burst`) ; message unique « Carte cadeau invalide » ; arrêt d'urgence vérifié en premier | majeur | corrigé ; débits sans test dédié | `src/lib/giftcards/abuse.ts`, `src/lib/giftcards/actions.ts` (`checkGiftCardBalance`), `src/lib/storefront/actions.ts` (checkout) ; `tests/giftcards-isolation.test.ts` (message unique, arrêt d'urgence), `tests/giftcard-redeem.test.ts` (« carte épuisée : même message… ») |
| Photos de retour envoyées par l'acheteur : 6 photos au plus par commande et par 24 h (en plus de 20 / h par IP, 12 / h par commande, 300 / h par boutique) ; photos citées par aucune demande et plus vieilles que 24 h supprimées par le balayage de `/api/jobs/run`, quota rendu une seule fois ; date inconnue : pas de suppression | mineur | corrigé | `src/app/api/s/[slug]/returns/photos/route.ts`, `src/lib/returns/photo-purge.ts` (`RETURN_PHOTO_GRACE_MS` = 24 h) ; `tests/returns-photos.test.ts` |

### Audit « comptes acheteurs » : corrigé

| Constat | Gravité | Statut | Fichier(s) corrigé(s) et test(s) |
|---|---|---|---|
| Plafonds d'envoi des codes : 3 / 15 min par couple IP + destination, 10 / 24 h par destination toutes boutiques confondues, 10 / h par IP, 300 / h et 500 / jour par boutique ; destination hachée dans les clés | majeur | corrigé | `src/lib/buyer/otp.ts` (`otpRequestRules`, `STORE_DAILY_CAP`, `DEST_DAILY_CAP`) ; `tests/buyer-otp.test.ts` (« applique les trois débits… ») |
| M1, expéditeur plateforme : réservé aux boutiques sans WhatsApp Cloud actif (pas de repli si le débit ou l'envoi Meta échoue) ; plan Gratuit : 30 codes / jour / boutique (`AXI_OTP_FREE_DAILY_PER_STORE`) ; budget global 2 000 / jour (`AXI_OTP_DAILY_BUDGET`), au-delà arrêt d'urgence activé et alerte admin | majeur | corrigé | `src/lib/buyer/senders.ts`, `src/lib/buyer/otp.ts` (`freeDailyPerStore`, `platformDailyBudget`) ; `tests/buyer-otp-senders.test.ts` (« M1 : envoi des codes »), `tests/buyer-otp.test.ts` (« M1 : budget plateforme… ») |
| Défi anti-robot Turnstile optionnel : inactif sans `TURNSTILE_SECRET_KEY` ; exigé au-delà de 3 demandes / h / IP (`AXI_OTP_CHALLENGE_AFTER`) ; vérification serveur, délai 5 s, refus prudent si l'API est indisponible | mineur | corrigé, sans test dédié | `src/lib/buyer/challenge.ts`, `src/lib/buyer/actions.ts` (`requestOtp`) |
| m1, anti-énumération : même message que le numéro ou l'e-mail soit connu ou non ; code par e-mail émis seulement si une fiche de la boutique porte cet e-mail vérifié ; envoi après la réponse (`after()`) et réponse d'au moins 700 ms ; échec de vérification identique | mineur | corrigé | `src/lib/buyer/actions.ts` (`issueAfterResponse`, `MIN_REQUEST_MS`) ; `tests/buyer-otp.test.ts` (« requestOtp : anti-énumération… », « m1 : connexion par e-mail… ») |
| m2, `verifyBuyerEmail` plafonné à 3 envois / jour / client, en plus des débits d'émission ; nom de boutique neutralisé dans l'e-mail | mineur | corrigé | `src/lib/buyer/otp.ts` (`emailVerifyRules`, `neutralStoreName`), `src/lib/buyer/actions.ts` ; `tests/buyer-otp.test.ts` (« m2 : seuls les codes du même client sont expirés », « m2 : nom de boutique neutralisé… ») |
| m2 et m3, codes non invalidables par un tiers : un code actif n'est remplacé que par une demande de la même IP (`shouldReissue`) ; seuls les codes du même client sont expirés | mineur | corrigé | `src/lib/buyer/otp.ts`, `src/lib/buyer/actions.ts` (`issueOtp`) ; `tests/buyer-otp.test.ts` (« m3 : … », « m2 : … ») |
| m4, plafond d'échecs : au-delà de 20 essais ratés sur 24 h pour une destination de la boutique, plus aucun code émis ni vérifié (compteur `otp:locked`) ; 5 essais par code | mineur | corrigé | `src/lib/buyer/otp.ts` (`FAIL_DAILY_CAP`, `failuresFrom`), `src/lib/buyer/actions.ts` (`isDestinationLocked`) ; `tests/buyer-otp.test.ts` (« m4 : … ») |
| m5, hôte de boutique strict : sur un sous-domaine ou un domaine personnalisé, `/s/<autre>` répond 404 ; cookie `__Host-axi_buyer` (Path=/) seulement sur un hôte de boutique en HTTPS, `axi_buyer` limité à `/s/{slug}` sinon | mineur | corrigé | `src/lib/buyer/host.ts` (`foreignStorePath`), `src/proxy.ts`, `src/lib/buyer/otp.ts` (`buyerCookieName`, `buyerCookiePath`), `src/lib/buyer/session.ts` ; `tests/buyer-otp-senders.test.ts` (« m5 »), `tests/buyer-otp.test.ts` (« m5 : cookie __Host-… ») |
| m6, purge : IP des codes et des sessions effacées 30 jours après création ; codes expirés et sessions expirées ou révoquées depuis plus de 30 jours supprimés (balayage de `/api/jobs/run`) | mineur | corrigé | `src/lib/buyer/purge.ts` (`purgeBuyerAuthData`) ; `tests/buyer-otp-senders.test.ts` (« m6 : purge ») |
| Arrêt d'urgence `buyer_accounts.kill_switch` : bloque aussi l'avoir et les points au checkout (`placeOrder` et `previewTotals`), le reste de la commande reste possible | majeur | corrigé | `src/lib/storefront/actions.ts`, `src/lib/buyer/settings.ts` ; `tests/buyer-kill-switch-checkout.test.ts` |

### Isolation entre boutiques (actions marchandes du lot 1) : corrigé

| Constat | Gravité | Statut | Fichier(s) corrigé(s) et test(s) |
|---|---|---|---|
| Chaque action qui reçoit un identifiant le relit avec `storeId` = boutique du membre (`findFirst` ou `updateMany` filtré) : un identifiant d'une autre boutique donne « introuvable », sans écriture ni audit ni job. Couvert pour `upsertAutomaticDiscount`, `toggleAutomaticDiscount`, `duplicateAutomaticDiscount`, `deleteAutomaticDiscount`, `upsertCartOffer`, `toggleCartOffer`, `deleteCartOffer`, `revokeBuyerSessions`, `extendGiftCard`, `quoteReturnAction`, `refundOrder` (deux destinations), `adjustLoyaltyPoints` ; références de produits, collections et remise liée d'une autre boutique refusées à l'enregistrement | majeur | corrigé | `src/lib/discounts/actions.ts`, `src/lib/buyer/merchant-actions.ts`, `src/lib/giftcards/actions.ts`, `src/lib/returns/actions.ts`, `src/lib/orders/actions.ts` ; `tests/security-lot1.test.ts` (instantané des tables comparé avant et après), en complément de `tests/giftcards-isolation.test.ts` et `tests/returns-isolation.test.ts` |
| `adjustLoyaltyPoints` sur un client d'une autre boutique : aucune écriture (filtre `storeId`), mais erreur générique au lieu de « introuvable » | mineur | corrigé | `src/lib/loyalty/actions.ts` (contrôle du client avant la transaction) ; `tests/security-lot1.test.ts` |
| Montée en gamme (`resolveOfferUpgrade`, lecture publique) : boutique publiée, plan, offre active de mode `replace` de la boutique, produit proposé par l'offre et ligne réellement déclencheuse revalidés côté serveur ; débit limité (60 / 10 min par IP) ; prix indicatif seulement (recalcul à la commande) | mineur | corrigé | `src/lib/storefront/offer-actions.ts`, `src/lib/discounts/upgrade.ts` ; `tests/offer-upgrade.test.ts` |

### Point ouvert assumé

La valeur remboursable d'un article retourné n'est pas figée sur le retour. `ReturnItem` ne stocke que la quantité ;
`quoteReturn` (`src/lib/returns/service.ts`) relit à chaque calcul (pages et résolution) l'instantané `OrderItem`
(`lineTotal`, `discountAllocated`, `quantity`), puis `computeReturnAmounts` (`src/lib/returns/amounts.ts`) répartit le
net de la ligne sur ses unités au plus fort reste, dans l'ordre de création des retours. Seuls `refundAmount` et
`restockingFee` sont écrits sur `ReturnRequest`, à la résolution. Risque faible : aucun code ne modifie un
`OrderItem` après la création de la commande (aucun `orderItem.update`, `updateMany` ni `upsert` dans `src/`). À figer
sur `ReturnItem` si un jour l'instantané devient modifiable (édition de commande, par exemple).

## Audit du 10/10/2026 : constats d'origine

Rapport de l'agent `security-auditor`. Le schéma a déjà été étendu pour les correctifs :
`VerificationToken.attempts`, `Integration.phoneNumberId @unique`, `Store.marketplaceBlocked`, modèle `RateLimit` (clé, compteur, `resetAt`). Client Prisma régénéré.

## Bloquants
- **B1** Force brute des codes à 6 chiffres (`src/lib/auth/actions.ts` : `resetPassword` l.136-158, `verifyEmail` l.95-113) : compteur d'essais par jeton (5 max, `updateMany ... attempts lt 5`), limite d'émission par e-mail et par IP, comparaison `safeEqual`.
- **B2** Plan payant et crédits accordés avant paiement (`src/lib/billing/actions.ts` l.96-117, `permissions.ts effectivePlanId`, `billing/lifecycle.ts`, `api/jobs/run` crédits) : ne basculer `planId`/`currentPeriodEnd` qu'à `confirmInvoicePayment` (montée en gamme = facture OPEN, ancien plan conservé jusqu'au paiement ; l'essai reste un cas à part), crédits mensuels seulement si une facture PAID couvre la période (ou essai en cours), grâce PAST_DUE calculée depuis `invoice.dueAt`, ne pas annuler en cascade des factures ouvertes pour prolonger l'accès.

## Majeurs
- **M1** Zone tarifaire : `subscription.zone` est la source de vérité (jamais réécrite depuis `store.currency` dans `changePlan`, `payInvoiceOnline`, `purchaseAddOn`) ; une zone posée par l'admin n'est plus écrasée.
- **M2** WhatsApp : `phoneNumberId` stocké dans la colonne unique `Integration.phoneNumberId`, refus si déjà utilisé, webhook ne route que les intégrations `active` via cette colonne.
- **M3** Accès SUPPORT implicite de l'admin (`permissions.ts` l.110-111) : le supprimer ; exiger la `Membership` SUPPORT datée créée par `grantSupportAccess` (l'admin garde la console `/admin`).
- **M4** E-mails : en production, refuser le mode `console` (erreur explicite) ; implémenter `smtp` via `fetch` impossible → retirer `smtp` de la doc, garder `resend`.
- **M5** Limitation de débit : `src/lib/rate-limit.ts` (table `RateLimit`, fenêtre fixe, upsert atomique) appliquée à connexion, inscription, demande et saisie de code (réinitialisation et vérification d'e-mail, par compte et par IP), `placeOrder`, `previewTotals`, avis, contact, `/api/marketplace/suggest`. Message unique « Code promo invalide » quel que soit le motif. Identification IP via `x-forwarded-for` premier élément.
- **M6** Double débit passerelle : ne pas ré-initier une tentative `INITIATED` (réutiliser l'URL ou interroger `fetchStatus`) ; un `CONFIRMED` sur tentative déjà confirmée avec un autre `providerRef` crée un `OrderEvent` + notification « paiement en double à rembourser ».

## Mineurs
m1 redirection ouverte (`next` : n'accepter que `^/(?![/\\])`) · m2 révoquer les autres sessions au changement de mot de passe · m3 énumération (hash factice à la connexion, message neutre à l'inscription) · m4 `marketplaceBlocked` respecté (le commerçant ne peut plus se relister), `.max()` sur description/orderNotes · m5 coupon `maxUses` atomique · m6 `maxQty` agrégé par produit/variante · m7 transition de commande conditionnelle (`updateMany where status`) · m8 ne pas écraser une fiche client existante depuis le checkout, vérifier `pickupSlotId` de la boutique · m9 exiger `emailVerified` dans `requireUserOrThrow`/`requireStore` · m10 proxy : base fixe pour `/api/domains/resolve` · m11 CSP + HSTS dans `next.config.ts` · m12 rejeter `CONFIRMED` sans montant/devise · m13 PayDunya : confirmer via API de statut · m14 journaliser au plus un échantillon borné des webhooks à signature invalide · m15 `/api/health` sans message d'erreur ; clé worker en en-tête seulement (garder `Authorization: Bearer` pour Vercel Cron) · m16 refuser `APP_SECRET`/`JOBS_RUN_KEY` contenant `change-me` en production · domaines non vérifiés expirés après 7 j · seed refusé si `NODE_ENV=production`.
