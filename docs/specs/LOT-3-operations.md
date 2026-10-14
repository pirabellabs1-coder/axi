# Lot 3 : opérations (spécification d'implémentation)

Dépend des lots 1 (pipeline, tenders, retours) et 2 (taxes, reçus). Accord du porteur sur les fichiers protégés : accordé le 11/10/2026.

## 1. F9 : Expédition avancée et plusieurs dépôts

### 1.1 Dépôts et stock par dépôt
- `Location` (`WAREHOUSE`, `STORE`, `PICKUP_POINT`). Chaque boutique reçoit un « Dépôt principal » par la migration de données idempotente `scripts/migrate-locations.ts` : `InventoryLevel` = stock actuel de chaque produit simple et de chaque variante suivie.
- **Invariant** : `Σ InventoryLevel.available` (tous dépôts) = `Product.stock` ou `Variant.stock`. Le stock agrégé reste la référence de disponibilité de `createOrder` (pas de régression) ; chaque écriture de stock met à jour l'agrégat ET le niveau du dépôt dans la même transaction. Le job quotidien `inventory.reconcile` signale tout écart (notification et audit, sans correction automatique).
- **Affectation d'une commande** (`allocateLocations`, pur), par ligne :
  1. dépôt de la zone (`DeliveryZone.locationId`) s'il couvre la quantité ;
  2. dépôt de retrait choisi ;
  3. dépôt par défaut ;
  4. dépôt qui couvre le plus.
  - Une ligne peut être répartie entre dépôts. En politique `CONTINUE`, le dépôt d'affectation peut devenir négatif.
  - `InventoryMovement.locationId` renseigné ; `OrderItem.locationId` (instantané).
- **Transferts** (`StockTransfer`) :
  ```
  DRAFT ──expédier──► IN_TRANSIT ──recevoir──► RECEIVED
    └──annuler──► CANCELLED ◄──annuler (restitue au dépôt source)── IN_TRANSIT
  ```
  - Expédition : `TRANSFER` négatif à la source (conditionnel `available ≥ qty`), stock agrégé inchangé.
  - Réception : `RECEIVE` positif à la destination, quantités reçues ≤ expédiées ; l'écart est déclaré en perte (`ADJUSTMENT` agrégé négatif, motif obligatoire).
- **Inventaire tournant** : saisie des quantités comptées par dépôt, écart en `COUNT`, audit.

### 1.2 Tarifs et transporteurs
- `ShippingRate` par zone : poids min/max, sous-total min/max (net après remises), prix, `freeAbove`, délai, transporteur. Une zone sans tarif garde `DeliveryZone.fee` (compatibilité). Poids = `Σ weightGrams × qty` (variante, sinon produit, sinon 0 avec avertissement au commerçant).
- `CarrierAccount` : `manual` (livreur interne ou transporteur sans API) et adaptateurs (point d'intégration, comme les passerelles) : `gozem`, `yango`, `dhl`, `laposte_bj`. Interface `src/lib/carriers/types.ts` :
  ```ts
  type CarrierAdapter = {
    quote?(i): Promise<Quote[]>;
    createShipment(i): Promise<{ providerRef; trackingNumber?; labelUrl? }>;
    cancel(ref): Promise<void>;
    track(ref): Promise<TrackingEvent[]>;
    verifyWebhook?(raw, headers): ParsedEvent | null;
  };
  ```
  Identifiants chiffrés (`encryptSecret`).
- **Expéditions** (`Shipment`) : partielles possibles (`ShipmentItem` ≤ quantité restante à expédier) ; `Order.fulfillmentStatus` calculé (`UNFULFILLED`, `PARTIAL`, `FULFILLED`).
- **Machine d'états** :
  ```
  PENDING → LABEL_CREATED → PICKED_UP → IN_TRANSIT → OUT_FOR_DELIVERY → DELIVERED
                 │              │            │               └─► FAILED_ATTEMPT ─► OUT_FOR_DELIVERY | RETURNED
  PENDING | LABEL_CREATED ─► CANCELLED                          (RETURNED : remise en stock via F4 du lot 1)
  ```
  - `canTransitionShipment` est la source de vérité ; les statuts d'un transporteur sont **ordonnés** (comme les paiements : un événement tardif ne rétrograde pas).
  - Toutes les expéditions `DELIVERED` : `transitionOrder` vers `DELIVERED` (fidélité, avis…). Une expédition `OUT_FOR_DELIVERY` : commande `OUT_FOR_DELIVERY` si possible.
- **Étiquette interne** (transporteurs `manual`) : page imprimable A6 / 100×150 mm avec expéditeur, destinataire, repère, téléphone masqué partiellement, référence, poids, QR du lien de suivi (`src/lib/qr`) et code-barres Code 128 SVG (`src/lib/shipping/code128.ts`, pur, sans dépendance).
- **Preuve de remise anti-fraude** :
  - `Shipment.deliveryCodeHash` : code à 4 chiffres envoyé à l'acheteur (WhatsApp ou page de suivi) ;
  - page livreur `/livraison/[shipmentToken]` (jeton aléatoire, expire 7 jours après création) : « Récupéré », « Livré » avec le code de l'acheteur (5 essais) ou photo de preuve (stockage objet), « Échec » avec motif ;
  - géolocalisation facultative (consentement du livreur).
- **Suivi acheteur** : `/suivi/[token]` affiche les expéditions et leur chronologie (`ShipmentEvent`). Webhooks transporteurs `/api/webhooks/carriers/[carrier]` : HMAC, idempotence `(shipmentId, providerEventId)`.

## 2. F10 : Caisse en magasin (PWA hors ligne)
- **Accès** : `/caisse/[storeId]` (sous l'espace marchand, session membre) avec capacité `pos.sell` (OWNER, MANAGER, STAFF) ; appareils enregistrés (`PosDevice`, jeton haché, révocable, lié à un dépôt). Une session de caisse (`PosSession`) est ouverte avec un fond de caisse et fermée avec un comptage.
- **Hors ligne** :
  - service worker dédié `/caisse/sw.js` (portée `/caisse/`) ;
  - instantané du catalogue (produits actifs, variantes, codes-barres, prix, stock du dépôt, remises automatiques, taux de TVA) dans IndexedDB, version et date ; rafraîchi toutes les 15 min en ligne ;
  - au-delà de 72 h sans synchronisation, vente bloquée (« Reconnectez la caisse ») ;
  - ventes hors ligne en file IndexedDB avec clé d'idempotence UUID v4 générée sur l'appareil, puis `POST /api/pos/[storeId]/sales` par lots de 20 (en-tête `Axi-Pos-Device`).
- **Vente** :
  - scan (API `BarcodeDetector` si disponible, sinon saisie ou lecteur clavier USB/Bluetooth) ;
  - recherche, quantités, remise manuelle (plafonnée par rôle : STAFF ≤ 10 %, MANAGER ≤ 50 %, au-delà code du gérant) ;
  - client facultatif (téléphone : points, avoir via `customers.manage`) ;
  - cartes cadeaux (lot 1) ;
  - TVA (lot 2).
- **Paiements multiples** (`PaymentAttempt` par moyen : `pos_cash`, `pos_momo` avec référence, `pos_card` terminal externe avec référence) ; rendu de monnaie calculé (espèces arrondies à 5 FCFA si réglage).
- **Commande** : `channel POS`, `fulfillmentType PICKUP`, `status DELIVERED` immédiat (vente au comptoir), `paymentStatus PAID`, `locationId` du dépôt, `posSessionId`, `offlineCreatedAt`.
- **Prix hors ligne (exception contrôlée à « jamais de prix client »)** :
  - le serveur recalcule TOUT avec le pipeline à la date `offlineCreatedAt` ;
  - si le résultat diffère de l'instantané, la vente est enregistrée au prix encaissé (l'argent est en caisse) avec `priceSource = "offline_snapshot"`, l'écart dans `OrderEvent` et `audit("pos.price_mismatch")`, et un signalement dans le rapport de session ;
  - toute vente en ligne est recalculée côté serveur avant encaissement (aucun écart possible).
- **Stock** : décrément du dépôt et de l'agrégat ; hors ligne, une survente (stock < 0) est acceptée (la marchandise est déjà remise), avec mouvement, alerte et audit.
- **Reçu** : impression navigateur (CSS 58 et 80 mm) et/ou envoi WhatsApp (lien `wa.me` avec lien de suivi) ; mentions fiscales du lot 2 ; facture à la demande.
- **Clôture** : espèces attendues = fond + encaissements espèces − rendus − sorties ; écart = compté − attendu ; rapport Z (ventes par moyen, remises, taxes, écarts de prix hors ligne) ; une session ne se ferme pas tant que des ventes ne sont pas synchronisées sur l'appareil.
- **Retour en caisse** : crée un `ReturnRequest` (lot 1) directement `RECEIVED` et le résout (remboursement espèces, avoir ou échange).
- **Cas limites** : deux appareils hors ligne vendent la dernière unité (deux ventes acceptées, stock −1, alerte) ; appareil révoqué avec ventes en file (synchronisation acceptée 24 h après révocation pour ne pas perdre d'encaissement, puis refus) ; changement de prix pendant le hors-ligne (écart signalé) ; horloge de l'appareil faussée (`offlineCreatedAt` borné entre la dernière synchronisation et la réception, sinon `receivedAt`).

## 3. Modèle de données (diff Prisma exact, additif)

```prisma
enum LocationType {
  WAREHOUSE
  STORE
  PICKUP_POINT
}

enum TransferStatus {
  DRAFT
  IN_TRANSIT
  RECEIVED
  CANCELLED
}

enum ShipmentStatus {
  PENDING
  LABEL_CREATED
  PICKED_UP
  IN_TRANSIT
  OUT_FOR_DELIVERY
  DELIVERED
  FAILED_ATTEMPT
  RETURNED
  CANCELLED
}

enum FulfillmentStatus {
  UNFULFILLED
  PARTIAL
  FULFILLED
}

enum PosSessionStatus {
  OPEN
  CLOSED
}

enum InventoryReason {
  ADJUSTMENT
  SALE
  CANCEL
  RETURN
  IMPORT
  TRANSFER // +
  RECEIVE  // +
  COUNT    // +
}

enum OrderChannel {
  STORE
  WHATSAPP
  MANUAL
  POS // +
}

model Store {
  // …
  locations         Location[]
  inventoryLevels   InventoryLevel[]
  stockTransfers    StockTransfer[]
  carrierAccounts   CarrierAccount[]
  shippingRates     ShippingRate[]
  shipments         Shipment[]
  posDevices        PosDevice[]
  posSessions       PosSession[]
}

model DeliveryZone {
  // …
  locationId String? // + dépôt qui sert la zone
  location   Location? @relation(fields: [locationId], references: [id], onDelete: SetNull)
  rates      ShippingRate[]
}

model InventoryMovement {
  // …
  locationId String?   // +
  location   Location? @relation(fields: [locationId], references: [id], onDelete: SetNull)
  @@index([storeId, locationId, createdAt]) // +
}

model Order {
  // …
  locationId        String?           // +
  shippingRateId    String?           // +
  shippingRateName  String?           // +
  fulfillmentStatus FulfillmentStatus @default(UNFULFILLED) // +
  posSessionId      String?           // +
  posDeviceId       String?           // +
  offlineCreatedAt  DateTime?         // +
  priceSource       String?           // + server | offline_snapshot
  shipments         Shipment[]
}

model OrderItem {
  // …
  locationId    String? // +
  shipmentItems ShipmentItem[]
}

model Product { /* … */ inventoryLevels InventoryLevel[] }
model Variant { /* … */ inventoryLevels InventoryLevel[] }

model Location {
  id                   String              @id @default(cuid())
  storeId              String
  name                 String
  type                 LocationType        @default(WAREHOUSE)
  address              String?
  city                 String?
  country              String              @default("BJ")
  phone                String?
  latitude             Decimal?            @db.Decimal(9, 6)
  longitude            Decimal?            @db.Decimal(9, 6)
  isDefault            Boolean             @default(false)
  active               Boolean             @default(true)
  fulfillsOnlineOrders Boolean             @default(true)
  pickupEnabled        Boolean             @default(false)
  position             Int                 @default(0)
  createdAt            DateTime            @default(now())
  updatedAt            DateTime            @updatedAt
  store                Store               @relation(fields: [storeId], references: [id], onDelete: Cascade)
  levels               InventoryLevel[]
  zones                DeliveryZone[]
  movements            InventoryMovement[]
  transfersOut         StockTransfer[]     @relation("TransferFrom")
  transfersIn          StockTransfer[]     @relation("TransferTo")
  shipments            Shipment[]
  posDevices           PosDevice[]

  @@unique([storeId, name])
  @@index([storeId, active])
}

model InventoryLevel {
  id         String   @id @default(cuid())
  storeId    String
  locationId String
  productId  String
  variantId  String?
  itemKey    String // variantId ?? productId
  available  Int      @default(0)
  updatedAt  DateTime @updatedAt
  store      Store    @relation(fields: [storeId], references: [id], onDelete: Cascade)
  location   Location @relation(fields: [locationId], references: [id], onDelete: Cascade)
  product    Product  @relation(fields: [productId], references: [id], onDelete: Cascade)
  variant    Variant? @relation(fields: [variantId], references: [id], onDelete: Cascade)

  @@unique([locationId, itemKey])
  @@index([storeId, productId])
}

model StockTransfer {
  id             String              @id @default(cuid())
  storeId        String
  reference      String // TR-XXXXXX
  fromLocationId String
  toLocationId   String
  status         TransferStatus      @default(DRAFT)
  note           String?
  createdById    String?
  shippedAt      DateTime?
  receivedAt     DateTime?
  createdAt      DateTime            @default(now())
  updatedAt      DateTime            @updatedAt
  store          Store               @relation(fields: [storeId], references: [id], onDelete: Cascade)
  fromLocation   Location            @relation("TransferFrom", fields: [fromLocationId], references: [id], onDelete: Restrict)
  toLocation     Location            @relation("TransferTo", fields: [toLocationId], references: [id], onDelete: Restrict)
  items          StockTransferItem[]

  @@unique([storeId, reference])
  @@index([storeId, status])
}

model StockTransferItem {
  id               String        @id @default(cuid())
  transferId       String
  productId        String
  variantId        String?
  quantity         Int
  receivedQuantity Int           @default(0)
  transfer         StockTransfer @relation(fields: [transferId], references: [id], onDelete: Cascade)

  @@index([transferId])
}

model CarrierAccount {
  id                   String         @id @default(cuid())
  storeId              String
  carrier              String // manual | gozem | yango | dhl | laposte_bj
  name                 String
  credentialsEncrypted String?
  settings             Json?
  active               Boolean        @default(true)
  createdAt            DateTime       @default(now())
  updatedAt            DateTime       @updatedAt
  store                Store          @relation(fields: [storeId], references: [id], onDelete: Cascade)
  rates                ShippingRate[]
  shipments            Shipment[]

  @@index([storeId])
}

model ShippingRate {
  id               String          @id @default(cuid())
  storeId          String
  zoneId           String
  carrierAccountId String?
  name             String
  minWeightGrams   Int?
  maxWeightGrams   Int?
  minSubtotal      Int?
  maxSubtotal      Int?
  price            Int
  freeAbove        Int?
  etaLabel         String?
  active           Boolean         @default(true)
  position         Int             @default(0)
  store            Store           @relation(fields: [storeId], references: [id], onDelete: Cascade)
  zone             DeliveryZone    @relation(fields: [zoneId], references: [id], onDelete: Cascade)
  carrierAccount   CarrierAccount? @relation(fields: [carrierAccountId], references: [id], onDelete: SetNull)

  @@index([storeId, zoneId, active])
}

model Shipment {
  id               String          @id @default(cuid())
  storeId          String
  orderId          String
  locationId       String?
  carrierAccountId String?
  carrier          String
  service          String?
  status           ShipmentStatus  @default(PENDING)
  trackingNumber   String?
  trackingUrl      String?
  labelUrl         String?
  providerRef      String?
  cost             Int?
  weightGrams      Int?
  courierName      String?
  courierPhone     String?
  courierToken     String?         @unique // page livreur, aléatoire
  courierTokenExpiresAt DateTime?
  deliveryCodeHash String?
  deliveryAttempts Int             @default(0)
  proofPhotoUrl    String?
  deliveredAt      DateTime?
  createdAt        DateTime        @default(now())
  updatedAt        DateTime        @updatedAt
  store            Store           @relation(fields: [storeId], references: [id], onDelete: Cascade)
  order            Order           @relation(fields: [orderId], references: [id], onDelete: Cascade)
  location         Location?       @relation(fields: [locationId], references: [id], onDelete: SetNull)
  carrierAccount   CarrierAccount? @relation(fields: [carrierAccountId], references: [id], onDelete: SetNull)
  items            ShipmentItem[]
  events           ShipmentEvent[]

  @@index([storeId, status])
  @@index([orderId])
  @@index([carrier, trackingNumber])
}

model ShipmentItem {
  id          String    @id @default(cuid())
  shipmentId  String
  orderItemId String
  quantity    Int
  shipment    Shipment  @relation(fields: [shipmentId], references: [id], onDelete: Cascade)
  orderItem   OrderItem @relation(fields: [orderItemId], references: [id], onDelete: Cascade)

  @@unique([shipmentId, orderItemId])
}

model ShipmentEvent {
  id              String         @id @default(cuid())
  shipmentId      String
  status          ShipmentStatus
  message         String?
  locationLabel   String?
  source          String // manual | courier | webhook | poll
  providerEventId String?
  occurredAt      DateTime
  createdAt       DateTime       @default(now())
  shipment        Shipment       @relation(fields: [shipmentId], references: [id], onDelete: Cascade)

  @@unique([shipmentId, providerEventId])
  @@index([shipmentId, occurredAt])
}

model PosDevice {
  id          String       @id @default(cuid())
  storeId     String
  locationId  String
  name        String
  tokenHash   String       @unique
  tokenPrefix String
  lastSeenAt  DateTime?
  lastSyncAt  DateTime?
  revokedAt   DateTime?
  createdById String?
  createdAt   DateTime     @default(now())
  store       Store        @relation(fields: [storeId], references: [id], onDelete: Cascade)
  location    Location     @relation(fields: [locationId], references: [id], onDelete: Cascade)
  sessions    PosSession[]

  @@index([storeId, revokedAt])
}

model PosSession {
  id           String            @id @default(cuid())
  storeId      String
  deviceId     String
  locationId   String
  status       PosSessionStatus  @default(OPEN)
  openedById   String
  closedById   String?
  openingFloat Int               @default(0)
  countedCash  Int?
  expectedCash Int?
  discrepancy  Int?
  report       Json? // rapport Z
  openedAt     DateTime          @default(now())
  closedAt     DateTime?
  store        Store             @relation(fields: [storeId], references: [id], onDelete: Cascade)
  device       PosDevice         @relation(fields: [deviceId], references: [id], onDelete: Cascade)
  cashMoves    PosCashMovement[]

  @@index([storeId, status])
  @@index([deviceId, openedAt])
}

model PosCashMovement {
  id        String     @id @default(cuid())
  sessionId String
  kind      String // in | out
  amount    Int
  reason    String
  actorId   String?
  createdAt DateTime   @default(now())
  session   PosSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@index([sessionId])
}
```

## 4. Fichiers, actions, routes, MCP
- **Dépôts et stock** :
  - `src/lib/locations/{actions,service}.ts` (`upsertLocation`, `setDefaultLocation`, `archiveLocation` refusé s'il reste du stock) ;
  - `src/lib/inventory/{levels,allocate,transfer,count,reconcile}.ts`, actions `createTransfer`, `shipTransfer`, `receiveTransfer`, `cancelTransfer`, `submitCount` (`products.manage`, audit) ;
  - pages `/app/[storeId]/depots/**`, `/app/[storeId]/stock/transferts/**` ;
  - `scripts/migrate-locations.ts`.
- **Expédition** :
  - `src/lib/shipping/{rates,state,label,code128,actions}.ts` (`upsertShippingRate`, `createShipment`, `updateShipmentStatus`, `cancelShipment`, `printLabel`), `src/lib/carriers/**` (types, `manual`, adaptateurs) ;
  - routes `/app/[storeId]/commandes/[orderId]/expeditions/**`, `/app/[storeId]/livraison/tarifs/**`, `/app/[storeId]/livraison/transporteurs/**`, `src/app/livraison/[token]/page.tsx`, `src/app/api/webhooks/carriers/[carrier]/route.ts` ;
  - `/suivi/[token]` : composant `shipment-timeline.tsx`.
- **Caisse** :
  - `src/app/caisse/[storeId]/**` (interface client, mise en page plein écran), `src/app/caisse/sw.js/route.ts`, `src/app/caisse/manifest.webmanifest/route.ts` ;
  - `src/lib/pos/{offline-store,sync,session,receipt,actions}.ts` ;
  - `src/app/api/pos/[storeId]/{catalog,sales,sessions}/route.ts` ;
  - capacité `pos.sell` (`permissions.ts`).
- **Jobs** : `inventory.reconcile`, `shipment.poll` (transporteurs sans webhook), `shipment.status_changed` (notification acheteur), `pos.session_report`.
- **MCP** :
  - `list_locations`, `get_inventory_levels` (catalog:read) ;
  - `transfer_stock` (inventory:write, confirmation au-delà de 50 unités) ;
  - `create_shipment`, `update_shipment_status` (orders:write) ;
  - `pos_daily_report` (analytics:read).

## 5. Plans
Nouvelles limites : `locations`, `posDevices` ; fonctions `shippingLabels`, `carrierApi`, `stockTransfers`.

| Fonction | Gratuit | Starter | Business | Scale | Enterprise |
|---|---|---|---|---|---|
| Dépôts | 1 | 1 | 2 | 10 | illimité |
| Tarifs par poids et montant | non | oui | oui | oui | oui |
| Étiquettes internes, page livreur, code de remise | non | non | oui (`couriers`) | oui | oui |
| API transporteurs | non | non | non | oui (`carriers`) | oui |
| Caisse (appareils) | non | non | 1 | 5 (`pos`) | illimité |

## 6. Sécurité
- Isolation `storeId` (dépôts, niveaux, expéditions, appareils).
- Jetons livreur et appareil aléatoires et hachés, avec expiration et révocation.
- Code de remise : 5 essais, puis blocage et alerte.
- Webhooks transporteurs : HMAC, idempotence.
- Caisse : appareil, session et membre vérifiés à chaque synchronisation ; plafonds de remise par rôle ; écarts de prix et survente audités ; rapport Z immuable.
- Données personnelles minimisées sur l'étiquette et la page livreur (prénom et téléphone partiellement masqué, numéro complet via un bouton « Appeler » journalisé).

## 7. Tests
- **Vitest** :
  - `inventory-allocate.test.ts` ;
  - `inventory-invariant.test.ts` (Σ niveaux = agrégat après vente, annulation, retour, transfert, comptage) ;
  - `transfer-state.test.ts` ;
  - `shipping-rates.test.ts` (poids, montant, seuils) ;
  - `shipment-state.test.ts` (ordre, non-rétrogradation) ;
  - `code128.test.ts` (vecteurs) ;
  - `courier-code.test.ts` ;
  - `pos-sync.test.ts` (idempotence UUID, écart de prix, survente, appareil révoqué, horloge) ;
  - `pos-cash.test.ts` (attendu, écart, arrondi à 5) ;
  - `security-lot3.test.ts`.
- **E2E** `e2e/10-lot3.spec.ts` :
  - deux dépôts, commande affectée au dépôt de la zone, expédition partielle et étiquette, page livreur avec code ;
  - caisse : vente en ligne, passage hors ligne (contexte réseau Playwright coupé), vente, retour du réseau et synchronisation sans doublon, clôture avec rapport Z.

## 8. Équipes et vague de schéma
- **S3** (unique) : schéma et migration `*_lot3_operations`, `scripts/migrate-locations.ts`, `plans.ts`, `permissions.ts` (`pos.sell`), `jobs.ts` (registre), seed.

| Équipe | Propriété exclusive |
|---|---|
| A. Stock multi-dépôts et cœur commerce (seule propriétaire de `src/lib/commerce/**` pendant le lot) | `src/lib/commerce/**`, `src/lib/locations/**`, `src/lib/inventory/**`, `/app/[storeId]/depots/**`, `/app/[storeId]/stock/**` ; expose `createPosOrder(tx, input)` et `allocateLocations` |
| B. Expédition et transporteurs | `src/lib/shipping/**`, `src/lib/carriers/**`, `src/app/livraison/**`, `src/app/api/webhooks/carriers/**`, `/app/[storeId]/livraison/{tarifs,transporteurs}/**`, `/app/[storeId]/commandes/[orderId]/expeditions/**`, timeline de suivi |
| C. Caisse | `src/app/caisse/**`, `src/lib/pos/**`, `src/app/api/pos/**` |
| D. MCP, recette et docs | `src/lib/mcp/merchant/operations.ts`, enregistrement dans `server.ts`, E2E, `docs/GUIDE-BOUTIQUE.md`, `docs/RECETTE.md` |
