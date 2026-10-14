# Équipe T : taxes et factures (lot 2 C)

> Consolidé dans `docs/GUIDE-BOUTIQUE.md`, `docs/RECETTE.md`, `docs/ARCHITECTURE.md`, `docs/FEUILLE-DE-ROUTE.md`. Ce fichier reste comme historique.

Spécification : `docs/specs/LOT-2-international-contenu.md` §2, §5, §8, §9. Propriété : `src/config/taxes.ts`, `src/lib/tax/**`, `src/app/app/[storeId]/parametres/taxes/**`, `src/app/app/[storeId]/commandes/[orderId]/facture/**`, `src/app/suivi/[token]/facture/**`.

## 1. Guide commerçant

**Activer la TVA** : menu « Taxes et factures » (ou `/app/{boutique}/parametres/taxes`).
1. « Ajouter TVA 18 % (Bénin, indicatif) » crée le taux normal du pays de la boutique (préréglages : BJ, SN, CI, TG, BF, ML, GA, GN 18 % ; NE 19 % ; CM 19,25 % ; CG 18,9 % ; FR 20 %). **Axi ne fournit pas de conseil fiscal** : vérifiez vos taux avec votre comptable.
2. Activez « Collecter la TVA sur mes ventes », choisissez TTC (usage courant, le prix affiché est le prix payé, « dont TVA ») ou HT (la TVA s'ajoute au total).
3. Renseignez votre identité fiscale : raison sociale, numéro fiscal (IFU, NIF : obligatoire pour facturer la TVA), RCCM, adresse, régime (TVA, TPS, autre) et, si besoin, une mention d'exonération. En régime TPS, aucune TVA n'est collectée et les factures portent « TVA non applicable » (ou votre mention).
4. Taux supplémentaires : un taux par pays et par catégorie (normal, réduit, exonéré), livraison taxée ou non, actif ou non.
5. Produit : carte « Taxes » de la fiche produit (soumis à la TVA, catégorie fiscale), enregistrée immédiatement. Les cartes cadeaux sont toujours exonérées.

**Factures** : depuis une commande payée, `/app/{boutique}/commandes/{commande}/facture`.
- Émission automatique au paiement (option cochée par défaut) ou bouton « Émettre la facture ».
- Numéro `F-AAAA-000001`, séquentiel sans trou par boutique ; avoir `A-AAAA-000001` à chaque remboursement d'une commande facturée.
- Une facture émise ne change plus jamais (ni suppression, ni modification) : on corrige par un avoir.
- « Imprimer ou PDF » : impression navigateur (enregistrer en PDF), sans menu ni boutons.
- L'acheteur consulte ses documents par son lien de suivi : `/suivi/{jeton}/facture` (même expiration que le suivi).
- Plans : taxes et factures à partir de Starter. Une boutique rétrogradée peut seulement désactiver les taxes ; les documents émis restent consultables ; les avoirs restent émis (obligation fiscale).

## 2. Calcul (contrat pour le pipeline, `src/lib/tax/compute.ts`)

`computeTaxes({ lines: [{ net, taxable, taxCategory }], delivery: { amount }, settings: { enabled, pricesIncludeTax, rates } })`
→ `{ perLine: [{ taxAmount, taxRateBps }], shippingTax, shippingTaxRateBps, taxTotal, taxLines: [{ name, rateBps, base, amount }], taxesIncluded, addToTotal }`.

- `net` = montant de la ligne après remises allouées (`PricedCartLine.netTotal`).
- TTC : `round(net × bps / (10 000 + bps))` ; HT : `round(net × bps / 10 000)`. Arrondi par ligne, demi-unité vers le haut, arithmétique entière.
- Ligne non taxable, catégorie `exempt` ou sans taux : taxe 0, `taxRateBps` null.
- Livraison taxée au taux de la catégorie `standard` si `appliesToShipping`.
- `taxLines.base` = base **hors taxe** (TTC : net − taxe ; HT : net). `Σ taxLines.amount = taxTotal` exactement.
- `addToTotal` = `taxTotal` en HT, 0 en TTC : total = net + livraison + `addToTotal`.
- Écart d'arrondi par ligne : au plus 1 unité (FCFA) par ligne par rapport à un calcul global. Assumé.
- `loadTaxSettings(storeId, tx?)` (`src/lib/tax/settings.ts`) fournit `settings` : taux actifs du pays de la boutique (`Store.country` en majuscules, `regionKey "*"`), `enabled = false` si taxes désactivées, régime TPS ou plan sans `features.taxes`. SOURCE UNIQUE : le pipeline passe par `taxSettingsOrNull` (même module) via `checkout-context.ts`.

## 3. Architecture des factures (`src/lib/tax/invoice.ts`)

- `issueInvoiceTx(tx, { storeId, orderId, actorId })` : verrou `Order` (`FOR UPDATE`), facture existante → renvoyée (idempotent), commande PAID / PARTIALLY_REFUNDED / REFUNDED exigée, puis verrou `Store` + incrément du compteur, instantané, insertion, `OrderEvent`, `audit("invoice.issued")`, puis avoirs des remboursements antérieurs.
- `issueCreditNoteForRefundTx(tx, { storeId, refundId })` : un avoir par remboursement `DONE` (idempotent par `refundId`), seulement si la commande a une facture (sinon `null`, aucun numéro consommé). TVA de l'avoir au prorata de la facture, ventilée par taux ; le remboursement qui solde la commande solde exactement la TVA.
- **Sans trou** : le compteur est incrémenté dans la transaction qui insère le document ; un échec annule l'incrément. Unicité `(storeId, number)` en base. Compteur continu (jamais remis à zéro), l'année du numéro est l'année d'émission dans le fuseau de la boutique.
- **Ordre des verrous** : Order puis Store, identique à `requestRefund` (qui verrouille Order) : pas d'interblocage.
- Transactions `maxWait 10 s / timeout 15 s` : les émissions d'une même boutique se sérialisent sur la ligne Store ; en rafale elles attendent une connexion plutôt que d'échouer (constaté sur la vraie base avec le défaut Prisma de 2 s).
- **Instantané immuable** (`src/lib/tax/snapshot.ts`, version 1) : vendeur (raison sociale, IFU/NIF, RCCM, régime), acheteur (dont `buyerCompany`, `buyerTaxId`), lignes HT / taxe / TTC, livraison, totaux par taux, paiement, mentions. Les pages lisent exclusivement l'instantané (`src/lib/tax/invoice-document.tsx`).
- Taxes d'une commande : reprises de la commande si le pipeline les a figées (`Order.taxLines` non nul) ; sinon, en TTC, ventilation « dont TVA » calculée à l'émission (le total ne change pas, `taxSource: "computed"`) ; en HT sans taxes figées, aucune taxe (le total payé ne peut pas changer).
- Émission automatique : gestionnaire du job existant `payment.succeeded` (`src/lib/jobs.ts`) → `src/lib/tax/jobs.ts` → `autoIssueInvoiceForOrder` (plan `invoices`, option `autoIssueInvoices`, boutique qui collecte la taxe, commande payée). Le job est mis en file dans la transaction qui passe la commande à PAID sur les trois chemins (création payée, confirmation manuelle, webhook) ; en cas d'erreur le job est relancé.
- Accès : page commerçant `getStoreContext(storeId, "orders.view")` + commande filtrée par `storeId` ; page acheteur `documentsForTrackingToken` (format du jeton, existence, expiration). Émission manuelle : `orders.manage` + plan `invoices`. Réglages et taux : `store.settings` + plan `taxes`.

### Actions (`src/lib/tax/actions.ts`)
`updateTaxSettings`, `upsertTaxRate`, `deleteTaxRate`, `applyTaxPreset`, `updateProductTax`, `issueInvoiceAction`, `issueMissingCreditNotesAction`. Audit : `tax.settings_updated`, `tax.rate_created|updated|deleted`, `invoice.issued`, `invoice.credit_note_issued`.

## 4. Lignes à insérer par d'autres équipes

1. **Avoir à chaque remboursement** (équipe P1, `src/lib/payments/service.ts`, `requestRefund`, dans la transaction, juste après `await audit({ storeId, actorId, action: "payment.refunded", … }, tx);`) :
   ```ts
   await (await import("@/lib/tax/invoice")).issueCreditNoteForRefundTx(tx, { storeId, refundId: refund.id, actorId });
   ```
   En attendant : la page facture signale les remboursements sans avoir et propose « Émettre les avoirs manquants » ; l'émission d'une facture régularise aussi les remboursements antérieurs.
2. **Pipeline** (équipe C) : `computeTaxes` sur les `netTotal`, cartes cadeaux en `exempt`, `settings` de `loadTaxSettings`, total + `addToTotal`, puis `Order.taxTotal / taxesIncluded / taxLines` et `OrderItem.taxAmount / taxRateBps` depuis `perLine`.
3. **Fiche produit** (`src/app/app/[storeId]/produits/[productId]/page.tsx`, après `<ProductForm … />`) :
   ```tsx
   <ProductTaxFields storeId={ctx.store.id} productId={product.id} taxable={product.taxable} taxCategory={product.taxCategory} />
   ```
   avec `import { ProductTaxFields } from "@/lib/tax/product-tax-fields";`.
4. **Détail commande** (`src/app/app/[storeId]/commandes/[orderId]/page.tsx`, à côté du bouton « imprimer ») :
   ```tsx
   <ButtonLink href={`${base}/commandes/${order.id}/facture`} variant="outline" size="sm" className="h-11 sm:h-9">Facture</ButtonLink>
   ```
5. **Suivi acheteur** (`src/app/suivi/[token]/page.tsx`, à côté du lien retours) : lien `/suivi/${order.trackingToken}/facture` « Ma facture ».
6. **MCP** `get_tax_settings` (store:read, §6) : non livré ici (fichiers MCP hors périmètre) ; `loadTaxSettings` + `parseTaxRegistration` suffisent à l'implémenter.

## 5. Écarts au schéma

- Pas de colonne pour l'émission automatique : rangée dans `Store.taxRegistration.autoIssueInvoices` (défaut `false` quand aucune identité fiscale n'est enregistrée : activation explicite ; l'écran coche la case à la première configuration).
- Pas d'unicité en base « une facture par commande » ni « un avoir par remboursement » : garanties sous le verrou de la commande.

## 6. Recette

1. Plan Starter+, boutique au Bénin : Taxes et factures → « Ajouter TVA 18 % » → activer, TTC, IFU → Enregistrer. L'exemple affiche « dont TVA (18 %) » 1 678 pour 10 000 + 1 000.
2. Commande payée → Facture → « Émettre la facture » → `F-AAAA-000001`, « dont TVA 18 % », IFU et RCCM imprimés. Recharger : même numéro.
3. Imprimer : pas de menu ni de boutons.
4. Lien de suivi `/suivi/{jeton}/facture` sans session : même document ; jeton inconnu : « Facture introuvable » ; jeton expiré : « Lien expiré ».
5. Remboursement partiel puis total : avoirs `A-AAAA-000001`, `A-AAAA-000002` ; Σ TVA des avoirs = TVA de la facture.
6. Membre d'une autre boutique : page facture introuvable ; plan gratuit : écran d'offre.

Tests : `tests/tax-compute.test.ts` (calcul, instantané, avoirs), `tests/invoice-numbering.test.ts` (numérotation, concurrence avec verrous simulés, échec sans trou, avoirs, immutabilité, accès par jeton, isolation, plans).
