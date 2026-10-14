# Équipe C : devises, taxes dans le pipeline, checkout (lot 2 B)

> Consolidé dans `docs/GUIDE-BOUTIQUE.md`, `docs/RECETTE.md`, `docs/ARCHITECTURE.md`, `docs/CONSTRUCTEUR-BOUTIQUE.md`, `docs/DEPLOIEMENT.md`, `docs/FEUILLE-DE-ROUTE.md`. Ce fichier reste comme historique.

Spécification : `docs/specs/LOT-2-international-contenu.md` §1.2 (devises) et §2 (taxes, calcul) ; pipeline normatif :
`docs/specs/LOT-1-ventes-fidelite.md` §0.

## 1. Guide commerçant

### Devises (`/app/{storeId}/devises`, menu « Devises »)
- Plan : Gratuit 0 devise affichée, Starter 1, Business 3, Scale 10, Enterprise illimité (`multiCurrency`, `limits.currencies`).
  Après une rétrogradation, les N premières devises (ordre d'activation) restent affichées, les autres sont conservées.
- **Ajouter une devise** : l'euro et le franc CFA de l'autre zone (parités fixes BCEAO) et les devises publiées par la BCE
  ont un taux automatique. Les autres (naira, cedi, dirham…) sont créées désactivées en mode manuel : saisissez un taux.
- **Taux** :
  - automatique : parités fixes 1 € = 655,957 FCFA (XOF et XAF), XOF = XAF ; autres devises : BCE quotidienne ;
  - manuel : « 1 unité affichée = x FCFA », ne périme jamais (sous la responsabilité du commerçant) ;
  - un taux automatique de plus de 72 h n'est plus utilisé : la boutique s'affiche en FCFA (statut « Taux de plus de 72 h »).
- **Marge de change** : 0 à 5 %. **Arrondi** des prix et de la livraison (jamais des remises ni des taxes) :
  au plus proche, multiple supérieur de 5 / 10 / 25 / 50 / 100 unités, ou terminaison ,99 / ,95 (devises à centimes).
- **Prix fixés** (produits sans variantes) : un prix rond par devise (ex. 15 €) remplace la conversion ; une promotion
  datée en cours reste prioritaire (elle est convertie).
- Ce que voit le client : un sélecteur de devise (en-tête et checkout). Les remises, paliers, minimum de coupon et
  livraison offerte sont **toujours évalués en FCFA** ; les montants sont ensuite convertis. Au paiement, le client lit
  « Vous serez débité de 6 560 FCFA (≈ 10,00 €) » : le Mobile Money et les moyens manuels sont toujours débités en FCFA.
  Les cartes cadeaux ne s'utilisent qu'en FCFA (message clair si l'affichage est en euros).

### Taxes au checkout
- Réglages (équipe T, `/parametres/taxes`) : `taxesEnabled`, TTC/HT, taux par pays et catégorie. Le pays de taxation est
  `Store.country`.
- Checkout TTC : « dont TVA (18 %) » sous le total. HT : ligne « TVA (18 %) » ajoutée avant le total.
  Régime TPS / autre sans taux : mention « TVA non applicable » (ou la mention saisie).
- Case « Facture au nom d'une entreprise » (raison sociale obligatoire, numéro fiscal IFU/NIF facultatif), proposée
  quand la boutique applique les taxes ; stockée dans `Order.buyerCompany` / `buyerTaxId`.

## 2. Architecture

| Fichier | Rôle |
|---|---|
| `src/lib/currency/rounding.ts` | Règles d'arrondi (pur, BigInt). |
| `src/lib/currency/convert.ts` | Taux = fraction exacte BigInt (10 décimales en entrée), parités fixes, pivot EUR, marge, conversion, cotation `Cart.fxQuote`. |
| `src/lib/currency/present.ts` | `presentCart(priced, fx, { fixedUnitPrices, tax })` : conversion APRÈS le pipeline ; `presentPrice`, `presentCompareAt`. |
| `src/lib/currency/payment.ts` | `chargePlan`, mention « Vous serez débité de… ». |
| `src/lib/currency/pick.ts` | Choix de la devise : cookie `axi_cur` → `x-vercel-ip-country` → `Accept-Language` → devise boutique. |
| `src/lib/currency/ecb.ts` | Analyse du XML BCE (pur). |
| `src/lib/currency/rates.ts` | Lecture des taux (mémo 60 s), devises actives par plan, `refreshPlatformRates`, `scheduleDailyFxRefresh`. |
| `src/lib/currency/display.ts` | Devise de l'acheteur courant, `getCurrencyPickerData(store)`. |
| `src/lib/currency/actions.ts` | Actions commerçant et admin (voir §4). |
| `src/lib/currency/jobs.ts` | Gestionnaire `fx.refresh`. |
| `src/lib/commerce/checkout-pipeline.ts` | Étape 7 : `taxesFor` → `computeTaxes` (équipe T) ; `taxTotal`, `taxLines`, `taxesIncluded`, taxes par ligne. |
| `src/lib/commerce/checkout-context.ts` | Taxes de la boutique (plan compris), devise d'affichage et cotation verrouillée, prix fixés. |
| `src/lib/commerce/domain-events.ts` | Charge minimale des webhooks de commande (sans données personnelles). |
| `src/components/storefront/currency-picker.tsx` | Sélecteur client (cookie puis `router.refresh()`). |

### Formule et invariants
```
taux effectif = taux × (10 000 + markupBps) / 10 000        (fraction exacte, aucun flottant)
brutMinor     = montantMinor × taux effectif × 10^(décimales cible − décimales base)
prix, livraison : règle d'arrondi ; remises, avoir : au plus proche (Math.round) ; taxes : recalculées (§2)
```
- XOF → EUR = 1000 / 655957 exactement : 655 957 FCFA = 1 000,00 € ; 6 560 FCFA = 10,00 €.
- `presentCart` : ligne = unitaire converti × quantité ; chaque remise convertie puis répartie au prorata de ses
  allocations d'origine (plus fort reste), plafonnée par le reste de la ligne ; total affiché = Σ nets + livraison
  (+ taxes si HT), somme exacte des éléments affichés (testé).
- Taxes : `computeTaxes` sur les nets APRÈS toutes les remises allouées (fidélité comprise), arrondi par ligne ;
  cartes cadeaux toujours exonérées ; TTC : total inchangé ; HT : total = net + livraison + taxes. Les tenders
  couvrent les taxes, jamais les lignes carte cadeau.

### Commande (`createOrder`)
- Montants TOUJOURS calculés et enregistrés en devise boutique (`total`, `amountDue`, rapports inchangés).
- Lot 2 : `taxTotal`, `taxesIncluded`, `taxLines` ; `OrderItem.taxAmount`, `taxRateBps`, `presentmentUnitPrice`.
- Instantané : `presentmentCurrency`, `presentmentRate` (10 décimales, marge comprise), `presentmentTotal`,
  `presentmentAmounts` = `PresentedCart` + `source` + `charge` (devise, montant et mention d'encaissement).
- Devise d'affichage relue côté serveur (cookie), jamais du formulaire. Cotation : `Cart.fxQuote` écrite par l'aperçu
  quand un panier serveur existe (après saisie du téléphone), valable 15 min et relue par `createOrder` ; sinon taux
  courant. Devise désactivée ou taux périmé pendant le checkout : repli en FCFA avec message (aperçu), commande sans
  instantané.
- `PaymentAttempt` : devise/montant du `chargePlan` (aujourd'hui toujours la devise boutique, voir §5).

### Webhooks (contrat équipe W)
`emitDomainEvent(tx, storeId, event, data)` dans la même transaction :
- `createOrder` : `order.created` ; `order.paid` si réglée entièrement par carte cadeau / avoir ;
- `createExchangeOrder` : `order.created` (+ `order.paid` si couverte par l'avoir d'échange) ;
- `transitionOrder` : `order.status_changed` ; `order.cancelled` en plus à l'annulation.
Charge : `orderEventData` (id, référence, statuts, montants, devises, canal, mode, date) ; aucune coordonnée.

### Rafraîchissement des taux (`fx.refresh`)
- Source : `https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml` (HTTPS, sans clé, délai 10 s, pas de
  redirection). **Point d'intégration** : `FX_ECB_URL` (HTTPS uniquement) pour un miroir ; `FX_REFRESH_DISABLED=1` pour
  n'écrire que les parités fixes (environnements sans Internet).
- Échec réseau ou fichier illisible : le job échoue (retenté puis DEAD), les anciens taux restent et deviennent
  inaffichables après 72 h.
- Planification : `scheduleDailyFxRefresh()` (une fois par jour UTC, réservation dans `PlatformSetting`
  `fx.daily_refresh`). Appelée paresseusement par la vitrine quand le dernier taux BCE a plus de 24 h. À brancher
  aussi dans le cron (fichier hors périmètre) : dans `src/app/api/jobs/run/route.ts`, à côté de
  `scheduleDailyGiftCardSweeps()` :
  `try { await (await import("@/lib/currency/rates")).scheduleDailyFxRefresh(); } catch (e) { console.error("[jobs/run] fx", e); }`
- Taux manuels plateforme : `adminSetPlatformRate`, `adminRefreshFxRates` (`settings.manage`, audit `admin.fx.*`), à
  brancher sur un écran admin (hors périmètre).

## 3. Intégration du sélecteur (équipe T3)
Dans l'en-tête de la vitrine (composant serveur qui dispose de `store` avec `subscription`) :
```tsx
import { getCurrencyPickerData } from "@/lib/currency/display";
import { CurrencyPicker } from "@/components/storefront/currency-picker";
const currency = await getCurrencyPickerData(store).catch(() => null);
// …
{currency && <CurrencyPicker {...currency} compact />}
```
Ligne à ajouter dans l'en-tête : `{currency && <CurrencyPicker {...currency} compact />}`. Rien ne s'affiche s'il n'y a
qu'une devise. Pour convertir les prix des cartes et fiches produit : `getDisplayCurrency(store)` puis
`presentPrice(price, fx, fixed)` et `presentCompareAt(compareAt, shown, fx, fixedCompareAt)` (`src/lib/currency/present.ts`),
formatés avec `formatMoney(amount, fx.quote)`.

## 4. Actions serveur
| Action | Capacité | Audit |
|---|---|---|
| `addStoreCurrency`, `updateStoreCurrency`, `removeStoreCurrency` | `store.settings` + plan | `currency.enabled/updated/removed` |
| `upsertProductPrice`, `deleteProductPrice` | `products.manage` | `product.price_fixed/unfixed` |
| `adminSetPlatformRate`, `adminRefreshFxRates` | admin `settings.manage` | `admin.fx.rate_set`, `admin.fx.refresh` |

## 5. Limites connues et points d'intégration
- **Encaissement en devise étrangère** : `initiateGatewayPayment` (équipe P1) initie toujours `amountDue` en
  `order.currency`. `GATEWAY_PRESENTMENT_CHARGE = false` (`src/lib/currency/payment.ts`) : tout est encaissé en FCFA avec
  la mention, ce qui est exact pour l'acheteur. Pour l'activer : initier avec `attempt.amount` / `attempt.currency`, puis
  passer le drapeau à true (les passerelles acceptant la devise sont lues dans `PaymentMethod.currencies`).
- **Événements de paiement et de remboursement** : `confirmManualPayment`, `applyAttemptStatus` et `requestRefund` vivent
  dans `src/lib/payments/service.ts` (équipe P1). Lignes à ajouter dans leurs transactions :
  `await emitDomainEvent(tx, storeId, "order.paid", orderEventData(updated))` et
  `await emitDomainEvent(tx, storeId, "order.refunded", { ...orderEventData(order), refundId: refund.id, amount })`.
- **Remboursement au prorata de `presentmentAmounts`** (affichage en devise étrangère) : non implémenté côté
  remboursement (fichier P1) ; l'instantané contient toutes les données nécessaires.
- Prix fixés limités aux produits sans variantes (le modèle `ProductPrice.itemKey` accepte déjà les variantes).
- Pages merci / suivi (hors périmètre) : afficher `presentmentTotal` à titre indicatif si souhaité.
- Écart d'arrondi des taxes par ligne : ≤ 1 unité par ligne par rapport à un calcul global (assumé, §2).

## 6. Recette
1. `/devises` : ajouter EUR → statut « Affichée », « 1 EUR = 655,957 FCFA (parité fixe BCEAO) », exemple
   « 10 000 FCFA ≈ 15,24 € ». Passer en NEAREST_5 : les prix deviennent des multiples de 5 €.
2. Vitrine, checkout, sélecteur → EUR : récapitulatif en €, mention « Vous serez débité de … FCFA (≈ … €) » ; choisir
   MTN MoMo : « Montant à envoyer : … FCFA ».
3. Commander : la commande a `total` en FCFA, `presentmentCurrency = EUR`, `presentmentTotal`, une note « Affiché en EUR… »,
   la tentative de paiement en XOF.
4. Taxes TTC 18 % : « dont TVA (18 %) » ; HT : ligne « TVA (18 %) » et total majoré.
5. Carte cadeau avec affichage en euros : message « Les cartes cadeaux s'utilisent uniquement dans la devise de la boutique ».
6. Taux BCE vieux de plus de 73 h (modifier `fetchedAt`) : la devise BCE disparaît du sélecteur, l'euro reste (parité fixe).

Tests : `tests/currency-convert.test.ts`, `tests/checkout-pipeline-taxes.test.ts`, `tests/checkout-lot2.test.ts`.
