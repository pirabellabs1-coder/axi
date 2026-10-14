# Vague 2, équipe N : produits numériques et services

Propriété : `prisma/schema.prisma` (migration `20261011200000_vague2_produits_numeriques`), `src/lib/digital/**`,
`src/lib/storage/{file-keys,file-upload}.ts`, `src/app/telechargement/**`, `src/app/api/stores/[storeId]/files/**`,
`src/app/app/[storeId]/produits/digital-files.tsx`, `src/components/digital/buyer-downloads.tsx`,
plus des ajouts encadrés dans `src/lib/commerce/**`, `src/lib/products/**`, `src/lib/mcp/merchant/digital.ts`.

Avant cette vague, seules les cartes cadeaux (`Product.isGiftCard`) échappaient à la livraison : tout le reste
supposait un colis. Cette vague ajoute **trois natures de produit** (numérique, service, carte cadeau) à côté du
produit physique, avec la remise automatique des fichiers après paiement.

---

## 1. Guide commerçant

### Vendre un fichier (PDF, ZIP, EPUB, MP3, MP4, image)

1. **Produits → Ajouter un produit**. En haut de la page, « Que vendez-vous ? » : choisissez la carte
   **Produit numérique** (le formulaire s'adapte aussitôt : plus de stock, plus de poids ni d'expédition ; une carte
   **« Fichiers à remettre »** apparaît).
2. Renseignez le titre et le prix. Sur un produit existant, le type se change depuis la ligne
   « Type de produit : … · Changer » en haut du formulaire, après confirmation des conséquences.
3. **Enregistrez** le produit (un fichier s'attache à une fiche existante), puis **« Ajouter un fichier »**.
   - formats acceptés : **PDF, ZIP, EPUB, MP3, MP4, JPEG, PNG, WebP** ;
   - **50 Mo maximum par fichier**, **20 fichiers par produit** ;
   - l'espace occupé est celui de votre plan (le même compteur que les photos : 100 Mo en Gratuit, 1 Go en Starter,
     5 Go en Business, 20 Go en Scale, illimité en Enterprise ; option « Stockage +10 Go »).
4. Réglez **« Téléchargements autorisés »** (défaut 5, `0` = illimité) et **« Validité du lien »** en jours
   (défaut 365, `0` = sans date limite), puis les **instructions envoyées après l'achat** (mot de passe d'archive,
   logiciel conseillé…).
5. Si le produit a des variantes (formats, éditions), un fichier peut être **réservé à une variante** : choisissez-la
   avant d'ajouter le fichier. Les fichiers « Toutes les variantes » sont toujours remis.

**Mettre à jour un fichier** : bouton **« Remplacer »**. La fiche garde le même emplacement, sa version augmente et
**tous les acheteurs, anciens compris, téléchargent la nouvelle version** quand ils reviennent sur leur lien.

### Vendre un service

**Type : Service** (carte « Que vendez-vous ? »). Vous indiquez la durée, le lieu (ou « à distance »), une note de réservation affichée sur la
fiche, et les instructions envoyées après l'achat. Aucune livraison, aucun poids. Le **stock reste facultatif** :
activez-le pour limiter les places (atelier, session). *Il n'y a pas encore de calendrier ni de réservation de
créneau : c'est la suite prévue (voir §9).*

### Ce que vit l'acheteur

1. Il commande normalement. Si le panier ne contient **que** des produits numériques, des services ou des cartes
   cadeaux, il n'y a **ni livraison, ni retrait, ni adresse, ni frais** : la commande est en « Envoi numérique ».
2. Le **paiement à la livraison est refusé** dès qu'un fichier ou une carte cadeau est dans le panier (rien n'est
   remis avant paiement confirmé).
3. Dès que le paiement est confirmé, il reçoit **par e-mail un lien personnel** vers sa page de téléchargement
   (`/telechargement/{jeton}`), avec la liste des fichiers, le nombre de téléchargements restants et la date limite.
4. Il retrouve aussi ses fichiers **depuis le suivi de commande** (« Vos fichiers » → « Ouvrir ») et, s'il a un
   compte, dans son espace client.

### Suivre et dépanner

Fiche commande → carte **« Téléchargements »** : nombre de téléchargements utilisés, limite, expiration, dernier
téléchargement, et si l'e-mail est parti. Bouton **« Renvoyer le lien »** : un **nouveau** lien est émis et l'ancien
cesse immédiatement de fonctionner (utile si l'acheteur a perdu son e-mail ou si le lien a fuité). Sans e-mail sur la
commande, un lien WhatsApp prérempli est proposé.

### Plans

`digitalProducts` est **inclus dans tous les plans, Gratuit compris** (décision du 11/10/2026). Justification :
l'entrée de gamme ne doit pas être bridée sur un cas d'usage majeur en Afrique francophone (formations, e-books,
beats, modèles) ; la vraie limite est **l'espace de stockage du plan**, déjà en place, partagé avec les photos. Un
plan Gratuit tient ainsi ~2 e-books de 40 Mo, ce qui suffit pour démarrer et donne une raison claire de monter en
plan (espace, pas fonctionnalité).

---

## 2. Modèle de données (migration ADDITIVE)

`prisma/migrations/20261011200000_vague2_produits_numeriques` — aucune colonne ni table supprimée.

| Élément | Rôle |
|---|---|
| `enum ProductKind` | `PHYSICAL` (défaut), `DIGITAL`, `SERVICE`, `GIFT_CARD` |
| `Product.kind` | nature ; **invariant : `kind = GIFT_CARD` ⇔ `isGiftCard = true`** (la migration aligne l'existant, l'application les écrit ensemble) |
| `Product.downloadLimit`, `downloadValidityDays` | réglages du numérique (null = défauts 5 et 365 jours) |
| `Product.serviceDurationMinutes`, `serviceLocation`, `serviceRemote`, `serviceBookingNote` | prestation |
| `Product.postPurchaseInstructions` | texte envoyé après l'achat (numérique et service) |
| `OrderItem.kind` | **instantané** de la nature vendue (le produit peut changer de nature ensuite) |
| `DigitalAsset` | fichier vendu : `storeId`, `productId`, `variantId?`, `name`, `storageKey`, `bytes`, `mime`, `version`, `position` |
| `DownloadGrant` | accès d'un acheteur : `storeId`, `orderId`, `orderItemId` (**unique** = idempotence), `customerId?`, `tokenHash` (unique), `downloadCount`, `downloadLimit?`, `expiresAt?`, `lastDownloadAt?`, `lastIp?`, `notifiedAt?` |

`Product.isGiftCard` est **conservé** : tout le lot 1 (émission, limites, pipeline) continue de le lire.

**Retour arrière** : la migration est additive et sans destruction. Pour revenir en arrière, il suffit de déployer la
version précédente du code : les nouvelles colonnes gardent leurs valeurs par défaut et sont ignorées. Une
annulation complète (optionnelle, jamais nécessaire en production) serait
`DROP TABLE "DownloadGrant", "DigitalAsset"; ALTER TABLE "Product" DROP COLUMN … ; ALTER TABLE "OrderItem" DROP COLUMN "kind"; DROP TYPE "ProductKind";`
— à ne faire que si aucun accès n'a été émis.

---

## 3. Architecture

```
Commerçant ─ POST /api/stores/{id}/files (octets bruts)
   requireStore(products.manage) → plan → débit → ≤ 50 Mo → octets magiques → produit DIGITAL de la boutique
   → quota (compteur media_kb) → put(stores/{id}/files/aaaa/mm/{sha256}.ext) → DigitalAsset (version + 1 si remplacement)

Paiement confirmé (3 chemins : commande payée à la création, confirmation manuelle, webhook passerelle)
   └─ job payment.succeeded (déjà dans la transaction) ─► digital.deliver { orderId }
        └─ issueDigitalDeliveriesForOrder : PAID + non annulée (revérifié sous verrou)
             ├─ DownloadGrant (jeton 256 bits, seul le HMAC est stocké) — unique par ligne de commande
             ├─ e-mail à l'acheteur (lien) + webhook digital.delivered (sans jeton)
             └─ commande 100 % immatérielle → DELIVERED (canTransition(..., { intangible: true }))

Acheteur ─ /telechargement/{jeton}            (page, hors /s/**, modèle de /suivi/{jeton})
        └─ /telechargement/{jeton}/fichier/{assetId}
             jeton (forme → HMAC → comparaison en temps constant) → commande payée et non annulée
             → expiration → limite → débit → UPDATE conditionnel du compteur → flux relayé depuis le stockage
```

### Modules

| Fichier | Rôle |
|---|---|
| `src/lib/digital/kinds.ts` | **pur** : natures, libellés, `productKindOf`, `summarizeCartKinds` (expédition, prépaiement), message de refus du paiement à la livraison |
| `src/lib/digital/rules.ts` | **pur** : état d'un accès (expiré, épuisé, restant), défauts de limite et d'expiration, libellés, fichiers d'une ligne, taille lisible |
| `src/lib/digital/token.ts` | jeton 256 bits base64url, `hashDownloadToken` (HMAC clé « download » dérivée d'`APP_SECRET`), comparaison en temps constant |
| `src/lib/digital/service.ts` | émission, notification, lecture par jeton, service d'un fichier (compteur atomique), vues marchand / client, rotation du jeton |
| `src/lib/digital/jobs.ts` | `digital.deliver` + `onPaymentSucceeded` (mise en file depuis `payment.succeeded`) |
| `src/lib/digital/actions.ts` | actions marchand (renommer, retirer, renvoyer le lien) et acheteur (`openOrderDownload`, autorisée par le jeton de suivi) |
| `src/lib/storage/file-keys.ts` | **pur** : clés `stores/{id}/files/…`, formats acceptés, octets magiques, nom de fichier servi |
| `src/lib/storage/file-upload.ts` | téléversement (capacité, plan, débit, taille, format, quota, fiche) |
| `src/components/digital/buyer-downloads.tsx` | « Mes téléchargements » de l'espace compte (prêt à monter, §7) |

### Règles de panier (`src/lib/commerce/**`)

- `resolveLinesTx` : la nature décide du stock — **DIGITAL et GIFT_CARD : jamais de stock** ; SERVICE : suivi
  facultatif ; PHYSICAL : inchangé. `OrderItem.kind` est écrit comme instantané.
- `createOrder` : `summarizeCartKinds(lines)` (recalculé serveur, jamais fourni par le client) →
  - panier sans aucune ligne expédiée → `fulfillmentType = DIGITAL`, zone, adresse et créneau effacés,
    **quel que soit le mode envoyé par la vitrine** ;
  - `DIGITAL` demandé avec un article à livrer → refus explicite ;
  - **paiement à la livraison refusé** si une ligne est numérique ou carte cadeau (règle du lot 1 étendue).
- `checkout-pipeline` : `PipelineLine.kind` (absent = `PHYSICAL`, donc comportement historique strictement inchangé).
  Seules les lignes **expédiées** entrent dans l'assiette de la livraison offerte (`freeAbove`) et, si **aucune**
  ligne n'est expédiée, les frais valent 0 même en mode livraison.
- `order-state` : `canTransition(from, to, { intangible })` ouvre `NEW | CONFIRMED | PREPARING → DELIVERED`
  **uniquement** pour une commande sans ligne physique ; `transitionOrder` revérifie la commande réelle (le drapeau
  ne s'accorde jamais sur simple demande).

---

## 4. Sécurité

- **Aucun lien public permanent.** Les clés `stores/{id}/files/…` ne passent pas `isValidMediaKey` : la route
  `/media/[...key]` les refuse (404) et aucun pilote ne produit d'URL publique pour elles (`publicUrl` lève).
  Le contenu est **relayé par le serveur** (flux), le bucket n'est jamais exposé.
- **Jeton** : 256 bits (CSPRNG), seule l'empreinte `HMAC-SHA256(clé « download », jeton)` est en base (index unique) ;
  comparaison en **temps constant** ; forme vérifiée avant toute requête ; jamais journalisé, jamais dans un webhook,
  jamais renvoyé par le MCP.
- **Compteur atomique** : un seul `UPDATE … SET downloadCount = downloadCount + 1 WHERE id = ? AND (downloadLimit IS
  NULL OR downloadCount < downloadLimit) AND (expiresAt IS NULL OR expiresAt > now)`. Deux requêtes simultanées ne
  peuvent pas dépasser la limite (testé).
- **Débit** : 20 fichiers servis / 10 min par accès (anti-partage du lien) ; 20 ouvertures / 10 min par commande et
  60 / 10 min par IP pour « Ouvrir mes fichiers » ; 60 téléversements / 10 min par membre, 200 / h par boutique.
- **Isolation** : chaque lecture et chaque écriture est filtrée par `storeId` ; le fichier servi doit appartenir au
  produit acheté, à **sa variante** et à la boutique de l'accès ; la clé lue est revérifiée (`fileKeyBelongsTo`).
- **Cycle de vie** : rien n'est émis avant `paymentStatus = PAID` ; une commande annulée ou remboursée invalide
  l'accès (page et route répondent « introuvable »), et l'émission est bloquée (revérification sous verrou).
- **Réponses** : `Cache-Control: no-store`, `Content-Disposition: attachment`, `nosniff`, CSP `sandbox`,
  `X-Robots-Tag: noindex` ; la page de téléchargement est `noindex`.
- **Téléversement** : même origine exigée, cookie de session, `products.manage`, format décidé par les **octets**
  (jamais le type annoncé) — pas de SVG, pas d'exécutable, pas de HTML.
- **Rotation** : « Renvoyer le lien » (commerçant) et « Ouvrir » (acheteur, autorisé par le jeton de suivi) émettent
  un nouveau jeton ; l'ancien cesse de fonctionner.

---

## 5. Reste de la plateforme

- **Liste produits** : badge de nature (« Numérique · 2 fichiers », « Service », « Carte cadeau ») ; un produit
  numérique **sans fichier** est signalé en orange.
- **CSV** : nouvelle colonne facultative **« Nature »** (alias `nature`, `kind`, `product kind`, `type d'article`) ;
  valeurs `physique`, `numérique`, `service`, `carte cadeau` (anglais accepté). Colonne absente = nature inchangée ;
  valeur illisible = ligne importée quand même, avec un avertissement. Les fichiers ne s'importent pas par CSV.
- **MCP** (`docs/API-MCP.md`) : `kind` dans `get_product` et `search_products` ; `create_product` accepte
  `kind: physical | digital | service` ; `get_product` renvoie `digital` (nombre de fichiers, limites, noms) et
  `service` ; nouveaux outils **`list_digital_downloads`** (`orders:read`) et **`list_product_files`**
  (`catalog:read`), en lecture seule, **sans jamais renvoyer de lien ni de jeton**.
- **Webhooks** : nouvel événement **`digital.delivered`** (`order_id`, `order_item_id`, `grant_id`, `product_id`,
  `download_limit`, `expires_at`). `order.paid` reste l'événement de paiement.
- **Duplication d'un produit** : les fichiers communs sont rattachés à la copie (aucun octet dupliqué : le stockage
  est adressé par contenu). Les fichiers propres à une variante restent à recharger.

---

## 6. Recette (manuelle et automatisée)

Automatisée : `e2e/09-produits-numeriques.spec.ts` (`pnpm e2e -- e2e/09-produits-numeriques.spec.ts`), qui déroule
le parcours complet sur la boutique de démo. Unitaire : `tests/digital-rules.test.ts` (26 cas purs) et
`tests/digital-service.test.ts` (26 cas sur base simulée).

Manuelle, en 10 minutes :
1. Créer un produit, nature **Produit numérique**, prix 7 000, enregistrer. Vérifier qu'il n'y a **ni stock, ni
   expédition**.
2. Téléverser un PDF. Vérifier qu'il apparaît avec sa taille ; régler 2 téléchargements, 30 jours, instructions.
3. Essayer d'ouvrir la clé du fichier via `/media/stores/…` : **404**.
4. En vitrine, acheter le produit (retrait sélectionné) : la commande créée doit être en **« Envoi numérique »**,
   **frais de livraison 0**, sans adresse. Vérifier que le **paiement à la livraison** n'est pas proposé.
5. Côté commerçant, **confirmer le paiement**, puis lancer `/api/jobs/run` (ou `pnpm jobs`).
6. La commande passe **« Livrée / remise »** seule ; la carte « Téléchargements » apparaît (0 sur 2).
7. Sur `/suivi/{jeton}` → « Vos fichiers » → « Ouvrir » : la page liste le fichier, « 2 téléchargements restants ».
8. Télécharger deux fois : le compteur descend, le troisième essai est refusé (message « limite atteinte »), la carte
   marchand affiche 2 téléchargements et la date du dernier.
9. « Renvoyer le lien » : un nouveau lien part ; l'ancien ne fonctionne plus.
10. Annuler la commande : le lien ne donne plus rien (« introuvable »).

---

## 7. Lignes à insérer par les autres équipes

Trois points de montage ont été préparés mais **non insérés** (fichiers appartenant à d'autres équipes) :

**a. Espace compte acheteur** — `src/app/s/[slug]/compte/page.tsx` (équipe comptes acheteurs) :

```tsx
import { BuyerDownloads } from "@/components/digital/buyer-downloads";
// … dans la page, après les cartes existantes (composant serveur, aucune prop supplémentaire) :
<BuyerDownloads storeId={store.id} customerId={buyer.customerId} />
```
`customerId` doit venir de la session acheteur (`getBuyer(store)`), jamais d'une saisie. Le composant ne rend rien
s'il n'y a aucun téléchargement.

**b. Page de confirmation** — `src/app/s/[slug]/merci/[token]/page.tsx` (équipe vitrine), pour que l'acheteur ouvre
ses fichiers sans attendre l'e-mail. Le plus simple est de réutiliser le composant du suivi :

```tsx
import { DownloadsSection } from "@/app/suivi/[token]/downloads-section";
import { listOrderDownloads } from "@/lib/digital/service";
import { downloadsLabel, grantProblemMessage } from "@/lib/digital/rules";
// … dans la page :
const now = new Date();
const downloads = order.items.some((i) => i.kind === "DIGITAL")
  ? (await listOrderDownloads(store.id, order.id, now)).map((d) => ({
      grantId: d.grantId, itemName: d.itemName, files: d.files,
      label: downloadsLabel({ downloadCount: d.downloadCount, downloadLimit: d.downloadLimit, expiresAt: d.expiresAt }, now),
      usable: d.state.usable, problem: grantProblemMessage(d.state),
    }))
  : [];
<DownloadsSection trackingToken={order.trackingToken} rows={downloads} />
```
(Si les fichiers ne sont pas encore émis — file de tâches — la section ne s'affiche pas : un message « vos fichiers
arrivent par e-mail » est souhaitable.)

**c. Vitrine (panier et checkout)** — `src/components/storefront/cart-store.ts` et
`src/app/s/[slug]/commander/checkout-form.tsx` (équipe vitrine) :
- ajouter `kind` à l'instantané de ligne du panier (comme `isGiftCard`) ;
- remplacer `const digitalOnly = cart.lines.length > 0 && giftLines.length === cart.lines.length;` par le résumé
  partagé : `const { digitalOnly, prepaymentRequired } = summarizeCartKinds(cart.lines.map((l) => l.snapshot));`
  (`import { summarizeCartKinds } from "@/lib/digital/kinds";` — module pur, importable côté client) ;
- masquer le paiement à la livraison dès `prepaymentRequired` (aujourd'hui : `hasGiftCardLine`).

Sans ces lignes, **tout fonctionne quand même** : le serveur impose la remise numérique et refuse le paiement à la
livraison ; seul l'affichage du mode reste perfectible (l'acheteur voit « Retrait / Livraison » puis sa commande
devient « Envoi numérique »).

**d. Fiche produit en vitrine** (facultatif) : afficher la durée, le lieu et la note de réservation d'un service
(`product.serviceDurationMinutes`, `serviceLocation`, `serviceRemote`, `serviceBookingNote`) et, pour un produit
numérique, « Téléchargement immédiat après paiement ».

---

## 8. Limites connues

- Pas de **calendrier ni de réservation de créneaux** pour les services (durée, lieu et instructions seulement) :
  c'est la suite naturelle (modèle `Booking`, disponibilités, rappels).
- Le compteur de téléchargements est **par accès** (par ligne de commande), pas par fichier : « 2 téléchargements »
  signifie deux fichiers servis, quels qu'ils soient.
- La **suppression d'un fichier** retire la fiche mais pas l'objet stocké (dédoublonnage par contenu) : l'espace
  n'est pas rendu tant que `pnpm media:orphans` n'est pas suivi d'une suppression manuelle ; `media:orphans`
  n'inventorie d'ailleurs que les médias, pas encore les fichiers vendus.
- Le fichier est **relayé par le serveur** (pas d'URL signée de courte durée) : plus sûr et uniforme, mais la bande
  passante passe par l'application. Pour de très gros volumes, ajouter une URL présignée S3 (le pilote S3 sait déjà
  signer ; il manque la signature par **requête** `X-Amz-*`).
- Pas de **reprise de téléchargement** (`Range`) : un fichier de 50 Mo interrompu se reprend du début.
- Un produit numérique **sans fichier** peut être vendu (l'acheteur reçoit un lien vide) : la liste du catalogue le
  signale, mais la publication n'est pas bloquée.
- L'import CSV ne vérifie pas le plan `digitalProducts` (il est inclus partout aujourd'hui).
