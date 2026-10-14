# Vague 3 — équipe OPS (lot 3 : opérations)

Expédition avancée, dépôts et stock par dépôt, caisse en magasin. Spécification : `docs/specs/LOT-3-operations.md`.
Cette équipe est le **responsable unique du schéma** pour toute la vague 3.

## 1. Vague de schéma

Migration **additive** `prisma/migrations/20261012090000_lot3_operations` (appliquée en local, `prisma migrate status` à jour).

- Nouveaux enums : `LocationType`, `TransferStatus`, `ShipmentStatus`, `FulfillmentStatus`, `PosSessionStatus`.
- Valeurs ajoutées : `InventoryReason` + `TRANSFER`, `RECEIVE`, `COUNT` ; `OrderChannel` + `POS`.
- Nouvelles tables : `Location`, `InventoryLevel`, `StockTransfer`, `StockTransferItem`, `CarrierAccount`,
  `ShippingRate`, `Shipment`, `ShipmentItem`, `ShipmentEvent`, `PosDevice`, `PosSession`, `PosCashMovement`.
- Colonnes ajoutées : `DeliveryZone.locationId` ; `InventoryMovement.locationId` (+ index) ;
  `Order.{locationId, shippingRateId, shippingRateName, fulfillmentStatus, posSessionId, posDeviceId, offlineCreatedAt, priceSource}` ;
  `OrderItem.locationId`.
- Aucune suppression, aucun renommage, aucune colonne obligatoire sans valeur par défaut.

**Migration de données** : `pnpm exec tsx scripts/migrate-locations.ts [--dry-run] [--store <id>]` crée le
« Dépôt principal » de chaque boutique et y rattache le stock suivi. Idempotent : un article qui possède déjà
un niveau n'est jamais recrédité. Le seed (`prisma/seed.ts`, `seedLot3`) fait la même chose pour les boutiques
de démonstration, avec un second dépôt et un livreur interne pour Dantokpa Mode.

## 2. Invariant de stock

> `Product.stock` (ou `Variant.stock`) = Σ `InventoryLevel.available` + quantités **en transit**.

Le stock **agrégé** reste la seule référence de disponibilité du checkout (aucune régression) ; les niveaux
servent l'affectation, les transferts et la caisse. Une marchandise en transit a quitté le dépôt source sans
être encore reçue : elle appartient toujours au stock de la boutique, d'où le terme « en transit » dans
l'invariant (`invariantDiff`, `findLevelDiscrepancies`).

Toute écriture passe par `src/lib/inventory/levels.ts`, dans **la même transaction** que l'agrégat :

| Chemin | Agrégat | Niveau | Mouvement |
|---|---|---|---|
| Vente en ligne (`createOrderItemsTx`) | déjà décrémenté par `resolveLinesTx` | un décrément par dépôt affecté | `SALE` par dépôt |
| Annulation / retour (`creditOrderLevelsTx`) | incrément par le code existant | restitution aux dépôts qui ont servi | `CANCEL` / `RETURN` avec `locationId` |
| Transfert | inchangé | − source à l'expédition, + destination à la réception | `TRANSFER` / `RECEIVE` |
| Perte en transit | décrément | aucun (la marchandise n'est nulle part) | `ADJUSTMENT` sans `locationId`, motif obligatoire |
| Inventaire tournant | écart | écart | `COUNT` |
| Vente en caisse | décrément | décrément du dépôt de l'appareil | `SALE` |

Job quotidien `inventory.reconcile` : signale les écarts (notification + audit), **sans correction automatique**.
Les mouvements `TRANSFER`/`RECEIVE` sont neutres pour l'agrégat : ils sont exclus de la reconstitution
d'historique des alertes de stock (`src/lib/inventory/alerts.ts`).

## 3. Affectation des commandes aux dépôts

`allocateLocations` (pur) : dépôt de la zone → dépôt de retrait → dépôt par défaut → dépôt qui couvre le plus.
Une ligne peut être répartie entre plusieurs dépôts ; le reliquat (stock insuffisant partout) est porté par le
dépôt préféré, dont le niveau peut devenir négatif. `Order.locationId` et `OrderItem.locationId` conservent
l'instantané. Une boutique sans dépôt traverse tout le chemin sans effet.

## 4. Expédition

- **Tarifs** (`src/lib/shipping/rates.ts`, pur) : poids (variante, sinon produit, sinon avertissement), sous-total
  net après remises, bornes **incluses**, `freeAbove`, choix du tarif applicable le moins cher ; une zone sans
  tarif actif garde son forfait `DeliveryZone.fee`.
- **Machine d'états** (`src/lib/shipping/state.ts`, pure) : `canTransitionShipment` fait foi ; les statuts sont
  **ordonnés** et `applyCarrierStatus` ignore tout événement qui ferait reculer une expédition (ou qui touche un
  état terminal). `Order.fulfillmentStatus` est **toujours recalculé** depuis les expéditions vivantes ; toutes
  livrées → commande `DELIVERED`, une en livraison → `OUT_FOR_DELIVERY`.
- **Expéditions partielles** : quantités bornées au reste à expédier ; une expédition annulée rend ses unités
  de nouveau expédiables.
- **Étiquette interne A6** (`/app/.../expeditions/<id>/etiquette`) : expéditeur, destinataire (prénom et
  téléphone partiellement masqué), repère de zone, poids, QR du suivi (`src/lib/qr`) et code-barres **Code 128**
  (`src/lib/shipping/code128.ts`, pur, sans dépendance). Impression navigateur, aucun PDF.
- **Preuve de remise** : code à 4 chiffres (empreinte HMAC en base, 5 essais puis blocage et alerte) ou photo de
  preuve **téléversée dans le stockage de la plateforme** (`POST /api/livraison/[token]/preuve` : octets vérifiés,
  clé interne `stores/{id}/delivery/…`) — aucune URL fournie par le livreur n'est acceptée, et la photo est
  affichée sur la fiche expédition. Page livreur `/livraison/[token]` (jeton aléatoire, 7 jours),
  géolocalisation facultative, révélation du numéro complet journalisée ; jeton **révocable**
  (`revokeCourierToken`) et **purgé** 24 h après la clôture de l'expédition (`purgeFinishedCourierTokens`).
  Jeton expiré ou révoqué : la page ne rend plus que le bandeau (aucune donnée personnelle, aucun article).
- **Webhooks transporteurs** `/api/webhooks/carriers/[carrier]` : HMAC du corps brut, **horodatage obligatoire**
  (toléré 5 min ; drapeau de configuration `allowMissingTimestamp` par compte transporteur), **anti-rejeu par
  nonce** (signature déjà vue, TTL 10 min), idempotence `(shipmentId, providerEventId)`, expédition retrouvée
  **dans la boutique du compte transporteur**.

### Point d'intégration laissé au porteur

`manual` (livreur interne / transporteur sans API) est **complet**. Pour `gozem`, `yango`, `dhl`, `laposte_bj` :
le contrat (`src/lib/carriers/types.ts`), la construction des requêtes (`buildCreateShipmentRequest`), le
**mapping des statuts** (`status-map.ts`) et la **vérification des webhooks** (`webhook.ts`) sont en place et
testés ; seuls les appels HTTP réels manquent (comptes et documentation fournisseur). Tant que
`implemented = false`, l'action refuse clairement la création et renvoie vers le transporteur manuel ; les
webhooks signés sont déjà acceptés dès que le secret est renseigné.

## 5. Caisse en magasin

### Parcours (deux écrans, deux usages)

La caisse se tient en **deux pages complémentaires**. Le menu latéral mène à la première : il n'envoie plus
personne en plein écran sans prévenir (retour du porteur : « on ne voit plus la barre latérale »).

| | `/app/[storeId]/caisse` — réglage et suivi | `/caisse/[storeId]` — écran de vente |
|---|---|---|
| Coque | Espace marchand, **barre latérale et en-tête conservés** | **Plein écran**, PWA, pour la tablette du comptoir |
| Cible du menu « Caisse » | **oui** | non (bouton « Ouvrir la caisse ») |
| Contenu | appareils (enregistrement, révocation, jeton affiché une seule fois), code du gérant, sessions ouvertes, historique des rapports Z, dépôt associé, explication du hors-ligne | association d'un appareil non encore associé, ouverture ou reprise de session, vente, file d'attente, ventes à régulariser, clôture |
| Accès | `pos.sell` pour consulter ; **`store.settings`** pour appareils et code du gérant | `pos.sell` + jeton d'appareil |

L'écran de vente n'est **pas un cul-de-sac** : son en-tête (collant) porte le nom de la boutique, l'état
**En ligne / Hors ligne**, la session en cours (heure d'ouverture et fond de caisse), le nombre de ventes en
attente, un bouton « Synchroniser » et surtout un **bouton « Espace marchand »** en première position (premier
élément du parcours clavier), pas un lien discret. En mobile (375 px), le titre passe sur sa propre ligne pour
rester entier. Réciproquement, la page de réglage ouvre l'écran de vente par un bouton explicite qui précise que
c'est l'écran à utiliser sur la tablette du comptoir.

- `/caisse/[storeId]` : plein écran, PWA (`/caisse/manifest.webmanifest`, service worker dédié
  `/caisse/sw.js` de portée `/caisse/`). Le service worker ne met en cache que la **coque statique**
  (`/_next/static`, manifeste) : le **document reste en réseau d'abord et n'est jamais écrit en cache** (page
  authentifiée), et **jamais** de cache sur `/api/pos/*`. Hors réseau, une page d'attente locale est rendue.
- **Appareils** : jeton aléatoire affiché **une seule fois**, conservé en base sous forme d'empreinte HMAC
  (`APP_SECRET` exigé par `requireAppSecret()`), révocable ; lié à un dépôt. Les ventes en file d'un appareil
  révoqué restent acceptées **24 h**, mais **uniquement** si elles sont réellement hors ligne et **antérieures
  à la révocation** : toute vente en ligne d'un appareil révoqué est refusée.
- **Hors ligne** : instantané du catalogue en IndexedDB (version, date, rafraîchi toutes les 15 min) ; au-delà de
  **72 h** sans synchronisation, la vente est bloquée (« Reconnectez la caisse ») ; file de ventes avec clé
  d'idempotence **UUID v4** générée sur l'appareil, envoyée par lots de **20** à `POST /api/pos/[storeId]/sales`
  (en-tête `Axi-Pos-Device`). Une vente ne quitte la file que lorsque le serveur l'a acceptée (ou déclarée
  définitivement invalide).
- **Prix** : le serveur recalcule TOUT avec le pipeline (`priceCart`) à la date `offlineCreatedAt`. Hors ligne,
  si l'écart reste dans la tolérance, la vente est enregistrée **au prix encaissé** (`priceSource =
  "offline_snapshot"`), l'écart étant tracé dans `OrderEvent`, audité (`pos.price_mismatch`) et compté dans le
  rapport Z. Au-delà de 50 % d'écart, le prix serveur reprend la main (appareil compromis).
- **« Hors ligne » n'est jamais déduit d'un champ du client** (`decideOffline`) : il exige une preuve technique
  — une dernière synchronisation connue en base (`PosDevice.lastSyncAt`, écrite **uniquement** par
  `GET /api/pos/{id}/catalog`), un écart réel d'au moins 20 min avec la réception, et une date déclarée dans la
  fenêtre de validité de l'instantané. Sans preuve : **prix serveur imposé**. Au-delà de 72 h sans
  synchronisation, la vente est refusée **côté serveur** aussi, pas seulement dans l'interface. Corollaire :
  l'appareil **vide sa file avant de rafraîchir son catalogue**.
- **Remise au-delà du plafond du rôle** : elle exige le **code du gérant** (4 à 6 chiffres par boutique,
  empreinte HMAC dans `Store.posManagerCodeHash`, défini sous `store.settings`, 5 essais puis blocage de 15 min).
  Il n'existe **aucun** drapeau de dérogation accepté depuis le client ; chaque usage est audité
  (`pos.manager_override`).
- **Paiements multiples** `pos_cash` / `pos_momo` / `pos_card` (référence obligatoire hors espèces), arrondi des
  espèces à 5 FCFA, rendu de monnaie calculé. Les `PaymentAttempt` sont **nets du rendu** (`settlePayments`) :
  Σ tentatives = total encaissé, sinon le rapport Z surévaluerait la caisse.
- **Commande** : `channel POS`, `PICKUP`, `DELIVERED`, `PAID`, `locationId`, `posSessionId`, `posDeviceId`,
  `offlineCreatedAt`.
- **Stock** : décrément de l'agrégat et du dépôt de l'appareil. Quantité bornée à **999 par ligne** et survente
  bornée à **50 unités par article et par dépôt** (au-delà : refus, saisie ou appareil douteux). En deçà, une
  **survente** (niveau négatif) est acceptée —
  la marchandise est déjà remise au client — avec mouvement, notification « survente » et audit `pos.oversold`.
  *Décision* : une vente au comptoir n'est **jamais refusée** pour cause de stock, même en ligne ; l'écart est
  signalé pour être régularisé par un inventaire.
- **Session** : ouverture avec fond de caisse (une seule session ouverte par appareil, reprise automatique),
  mouvements d'espèces motivés, clôture avec comptage → **rapport Z figé** (`PosSession.report`, immuable) et job
  `pos.session_report`. La clôture est refusée par l'interface tant que des ventes restent en file.
  Sans capacité de gestion (`store.settings`), un caissier n'agit que sur la session **qu'il a lui-même
  ouverte** ; **chaque sortie d'espèces notifie le gérant**.
- **Horloge faussée** : `offlineCreatedAt` borné entre la dernière synchronisation et la réception.

## 6. Plans (contrôles côté serveur)

| Fonction | Gratuit | Starter | Business | Scale | Enterprise |
|---|---|---|---|---|---|
| Dépôts (`limits.locations`) | 1 | 1 | 2 | 10 | illimité |
| Tarifs par poids et montant | non | oui | oui | oui | oui |
| Transferts (`features.stockTransfers`) | non | non | oui | oui | oui |
| Étiquettes, page livreur, code de remise (`features.couriers`) | non | non | oui | oui | oui |
| API transporteurs (`features.carriers`) | non | non | non | oui | oui |
| Appareils de caisse (`limits.posDevices`) | 0 | 0 | 1 | 5 | illimité |

La caisse s'appuie sur la **limite d'appareils**, pas sur le drapeau historique `features.pos` (réservé à Scale) :
le plan Business a droit à un appareil.

## 7. Sécurité

- Isolation `storeId` sur **chaque** requête (dépôts, niveaux, transferts, tarifs, transporteurs, expéditions,
  appareils, sessions) ; test dédié `tests/security-lot3.test.ts`.
- Un refus métier n'est **jamais** renvoyé depuis une transaction (`return` à l'intérieur de `db.$transaction`
  la VALIDE) : les refus lèvent une erreur typée interceptée hors transaction (`inTransaction`,
  `src/lib/inventory/actions.ts`). L'expédition d'un transfert est donc **tout ou rien**, et une réception ne
  peut jamais créditer plus que ce qui est réellement sorti de la source.
- Plan vérifié côté serveur sur les **trois** routes `/api/pos/*` (`posPlanGuard`), pas seulement dans les actions.
- `APP_SECRET` est lu par un **accesseur unique** (`requireAppSecret()`) qui lève s'il est absent, trop court ou
  resté sur la valeur d'exemple : plus aucune empreinte calculée avec une clé vide.
- Capacité `pos.sell` (OWNER, MANAGER, STAFF) ; dépôts et inventaire : `products.manage` ; tarifs et
  transporteurs : `delivery.manage` ; expéditions : `orders.manage` ; appareils : `store.settings`.
- Jetons livreur et appareil : aléatoires, hachés (HMAC `APP_SECRET`), expirables, révocables.
- Code de remise : 5 essais, puis blocage et notification au commerçant.
- Identifiants transporteurs chiffrés au repos (`encryptSecret`), jamais réaffichés.
- Webhooks : signature HMAC obligatoire, anti-rejeu, idempotence ; aucun événement accepté sans preuve.
- Données personnelles minimisées sur l'étiquette et la page livreur (prénom, téléphone masqué, révélation
  journalisée).
- API de caisse : session membre **et** jeton d'appareil exigés à chaque appel, limitation de débit par appareil.

## 8. Fichiers livrés

- Schéma : `prisma/schema.prisma`, `prisma/migrations/20261012090000_lot3_operations/`, `scripts/migrate-locations.ts`, `prisma/seed.ts` (`seedLot3`).
- Dépôts et stock : `src/lib/locations/{types,service,actions}.ts`, `src/lib/inventory/{allocate,levels,order-levels,transfer,count,reconcile,actions,jobs}.ts`.
- Expédition : `src/lib/shipping/{state,rates,code128,courier-code,label,service,courier,actions,courier-actions,jobs}.ts`, `src/lib/carriers/{types,status-map,webhook,manual,adapters,registry}.ts`.
- Caisse : `src/lib/pos/{cash,sync,device,catalog,service,session,offline-store,actions,jobs}.ts`.
- Interface : `/app/[storeId]/depots`, `/app/[storeId]/stock/transferts`, `/app/[storeId]/livraison/{tarifs,transporteurs}`,
  `/app/[storeId]/commandes/[orderId]/expeditions[/[shipmentId]/etiquette]`, `/livraison/[token]`,
  `/app/[storeId]/caisse` (réglage et suivi, dans l'espace marchand) et `/caisse/[storeId]` (écran de vente plein écran),
  `src/components/app/shipment-timeline.tsx`.
- API : `/api/pos/[storeId]/{catalog,sales,sessions}`, `/api/webhooks/carriers/[carrier]`, `/caisse/{sw.js,manifest.webmanifest}`.
- MCP : `src/lib/mcp/merchant/operations.ts` (`list_locations`, `get_inventory_levels`, `transfer_stock`,
  `create_shipment`, `update_shipment_status`, `pos_daily_report`).

## 9. Tests

`tests/inventory-allocate.test.ts`, `inventory-invariant.test.ts`, `transfer-state.test.ts`,
`shipping-rates.test.ts`, `shipment-state.test.ts`, `shipment-service.test.ts`, `code128.test.ts`,
`courier-code.test.ts`, `pos-sync.test.ts`, `pos-cash.test.ts`, `security-lot3.test.ts`, `plans-lot3.test.ts`.

Correctifs de l'audit de sécurité : `pos-manager-code.test.ts` et `pos-discount-override.test.ts` (bloquant
n° 1), `pos-offline-proof.test.ts` (majeurs n° 2 et 4, mineur n° 14), `inventory-transfer-rollback.test.ts`
(majeur n° 3), `vague3-securite-mineurs.test.ts` (mineurs n° 5 à 15).

`tests/helpers/fake-db.ts` a été étendu aux modèles du lot 3 (relations et listes imbriquées).
