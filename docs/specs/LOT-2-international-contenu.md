# Lot 2 : international et contenu (spécification d'implémentation)

Dépend du lot 1 (pipeline de prix, répartition `allocateProRata`, `OrderItem.discountAllocated`). Accord du porteur sur les fichiers protégés : accordé le 11/10/2026.

## 1. F5 : Boutique multilingue et multi-devises

### 1.1 Langues
- Langues plateforme (`src/i18n/locales.ts`) : `fr`, `en`, `pt`, `es`, `ar` (droite à gauche), `wo`, `fon`, `yo`, `ha`, `sw`, `ln`, `bm`.
  - `Store.locale` = langue principale ; `Store.enabledLocales` = langues secondaires.
  - Le nombre de langues totales est limité par `PLANS[…].limits.languages` (existant : 1, 1, 2, 5, illimité).
- **URL** : langue principale sans préfixe ; langues secondaires `/{locale}/…` (ex. `/en/p/robe-wax`, ou `/s/{slug}/en/p/…` sur le domaine principal).
  - `src/proxy.ts` détecte le 1er segment ∈ langues plateforme, retire le segment et pose l'en-tête `x-axi-locale` (toujours écrasé, jamais repris du client).
  - La page retombe sur la langue principale si la langue n'est pas activée pour la boutique (404 interdite : redirection 302 vers l'URL sans préfixe).
- **Choix de langue** :
  - l'URL fait foi ;
  - cookie `axi_locale` : bandeau de suggestion uniquement, jamais de redirection automatique (SEO) ;
  - `Accept-Language` : même bandeau (« Voir la boutique en English ? »).
- **SEO** :
  - `alternates.languages` (hreflang) dans `generateMetadata` ;
  - `x-default` = langue principale ;
  - sitemap par langue ;
  - `lang` et `dir` sur la racine de la boutique (`layout.tsx`).
- **Contenus traduisibles** (`TranslatableResource`) :

| Ressource | Champs |
|---|---|
| `STORE` | name, tagline, description, orderNotes |
| `PRODUCT` | name, description, seoTitle, seoDescription, details (titre et corps par index), options (noms et valeurs) |
| `VARIANT` | name |
| `OPTION` | name (suppléments) |
| `COLLECTION` | name, description, seoTitle, seoDescription |
| `PAGE` | title, body |
| `MENU` | libellés par chemin |
| `THEME` | `templates.{tid}.sections.{sid}.settings.{k}` et `…blocks.{bid}.settings.{k}` pour les champs `text`, `textarea`, `richtext` seulement ; `settings.header.announcement.text`, `settings.footer.text` |
| `BLOG_POST`, `BLOG_CATEGORY` | voir F7 |

- **Slugs** : non traduits au lot 2 (même handle dans toutes les langues).
- **Détection d'obsolescence** : `Translation.sourceHash` = sha256 du texte source au moment de la traduction. Si le source change, la traduction est marquée « à revoir » mais reste affichée.
- **Libellés de l'interface boutique** (« Ajouter au panier »…) : dictionnaires `src/i18n/storefront/{fr,en,pt,es,ar,wo,fon,yo,ha,sw,ln,bm}.ts`. Toute clé absente retombe sur `fr`. fr et en sont complets au lancement ; les langues locales sont partielles et validées par des locuteurs (critère de terminé).
- **Rendu** : `localizeThemeDocument(doc, translations)` (pur) ne remplace que des chaînes ; il ne touche jamais aux URL, couleurs ou identifiants, et les valeurs traduites repassent par `sanitizeFieldValue`.
- **Traduction par IA** :
  - action `translateResources({ locale, resourceType, ids[] })` ;
  - coût **1 crédit IA par tranche de 1 500 caractères source** (minimum 1), lots ≤ 20 000 caractères, débit avant appel, remboursement en cas d'échec (pattern de `src/lib/ai/actions.ts`) ;
  - sortie JSON `{ [clé]: traduction }` validée, Markdown préservé (`isSafeMarkdown`) ;
  - glossaire de la boutique (`Store.i18nConfig.glossary` : termes à ne pas traduire) ;
  - règles anti-invention héritées de `src/lib/ai/parse.ts` (aucun prix ni promesse ajoutés ; une phrase interdite absente du source est rejetée) ;
  - `source = AI` ; le commerçant relit (badge « Traduction automatique »).
- **Commandes** : `Order.locale` mémorisé ; notifications (e-mail, WhatsApp) dans cette langue si un modèle existe, sinon `fr`.
- **Cas limites** :
  - langue désactivée alors que des liens circulent : 302 ;
  - contenu non traduit : repli sur la langue principale, sans mélange visible dans un même champ ;
  - arabe : `dir="rtl"` et contrôle des sections (carrousels inversés) ;
  - quota de langues réduit après une baisse de plan : les langues en trop sont désactivées et les traductions conservées.

### 1.2 Devises
- `StoreCurrency` par devise activée (au-delà de `Store.currency`, la devise de règlement et de référence). Choix acheteur dans l'en-tête, cookie `axi_cur`. Proposition par défaut via `x-vercel-ip-country` si l'hébergeur le fournit, sinon langue, sinon devise de la boutique.
- **Taux** :
  - `ExchangeRate` plateforme (base vers quote), rafraîchi chaque jour par le job `fx.refresh` (source de référence BCE au format XML HTTPS, point d'intégration ; aucune clé) ;
  - parités fixes codées en dur : XOF/EUR = 655,957 ; XAF/EUR = 655,957 ; XOF/XAF = 1 (source `BCEAO_FIXED`) ;
  - taux manuel possible par boutique ;
  - un taux de plus de 72 h désactive l'affichage converti de cette devise (repli sur la devise de la boutique) ;
  - marge de change `markupBps` (0..500).
- **Formule** (arithmétique entière, `BigInt`, taux à 10 décimales) :
  ```
  tauxEff   = taux × (1 + markupBps / 10 000)
  brutMinor = montantMinorBase × tauxEff × 10^(décimalesCible − décimalesBase)
  résultat  = arrondi(brutMinor, règle)
  ```
- **Règles d'arrondi** (`RoundingRule`, appliquées aux prix catalogue et à la livraison, jamais aux remises ni aux taxes) :

| Règle | Effet |
|---|---|
| `NONE` | arrondi au plus proche de l'unité mineure |
| `NEAREST_5` / `NEAREST_10` / `NEAREST_25` / `NEAREST_50` / `NEAREST_100` | **arrondi supérieur** au multiple d'unités majeures (défaut XOF/XAF : `NEAREST_5`, conforme aux pièces) |
| `UP_TO_99` / `UP_TO_95` | arrondi supérieur à x,99 ou x,95 (devises à centimes) |

- **Prix fixés par devise** : `ProductPrice` (prioritaire sur la conversion).
- **Ordre** :
  1. le pipeline du lot 1 calcule TOUT dans la devise de la boutique (seuils, paliers, `minSubtotal`, `freeAbove` évalués en devise boutique) ;
  2. conversion : prix unitaire converti et arrondi, puis ligne = unitaire × quantité ;
  3. remises converties en `Math.round` puis réparties ;
  4. livraison convertie avec la règle ;
  5. taxes recalculées sur les montants convertis (même méthode qu'au §2) ;
  6. `presentmentTotal` = somme exacte de ces éléments.
- **Paiement** :
  - `PaymentMethod.currencies` (nouveau, vide = devise de la boutique uniquement) ;
  - si le moyen accepte la devise d'affichage (passerelle internationale), on encaisse `presentmentTotal` dans cette devise ;
  - sinon on affiche « Vous serez débité de 6 560 FCFA (≈ 10,00 €) » et on encaisse en devise boutique ;
  - le Mobile Money manuel n'est jamais converti.
- **Instantané commande** : `presentmentCurrency`, `presentmentRate`, `presentmentTotal`, `presentmentAmounts` (lignes, remises, livraison, taxes). Cotation verrouillée 15 min au checkout (`Cart.fxQuote`), puis recalcul.
- **Remboursement en devise d'affichage** : au prorata de `presentmentAmounts`. Les rapports restent en devise boutique.
- **Cas limites** : devise désactivée pendant un checkout (repli et message) ; coupon `FIXED` converti (`Math.round`) ; cartes cadeaux uniquement dans la devise de la boutique (refusées en affichage étranger, message clair) ; arrondi supérieur qui ferait dépasser un prix barré (le prix barré est converti avec la même règle).

## 2. F6 : Taxes (TVA par pays, TTC/HT, factures)
- **Réglages** :
  - `Store.taxesEnabled` (défaut `false`) ;
  - `Store.pricesIncludeTax` (défaut `true`, l'usage en Afrique francophone étant le TTC) ;
  - `Store.taxRegistration` (`{ legalName, taxId (IFU, NIF…), rccm, address, regime: "TVA" | "TPS" | "AUTRE", exemptionMention }`).
- **Taux** : `TaxRate` par pays et catégorie (`standard`, `reduced`, `exempt`).
  - Préréglages indicatifs (`src/config/taxes.ts`) : BJ 18 %, SN 18 %, CI 18 %, TG 18 %, BF 18 %, ML 18 %, NE 19 %, CM 19,25 %, GA 18 %, CG 18,9 %, GN 18 %, FR 20 %.
  - Le commerçant confirme ; mention « Axi ne fournit pas de conseil fiscal ».
- **Produit** : `Product.taxable`, `Product.taxCategory` (cartes cadeaux : `exempt`, imposé).
- **Pays de taxation** : `Store.country` au lot 2. Pays de livraison et dépôt au lot 3, via `DeliveryZone.country` si renseigné.
- **Calcul** (sur net après remises allouées, par ligne, arrondi par ligne) :
  - TTC : `taxe = round(net × bps / (10 000 + bps))` ;
  - HT : `taxe = round(net × bps / 10 000)` ;
  - livraison taxée si `appliesToShipping` ;
  - `Order.taxTotal = Σ` ; `taxLines` = regroupement par taux `{ name, rateBps, base, amount }` ;
  - prix HT : total = net + livraison + taxes ; prix TTC : total inchangé, taxes « dont TVA ».
  - L'écart d'arrondi par ligne (≤ 1 FCFA par ligne) est documenté.
- **Affichage** :
  - fiche produit « TVA incluse » ou « HT » ;
  - panier et checkout : ligne « TVA (18 %) » ou « dont TVA » ;
  - régime TPS : mention configurable « TVA non applicable ».
- **Factures** :
  - `OrderInvoice` (`INVOICE`, `CREDIT_NOTE`) ;
  - numérotation **séquentielle sans trou par boutique**, `F-{AAAA}-{000001}` et `A-{AAAA}-{000001}`, via `Store.invoiceCounter` / `creditNoteCounter` incrémentés sous verrou de ligne dans la transaction d'émission ;
  - émission automatique au passage `PAID` (paramétrable) ou manuelle ;
  - instantané JSON immuable (vendeur, acheteur, lignes HT/TVA/TTC, totaux par taux, paiement, mentions) ;
  - avoir fiscal émis à chaque remboursement.
  - Pages imprimables (CSS d'impression, aucune dépendance PDF) : `/suivi/[token]/facture`, `/app/[storeId]/commandes/[orderId]/facture`.
  - Checkout : case « Facture au nom d'une entreprise » (raison sociale, numéro fiscal), stockée en `Order.buyerCompany` / `buyerTaxId`.

## 3. F7 : Blog de la boutique
- Modèles `BlogCategory` et `BlogPost`.
- Statuts : `DRAFT`, `SCHEDULED` (`publishedAt` futur), `PUBLISHED`, `ARCHIVED`. Publication programmée résolue à la lecture (`status = PUBLISHED`, ou `SCHEDULED` avec `publishedAt ≤ now`), sans cron.
- Corps : Markdown limité (`isSafeMarkdown`), images via le stockage objet, temps de lecture calculé.
- **Routes boutique** :
  - `/s/[slug]/blog` (liste paginée, filtre par catégorie et étiquette) ;
  - `/s/[slug]/blog/[post]` ;
  - `/s/[slug]/blog/categorie/[category]` ;
  - flux `/s/[slug]/blog/rss.xml` ;
  - JSON-LD `BlogPosting` et `BreadcrumbList` ;
  - sitemap (créer `src/app/s/[slug]/sitemap.xml/route.ts` s'il n'existe pas).
- **Thème** :
  - nouveaux `TemplateId` `"blog"` et `"article"` (types.ts, `TEMPLATE_IDS` dans theme-doc.ts, défauts dans `defaults.ts` pour chaque préréglage ; `sanitizeThemeDocument` reprend le défaut pour les documents existants) ;
  - sections `main-blog` (requise, `templates: ["blog"]`), `main-article` (requise, `["article"]`, blocs : titre, méta, image, corps, partage, articles liés) ;
  - section `blog-posts` (« Derniers articles » : nombre 2..12, catégorie, disposition, image, extrait) ;
  - champ de réglage `blog_category`.
- **Marchand** : `/app/[storeId]/blog` (liste, éditeur avec aperçu, SEO, programmation, catégories). « Rédiger un brouillon avec l'IA » coûte 3 crédits, avec les mêmes garde-fous que les descriptions.
- **Cas limites** : slug en double (suffixe `-2`) ; catégorie supprimée (article sans catégorie) ; article programmé visible en aperçu par les membres.

## 4. F8 : Webhooks sortants signés et API REST d'administration

### 4.1 Webhooks
- `WebhookEndpoint` :
  - URL **https** uniquement ;
  - secret `whsec_` de 32 octets, affiché une fois, chiffré (`encryptSecret`) ;
  - liste d'événements ;
  - version `2026-10`.
- **Événements** : `order.created`, `order.updated`, `order.status_changed`, `order.paid`, `order.refunded`, `order.cancelled`, `product.created`, `product.updated`, `product.deleted`, `inventory.updated`, `customer.created`, `customer.updated`, `return.created`, `return.status_changed`, `giftcard.issued`, `app.ping`.
- **Production** : les domaines appellent `emitDomainEvent(tx, storeId, event, data)` (nouveau, `src/lib/webhooks/emit.ts`), qui crée DANS la transaction un job `webhook.fanout` ; le job crée une `WebhookDelivery` par point actif abonné (`@@unique([endpointId, eventId])`).
- **Envoi** (job `webhook.deliver`) :
  - `POST` JSON `{ id: eventId, type, created_at, store_id, api_version, data }` ;
  - en-têtes `Axi-Webhook-Id`, `Axi-Event`, `Axi-Delivery-Id`, `Axi-Signature: t={unix},v1={hex(HMAC-SHA256(secret, t + "." + corps))}` ;
  - le destinataire vérifie la tolérance de 5 min ;
  - délai 10 s, pas de redirection suivie, réponse lue jusqu'à 4 Ko ;
  - succès = 2xx.
- **Relances** : 1 min, 5 min, 30 min, 2 h, 6 h, 12 h, 24 h, puis `DEAD`. Point désactivé automatiquement après 50 échecs consécutifs sur plus de 72 h (notification au commerçant). Rejouer une livraison depuis l'interface.
- **SSRF** :
  - résolution DNS avant envoi ; refus si une IP résolue est privée, de bouclage, lien-local, CGNAT, métadonnées (169.254.169.254) ou IPv6 ULA ;
  - nouvelle vérification à chaque envoi (DNS rebinding) ;
  - ports 443 et 8443 uniquement.
- **Données** : charge minimale par défaut. Données personnelles (`customer.*`, coordonnées des commandes) envoyées uniquement si le créateur a `customers.view` et que le plan l'autorise ; avertissement à la création.

### 4.2 API REST `/api/v1`
- **Authentification** : `Authorization: Bearer axi_live_…` (jetons existants, `src/lib/mcp/auth.ts` réutilisé) ; portée = scopes ∩ plan ∩ rôle (comme le MCP) ; journal `ApiRequestLog` (`method = "REST GET /v1/orders"`) ; quotas `MCP_LIMITS` partagés.
- **Ressources** :

| Méthode | Route | Scope |
|---|---|---|
| GET | `/products`, `/products/{id}` | catalog:read |
| POST, PATCH | `/products`, `/products/{id}` | catalog:write |
| POST | `/inventory/adjustments` | inventory:write |
| GET | `/orders`, `/orders/{id}` | orders:read |
| POST | `/orders/{id}/transitions` | orders:write |
| GET | `/customers`, `/customers/{id}` | customers:read |
| GET, POST, DELETE | `/webhooks` | `webhooks:write` (nouveau) |

- **Conventions** :
  - pagination par curseur (`?limit≤100&cursor=`) ;
  - erreurs `application/problem+json` (RFC 9457) ;
  - en-tête `Idempotency-Key` obligatoire sur `POST` (stocké 24 h dans `ApiIdempotencyKey`, même clé avec un corps différent : 422) ;
  - versions par en-tête `Axi-Api-Version` (défaut `2026-10`) ;
  - mêmes règles métier que le MCP (`transitionOrder`, stock conditionnel, confirmations remplacées par `?confirm=true`).
- Documentation OpenAPI 3.1 statique : `public/api/openapi-2026-10.json`, et page `docs/API-REST.md`.

## 5. Modèle de données (diff Prisma exact, additif)

```prisma
enum TranslatableResource {
  STORE
  PRODUCT
  VARIANT
  OPTION
  COLLECTION
  PAGE
  MENU
  THEME
  BLOG_POST
  BLOG_CATEGORY
}

enum TranslationSource {
  MANUAL
  AI
  IMPORT
}

enum RoundingRule {
  NONE
  NEAREST_5
  NEAREST_10
  NEAREST_25
  NEAREST_50
  NEAREST_100
  UP_TO_99
  UP_TO_95
}

enum InvoiceKind {
  INVOICE
  CREDIT_NOTE
}

enum BlogPostStatus {
  DRAFT
  SCHEDULED
  PUBLISHED
  ARCHIVED
}

enum WebhookDeliveryStatus {
  PENDING
  SUCCEEDED
  FAILED
  DEAD
}

model Store {
  // …
  enabledLocales    String[] @default([]) // + langues secondaires
  i18nConfig        Json?                 // + { glossary: [{ term }] }
  taxesEnabled      Boolean  @default(false) // +
  pricesIncludeTax  Boolean  @default(true)  // +
  taxRegistration   Json?                    // + { legalName, taxId, rccm, address, regime, exemptionMention }
  invoiceCounter    Int      @default(0)     // +
  creditNoteCounter Int      @default(0)     // +

  translations     Translation[]
  storeCurrencies  StoreCurrency[]
  productPrices    ProductPrice[]
  taxRates         TaxRate[]
  invoices         OrderInvoice[]
  blogCategories   BlogCategory[]
  blogPosts        BlogPost[]
  webhookEndpoints WebhookEndpoint[]
  webhookDeliveries WebhookDelivery[]
  idempotencyKeys  ApiIdempotencyKey[]
}

model Product {
  // …
  taxable     Boolean @default(true)       // +
  taxCategory String  @default("standard") // + standard | reduced | exempt
  prices      ProductPrice[]
}

model PaymentMethod {
  // …
  currencies String[] @default([]) // + vide = devise de la boutique uniquement
}

model DeliveryZone {
  // …
  country String? // + ISO 3166-1 alpha-2 ; null = pays de la boutique
}

model Cart {
  // …
  locale  String? // +
  fxQuote Json?   // + { currency, rate, expiresAt }
}

model Order {
  // …
  locale              String?  // +
  presentmentCurrency String?  // +
  presentmentRate     Decimal? @db.Decimal(20, 10) // +
  presentmentTotal    Int?     // +
  presentmentAmounts  Json?    // +
  taxTotal            Int      @default(0)    // +
  taxesIncluded       Boolean  @default(true) // +
  taxLines            Json?    // + [{ name, rateBps, base, amount }]
  buyerCompany        String?  // +
  buyerTaxId          String?  // +
  invoices            OrderInvoice[]
}

model OrderItem {
  // …
  taxAmount            Int  @default(0) // +
  taxRateBps           Int?             // +
  presentmentUnitPrice Int?             // +
}

model Translation {
  id          String               @id @default(cuid())
  storeId     String
  resourceType TranslatableResource
  resourceId  String // id, handle de menu, ou "published" pour THEME
  locale      String
  field       String // chemin du champ (ex. "description", "templates.home.sections.hero-1.settings.heading")
  value       String
  source      TranslationSource    @default(MANUAL)
  sourceHash  String
  updatedById String?
  createdAt   DateTime             @default(now())
  updatedAt   DateTime             @updatedAt
  store       Store                @relation(fields: [storeId], references: [id], onDelete: Cascade)

  @@unique([storeId, resourceType, resourceId, locale, field])
  @@index([storeId, locale, resourceType])
}

model StoreCurrency {
  id         String       @id @default(cuid())
  storeId    String
  currency   String
  enabled    Boolean      @default(true)
  rateMode   String       @default("auto") // auto | manual
  manualRate Decimal?     @db.Decimal(20, 10)
  markupBps  Int          @default(0)
  rounding   RoundingRule @default(NONE)
  createdAt  DateTime     @default(now())
  updatedAt  DateTime     @updatedAt
  store      Store        @relation(fields: [storeId], references: [id], onDelete: Cascade)

  @@unique([storeId, currency])
}

model ExchangeRate {
  id        String   @id @default(cuid())
  base      String
  quote     String
  rate      Decimal  @db.Decimal(20, 10)
  source    String // ECB | BCEAO_FIXED | manual
  fetchedAt DateTime

  @@unique([base, quote])
}

model ProductPrice {
  id             String   @id @default(cuid())
  storeId        String
  productId      String
  variantId      String?
  itemKey        String // variantId ?? productId (unicité sans NULL)
  currency       String
  price          Int
  compareAtPrice Int?
  updatedAt      DateTime @updatedAt
  store          Store    @relation(fields: [storeId], references: [id], onDelete: Cascade)
  product        Product  @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@unique([itemKey, currency])
  @@index([storeId, productId])
}

model TaxRate {
  id                String   @id @default(cuid())
  storeId           String
  name              String // "TVA"
  country           String
  regionKey         String   @default("*")
  taxCategory       String   @default("standard")
  rateBps           Int // 1800 = 18 %
  appliesToShipping Boolean  @default(true)
  active            Boolean  @default(true)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  store             Store    @relation(fields: [storeId], references: [id], onDelete: Cascade)

  @@unique([storeId, country, regionKey, taxCategory])
}

model OrderInvoice {
  id        String      @id @default(cuid())
  storeId   String
  orderId   String
  kind      InvoiceKind
  number    String
  amount    Int
  taxTotal  Int
  currency  String
  snapshot  Json // instantané immuable
  refundId  String?
  issuedAt  DateTime    @default(now())
  issuedById String?
  store     Store       @relation(fields: [storeId], references: [id], onDelete: Cascade)
  order     Order       @relation(fields: [orderId], references: [id], onDelete: Cascade)

  @@unique([storeId, number])
  @@index([orderId])
}

model BlogCategory {
  id          String     @id @default(cuid())
  storeId     String
  slug        String
  name        String
  description String?
  position    Int        @default(0)
  store       Store      @relation(fields: [storeId], references: [id], onDelete: Cascade)
  posts       BlogPost[]

  @@unique([storeId, slug])
}

model BlogPost {
  id             String         @id @default(cuid())
  storeId        String
  categoryId     String?
  slug           String
  title          String
  excerpt        String?
  body           String
  coverImage     Json? // { url, alt }
  authorName     String?
  tags           String[]       @default([])
  status         BlogPostStatus @default(DRAFT)
  publishedAt    DateTime?
  seoTitle       String?
  seoDescription String?
  readingMinutes Int            @default(1)
  createdById    String?
  createdAt      DateTime       @default(now())
  updatedAt      DateTime       @updatedAt
  store          Store          @relation(fields: [storeId], references: [id], onDelete: Cascade)
  category       BlogCategory?  @relation(fields: [categoryId], references: [id], onDelete: SetNull)

  @@unique([storeId, slug])
  @@index([storeId, status, publishedAt])
}

model WebhookEndpoint {
  id                  String            @id @default(cuid())
  storeId             String
  url                 String
  description         String?
  secretEnc           String
  secretPrefix        String
  events              String[]
  apiVersion          String            @default("2026-10")
  includePersonalData Boolean           @default(false)
  active              Boolean           @default(true)
  consecutiveFailures Int               @default(0)
  disabledAt          DateTime?
  disabledReason      String?
  lastSuccessAt       DateTime?
  lastFailureAt       DateTime?
  createdById         String?
  createdAt           DateTime          @default(now())
  updatedAt           DateTime          @updatedAt
  store               Store             @relation(fields: [storeId], references: [id], onDelete: Cascade)
  deliveries          WebhookDelivery[]

  @@index([storeId, active])
}

model WebhookDelivery {
  id              String                @id @default(cuid())
  storeId         String
  endpointId      String
  eventId         String
  event           String
  payload         Json
  status          WebhookDeliveryStatus @default(PENDING)
  attempts        Int                   @default(0)
  nextAttemptAt   DateTime              @default(now())
  lastStatusCode  Int?
  lastError       String?
  responseSnippet String?
  durationMs      Int?
  deliveredAt     DateTime?
  createdAt       DateTime              @default(now())
  store           Store                 @relation(fields: [storeId], references: [id], onDelete: Cascade)
  endpoint        WebhookEndpoint       @relation(fields: [endpointId], references: [id], onDelete: Cascade)

  @@unique([endpointId, eventId])
  @@index([status, nextAttemptAt])
  @@index([storeId, createdAt])
}

model ApiIdempotencyKey {
  id             String   @id @default(cuid())
  storeId        String
  key            String
  method         String
  path           String
  requestHash    String
  responseStatus Int
  responseBody   Json
  createdAt      DateTime @default(now())
  expiresAt      DateTime
  store          Store    @relation(fields: [storeId], references: [id], onDelete: Cascade)

  @@unique([storeId, key])
  @@index([expiresAt])
}
```

## 6. Fichiers, actions, routes, MCP
- **i18n** :
  - `src/i18n/{locales,dictionary}.ts`, `src/i18n/storefront/*.ts` ;
  - `src/lib/i18n/{resolve,localize-theme,translate-ai,actions}.ts` (actions `upsertTranslation`, `deleteTranslation`, `translateResources`, `updateLanguages`, capacité `store.settings`, quota `limits.languages`) ;
  - pages `/app/[storeId]/langues/**` (tableau « source / traduction / état ») ;
  - `src/proxy.ts` (segment de langue) ;
  - `src/app/s/[slug]/layout.tsx` (`lang`, `dir`, hreflang).
- **Devises** :
  - `src/lib/currency/{convert,rounding,rates,actions}.ts` ;
  - job `fx.refresh` ;
  - `/app/[storeId]/devises/**` ;
  - sélecteur `src/components/storefront/currency-picker.tsx` ;
  - le pipeline (équipe B du lot 2) appelle `presentCart(priced, fx)`.
- **Taxes** :
  - `src/config/taxes.ts`, `src/lib/tax/{compute,invoice,actions}.ts` (`updateTaxSettings`, `upsertTaxRate`, `issueInvoice`, `issueCreditNote`) ;
  - pages `/app/[storeId]/parametres/taxes/**`, `/app/[storeId]/commandes/[orderId]/facture/page.tsx`, `/suivi/[token]/facture/page.tsx`.
- **Blog** :
  - `src/lib/blog/{service,actions}.ts` ;
  - `/app/[storeId]/blog/**`, `src/app/s/[slug]/blog/**` ;
  - sections `src/components/storefront/sections/{blog-posts,main-blog,main-article}.tsx` ;
  - schémas dans `schemas.ts`, registre.
- **Webhooks et REST** :
  - `src/lib/webhooks/{emit,deliver,sign,ssrf,actions}.ts` ;
  - `src/lib/api/{auth,problem,pagination,idempotency}.ts` ;
  - `src/app/api/v1/**/route.ts` ;
  - `/app/[storeId]/integrations/webhooks/**`.
- **Jobs** : `fx.refresh`, `webhook.fanout`, `webhook.deliver`, `idempotency.purge`.
- **MCP** :
  - `translate_content` (`content:write`, crédits IA, confirmation au-delà de 20 crédits), `list_translations_status` ;
  - `create_blog_post` (brouillon uniquement), `list_blog_posts` (nouveau scope `content:write`, Starter+) ;
  - `get_tax_settings` (store:read) ;
  - `list_webhook_deliveries` (`webhooks:write`).
  - Ressource `axi://i18n/coverage`.

## 7. Plans
Nouvelles clés : `multiCurrency`, `taxes`, `invoices`, `blog`, `webhooks`, `restApi`, `aiTranslation`. Limites : `webhookEndpoints`, `blogPosts`, `currencies`.

| Fonction | Gratuit | Starter | Business | Scale | Enterprise |
|---|---|---|---|---|---|
| Langues (existant) | 1 | 1 | 2 | 5 | illimité |
| Devises affichées | 0 | 1 | 3 | 10 | illimité |
| Taxes et factures | non | oui | oui | oui | oui |
| Blog | non | 20 articles | illimité | illimité | illimité |
| Traduction IA | non | non | oui (crédits) | oui | oui |
| Webhooks | non | non | 2 points | 10 | illimité |
| API REST | non | non | lecture | complète | complète |

## 8. Sécurité
- Isolation `storeId` partout. `x-axi-locale` toujours écrasé par le proxy. Traductions resanitisées au rendu (pas de HTML).
- Taux plateforme modifiables uniquement par admin (`settings.manage`, audit `admin.fx.*`).
- Factures immuables, compteur sous verrou, aucune suppression (avoir fiscal uniquement).
- Webhooks :
  - SSRF (§4.1) ;
  - secret chiffré, jamais renvoyé ; rotation avec double signature 24 h (`v1` ancien et nouveau) ;
  - pas de données personnelles par défaut.
- REST : jetons hachés, débits limités, idempotence, `problem+json` sans trace interne, CORS fermé.
- IA de traduction : contenu dans des balises de données, sortie filtrée.

## 9. Tests
- **Vitest** :
  - `currency-convert.test.ts` : parités exactes XOF/EUR, arrondis `NEAREST_5` supérieurs, `UP_TO_99`, marge, `BigInt` sans dérive, somme des lignes = total d'affichage ;
  - `tax-compute.test.ts` : TTC, HT, livraison, exonéré, arrondi par ligne, remises allouées ;
  - `invoice-numbering.test.ts` : concurrence, sans trou, avoirs ;
  - `i18n-localize-theme.test.ts` : seuls les champs texte remplacés, `sourceHash`, repli ;
  - `proxy-locale.test.ts` ;
  - `blog-visibility.test.ts` ;
  - `webhook-sign.test.ts` (vecteurs, tolérance) ;
  - `webhook-ssrf.test.ts` (IP privées, IPv6, rebinding simulé) ;
  - `webhook-retry.test.ts` ;
  - `api-v1-auth.test.ts` (scopes ∩ plan ∩ rôle, isolation, idempotence) ;
  - `security-lot2.test.ts`.
- **E2E** `e2e/09-lot2.spec.ts` :
  - boutique en `/en` avec hreflang ;
  - affichage EUR et commande payée en XOF avec mention ;
  - TVA 18 % TTC sur la facture imprimable ;
  - article programmé publié à l'heure ;
  - point de webhook de test (serveur local dans le test) qui reçoit `order.created` signé.

## 10. Équipes et vague de schéma
- **S2** (unique) : schéma et migration `*_lot2_international_contenu`, `plans.ts`, `scopes.ts` (`content:write`, `webhooks:write`), `jobs.ts` (registre), `types.ts` (`TemplateId` blog/article et défauts), seed.

| Équipe | Propriété exclusive |
|---|---|
| A. Langues | `src/i18n/**`, `src/lib/i18n/**`, `src/proxy.ts`, `src/app/s/[slug]/layout.tsx`, `/app/[storeId]/langues/**` |
| B. Cœur commerce (devises dans le pipeline, taxes intégrées) | `src/lib/commerce/**`, `src/lib/storefront/actions.ts`, `src/lib/currency/**`, `/app/[storeId]/devises/**`, `src/components/storefront/currency-picker.tsx` |
| C. Taxes et factures | `src/config/taxes.ts`, `src/lib/tax/**` (fonctions pures livrées à B au jour 4), pages de factures et `parametres/taxes/**` |
| D. Blog | `src/lib/blog/**`, `src/app/s/[slug]/blog/**`, `/app/[storeId]/blog/**`, sections blog, ajouts blog dans `schemas.ts` et le registre (seul éditeur de ces deux fichiers pendant le lot) |
| E. API et webhooks | `src/lib/webhooks/**`, `src/lib/api/**`, `src/app/api/v1/**`, `/app/[storeId]/integrations/webhooks/**`, outils MCP du lot (`src/lib/mcp/merchant/content.ts`) |

`emitDomainEvent` est appelé dans les domaines par leurs propriétaires : B (commandes), D (rien), le catalogue (une ligne dans `src/lib/products/*`, faite par E avec relecture).
