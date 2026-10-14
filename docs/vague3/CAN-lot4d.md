# CAN — Lot 4D : boutique installable, économie de données, statut WhatsApp, médias achetables, direct, notifications push

Vague 3 (12/10/2026). Spécification : `docs/specs/LOT-4-personnalisation.md` §14, §15, §17, §18, §19.
§16 (flux catalogues et synchronisation sociale) était **déjà livré** en vague 2 par l'équipe P2 (`src/lib/social/**`,
`docs/vague2/P2-catalogue-whatsapp.md`) : rien n'a été refait ni modifié.

---

## 1. Boutique installable (PWA) — §14

| Sujet | Où | Comportement |
|---|---|---|
| Manifeste | `src/app/s/[slug]/manifest.webmanifest/route.ts`, `src/lib/pwa/config.ts` | `application/manifest+json`, nom, nom court, description, `theme_color` = couleur primaire du thème, `background_color` = fond, icônes 192 / 512 (+ une entrée `maskable`), raccourcis Catalogue et Mon compte. **404 indistinct** si la boutique n'est pas publique, si le plan n'inclut pas `pwa` ou si le commerçant n'a pas activé l'option. |
| Portée | `pwaScope()` | Sous-domaine (`chez-aicha.axi.africa`) ou domaine propre → `start_url` et `scope` = `/`. Domaine de l'application (`axi.africa`, `localhost:3000`) → `/s/{slug}/`. |
| Service worker | `src/app/s/[slug]/sw.js/route.ts`, `src/lib/pwa/sw-source.ts` | Script généré par boutique, `Service-Worker-Allowed` aligné sur la portée, `Cache-Control: no-cache` (un correctif part tout de suite). Version dérivée des réglages : changer d'icône renomme les caches. |
| Stratégies | `swStrategy()` (pure, testée) | HTML : **réseau d'abord**, repli sur la dernière version connue puis sur `/{portée}hors-ligne`. Images (y compris le CDN et `/media/…`) : **cache puis revalidation**, 60 entrées. `/_next/static` : cache d'abord. **Jamais en cache** : `commander`, `compte`, `panier`, `merci`, `connexion`, `/api/**`, `_rsc`, `/_next/data`, toute requête non GET (donc toutes les actions serveur), toute URL portant `panier=` ou `token=`. Hors portée (console, site vitrine, autre boutique) : rien n'est écrit. |
| Page hors ligne | `src/app/s/[slug]/hors-ligne/page.tsx`, `src/components/storefront/pwa/recently-seen.tsx` | Nom de la boutique, message personnalisable, WhatsApp, téléphone, bouton Réessayer, et **derniers produits vus** relus dans le cache HTML du service worker (aucun stockage supplémentaire, donc aucun suivi en plus). |
| Icônes | `src/app/app/[storeId]/apparence/pwa/pwa-forms.tsx` | Générées **côté client** (`canvas`) à l'envoi : deux PNG carrés 192 et 512, fond blanc, marge de 8 % (lisibles en « maskable »), téléversées par l'API média existante (`POST /api/stores/{id}/media?purpose=theme`). Le serveur ne reçoit que des URL, revalidées par la liste blanche de `readPwaConfig`. |
| Invitation | `src/components/storefront/pwa/install-prompt.tsx` | Bandeau discret, à partir de la 2ᵉ visite **ou** dès qu'un panier existe, seulement si le navigateur déclare la boutique installable (`beforeinstallprompt`), jamais en mode déjà installé. Refus mémorisé 30 jours. Désactivable par le commerçant. |
| Écran marchand | `/app/{storeId}/apparence/pwa` | Activation, nom, nom court, message hors ligne, icône, invitation ; **critères d'installation** contrôlés côté serveur ; adresses du manifeste et du service worker à copier. |

Réglages stockés dans `Store.pwaConfig` (JSON, liste blanche `readPwaConfig`) : `{ enabled, prompt, name, shortName, icon192, icon512, offlineText }`.

## 2. Mode économie de données — §14

- Activation : en-tête `Save-Data: on` **ou** interrupteur du pied de page (cookie `axi_lite=1`, 180 jours).
  Le choix explicite du visiteur l'emporte : `axi_lite=0` désactive le mode même sous `Save-Data`.
- Effets : police **système** imposée avant la première peinture (aucune police décorative téléchargée),
  aucune animation (contrat `motionEnvFromRequest` de l'équipe Moteur, déjà en place), aucune lecture
  automatique de vidéo (vidéo achetable, vidéo d'ambiance), aucun préchargement de média, chargement
  paresseux strict, et **images du CDN demandées en qualité 40 / largeur ≤ 640 px** par le service worker.
- Fonctions pures et testées : `src/lib/pwa/lite.ts` (`isLiteRequest`, `liteOrigin`, `liteImageUrl`).
- Mesure du poids : voir §7.

## 3. Partage en statut WhatsApp — §15

`src/components/storefront/status-share.tsx` (client, monté sur la fiche produit par le bloc « Partager ») :
visuel **1080 × 1920** composé entièrement dans le navigateur (`canvas`) — photo du produit, nom (2 lignes
maximum), prix formaté dans la devise d'affichage, prix barré, logo et nom de la boutique, bouton
« Commander », **QR code** vers la fiche (générateur maison `src/lib/qr/encoder.ts`, aucune dépendance),
couleurs du kit de marque lues sur les variables CSS du thème (`--store-primary`, `--store-bg`…),
mention « Propulsé par Axi » en plan Gratuit.
Partage par **Web Share API niveau 2** (`navigator.share({ files })`) ; sinon téléchargement du PNG et copie du
texte. Texte prérempli : `Nom — Prix` + lien avec `utm_source=whatsapp_status&utm_medium=social`.
Aucune donnée n'est envoyée au serveur, aucun crédit débité.

## 4. Vidéos et stories achetables — §17

- **Section « Vidéo achetable »** (`shoppable-video`) : vidéo MP4/WebM https (téléversée ou lien direct),
  image de couverture obligatoire (rendue par le serveur : pas de décalage, elle reste seule en mode économie),
  blocs « produit étiqueté » (produit, instant d'apparition, précision) jusqu'à 10, sous-titres `.vtt`
  facultatifs, lecture muette **seulement dans la vue** et hors `prefers-reduced-motion` / Save-Data / mode
  économie, boutons Pause-Lecture et Son (44 px, `aria-pressed`), produits avec ajout direct et
  « Commander sur WhatsApp », mise en avant du produit correspondant à l'instant de lecture (`aria-current`).
- **Section « Stories »** (`stories`) : cercles (vrais boutons, 44 px minimum) et visionneuse plein écran
  `role="dialog"` `aria-modal="true"` : focus déplacé à l'ouverture et **restitué** au cercle d'origine, focus
  **piégé** (Tab et Maj+Tab bouclent), Échap ferme, flèches changent de story, Espace met en pause, barre de
  progression, avance automatique **désactivée** sous `prefers-reduced-motion`, défilement de la page bloqué
  puis restauré. Blocs story : image ou vidéo, titre, texte, produit, durée 3 à 15 s.
- Les deux sections sont masquées si elles n'ont rien à afficher.

## 5. Live shopping — §18

- `LiveEvent` (déjà en base) ; écran marchand `/app/{storeId}/live` : programmer, modifier, choisir jusqu'à
  12 produits, **épingler** le produit « à l'écran », lancer, terminer, supprimer.
- Liens de diffusion en **liste blanche** : YouTube, Facebook, TikTok, Instagram, https uniquement
  (`src/lib/live/stream.ts`, testé). Statut déduit des dates **et** du statut enregistré (un direct démarre tout
  seul à l'heure dite ; sans heure de fin, il se termine après 3 h).
- Section « Direct » (`live-shopping`) : compte à rebours (texte lisible par lecteur d'écran), lecteur,
  produits épinglés **rafraîchis toutes les 15 s** via `GET /api/live/{slug}` — uniquement quand la section est
  visible et l'onglet au premier plan. États explicites : chargement, aucun direct, direct affiché.
- « Me rappeler sur WhatsApp » : prénom + numéro + **case de consentement obligatoire** → client créé ou
  retrouvé, `Consent` WHATSAPP/MARKETING `granted` (source `live_reminder`), étiquette `direct-xxxxxxxx`, et
  **une** campagne WhatsApp `SCHEDULED` à l'heure du direct (segment « étiquette ») : la mécanique existante
  `runDueCampaigns` l'envoie, aucun nouveau type de job.
- **Aucun lecteur tiers intégré** : la politique de sécurité du site est `frame-src 'self'` et un lecteur
  YouTube chargerait des traceurs sans action du visiteur. Le direct s'ouvre dans un nouvel onglet, comme la
  section « Vidéo » existante (voir §8, écarts).

## 6. Notifications push — §19

- **Chiffrement RFC 8291** (`src/lib/push/encrypt.ts`) et **VAPID RFC 8292** (`src/lib/push/vapid.ts`), écrits
  avec `node:crypto` seul : ECDH P-256, HKDF-SHA256, AES-128-GCM, codage de contenu `aes128gcm` (RFC 8188),
  JWT ES256 (signature brute R‖S, `dsaEncoding: ieee-p1363`). Aucune dépendance ajoutée.
  Vecteurs de la RFC 8291 §5 et annexe A rejoués **octet pour octet** (`tests/push-encrypt.test.ts`), exemple
  de la RFC 8292 §2.4 vérifié (`tests/vapid.test.ts`).
- Envoi (`src/lib/push/send.ts`) : en-têtes `TTL`, `Urgency`, `Content-Encoding: aes128gcm`,
  `Authorization: vapid t=…, k=…`. **404 / 410 → abonnement révoqué** (jamais réessayé) ; 400/401/403/413 non
  réessayés ; 429 et 5xx réessayables ; 10 échecs consécutifs → révocation ; aucun secret dans les journaux.
- Sujets : `orders` (transactionnel) et `marketing` (**consentement `PUSH` / `MARKETING` obligatoire**, et
  réservé aux clients identifiés — un visiteur anonyme ne reçoit jamais de marketing).
- Campagnes `channel = "push"` (`sendPushCampaign`) : aucune consommation de crédit WhatsApp, **plafond
  mensuel du plan** (`limits.pushPerMonth`) compté sur les envois réussis (lignes `Notification` canal `push`),
  job `push.send` mis en file dans la même transaction que la campagne.
- Abonnement côté boutique : bouton du pied de page (`footer-extras.tsx`) → `subscribeToPush` /
  `unsubscribeFromPush` (débit limité par IP, clés revalidées, consentement journalisé dans les deux sens).
- Affichage et clic des notifications : gérés par le service worker de la boutique.

### Clés VAPID (porteur)
```
VAPID_PUBLIC_KEY   # clé publique P-256 base64url (65 octets non compressés)
VAPID_PRIVATE_KEY  # clé privée P-256 base64url (32 octets)
VAPID_SUBJECT      # mailto: ou https: du responsable (défaut : mailto:contact@pirabellabs.com)
```
Génération :
```bash
node -e "const{createECDH,randomBytes}=require('node:crypto');const b=x=>Buffer.from(x).toString('base64url');const e=createECDH('prime256v1');e.setPrivateKey(randomBytes(32));console.log('public',b(e.getPublicKey()));console.log('private',b(e.getPrivateKey()))"
```
Sans clés : aucun écran ne propose les notifications (message explicite au marchand), rien n'échoue.
**Changer la clé publique invalide tous les abonnements existants** : ne jamais la remplacer en production.
Une paire de développement a été ajoutée à `.env` ; `.env.example` documente les trois variables.

## 7. Vérification réelle (http://localhost:3000, Chrome système, boutique « Chez Aïcha »)

Captures : `docs/captures/vague3-can-*.png`.

| Contrôle | Résultat |
|---|---|
| Manifeste avant activation | **404** `text/plain` (indistinct) |
| Icônes générées au téléversement | 2 PNG (192 et 512) fabriqués dans le navigateur et stockés (`/media/stores/…`) |
| Manifeste après activation | **200** `application/manifest+json`, `scope` et `start_url` = `/s/chez-aicha/`, `theme_color` `#7a2e3a` (primaire du thème), 3 entrées d'icônes dont une `maskable`, raccourcis Catalogue / Mon compte |
| Service worker | **200** `text/javascript`, `Service-Worker-Allowed: /s/chez-aicha/`, 7,5 Ko, enregistré avec le bon `scope` |
| Caches après navigation (accueil, catalogue, compte) | `axi-html-*` (page hors ligne + pages visitées), `axi-asset-*` (42), `axi-img-*` ; **0 entrée** pour `/commander`, `/compte`, `/panier`, `/merci`, `/connexion`, `/api/**` |
| Page hors ligne | servie, titre « Vous êtes hors ligne », contact WhatsApp |
| Mode économie (`Save-Data: on` et interrupteur du pied de page) | cookie `axi_lite=1` posé, `lite: true`, **aucun `data-motion`**, 0 section animée, 0 vidéo lancée, police du thème remplacée par la police système (`--store-font` et `--store-font-heading`), **police décorative Outfit plus téléchargée** : 4 fichiers / 110,3 Ko → 3 fichiers / 78,9 Ko |
| Budget 300 Ko de l'accueil | **non validé en développement** : voir §8 point 6 |
| Sections | `shoppable-video`, `stories` et `live-shopping` présentes sur l'accueil et rendues |
| Visionneuse de stories au clavier | Entrée ouvre, `role="dialog"` + `aria-modal="true"`, libellé « Story 1 sur 3 : … », focus dans la boîte, **Échap** ferme, focus **restitué** au cercle, défilement de la page restauré |
| Direct | compte à rebours (« Début dans 1 heure et 13 minutes »), lien de diffusion, produits avec `aria-current="true"` sur le produit à l'écran |
| Épinglage rafraîchi | produit changé côté marchand → repris par la boutique **sans action du visiteur**, via `/api/live/{slug}` |
| Rappel WhatsApp | client créé (`2250771931383`), `Consent` WHATSAPP/MARKETING `granted` source `live_reminder`, étiquette `direct-mavqv5y4`, **une seule** campagne `SCHEDULED` à l'heure du direct, segment « étiquette », message prérempli |
| Limitation de débit du rappel | atteinte après plusieurs envois successifs depuis la même IP (comportement attendu) |
| Visuel de statut WhatsApp | PNG **1080 × 1920** téléchargé (`gateau-au-chocolat-statut.png`) : photo, logo + nom de boutique, nom du produit, prix, bouton « Commander », QR vers la fiche, texte copié |
| Notifications push | clé publique VAPID exposée dans la page, bouton d'abonnement présent ; `pushManager.subscribe` **échoue dans Chrome sans service de push** (navigateur de test) → message « Activation impossible sur ce navigateur », **aucune écriture en base** (état d'erreur correct) |

## 8. Écarts et points d'attention

1. **Lecteur de direct intégré** : impossible sans ajouter YouTube / Facebook / TikTok à `frame-src` dans
   `next.config.ts` (fichier hors périmètre, et un changement de CSP touche tout le site). Livré : ouverture
   dans un nouvel onglet. Ligne à insérer par le porteur s'il veut l'intégration :
   `frame-src 'self' https://www.youtube-nocookie.com https://www.facebook.com https://www.tiktok.com`.
2. **Qualité d'image en mode économie** : appliquée par le service worker (navigations suivantes et visites
   répétées) et par `liteImageUrl` dans les composants du lot 4D. L'appliquer **au premier chargement** à
   toutes les images de la boutique demanderait de passer l'état « économie » dans `RenderCtx` et une ligne
   de prop dans `product-image.tsx` (fichiers de l'équipe Rendu) — demande consignée au §9.
3. **Aucun champ de schéma manquant** : `PushSubscription`, `LiveEvent`, `Store.pwaConfig` et
   `ConsentChannel.PUSH` étaient en base. `prisma/schema.prisma` n'a pas été touché.
4. Le compteur du plafond mensuel push s'appuie sur les lignes `Notification` (canal `push`) : pas de nouveau
   modèle. Un envoi journalise un compte agrégé, pas une ligne par destinataire.
5. Le mode économie coupe aussi les animations via le contrat existant du moteur : aucune duplication.
6. **Budget « accueil < 300 Ko en mode économie » non validé** : en développement, le JavaScript n'est ni
   minifié ni découpé (8,3 Mo de scripts contre ~150 Ko attendus en production) et le document RSC pèse
   440 Ko au lieu de quelques dizaines. La mesure n'a donc aucune valeur ; `next build` est interdit pendant
   la vague et aucun serveur de production ne tournait sur le port 3100. Ce qui est mesurable est acquis :
   police décorative supprimée (−31,4 Ko), aucune vidéo, aucun JavaScript d'animation, aucune image
   prioritaire supplémentaire. **À re-mesurer sur une version de production** (accueil mobile, DPR 2) ;
   si le budget est dépassé, les deux leviers restants sont la demande au Rendu (point 2) et une variante
   640 px des médias stockés au téléversement (équipe Données / stockage).
7. **Gating de plan des sections `shoppable-video` et `stories`** : le §22 les réserve au plan Business.
   Le rendu d'une section ne connaît pas le plan (`RenderCtx` n'en porte pas) et le contrôle serveur des
   documents de thème vit dans `src/lib/theme/editor-plan.ts` (équipe Moteur / Éditeur). Le live shopping
   est bien filtré (l'API `/api/live/{slug}` vérifie `liveShopping`), mais les deux sections média ne le sont
   pas encore : demande consignée au §9.
8. Le lecteur de direct est un lien (voir point 1) : aucun traceur tiers n'est chargé sans action du visiteur.
9. L'interrupteur « mode économie » et le bouton de notifications du pied de page n'apparaissent qu'une fois
   la page interactive (ils lisent les réglages posés par `PwaHead` dans le document). Sans JavaScript, le
   mode économie reste pilotable par le navigateur (`Save-Data`), et la boutique fonctionne comme avant.

## 9. Lignes à insérer par d'autres équipes (demandes)

- **Rendu (T3)** — mode économie « premier chargement » : exposer `lite` dans `RenderCtx` (déjà calculable avec
  `requestLite()` de `src/lib/pwa/service.ts`) et ajouter une prop `quality` à `ProductImage` pour les images
  non prioritaires. Sans cela, le point 2 des écarts reste.
- **Moteur / Éditeur (T1-T2)** — plan des médias achetables : dans `lot4PlanIssue`
  (`src/lib/theme/editor-plan.ts`), refuser un document qui AJOUTE une section `shoppable-video` ou `stories`
  quand `PLANS[planId].features.shoppableMedia` est faux (même logique que les modèles alternatifs : ce qui
  existe déjà est conservé si le plan est rétrogradé).
- **Porteur / configuration** : CSP `frame-src` si l'on veut un lecteur de direct intégré (point 1).
- **Porteur / déploiement** : définir `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` et `VAPID_SUBJECT` en
  production (voir §6) ; la paire présente dans `.env` est une paire de développement.

## 10. Fichiers livrés

```
src/lib/pwa/{config,lite,sw-source,service,actions}.ts
src/lib/push/{encrypt,vapid,send,service,actions,jobs}.ts
src/lib/live/{stream,service,actions}.ts
src/lib/theme-engine/section-schemas/{_can-sections,shoppable-video,stories,live-shopping}.ts
src/app/s/[slug]/manifest.webmanifest/route.ts
src/app/s/[slug]/sw.js/route.ts
src/app/s/[slug]/hors-ligne/page.tsx
src/app/api/live/[slug]/route.ts
src/app/app/[storeId]/apparence/pwa/{page,pwa-forms}.tsx
src/app/app/[storeId]/live/{page,live-forms}.tsx
src/components/storefront/status-share.tsx
src/components/storefront/pwa/{pwa-head,sw-register,install-prompt,footer-extras,recently-seen}.tsx
src/components/storefront/live/{shoppable-body,stories-strip,live-panel}.tsx
src/components/storefront/sections/{shoppable-video,stories,live-shopping}.tsx
src/components/storefront/sections/can-renderers.ts
tests/{push-encrypt,vapid,pwa-sw,pwa-lite,pwa-manifest,live-stream,can-sections,can-isolation}.test.ts
docs/vague3/CAN-lot4d.md
```

Lignes d'enregistrement ajoutées dans des fichiers partagés (une par fichier, relu juste avant) :
`src/lib/theme-engine/types.ts` (3 types de sections), `src/lib/theme-engine/schemas.ts`,
`src/lib/theme-engine/render-registry.tsx`, `src/components/app/app-shell.tsx` (2 liens de menu),
`src/app/s/[slug]/layout.tsx` (`<PwaHead />`), `src/components/storefront/store-footer.tsx` (`<FooterExtras />`),
`src/components/storefront/product/product-main.tsx` (bloc « Partager » → `<StatusShare />`),
`tests/helpers/fake-db.ts` (relation `consent.customer`), `.env` et `.env.example` (clés VAPID).
