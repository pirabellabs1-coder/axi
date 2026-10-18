# Déploiement, checklist pour le porteur

Ce document liste ce qu'il faut faire pour mettre Axi en production. Les points marqués **[INTÉGRATION]**
sont des branchements volontairement laissés au porteur (clés, contrats fournisseurs, tests en sandbox).

## 1. Variables d'environnement

Copiez `.env.example` et renseignez :

| Variable | Obligatoire | Rôle |
|---|---|---|
| `DATABASE_URL` | oui | PostgreSQL (Supabase, Neon, Railway, RDS ou VPS). Ajoutez `?sslmode=require` si le fournisseur l'exige. Pour Supabase/Neon avec pooler, utilisez l'URL **pooled** pour l'app et l'URL directe pour `prisma migrate`. |
| `APP_SECRET` | oui | 32+ caractères aléatoires. Sert aux sessions, tokens et au chiffrement AES-256-GCM des clés de paiement. **Le changer invalide toutes les clés chiffrées.** `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `NEXT_PUBLIC_APP_URL` | oui | URL publique, ex. `https://axi.africa` (liens e-mail, suivi, WhatsApp). |
| `INTERNAL_APP_URL` | non | URL interne utilisée par le proxy pour résoudre les domaines personnalisés (`/api/domains/resolve`). Par défaut : `NEXT_PUBLIC_APP_URL`. |
| `NEXT_PUBLIC_APP_DOMAIN` | oui | Domaine racine des boutiques, ex. `axi.africa` → `{slug}.axi.africa`. |
| `EMAIL_PROVIDER` | oui | `console` (dev uniquement) · `resend` (production). |
| `ALLOW_CONSOLE_EMAIL` | non | `1` uniquement pour tester un build de production **en local** (APP_URL sur localhost) : les e-mails restent dans le terminal. Ne jamais définir en production. |
| `EMAIL_FROM` | oui | Expéditeur, ex. `Axi <no-reply@axi.africa>` (domaine vérifié chez Resend). |
| `RESEND_API_KEY` | si resend | Clé API Resend. |
| `JOBS_RUN_KEY` | oui | Clé secrète protégeant `/api/jobs/run`, transmise uniquement par l'en-tête `x-jobs-key` (Vercel Cron : `CRON_SECRET` via `Authorization: Bearer`). |
| `CRON_SECRET` | Vercel | Sur Vercel, le cron envoie automatiquement `Authorization: Bearer $CRON_SECRET` : définissez-la et l'endpoint l'accepte. |
| `JOBS_BATCH` / `JOBS_INTERVAL_MS` | non | Worker permanent `pnpm jobs` uniquement : jobs par cycle (défaut `25`) et pause entre cycles (défaut `10000` ms). Voir §5. |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | au seed | Compte admin créé par `pnpm db:seed`. Changez le mot de passe ensuite. |
| `ADMIN_MFA_OPTIONAL` | non | **Démo locale uniquement.** `1` rend la double authentification facultative pour l'équipe plateforme. Absent ou `0` (défaut, obligatoire en production) : un membre sans MFA ne voit que /admin/equipe (section Sécurité) et toutes les actions de la console sont refusées tant qu'il ne l'a pas activée. |
| `PLATFORM_BILLING_PROVIDER_AFRICA` | non | Facturation plateforme en zone Afrique (FCFA) : `manual` (défaut), `fedapay`, `kkiapay`. Voir §7.2. |
| `PLATFORM_BILLING_PROVIDER_WORLD` | non | Facturation plateforme en zone Monde (EUR) : `manual` (défaut), `stripe`. |
| `PLATFORM_BILLING_PROVIDER` | non | Ancienne variable unique, utilisée en repli si compatible avec la zone. |
| `PLATFORM_MOMO_NUMBER` | mode manuel | Numéro Mobile Money de la plateforme affiché sur les factures en FCFA. |
| `PLATFORM_BANK_DETAILS` | mode manuel | Coordonnées bancaires (IBAN) affichées sur les factures en EUR. |
| `FEDAPAY_SECRET_KEY`, `FEDAPAY_WEBHOOK_SECRET`, `FEDAPAY_MODE` | si FedaPay | Clés **plateforme** (abonnements et options). `FEDAPAY_MODE` = `sandbox` ou `live`. |
| `KKIAPAY_PUBLIC_KEY`, `KKIAPAY_PRIVATE_KEY`, `KKIAPAY_SECRET`, `KKIAPAY_MODE` | si KkiaPay | Clés **plateforme**. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | si Stripe | Clés **plateforme** (zone Monde). `sk_test_...` et `whsec_...` en test. |
| `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` | si API WhatsApp | Vérification et signature du webhook Meta (§7.3). `WHATSAPP_APP_SECRET` sert aussi à l'échange de code du mode partenaire (§7.3 ter) à défaut de `META_APP_SECRET`. |
| `NEXT_PUBLIC_META_APP_ID`, `NEXT_PUBLIC_META_ESIGNUP_CONFIG_ID`, `META_APP_SECRET` | si mode partenaire | **[INTÉGRATION]** Mode partenaire WhatsApp / Embedded Signup (§7.3 ter). Les deux `NEXT_PUBLIC_*` sont lus **au build** : définis, ils affichent le bouton « Connecter avec WhatsApp » et ajoutent `facebook.com` à la CSP `frame-src` (rebâtir après modification) ; absents, seule la saisie manuelle s'affiche. `META_APP_SECRET` facultatif (repli sur `WHATSAPP_APP_SECRET`). |
| `AXI_OTP_WHATSAPP_PHONE_ID`, `AXI_OTP_WHATSAPP_TOKEN` | non | Numéro WhatsApp Cloud de la plateforme pour envoyer les codes de connexion des acheteurs. Utilisé uniquement pour une boutique **sans** WhatsApp Cloud actif, dans tous les plans (Gratuit : quota `AXI_OTP_FREE_DAILY_PER_STORE`) ; jamais en repli quand le débit de crédit de la boutique échoue. Sans lui : e-mail vérifié seulement (et console en développement). |
| `AXI_OTP_FREE_DAILY_PER_STORE` | non | Plan Gratuit : codes envoyés par l'expéditeur plateforme, par boutique et par jour UTC (défaut `30`). Toujours comptés dans `AXI_OTP_DAILY_BUDGET`. Les plans payants n'ont que les plafonds généraux (500 codes par boutique et par jour). |
| `AXI_OTP_WHATSAPP_TEMPLATE`, `AXI_OTP_WHATSAPP_LANGUAGE` | non | Modèle Meta de catégorie « authentification » (défaut `code_authentification`, langue `fr`). Une boutique peut surcharger via `otpTemplate` / `otpLanguage` dans la config de son intégration. |
| `AXI_OTP_DAILY_BUDGET` | non | Budget quotidien (jour UTC) de codes envoyés par l'expéditeur plateforme, défaut `2000`. Au-delà : arrêt d'urgence des comptes acheteurs activé automatiquement (`buyer_accounts.kill_switch`, à lever depuis la console) et alerte `admin.alert.buyer_otp_budget` au journal d'audit. |
| `TURNSTILE_SECRET_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `AXI_OTP_CHALLENGE_AFTER` | non | **[INTÉGRATION]** Défi anti-robot Cloudflare Turnstile sur la demande de code acheteur, exigé au-delà de `AXI_OTP_CHALLENGE_AFTER` demandes (défaut 3) par IP et par heure ; vérification serveur par l'API `siteverify` (`src/lib/buyer/challenge.ts`). La CSP (`next.config.ts`) ajoute `https://challenges.cloudflare.com` à `script-src` et `frame-src` **uniquement** si `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SITE_KEY` ou `TURNSTILE_SECRET_KEY` est défini **au build** (rebâtir après modification) ; le reste de la politique est inchangé. Vide = désactivé. |
| `ANTHROPIC_API_KEY` | non | Assistant IA de rédaction (désactivé si vide). |
| `STORAGE_DRIVER` | **oui en production** | Stockage des images : `s3` (production : Cloudflare R2 recommandé, AWS S3, Supabase Storage, Backblaze B2, MinIO) ou `local` (développement ; en production uniquement sur un VPS à disque persistant). Voir §6 bis. |
| `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_BUCKET` | si s3 | Point d'accès S3 du fournisseur, région (`auto` pour R2) et nom du bucket. |
| `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY` | si s3 | Clé d'API **limitée à ce bucket** (lecture + écriture d'objets). Reste côté serveur. |
| `STORAGE_PUBLIC_URL` | si s3 | URL publique des fichiers (domaine CDN ou bucket public), ex. `https://media.axi.africa`, en https. Lue aussi au build (CSP) : rebâtir après modification. |
| `STORAGE_FORCE_PATH_STYLE` | non | `1` (défaut : R2, Supabase, MinIO, Backblaze) ou `0` (hôte virtuel, AWS S3). |
| `STORAGE_LOCAL_DIR` | non | Pilote local : dossier des fichiers (défaut `.local/uploads`, hors `public/`). |
| `FX_ECB_URL` | non | **[INTÉGRATION]** Taux de change (lot 2) : URL d'un miroir du fichier quotidien de la BCE, **HTTPS uniquement** (sinon ignorée). Défaut : `https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml`. Voir §7.5. |
| `FX_REFRESH_DISABLED` | non | `1` : le rafraîchissement `fx.refresh` n'écrit que les parités fixes (EUR, XOF, XAF), sans appel réseau (environnements sans Internet). Les devises BCE deviennent alors indisponibles au bout de 72 h. |
| `META_GRAPH_VERSION` | non | **[INTÉGRATION]** Version de l'API Graph de Meta pour la synchronisation du catalogue WhatsApp (lot 1 bis), format `vNN.N` (sinon ignorée). Défaut `v26.0`. Voir §7.3 bis et docs/SOCIAL-COMMERCE.md. |
| `SOCIAL_IG_PRODUCT_TAGGING` | non | `1` ouvre l'écran « Produits sur Instagram » (identification de produits sur les publications, API Instagram Graph). Exige une Boutique Instagram approuvée et l'App Review de `instagram_shopping_tag_products` ; désactivé par défaut. Voir docs/SOCIAL-COMMERCE.md §3. |
| `SOCIAL_SYNC_DRY_RUN` | non | **Développement uniquement** (ignorée si `NODE_ENV=production`). `1` remplace les appels à l'API Graph par un client qui accepte tout, pour tester la synchronisation du catalogue sans compte Meta. |
| `AXI_WEBHOOKS_ALLOW_LOCALHOST` | non | **Test local uniquement** (ignorée si `NODE_ENV=production`). `1` accepte des points de webhook `http(s)://localhost`, `127.0.0.1` ou `[::1]` sur tout port (bouclage seulement). À définir dans le processus qui crée le point (serveur Next) **et** dans celui qui livre (`pnpm jobs` ou `/api/jobs/run`). Voir §7.6. |
| `LOCAL_PG_PORT` | non | Développement : port du PostgreSQL embarqué de `pnpm db:local` (défaut `5433`). |

Paiements Wave / Orange Money (lot 1 bis) : **aucune variable nouvelle**. Les clés Paystack, pawaPay et CinetPay sont
celles de chaque marchand, saisies dans *Paiements* et chiffrées par `APP_SECRET` (§7.1 bis). Les variables `FX_*`,
`META_GRAPH_VERSION`, `SOCIAL_SYNC_DRY_RUN` et `AXI_WEBHOOKS_ALLOW_LOCALHOST` ne figurent pas encore dans
`.env.example` : ajoutez-les à votre `.env` si besoin (toutes facultatives).

Jamais de secret dans le code ni dans Git (`.env` est ignoré). Sur Vercel/Railway, saisissez-les dans l'interface « Environment Variables ».

## 2. Base de données

```bash
# Première mise en production : appliquer les migrations
pnpm prisma migrate deploy
# La migration initiale est livrée dans prisma/migrations/20261011000000_init (base vide → schéma complet).
# Base locale déjà créée par `db push` : marquez-la appliquée avec
#   pnpm prisma migrate resolve --applied 20261011000000_init

# Suppression du plan Gratuit (18/10/2026) : migration 20261018200158_plan_free_removal_pause, puis
# nouvel essai Business de 14 jours pour chaque boutique encore en Gratuit (idempotent, rejouable) :
pnpm billing:migrate-free --dry-run   # inventaire
pnpm billing:migrate-free
# (le cron /api/jobs/run applique aussi cette étape à chaque passage, par sécurité)

# Données de démo : UNIQUEMENT sur un environnement de démo/staging
pnpm db:seed
```

Recommandations : PostgreSQL 15+, `max_connections` suffisant ou pooler (PgBouncer, Supabase pooler, Neon), fuseau serveur UTC.

## 3. DNS et sous-domaines

Les boutiques sont servies sur `{slug}.{NEXT_PUBLIC_APP_DOMAIN}` (proxy `src/proxy.ts` → `/s/{slug}`) et les domaines personnalisés sur `/d/{host}`.

| Enregistrement | Valeur | Rôle |
|---|---|---|
| `A` / `CNAME` `axi.africa` | votre hébergeur | site + app |
| `CNAME` `*.axi.africa` | `axi.africa` (ou cible de l'hébergeur) | **wildcard** pour les boutiques |
| `CNAME` `www` | `axi.africa` | |
| SPF / DKIM / DMARC | fournis par Resend | délivrabilité des e-mails |

- **Vercel** : ajoutez `axi.africa` et `*.axi.africa` dans Domains (le wildcard exige que le DNS soit géré par Vercel ou une validation TXT). Le certificat wildcard est émis automatiquement.
- **Railway / VPS (Caddy ou Nginx)** : certificat wildcard via DNS-01 (Let's Encrypt). Exemple Caddy :
  ```
  axi.africa, *.axi.africa {
    reverse_proxy localhost:3000
    tls { dns cloudflare {env.CF_API_TOKEN} }
  }
  ```
- Domaines personnalisés des marchands (plan Business+) : le marchand crée un `CNAME` vers `axi.africa` ; la vérification se fait par token TXT (modèle `Domain`). Sur Vercel, ajoutez le domaine au projet (API Domains), **[INTÉGRATION]** si vous voulez l'automatiser.

## 4. Hébergement

### Vercel (recommandé pour démarrer)
1. Importez le dépôt, framework Next.js détecté. `vercel.json` déclare la région `cdg1` (Paris, proche de l'Afrique de l'Ouest) et le cron des jobs (`/api/jobs/run`, `*/5 * * * *`, soit toutes les 5 minutes). **Un cron aussi fréquent exige un plan Vercel Pro** (le plan Hobby limite les crons à une exécution par jour). Sans plan Pro, retirez le bloc `crons` de `vercel.json` et faites appeler `/api/jobs/run` toutes les 5 minutes par un cron externe (cron-job.org, GitHub Actions, crontab d'un serveur…) avec l'en-tête `x-jobs-key: $JOBS_RUN_KEY` ou `Authorization: Bearer $CRON_SECRET`.
2. Variables d'environnement (§1) + `CRON_SECRET`.
3. Build : `pnpm build` (le `postinstall` lance `prisma generate`).
4. Les Server Actions et route handlers tournent en fonctions serverless : gardez `maxDuration` raisonnable (`/api/jobs/run` est à 60 s).

### Railway / Render / Fly
- Service web : `pnpm install --frozen-lockfile && pnpm build` puis `pnpm start`. Port `3000` (ou `PORT`).
- Service PostgreSQL managé → `DATABASE_URL`.
- Cron : service « cron job » qui exécute `curl -fsS -H "x-jobs-key: $JOBS_RUN_KEY" https://axi.africa/api/jobs/run` toutes les 5 minutes, **ou** un second service `pnpm jobs` (worker permanent, voir `JOBS_INTERVAL_MS` et `JOBS_BATCH` au §5).

### VPS (Ubuntu + Node 22 + PostgreSQL)
```bash
pnpm install --frozen-lockfile && pnpm build
# PM2
pm2 start pnpm --name axi -- start
pm2 start pnpm --name axi-jobs -- jobs      # worker optionnel (sinon crontab)
pm2 save && pm2 startup
# crontab -e
*/5 * * * * curl -fsS -H "x-jobs-key: VOTRE_CLE" https://axi.africa/api/jobs/run > /dev/null
```
Reverse proxy Caddy/Nginx avec HTTPS (wildcard, §3). Activez `fail2ban`, les mises à jour automatiques et un pare-feu (80/443 uniquement).

### Docker (toutes plateformes)
Un `Dockerfile` multi-étapes standard Next.js (output `standalone`) convient ; pensez à `prisma generate` à l'étape build et à passer `DATABASE_URL` au runtime uniquement.

## 5. Tâches de fond (jobs)

- L'outbox `Job` est vidée par `runJobs()` : notifications e-mail, événements commande/paiement/abonnement.
- `GET|POST /api/jobs/run` (auth `JOBS_RUN_KEY` par l'en-tête `x-jobs-key`, ou `CRON_SECRET` par `Authorization: Bearer`) exécute jusqu'à **50 jobs** (valeur fixe dans `src/app/api/jobs/run/route.ts`), puis le **rapprochement des paiements** (`reconcilePendingAttempts`), le cycle de vie des abonnements (`runBillingLifecycle`), les campagnes programmées, les crédits mensuels et, au plus toutes les 9 minutes, le balayage périodique (automatisations, notifications, récapitulatifs quotidiens, purge des données des connecteurs IA).
- Fréquence recommandée : toutes les 5 minutes (`vercel.json` sur Vercel Pro, ou cron externe, voir §4).
- Worker permanent `pnpm jobs` (`scripts/jobs-worker.ts`) : boucle qui appelle `runJobs()` puis, un cycle sur six, le rapprochement des paiements. Il ne lance ni le cycle de vie des abonnements, ni les campagnes, ni les crédits, ni le balayage : gardez le cron de `/api/jobs/run` même avec ce worker. Variables :

  | Variable | Défaut | Rôle |
  |---|---|---|
  | `JOBS_BATCH` | `25` | Nombre maximum de jobs exécutés par cycle du worker (argument de `runJobs`). Sans effet sur `/api/jobs/run`, fixé à 50. |
  | `JOBS_INTERVAL_MS` | `10000` | Pause entre deux cycles du worker, en millisecondes. | Les jobs en échec sont rejoués avec backoff (1, 2, 4, 8, 16 min) jusqu'à `maxAttempts` (5) puis passent `DEAD` : visibles et rejouables dans **/admin/taches**.
- Vague 2 : le balayage de `/api/jobs/run` planifie aussi la synchronisation du catalogue WhatsApp (étape `catalogSync`, `scheduleDueCatalogSyncs()`, job `social.sync`). Les webhooks sortants passent par les jobs `webhook.fanout` et `webhook.deliver`, les factures automatiques par `payment.succeeded` : le worker doit tourner pour qu'ils partent. Deux planifications quotidiennes ne sont **pas encore** appelées par `/api/jobs/run` : `scheduleDailyFxRefresh()` (taux BCE, appelée paresseusement par la vitrine quand le dernier taux a plus de 24 h) et `scheduleIdempotencyPurge()` (appelée de façon opportuniste par les `POST` de l'API REST). Pour les rendre indépendantes du trafic, ajoutez dans `src/app/api/jobs/run/route.ts`, à côté de `scheduleDailyGiftCardSweeps()` :
  ```ts
  try { await (await import("@/lib/currency/rates")).scheduleDailyFxRefresh(); } catch (e) { console.error("[jobs/run] fx", e); }
  try { await (await import("@/lib/api/idempotency")).scheduleIdempotencyPurge(); } catch (e) { console.error("[jobs/run] idempotency", e); }
  ```
- Surveillance : `/api/health` (base, version, uptime) pour un uptime-checker (Better Uptime, UptimeRobot…). Alerte si le dashboard admin affiche des jobs `DEAD` ou des notifications `FAILED`.

## 6. E-mail (Resend)

1. Créez un compte Resend, ajoutez le domaine `axi.africa`, posez les enregistrements DKIM/SPF/DMARC.
2. `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM="Axi <no-reply@axi.africa>"`.
3. Testez : inscription → e-mail de vérification reçu ; commande avec e-mail client → confirmation reçue.
4. En dev, `EMAIL_PROVIDER=console` affiche les e-mails dans le terminal.

## 6 bis. Stockage des médias (images)

Les photos produits, variantes, collections, logos et images du thème sont envoyées par le navigateur
(compressées à ~300 Ko) à `POST /api/stores/{storeId}/media`, vérifiées côté serveur (membre de la boutique,
capacité `products.manage` ou `theme.manage`, 5 Mo maximum, format JPEG/PNG/WebP/AVIF/GIF reconnu par ses
octets, jamais de SVG, dimensions lues dans l'en-tête et limitées à 8000 px de côté et 40 mégapixels, débit limité,
quota par plan réservé atomiquement avant l'écriture) puis écrites dans le stockage. La base ne garde que l'URL.
À l'enregistrement d'un produit, d'une collection, du logo ou du thème, le serveur refuse toute nouvelle image
base64 (data-URL) et tout média d'une autre boutique ; une ancienne data-URL déjà en base n'est conservée que si
elle est renvoyée à l'identique (collections, logo, thème ; pour les produits : migrez-les, voir plus bas).
Clé : `stores/{storeId}/{aaaa}/{mm}/{sha256}.{ext}` : contenu immuable, cache d'un an, doublons évités.

**En production, sans `STORAGE_DRIVER`, l'envoi d'images est refusé** (message explicite) ; l'affichage continue.

### Cloudflare R2 (recommandé : pas de frais de sortie, CDN inclus)

1. Tableau de bord Cloudflare → **R2 Object Storage** → *Create bucket* : nom `axi-media`, emplacement automatique
   (ou *Europe* si vos clients y sont majoritaires). **Aucune règle CORS à créer** : l'envoi passe par le serveur Axi,
   jamais directement du navigateur vers le bucket.
2. Bucket → **Settings → Public access → Custom Domains** → *Connect domain* : `media.axi.africa` (domaine géré par
   Cloudflare). Cloudflare crée l'enregistrement DNS et le certificat. Évitez l'URL `r2.dev` en production
   (débit limité, pas de cache).
3. **R2 → Manage R2 API Tokens** → *Create API token* : permission **Object Read & Write**, limitée au bucket
   `axi-media`. Notez l'*Access Key ID*, le *Secret Access Key* et l'endpoint `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.
4. Variables :
   ```env
   STORAGE_DRIVER="s3"
   STORAGE_ENDPOINT="https://<ACCOUNT_ID>.r2.cloudflarestorage.com"
   STORAGE_REGION="auto"
   STORAGE_BUCKET="axi-media"
   STORAGE_ACCESS_KEY_ID="…"
   STORAGE_SECRET_ACCESS_KEY="…"
   STORAGE_PUBLIC_URL="https://media.axi.africa"
   ```
5. **En-tête `nosniff` sur le domaine des médias** : R2 ne l'ajoute pas. Cloudflare → zone `axi.africa` → **Rules →
   Transform Rules → Modify Response Header** → *Create rule* : « Si » *Hostname* égal à `media.axi.africa`, « Alors »
   *Set static* `X-Content-Type-Options` = `nosniff`. Le serveur n'envoie déjà que des images raster vérifiées, avec
   le bon `Content-Type` ; l'en-tête empêche en plus tout navigateur d'interpréter un fichier autrement.
   Vérifiez : `curl -sI https://media.axi.africa/stores/<…>.jpg | grep -i nosniff`.
6. Redéployez (rebuild : la CSP `img-src` inclut l'origine de `STORAGE_PUBLIC_URL`), puis testez : ajoutez une
   photo à un produit ; elle doit s'afficher depuis `https://media.axi.africa/stores/…`.

### Autres fournisseurs

| Fournisseur | `STORAGE_ENDPOINT` | `STORAGE_REGION` | `STORAGE_FORCE_PATH_STYLE` | `STORAGE_PUBLIC_URL` |
|---|---|---|---|---|
| AWS S3 | `https://s3.<région>.amazonaws.com` | `eu-west-3`… | `0` | CloudFront devant le bucket, ou `https://<bucket>.s3.<région>.amazonaws.com` (lecture publique) |
| Supabase Storage | `https://<projet>.supabase.co/storage/v1/s3` | région du projet | `1` | `https://<projet>.supabase.co/storage/v1/object/public/<bucket>` (bucket public) |
| Backblaze B2 | `https://s3.<région>.backblazeb2.com` | `eu-central-003`… | `1` | URL « Friendly » du bucket public, ou un CDN devant |
| MinIO (auto-hébergé) | `https://minio.exemple.com` | `us-east-1` | `1` | `https://minio.exemple.com/<bucket>` (lecture anonyme) |

Le bucket doit être **lisible publiquement** (ou servi par un CDN) : les images de boutique sont publiques par nature.
Les clés d'API ne quittent jamais le serveur (signature AWS SigV4 maison, `src/lib/storage/sigv4.ts`, sans SDK).

### Pilote local en production (VPS uniquement)

`STORAGE_DRIVER=local` est accepté en production, avec un avertissement dans les journaux : fichiers écrits dans
`STORAGE_LOCAL_DIR` (défaut `.local/uploads`) et servis par `/media/…` (cache immuable, `nosniff`, CSP `sandbox`).
**Uniquement sur un serveur à disque persistant et sauvegardé**, jamais sur Vercel, Render, Netlify ou un conteneur
sans volume : les images disparaîtraient au déploiement suivant. Sans `STORAGE_DRIVER`, le pilote local n'est
utilisé en production que pour une recette sur `http://localhost` (même règle que `ALLOW_CONSOLE_EMAIL`).

### Migration des anciennes images (data-URL en base)

Avant le stockage des médias, les images étaient enregistrées en base64 dans la base. Une fois `STORAGE_*` configuré,
**avec les variables de production** dans l'environnement, et **dans un créneau creux** (la nuit, heure de vos
marchands : la migration relit et réécrit des documents volumineux) :
```bash
pnpm media:migrate --dry-run   # inventaire : nombre d'images, octets récupérables
pnpm media:migrate             # envoi + remplacement des data-URL par les URL (idempotent, relançable)
```
Champs traités : photos et options produit, image de variante, image de collection, logo et bannière, thème publié,
brouillon et historique des versions. Écritures conditionnelles : si un marchand modifie une ligne pendant la migration,
rien n'est écrasé (ligne relue puis retraitée, 5 essais ; sinon signalée et laissée pour une exécution ultérieure).
L'usage de stockage est compté à chaque objet créé. Les data-URL non migrées restent lisibles (rétrocompatibilité),
mais un produit qui en contient encore ne peut plus être enregistré tant qu'il n'est pas migré : lancez la migration
juste après le déploiement. Sauvegardez la base avant (§9). Ensuite, `VACUUM FULL "Product", "Store", "ThemeVersion", "Variant";`
rend l'espace disque au système (verrou exclusif : en heure creuse).

### Quotas et nettoyage

- Quota par boutique (`src/lib/storage/quota.ts`) : Gratuit 100 Mo, Starter 1 Go, Business 5 Go, Scale 20 Go,
  Enterprise illimité, + 10 Go par option « Stockage +10 Go ». Compteur `UsageCounter` (`media_kb`, période `all`).
  Réservation atomique avant l'écriture (UPDATE conditionnel, remboursée si l'écriture échoue) : des envois simultanés
  ne dépassent pas le quota. Un quota atteint bloque les nouveaux envois (413 avec lien vers l'abonnement), jamais l'affichage.
- Débit : 120 envois / 10 min par utilisateur, 600 / heure par boutique.
- Fichiers orphelins (image remplacée, produit supprimé) : **aucune suppression automatique en v1**.
  `pnpm media:orphans` les liste (lecture seule, délai de grâce de 24 h, `--min-age-hours N`, `--store <id>`) ;
  suppression manuelle depuis la console du fournisseur après vérification (un fichier peut encore servir dans un
  e-mail envoyé ou un lien partagé ; activez le versioning du bucket pour pouvoir annuler une erreur).
- Changement de pilote (local → s3) : recopiez le dossier dans le bucket avec les mêmes clés
  (`rclone copy .local/uploads r2:axi-media`) ; les anciennes URL `/media/…` redirigent alors (308) vers `STORAGE_PUBLIC_URL`.

## 7. Intégration des paiements **[INTÉGRATION]**

Axi distingue deux circuits totalement séparés :

| Circuit | Qui encaisse | Code | Statut dans le dépôt |
|---|---|---|---|
| **Ventes des boutiques** | le marchand (ses propres clés) | `src/lib/payments/gateways.ts` + `src/lib/payments/service.ts` | Manuel complet ; agrégateurs Paystack, pawaPay, CinetPay complets, à valider avec de vraies clés (§7.1 bis) ; passerelles historiques structurées, appels HTTP à finaliser |
| **Abonnements et options plateforme** | la plateforme (vos clés) | `src/lib/billing/platform-billing.ts` + `src/lib/billing/service.ts` | Mode `manual` complet (confirmation admin) ; modes en ligne à compléter |

### 7.1 Ventes : `src/lib/payments/gateways.ts`

Quatre adaptateurs implémentent l'interface `PaymentGateway` (`src/lib/payments/provider.ts`) :

| Adaptateur | Pays | Signature webhook | À faire |
|---|---|---|---|
| `fedapay` | BJ, TG, CI, SN, BF, ML, NE, GN | HMAC `x-fedapay-signature` | Vérifier les endpoints/champs contre la doc FedaPay, tester en sandbox (`mode=sandbox`) |
| `kkiapay` | BJ, CI, SN, TG | selon doc KkiaPay | Widget côté client + vérification serveur `transactions/status` |
| `paydunya` | CI, SN, BJ, TG, BF, ML | selon doc PayDunya | Checkout invoice + webhook IPN |
| `stripe` | cartes internationales | `Stripe-Signature` (t=, v1=) | Checkout Session ; devise XOF zéro décimale |

Chaque adaptateur expose : `initiate()` (créer la transaction, renvoyer l'URL de redirection + `providerRef`), `verifyWebhook()` (signature en temps constant, extraction `eventId`/`status`/`amount`), `fetchStatus()` (rapprochement). Les clés sont saisies **par le marchand** dans *Paiements* et stockées chiffrées (`credentialsEncrypted`, AES-256-GCM via `APP_SECRET`) ; elles ne quittent jamais le serveur.

**URL de webhook à déclarer chez chaque fournisseur :**

```
POST https://axi.africa/api/webhooks/payments/{fedapay|kkiapay|paydunya|stripe}
```

Le handler (`handleGatewayWebhook`) : lit le corps brut, retrouve la tentative (`attemptId` ou `providerRef`), vérifie la signature avec les clés de la boutique, enregistre l'événement dans `ProviderEvent` (idempotent par `(provider, eventId)`), contrôle montant/devise, puis applique le statut (`applyAttemptStatus`), un `CONFIRMED` n'est jamais rétrogradé.

**Procédure de test (sandbox) :**
1. Créez un compte sandbox chez le fournisseur ; dans *Paiements* de la boutique de test, ajoutez la méthode « passerelle » avec les clés sandbox (`mode=sandbox`).
2. Passez une commande sur la boutique, choisissez la passerelle → redirection fournisseur → payez avec les moyens de test.
3. Vérifiez : `/admin/paiements` affiche l'événement (signature **Valide**, traité), la tentative `CONFIRMED`, la commande `PAID`, un `OrderEvent` « Passerelle », un job `payment.succeeded`.
4. Testez une signature invalide (modifiez le secret) → événement `invalid_signature`, HTTP 400, commande inchangée.
5. Testez un montant falsifié → `error = amount/currency mismatch`, commande inchangée.
6. Coupez le webhook, payez, puis lancez « Rapprochement » dans `/admin/paiements` (ou attendez le cron) → `fetchStatus` confirme la tentative.

### 7.1 bis Wave et Orange Money par agrégateur (lot 1 bis) : Paystack, pawaPay, CinetPay

Objectif : encaisser automatiquement **Wave, Orange Money, MTN MoMo et Moov Money** en Côte d'Ivoire, au Sénégal et dans
d'autres pays UEMOA, sur le compte du marchand, à 0 % de commission Axi. Les trois adaptateurs
(`src/lib/payments/adapters/{paystack,pawapay,cinetpay}.ts`) sont complets ; le marchand saisit ses clés dans
*Paiements* (guide : `docs/GUIDE-BOUTIQUE.md` §13).

| Agrégateur | Pays (portefeuilles) | Parcours client | Authenticité du webhook | Remboursement API |
|---|---|---|---|---|
| `paystack` | CI : Wave, Orange Money, MTN MoMo, carte (XOF) | page Paystack hébergée | HMAC-SHA512 du corps brut (`x-paystack-signature`, clé secrète), puis relecture `GET /transaction/verify/{ref}` | oui (`POST /refund`) |
| `pawapay` | CI : Wave, Orange, MTN · SN : Wave, Orange · BJ : MTN, Moov · BF : Moov, Orange · CM : MTN, Orange | page de paiement pawaPay (15 min) ; demande poussée (USSD) si le portefeuille et le numéro sont connus | callback = simple déclencheur : `Content-Digest` contrôlé s'il est présent, puis relecture `GET /v2/deposits/{depositId}` avec le jeton (source de vérité) | oui (`POST /v2/refunds`) |
| `cinetpay` | CI : Wave, Orange, MTN, Moov · SN : Wave, Orange · BF, ML, TG, BJ, CM, GN, NE | page CinetPay hébergée (API v1) | `notify_token` (empreinte SHA-256 conservée sur la tentative, comparaison en temps constant), puis relecture `GET /v1/payment/{id}` et contrôle des identifiants | non (API v1 sans remboursement) : remboursement manuel |

URL de webhook, une par agrégateur, commune à toutes les boutiques (la boutique est retrouvée par la tentative) :

```
POST https://axi.africa/api/webhooks/payments/paystack
POST https://axi.africa/api/webhooks/payments/pawapay
POST https://axi.africa/api/webhooks/payments/cinetpay   (transmise automatiquement à chaque paiement, rien à déclarer)
```

En local, exposez le port 3000 en HTTPS (ex. `cloudflared tunnel --url http://localhost:3000`) et mettez cette adresse
dans `NEXT_PUBLIC_APP_URL` le temps des tests. Aucune variable d'environnement nouvelle.

**Paystack (Côte d'Ivoire)**
1. Créez un compte sur paystack.com en choisissant la Côte d'Ivoire ; le mode test est disponible immédiatement, la
   production après la vérification d'entreprise (KYC).
2. *Settings → API Keys & Webhooks* : copiez la **clé secrète de test** `sk_test_…` ; renseignez l'**URL de webhook de
   test** ci-dessus.
3. Dans Axi (boutique en Côte d'Ivoire, XOF) : ajoutez « Paystack », cochez Wave / Orange Money / MTN MoMo / carte,
   collez la clé, **Tester la connexion** → « Connexion Paystack réussie en mode test ».
4. Passez une commande, choisissez ce moyen → page Paystack → payez avec un moyen de test proposé par Paystack.
5. Vérifiez : `/admin/paiements` (événement `charge.success`, signature valide, traité), tentative `CONFIRMED`, commande
   payée, job `payment.succeeded`.
6. Production : remplacez par `sk_live_…` et déclarez l'URL de webhook *live*.

**pawaPay (CI, SN, BJ, BF, CM)**
1. Créez un compte sandbox sur dashboard.sandbox.pawapay.io (la production est ouverte après l'onboarding).
2. *System configuration → API tokens* : générez un jeton. *Callback URLs* : URL de rappel des **dépôts** =
   `…/api/webhooks/payments/pawapay` (et, si vous le souhaitez, celle des remboursements à la même adresse : sans effet
   sur les commandes).
3. Dans Axi : ajoutez « pawaPay », environnement **Test (sandbox)**, collez le jeton, **Tester la connexion** : le
   message liste les pays activés et avertit si l'URL de rappel manque.
4. Commande de test → page pawaPay → utilisez un **numéro de test sandbox** (docs.pawapay.io/v2/docs/test_numbers :
   certains numéros réussissent, d'autres échouent volontairement).
5. Vérifiez comme pour Paystack ; testez aussi un numéro « échec » (commande en échec de paiement) et l'abandon de la
   page (tentative expirée au rapprochement après 20 min).
6. Production : nouveau jeton de production et environnement « Production ».

**CinetPay (CI, SN et autres pays UEMOA / CEMAC)**
1. Créez un compte marchand CinetPay ; récupérez pour **le pays de la boutique** la clé API (`sk_test_…` en test) et le
   mot de passe API.
2. Dans Axi : ajoutez « CinetPay », pays du compte = pays de la boutique (contrôlé), clé, mot de passe, **Tester la
   connexion** (authentification `POST /v1/oauth/login`).
3. Commande de test → page CinetPay → paiement de test. La notification arrive sur l'URL transmise ; le statut est relu
   chez CinetPay avant confirmation.
4. Montants acceptés : 100 à 2 500 000 XOF par paiement (message clair au client sinon). Remboursements : depuis
   l'espace CinetPay (notification « Remboursement à effectuer à la main »).

Scénarios de recette R1 à R9 pour chaque agrégateur : `docs/RECETTE.md` §4 quinquies.

**Points d'intégration à confirmer avec de vraies clés** (isolés dans des fonctions commentées « POINT
D'INTÉGRATION », jamais devinés) :
- **E-mail du client** (`payerEmail`, `adapters/util.ts`) : Paystack et CinetPay exigent un e-mail ; sans e-mail client,
  une adresse technique `client-<téléphone>@<domaine>` est utilisée. Si un fournisseur la refuse, c'est l'unique
  endroit à changer.
- **Montant dans `GET /v1/payment` (CinetPay)** : non documenté par les SDK officiels. S'il est présent, il fait foi ;
  sinon le montant fixé par notre serveur à l'initialisation est retenu (le client ne peut pas le modifier sur la page
  CinetPay).
- **Paiement poussé Paystack** (`POST /charge` + `mobile_money.provider`) : codes opérateurs de Côte d'Ivoire non
  publiés dans les sources accessibles ; la page hébergée est utilisée.
- **Signature RFC 9421 des callbacks pawaPay** (facultative) : non exigée, car la relecture authentifiée fait foi ; à
  ajouter en défense en profondeur si souhaité (clé publique `GET /v2/public-key/http`).
- **Demande poussée pawaPay sans page** : le checkout ne demande pas encore le portefeuille et le numéro du client.
  Pour l'activer : les demander dans `src/app/s/[slug]/commander/**`, puis renseigner `PaymentAttempt.channel` et
  `PaymentAttempt.payerPhone` (E.164 sans « + ») à la création de la tentative dans `createOrder` ;
  `initiateGatewayPayment` les transmet déjà aux adaptateurs. Améliorations d'affichage recommandées au même endroit :
  exposer `channels` dans `paymentMethods` (`page.tsx`) et afficher les portefeuilles en pastilles (`channelLabel()` de
  `src/lib/payments/channels.ts`), afficher `instructions` aussi pour les moyens `GATEWAY`.
- **Encaissement en devise étrangère** : `initiateGatewayPayment` initie toujours `amountDue` en `order.currency`
  (`GATEWAY_PRESENTMENT_CHARGE = false`, `src/lib/currency/payment.ts`) : tout est encaissé en FCFA avec la mention
  « Vous serez débité de … », ce qui est exact pour l'acheteur. Pour l'activer : initier avec `attempt.amount` /
  `attempt.currency`, puis passer le drapeau à `true` (les passerelles qui acceptent la devise sont lues dans
  `PaymentMethod.currencies`). Le remboursement au prorata de `presentmentAmounts` reste alors à écrire.
- Sources : paystack.com/docs répond 403 aux robots ; les informations Paystack viennent des dépôts officiels
  PaystackOSS (OpenAPI, extraits de doc, serveur MCP). docs.cinetpay.com était injoignable ; CinetPay vient des SDK
  officiels (`cinetpay-js`, `cinetpay-php-sdk`, API v1). pawaPay : docs.pawapay.io (v2).

### 7.2 Abonnements et options : `src/lib/billing/platform-billing.ts`

La plateforme facture deux choses : les **plans** (`Invoice` d'abonnement) et les **options** (`AddOnPurchase` lié à une `Invoice` par `invoiceId`). Les deux suivent un chemin unique de confirmation : `confirmInvoicePayment()` (`src/lib/billing/service.ts`).

| Zone | Devise | Fournisseur | Variable |
|---|---|---|---|
| Afrique | XOF | `manual` (défaut), `fedapay`, `kkiapay` | `PLATFORM_BILLING_PROVIDER_AFRICA` |
| Monde | EUR | `manual` (défaut), `stripe` | `PLATFORM_BILLING_PROVIDER_WORLD` |

`PLATFORM_BILLING_PROVIDER` (ancienne variable unique) sert de repli si elle est compatible avec la zone.

**Mode `manual` (fonctionnel sans clé)** : la facture affiche `PLATFORM_MOMO_NUMBER` (zone Afrique) ou `PLATFORM_BANK_DETAILS` (zone Monde). Le marchand clique « J'ai payé » : un ticket est créé. L'admin vérifie l'encaissement puis clique **Marquer payée** dans `/admin/abonnements` ou `/admin/options` :

- facture de plan : abonnement `ACTIVE` sur le plan et la période de la facture, job `subscription.changed` ;
- facture d'option : `activateAddOnPurchase()` (`src/lib/addons/service.ts`) passe l'achat en `ACTIVE`, crédite le portefeuille pour un pack (validité 12 mois) et ouvre un ticket pour une prestation (domaine, création clé en main) ;
- dans les deux cas : audit `invoice.paid` et `admin.invoice.marked_paid`, idempotent (une facture déjà payée ne déclenche rien).

**Modes en ligne** : complétez `createPlatformCheckout()` et `verifyPlatformWebhook()` avec **vos** clés plateforme (commentaires pas à pas dans le fichier), puis déclarez le webhook :

```
POST https://axi.africa/api/webhooks/billing/{fedapay|kkiapay|stripe}
```

Le handler (`src/app/api/webhooks/billing/[provider]/route.ts`) vérifie la signature sur le corps brut, enregistre l'événement (`ProviderEvent`, `provider = billing_{provider}`, idempotent), contrôle montant et devise, puis appelle `confirmInvoicePayment()`. Une simple redirection navigateur ne vaut **jamais** paiement.

**Cycle de vie** (`src/lib/billing/lifecycle.ts`, à appeler par le cron via `runBillingLifecycle()`) : fin d'essai vers Gratuit, facture de renouvellement 3 jours avant l'échéance (`RENEWAL_LINK_DAYS_BEFORE`), changements programmés en fin de période, `PAST_DUE` à l'échéance puis `SUSPENDED` après 7 jours (`PAST_DUE_GRACE_DAYS`), expiration et renouvellement des options récurrentes.

**Tests en sandbox** :
1. `PLATFORM_BILLING_PROVIDER_WORLD=stripe`, `STRIPE_SECRET_KEY=sk_test_...`, `STRIPE_WEBHOOK_SECRET=whsec_...` ; `stripe listen --forward-to localhost:3000/api/webhooks/billing/stripe`.
2. Connecté avec `awa@saveurs-afrique.demo` (boutique en EUR), passez au plan Scale : payez avec la carte de test 4242 4242 4242 4242.
3. Vérifiez : facture `PAID`, abonnement Scale `ACTIVE`, événement visible dans `/admin/paiements`, entrée `invoice.paid` dans `/admin/audit`.
4. Achetez un pack de 1 000 crédits IA : après le webhook, `/admin/credits` affiche +1 000 crédits IA.
5. Rejouez le même événement : HTTP 200, aucune double activation. Modifiez le secret : HTTP 400, facture inchangée.
6. Zone Afrique : même scénario avec `PLATFORM_BILLING_PROVIDER_AFRICA=fedapay`, `FEDAPAY_MODE=sandbox` et la boutique `chez-aicha`.

### 7.3 WhatsApp Cloud API : `/api/webhooks/whatsapp`

- `GET` : vérification de l'abonnement Meta (`hub.challenge`) avec `WHATSAPP_VERIFY_TOKEN`.
- `POST` : messages entrants et statuts de remise, signés `x-hub-signature-256` (HMAC-SHA256 du corps brut avec `WHATSAPP_APP_SECRET`). La boutique est retrouvée par `Integration(kind = whatsapp_cloud).config.phoneNumberId`, l'événement est idempotent (`ProviderEvent`, `provider = whatsapp`).
- À déclarer dans l'application Meta : `https://axi.africa/api/webhooks/whatsapp`, champs `messages`. Les messages remis consomment les crédits (`src/lib/credits.ts`), les échecs les remboursent.
- Lot 1 bis : un message `type: "order"` (panier envoyé depuis le catalogue WhatsApp) crée un panier Axi et une réponse avec le lien de la boutique (`handleCatalogOrderMessage`, `src/lib/social/whatsapp-order.ts`, 1 crédit `WA_UTILITY`). L'envoi effectif des messages sortants reste le point d'intégration du worker `notification.send`.

### 7.3 bis Catalogue WhatsApp (Meta Graph) **[INTÉGRATION]**

- **Flux** (sans compte développeur) : `/s/{slug}/feeds/meta.xml`, `google.xml`, `tiktok.csv`, à coller dans Commerce Manager, Merchant Center ou TikTok Ads Manager. Le proxy de sous-domaine exclut les chemins `.xml` : donnez l'adresse `{NEXT_PUBLIC_APP_URL}/s/{slug}/feeds/...` (celle affichée dans l'écran).
- **Synchronisation directe** : `src/lib/social/graph-client.ts` appelle `POST https://graph.facebook.com/{META_GRAPH_VERSION|v26.0}/{catalog_id}/items_batch` (suivi asynchrone par `check_batch_request_status`), corps `{ item_type: "PRODUCT_ITEM", allow_upsert: true, requests }`, en-tête `Authorization: Bearer`. Le jeton est celui de l'intégration WhatsApp Cloud de la boutique (permission `catalog_management`), chiffré dans `Integration.secretsEncrypted`.
- **Non testé contre Meta** (pas de compte) : à valider avec un jeton système et l'ID de catalogue fournis par le porteur, en particulier le format de `additional_image_link` (chaîne séparée par des virgules) et les prix XOF sans décimales. Les erreurs asynchrones du traitement Meta restent visibles dans Commerce Manager ; le suivi `check_batch_request_status?handle=` est une extension prévue.
- En développement, `SOCIAL_SYNC_DRY_RUN=1` (ignorée en production) remplace l'appel par un client qui accepte tout.
- Procédure : créer un catalogue « E-commerce » dans Commerce Manager, le relier au numéro (Gestionnaire WhatsApp › Outils du compte › Catalogue), saisir l'ID du catalogue dans *Intégrations › Catalogue WhatsApp*, cocher « Synchroniser automatiquement », « Synchroniser maintenant » puis vérifier les articles dans Commerce Manager. Pour un même catalogue : flux **ou** synchronisation, pas les deux.

### 7.3 ter Mode partenaire WhatsApp (Embedded Signup) **[INTÉGRATION]**

Axi comme **fournisseur de technologies** Meta : le marchand connecte SON numéro WhatsApp Business en quelques clics depuis *WhatsApp › Connexion partenaire*, sans recopier d'identifiant. La saisie manuelle des identifiants Cloud API reste disponible en dessous (« Connexion manuelle (avancé) ») — les deux chemins alimentent la même `Integration(whatsapp_cloud)`, donc le webhook (§7.3), l'envoi (`src/lib/whatsapp/send.ts`) et le catalogue (§7.3 bis) fonctionnent sans changement.

- **Flux** (`src/lib/whatsapp/embedded-signup.ts`, action `finishEmbeddedSignup`) : le bouton charge le SDK JS Meta, lance l'Embedded Signup et récupère un `code` d'autorisation + `phone_number_id` + `waba_id`. Côté serveur, Axi (1) échange le `code` contre un jeton d'accès business non expirant, (2) lit le numéro (valide l'accès, récupère numéro affiché / nom vérifié), (3) **abonne la WABA du marchand à l'app Axi** (ses événements arrivent sur le webhook partagé), (4) **enregistre le numéro** sur la Cloud API avec un PIN. Le jeton + PIN sont chiffrés dans `Integration.secretsEncrypted` ; l'intégration passe directement `active`.
- **Variables d'environnement** (porteur, voir `.env.example`) : `NEXT_PUBLIC_META_APP_ID`, `NEXT_PUBLIC_META_ESIGNUP_CONFIG_ID` (publics, lus **au build** : ils affichent le bouton et élargissent la CSP `frame-src` vers `facebook.com`), `META_APP_SECRET` (à défaut `WHATSAPP_APP_SECRET` — même secret d'app). Sans ces variables, `partnerModeConfig()` renvoie null, le bouton est masqué et seule la saisie manuelle s'affiche : rien n'est cassé. Rebâtir après modification des `NEXT_PUBLIC_*`.
- **Prérequis côté Meta (porteur, hors code)** : vérification de l'entreprise ; « Devenir fournisseur de technologies » (revue complète de l'application) ; une configuration Embedded Signup (rubrique *Gestion des clients* de l'app) dont l'ID alimente `NEXT_PUBLIC_META_ESIGNUP_CONFIG_ID` ; **ligne de crédit / paiement partagé** configurée dans Meta Business Settings pour facturer au nom des clients. L'app Meta et son secret sont les mêmes que pour le webhook (§7.3).
- **Non testé contre Meta** (pas de compte) : les appels Graph (`oauth/access_token`, lecture du numéro, `subscribed_apps`, `register`) sont couverts par `tests/whatsapp-embedded-signup.test.ts` avec un `fetch` simulé ; à valider de bout en bout avec l'application Meta réelle et un numéro de test. Le code tolère un numéro déjà enregistré ; les messages d'erreur ne divulguent jamais le secret d'application ni le jeton.

### 7.3 quater Modèles de messages et santé du numéro **[INTÉGRATION]**

- Écran *WhatsApp › Modèles de messages* (`src/app/app/[storeId]/whatsapp/modeles/`) : liste les modèles de la WABA et leur statut (Approuvé / En validation / Rejeté), permet d'en **créer** (soumission à validation) et d'en **supprimer**, et affiche la **santé du numéro** (nom vérifié, note de qualité, numéro affiché). Les modèles ne sont pas stockés côté Axi : lecture/écriture directes via Graph (`src/lib/whatsapp/templates.ts`, endpoint `message_templates`), jeton + `wabaId` lus sur l'intégration `whatsapp_cloud` active. Dégradation propre si Meta échoue (jeton expiré, réseau). Couvert par `tests/whatsapp-templates.test.ts` (`fetch` simulé) ; non testé contre Meta. L'**envoi** par modèle (hors fenêtre 24 h) reste à câbler dans le worker `notification.send`.

### 7.4 Rapprochement et exploitation

- `reconcilePendingAttempts()` est appelé par `/api/jobs/run` et par le bouton admin : il interroge `fetchStatus` pour les tentatives `INITIATED` de plus de 10 minutes.
- Tableau de bord : `/admin/paiements` (événements, signatures invalides, tentatives par statut).
- Conservez les `ProviderEvent` (preuve en cas de litige) ; purge > 12 mois à prévoir.
- Agrégateurs (lot 1 bis) : rapprochement des tentatives `INITIATED` aussi par le bouton « Vérifier les paiements en attente » de la boutique ; une session abandonnée expire (Paystack et CinetPay après 30 min, pawaPay après 20 min).

### 7.5 Taux de change (BCE) **[INTÉGRATION]**

- Source : `https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml` (HTTPS, sans clé, délai 10 s, pas de redirection), analysée par `src/lib/currency/ecb.ts`. Miroir possible par `FX_ECB_URL` (HTTPS uniquement) ; `FX_REFRESH_DISABLED=1` n'écrit que les parités fixes (environnements sans Internet).
- Parités fixes toujours disponibles : 1 € = 655,957 FCFA (XOF et XAF), XOF = XAF.
- Job `fx.refresh` : en cas d'échec réseau ou de fichier illisible, le job échoue (retenté puis `DEAD`, visible dans `/admin/taches`) ; les anciens taux restent et deviennent inaffichables après 72 h (la boutique s'affiche alors en FCFA).
- Planification : `scheduleDailyFxRefresh()` (une fois par jour UTC, réservation `PlatformSetting` `fx.daily_refresh`), appelée aujourd'hui par la vitrine quand le dernier taux BCE a plus de 24 h ; ajoutez l'appel au cron (§5) pour ne pas dépendre du trafic.
- Taux manuels plateforme : actions `adminSetPlatformRate` et `adminRefreshFxRates` (permission `settings.manage`, audit `admin.fx.*`), sans écran admin pour l'instant.

### 7.6 Webhooks sortants et API REST (lot 2)

- Référence développeur : `docs/API-REST.md` ; OpenAPI 3.1 servie à `/api/openapi-2026-10.json`. Aucune variable obligatoire.
- Les livraisons partent du worker (`webhook.fanout`, `webhook.deliver`) : le cron de `/api/jobs/run` (ou `pnpm jobs`) doit tourner. Délai de 10 s par envoi, sans redirection ; relances de 1 min à 24 h, abandon après 8 essais.
- Pare-feu sortant : le serveur doit pouvoir joindre les URL https des marchands ; les adresses privées, internes et de bouclage sont refusées (contrôle SSRF avec résolution DNS).
- **Test local de bout en bout** : `AXI_WEBHOOKS_ALLOW_LOCALHOST=1` (ignorée si `NODE_ENV=production`) accepte `http(s)://localhost|127.0.0.1|[::1]` sur tout port, uniquement le bouclage. Elle doit être présente dans le processus qui **crée** le point (serveur Next, ou script) et dans celui qui **livre** (`pnpm jobs` ou `/api/jobs/run`). Le récepteur doit écouter en double pile (`::`), car `localhost` se résout d'abord en `::1`.

## 8. Sécurité avant mise en ligne

- [ ] `APP_SECRET` fort et unique par environnement ; `JOBS_RUN_KEY` fort.
- [ ] Mots de passe de démo changés ou seed non exécuté en production.
- [ ] `ADMIN_MFA_OPTIONAL` absent ou à `0` ; chaque membre de l'équipe plateforme a activé la double authentification (Console > Équipe et sécurité).
- [ ] HTTPS partout, cookies `Secure` (automatique en `NODE_ENV=production`).
- [ ] En-têtes de sécurité (`next.config.ts`) en place ; ajoutez une CSP si vous n'embarquez pas de widget tiers.
- [ ] Rate limiting sur connexion / inscription / checkout (reverse proxy ou middleware), **[INTÉGRATION]** selon l'hébergeur.
- [ ] Comptes acheteurs : budget `AXI_OTP_DAILY_BUDGET` adapté, Turnstile configuré si la boutique est exposée à des robots. Plafonds intégrés : 500 codes par boutique et par jour, 10 envois par numéro sur 24 h (toutes boutiques), 3 par couple IP + numéro / 15 min, 20 échecs par numéro et par boutique sur 24 h (blocage, compteur `otp:locked`).
- [ ] Cookie acheteur : `__Host-axi_buyer` (Secure, Path=/, sans Domain) sur les sous-domaines et domaines personnalisés en HTTPS ; `axi_buyer` limité à `Path=/s/{slug}` sur le domaine principal (le préfixe `__Host-` y est impossible) et en HTTP local.
- [ ] `SOCIAL_SYNC_DRY_RUN` et `AXI_WEBHOOKS_ALLOW_LOCALHOST` absents de la production (ignorées si `NODE_ENV=production`, mais ne les laissez pas traîner) ; `FX_ECB_URL`, si définie, en HTTPS.
- [ ] Paiements par agrégateur : clés `sk_live_…` (ou environnement « Production » pour pawaPay) seulement après la recette en mode test ; URL de webhook *live* déclarées chez Paystack et pawaPay.
- [ ] Sauvegardes testées (§9). Journal d'audit consulté régulièrement.

## 9. Sauvegardes

- Base : snapshots quotidiens automatiques du fournisseur (Supabase/Neon/Railway) + `pg_dump` hebdomadaire hors site :
  ```bash
  pg_dump "$DATABASE_URL" -Fc -f axi-$(date +%F).dump && aws s3 cp axi-*.dump s3://axi-backups/
  ```
- Images : stockées hors de la base (§6 bis), donc **absentes du dump**. R2/S3 : activez le versioning du bucket ou une
  copie périodique (`rclone sync r2:axi-media b2:axi-media-backup`). Pilote local (VPS) : sauvegardez `STORAGE_LOCAL_DIR`
  avec la base. Les anciennes images non migrées (data-URL) restent dans le dump.
- Testez une restauration sur une base vide au moins une fois par trimestre.

## 10. Checklist de mise en production

1. [ ] Variables d'environnement renseignées (§1), `pnpm typecheck && pnpm lint && pnpm test && pnpm build` verts.
2. [ ] `prisma migrate deploy` exécuté.
3. [ ] DNS + wildcard + certificats OK ; `https://{slug}.axi.africa` répond.
4. [ ] Cron des jobs actif toutes les 5 minutes (Vercel Pro ou cron externe, §4) : `/api/jobs/run` renvoie `{"ok":true}` avec la clé, 401 sans.
5. [ ] `/api/health` → `{"status":"ok"}`.
6. [ ] E-mail de vérification reçu en conditions réelles.
7. [ ] Recette `docs/RECETTE.md` passée sur un téléphone Android réel.
8. [ ] Compte admin créé, 2e admin de secours, sessions de démo révoquées.
9. [ ] Pages légales (CGU, confidentialité) relues par un juriste.
10. [ ] Monitoring/alerting branché sur `/api/health` et les erreurs serveur.
11. [ ] Coordonnées de paiement manuel de la plateforme remplacées : les valeurs d'exemple de `.env.example` (`PLATFORM_MOMO_NUMBER="+229 01 00 00 00 00"`, `PLATFORM_BANK_DETAILS="IBAN à renseigner"`) sont remplacées par les vraies, ou saisies dans **Administration › Paramètres** (`/admin/parametres`), qui remplacent alors les variables d'environnement.
12. [ ] `ADMIN_MFA_OPTIONAL` et `ALLOW_CONSOLE_EMAIL` **absents** de l'environnement de production (MFA obligatoire pour l'équipe plateforme, e-mails envoyés par Resend).
13. [ ] Stockage des médias configuré (§6 bis) : `STORAGE_DRIVER=s3` et ses variables ; une photo produit téléversée s'affiche depuis `STORAGE_PUBLIC_URL` ; `pnpm media:migrate --dry-run` puis `pnpm media:migrate` exécutés si la base contient d'anciennes images.
14. [ ] Vague 2 : migrations `20261011170000_lot1bis_paiements_whatsapp`, `20261011180000_lot2_international_contenu` et `20261011190000_lot4_personnalisation` appliquées (`prisma migrate deploy`) ; bibliothèque de sections alimentée dans `/admin/bibliotheque` (le seed de démonstration, à ne pas lancer en production, en ajoute 6 par `seedLibrary`) ; taux BCE rafraîchis (job `fx.refresh` DONE dans `/admin/taches`) ; un agrégateur de paiement testé en sandbox (§7.1 bis) ; flux Meta d'une boutique Business lu par Commerce Manager (§7.3 bis) ; un webhook sortant reçu et sa signature vérifiée (§7.6).
