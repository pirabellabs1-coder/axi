# Commerce en direct : « commenter pour acheter » (Facebook, Instagram)

Pendant un direct Axi, un spectateur commente un mot-clé sur la Page Facebook ou le compte Instagram professionnel
de la boutique (« JE PRENDS 12 », « JP 12 », « 12 x2 »). Axi réserve l'article (stock retenu), lui envoie en
**message privé** (réponse privée Messenger / Instagram Direct) un lien court vers la boutique, et le marchand suit
les réservations en direct. Sans paiement dans le délai réglé, la réservation expire et le stock est rendu.

Vérifié dans la documentation Meta officielle le 14/10/2026 (sources en fin de document).

## Parcours

1. **Connexion** (écran Direct → « Commenter pour acheter ») : bouton Facebook Login for Business (configuration
   dédiée `NEXT_PUBLIC_META_SOCIAL_CONFIG_ID`, `response_type=code`). Le code est échangé côté serveur, la Page choisie
   est abonnée aux webhooks (`POST /{page-id}/subscribed_apps?subscribed_fields=feed`), la Page **et** le compte
   Instagram pro lié sont enregistrés (`SocialAccount`), jeton de Page chiffré (AES-256-GCM, `encryptSecret`).
   Une Page / un compte ne peut appartenir qu'à **une** boutique (unicité `platform + externalId`).
2. **Préparation du direct** (écran Direct → « Réservations ») : activer, délai de paiement (5 à 60 min, défaut
   30 min), plafond d'articles par client (défaut 2, max 5), plafond global d'unités réservées non payées par
   article (nombre fixe, sinon 30 % du stock par défaut) avec alerte si le taux d'expiration est anormal, message privé (variables `{nom} {produit} {quantite} {total}
   {delai} {boutique} {lien}`), réponse publique optionnelle, mots-clés (code → produit / variante), et liaison
   facultative à la vidéo en direct (« Détecter mon direct en cours » : `GET /{page-id}/live_videos?broadcast_status=["LIVE"]`
   et `GET /{ig-user-id}/live_media`). Sans liaison, les commentaires de **toutes** les publications des comptes
   connectés réservent, mais **uniquement pendant que le direct Axi est en cours**.
3. **Commentaire** → `POST /api/webhooks/meta` (signé) → réservation transactionnelle → réponse privée unique avec
   `https://{app}/l/{jeton}`.
4. **Lien court** : la page affiche le résumé (aucune action sur un simple GET : les aperçus de liens de Messenger ne
   consomment rien). Le bouton « Finaliser ma commande » (POST) crée un panier serveur et rend le stock retenu **dans
   la même transaction**, puis redirige vers `/s/{slug}?panier={jeton}` : livraison, paiement, prix et stock sont
   recalculés par le checkout normal (`createOrder`), sans contournement.
5. **Suivi** : PAID dès que la commande issue du panier est payée ; EXPIRED (stock rendu) à échéance ; le marchand
   peut **relancer** (prolonge le délai) ou **annuler** (stock rendu), copier le lien, exporter en CSV.

## Modèle de données (migration `20261014082817_live_comment_commerce`, additive)

| Table / champ | Rôle |
| --- | --- |
| `SocialAccount` | Page FB ou compte IG pro : `externalId` (routage), `pageId`, jeton de Page chiffré, `scopes`, `status` (`active` / `error`). Unique `(platform, externalId)`. |
| `LiveEvent.claims*`, `socialObjectIds` | Réglages du direct et vidéos reliées. |
| `LiveKeyword` | Code normalisé → produit / variante. Unique `(liveEventId, code)`. |
| `LiveClaim` | Réservation : commentaire (unique `(platform, commentId)`), auteur (id à portée de Page/IG + nom affiché), article, quantité, prix indicatif, `heldQuantity` (unités retirées du stock), statut `RESERVED → MESSAGED → PAID` ou `EXPIRED` / `CANCELLED`, `token` du lien, `cartId`, `orderId`, verrou d'envoi `replyLockedAt`, `expiresAt`. |

Retour arrière : les colonnes / tables sont nouvelles et non lues ailleurs ; libérer d'abord les réservations actives
(`releaseLiveHolds` ou attendre l'expiration), puis supprimer `LiveClaim`, `LiveKeyword`, `SocialAccount`, les
colonnes `claim*` / `socialObjectIds` de `LiveEvent` et les deux enums.

## Règles et garanties

- **Mots-clés** (`src/lib/live/claim-parser.ts`, fonction pure testée) : FR/EN (« je prends », « JP », « je veux »,
  « moi », « pour moi », « je réserve », « I take », « sold », « mine »…), quantité (`12 x2`, `12x2`, `12*2`, `2x 12`,
  `12 2 pièces`, plafond 10 par commentaire), tolérance d'une faute sur les mots d'intention (« je prend »,
  « prennds »), **jamais** sur les codes (« robe1 » ≠ « robe2 »). Sans mot d'intention, le commentaire doit se réduire
  au code (« 12 », « #12 svp ») : « j'ai 12 ans » ne réserve rien. Un commentaire = un article.
- **Réservation** (`reserveClaim`) : verrou du produit (`SELECT … FOR UPDATE`, comme le checkout), verrou consultatif
  par auteur et direct (plafond fiable même en rafale), prix normatif `unitPricing` (indicatif), stock retiré sous
  condition (DENY : stock suffisant ; CONTINUE : sans condition), niveau du dépôt par défaut + mouvement d'inventaire
  `ADJUSTMENT` « Réservation live {id} » (et l'inverse à la libération). Cartes cadeaux et produits à options
  obligatoires refusés ; produit à variantes : la variante est imposée par le mot-clé.
- **Réponse privée unique** : verrou conditionnel (`messageId` nul + `replyLockedAt`) en plus de la limite Meta (un
  message par commentaire). Les réservations d'un lot de webhook sont faites dans l'ordre d'arrivée (premier arrivé,
  premier servi), puis les messages partent en parallèle (5 à la fois). Rupture : un message « plus disponible ».
- **Idempotence** : `ProviderEvent(meta_social, "{plateforme}:{commentId}")` + unicité du commentaire sur
  `LiveClaim`. Une erreur inattendue libère l'événement et répond 500 en fin de lot : Meta renvoie, les commentaires
  déjà traités sont ignorés.
- **Isolation** : la boutique vient exclusivement du routage `SocialAccount` (jamais du contenu) ; toute requête est
  filtrée par `storeId` ; actions marchand avec `requireStore` (`theme.manage`, connexion : `integrations.manage`,
  export : `export`) et plan `liveShopping` (Scale et plus).
- **Anti-spam** : un claim par commentaire, plafond d'articles par auteur et par direct, 6 tentatives par auteur et
  par minute, commentaires de la Page / du compte ignorés (pas de boucle avec la réponse publique).
- **Données client** : la page `/l/{jeton}` (jeton de 96 bits) n'affiche que l'article et le prix ; l'export CSV
  ne contient pas les identifiants Meta ; `ProviderEvent` ne journalise ni texte ni nom.
- **Expiration** : `sweepLiveClaims` (idempotent, borné) est appelé par le webhook (30 s max par boutique), l'écran
  des réservations, et la route cron `GET|POST /api/webhooks/meta/sweep` (même authentification que
  `/api/jobs/run` : `x-jobs-key: $JOBS_RUN_KEY` ou `Authorization: Bearer $CRON_SECRET`).

### Compromis assumé : réservation jusqu'au clic, puis checkout normal

Le stock est retenu de la réservation jusqu'au clic sur « Finaliser ma commande » ; à cet instant il est rendu et le
panier part au checkout, qui le reprend sous ses propres règles. Entre ce clic et la validation de la commande
(quelques minutes), un autre acheteur peut théoriquement prendre la dernière unité. Supprimer cette fenêtre
demanderait que `createOrder` « consomme » une réservation (`src/lib/commerce/*`, hors périmètre sans accord).

## Réglages Meta à faire (porteur)

Même application Meta que WhatsApp (App ID `NEXT_PUBLIC_META_APP_ID`).

1. **Produits** : ajouter *Facebook Login for Business*, *Webhooks*, *Messenger* et *Instagram* (API Instagram avec
   **Facebook Login**, hôte `graph.facebook.com`).
2. **Facebook Login for Business → Configurations → Créer** : type de jeton **« Jeton d'accès utilisateur »**
   (recommandé : les jetons de Page obtenus via un jeton longue durée n'expirent pas) ou « utilisateur système »
   (le marchand doit alors avoir un portefeuille business) ; actifs : **Pages** et **comptes Instagram** ;
   permissions ci-dessous. Copier l'identifiant → `NEXT_PUBLIC_META_SOCIAL_CONFIG_ID`.
3. **Webhooks** :
   - objet **Page** : URL `https://{domaine}/api/webhooks/meta`, jeton `META_SOCIAL_VERIFY_TOKEN`, champ **`feed`** ;
   - objet **Instagram** : même URL et jeton, champs **`comments`** et **`live_comments`**.
   (L'objet WhatsApp garde `/api/webhooks/whatsapp` : Meta autorise une URL par objet.)
   Le champ Page `live_videos` n'est pas nécessaire : les commentaires d'un direct Facebook arrivent par `feed`.
4. **Contrôle de l'app (Advanced Access)** — à demander, avec une vidéo du parcours complet :

   | Permission | Pourquoi |
   | --- | --- |
   | `pages_show_list` | lister les Pages du marchand à la connexion |
   | `pages_manage_metadata` | abonner l'app aux webhooks de la Page (`subscribed_apps`) ; requis pour les webhooks Instagram via Facebook Login |
   | `pages_read_engagement` | lire les commentaires / vidéos en direct de la Page ; requis pour les réponses privées Instagram |
   | `pages_read_user_content` | contenu des commentaires des visiteurs dans le webhook `feed` |
   | `pages_messaging` | réponse privée Messenger (`POST /{page-id}/messages`, tâche MESSAGING sur la Page) |
   | `pages_manage_engagement` | réponse publique sous un commentaire Facebook (option) |
   | `instagram_basic` | compte Instagram pro lié à la Page |
   | `instagram_manage_comments` | webhooks `comments` / `live_comments`, réponse privée et réponse publique Instagram |
   | `instagram_manage_messages` | message de suivi Instagram (relance dans la fenêtre de 24 h) |
   | `business_management` | Pages détenues par un portefeuille business (et jetons utilisateur système) |

   Meta précise aussi : si l'utilisateur a un rôle sur la Page via Business Manager, les réponses privées Instagram
   peuvent exiger `ads_management` et `ads_read` (non demandés par défaut ; à ajouter si le test le révèle).
   Les webhooks `comments` / `live_comments` exigent l'**accès avancé** et une app **en mode Live** ; le compte
   Instagram doit être **public**.
5. **Domaine** : l'URL de base de l'app (`NEXT_PUBLIC_APP_URL`) doit être en **HTTPS** (certificat valide exigé par
   Meta pour les webhooks).
6. **Sécurité des en-têtes (CSP)** : le SDK JS Meta est autorisé dans `script-src` ; `frame-src` n'est élargi à
   facebook.com que si `NEXT_PUBLIC_META_ESIGNUP_CONFIG_ID` est défini au build (next.config.ts). Si la connexion
   sociale est activée **sans** Embedded Signup WhatsApp, élargir `frame-src` de la même façon (fichier hors périmètre).

## Variables d'environnement

| Variable | Rôle |
| --- | --- |
| `NEXT_PUBLIC_META_APP_ID` | App ID Meta (déjà utilisé par WhatsApp) |
| `NEXT_PUBLIC_META_SOCIAL_CONFIG_ID` | Configuration Facebook Login for Business « Pages + Instagram » |
| `META_APP_SECRET` (à défaut `WHATSAPP_APP_SECRET`) | Échange code → jeton, `appsecret_proof`, signature du webhook |
| `META_SOCIAL_VERIFY_TOKEN` | Jeton de vérification du webhook `/api/webhooks/meta` |
| `JOBS_RUN_KEY` / `CRON_SECRET` | Authentification de `/api/webhooks/meta/sweep` |
| `META_GRAPH_VERSION` | Version Graph (facultatif, défaut du dépôt) |

Cron conseillé (EC2) : `* * * * * curl -fsS -H "x-jobs-key: $JOBS_RUN_KEY" https://{domaine}/api/webhooks/meta/sweep`.

## Limites imposées par Meta

- **Une seule** réponse privée par commentaire ; envoi dans les **7 jours** du commentaire ; pour un **live
  Instagram**, uniquement **pendant la diffusion** (et les webhooks de commentaires de live s'arrêtent à la fin).
- Message suivant uniquement si la personne **répond**, dans les **24 h** de sa réponse : la « relance » d'une
  réservation déjà notifiée échoue sinon (message clair au marchand, lien copiable pour un autre canal).
- Réponse privée Instagram : boîte « Demandes » si la personne ne suit pas le compte.
- Accès standard : seules les personnes ayant un rôle sur l'app reçoivent / déclenchent ces flux (tests).
- Débits : Meta applique des limites d'appels par app / Page (codes 4, 17, 32, 613) ; la doc consultée ne chiffre
  pas de plafond propre aux réponses privées. Un échec est consigné sur la réservation et relançable.
- Webhooks : lots de 1 000 événements au plus, renvois pendant 36 h, doublons possibles (gérés).
- Instagram : 1 000 octets par message (le message est tronqué à 900 caractères, lien conservé).

## Autres plateformes

- **TikTok** : aucune API officielle ouverte ne donne accès aux commentaires d'un live. Les produits publics de
  TikTok for Developers (https://developers.tiktok.com/products/ : Login Kit, Share Kit, Content Posting API, Embed
  Videos, Content Display, Research & Insights, Mini Games) n'exposent ni flux de commentaires de live ni message privé à un commentateur.
  Les outils « comment to buy » existants s'appuient sur des API non officielles (contraires aux conditions) : non
  implémenté.
- **YouTube** : l'API Live Streaming permet de **lire** le chat (`liveChatMessages.list`, 5 unités de quota par
  appel, intervalle `pollingIntervalMillis` ; ou `liveChatMessages.streamList`, 5 unités) et d'y **écrire**
  (`liveChatMessages.insert`, 20 unités, portée OAuth `youtube.force-ssl`). Non implémenté, parce que :
  1. il n'existe **aucun message privé** : le lien de paiement devrait être publié dans le chat public, lisible et
     utilisable par tous, ce qui casse la réservation nominative ;
  2. le quota par défaut (10 000 unités / jour **pour tout le projet Google**, partagé par toutes les boutiques)
     ne tient qu'un ou deux directs par jour en relève toutes les 5 s ;
  3. la portée `youtube.force-ssl` est « sensible » : vérification de l'application Google obligatoire ;
  4. il faut un processus de relève permanent par direct (pas de webhook).
  Une variante réaliste : réserver depuis le chat YouTube et répondre « @pseudo, réservé : code ABCD » où le code se
  saisit sur la boutique ; à reconsidérer après extension de quota.

## Fichiers

- `src/lib/live/claim-parser.ts`, `claim-message.ts` (pur), `claims.ts` (service), `claim-actions.ts` (actions)
- `src/lib/meta-social/config.ts`, `graph.ts`, `webhook-payload.ts` (pur), `actions.ts` (connexion)
- `src/app/api/webhooks/meta/route.ts`, `src/app/api/webhooks/meta/sweep/route.ts`
- `src/app/app/[storeId]/live/` (connexion, liens) et `live/[eventId]/` (tableau, réglages, export)
- `src/app/l/[token]/page.tsx` (lien court public)
- Tests : `tests/live-claim-parser.test.ts`, `tests/meta-social-webhook.test.ts`, `tests/live-claims.test.ts` (base locale)

## Sources

- Réponses privées Messenger : https://developers.facebook.com/documentation/business-messaging/messenger-platform/discovery/private-replies
- Réponses privées Instagram : https://developers.facebook.com/documentation/instagram-platform/private-replies
- Webhooks Instagram (configuration, limites, mTLS) : https://developers.facebook.com/documentation/instagram-platform/webhooks/setup
- Champs et permissions des webhooks Instagram : https://developers.facebook.com/documentation/instagram-platform/webhooks/fields
- Exemples de charges utiles : https://developers.facebook.com/documentation/instagram-platform/webhooks/examples
- Webhooks de Page (`feed`, `live_videos`) : https://developers.facebook.com/docs/graph-api/webhooks/reference/page
- Facebook Login for Business : https://developers.facebook.com/documentation/facebook-login/facebook-login-for-business
- `live_media` Instagram : https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/live_media
- YouTube `liveChatMessages` : https://developers.google.com/youtube/v3/live/docs/liveChatMessages
- TikTok for Developers : https://developers.tiktok.com/products/
