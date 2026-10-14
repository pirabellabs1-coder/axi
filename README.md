# Axi : votre boutique WhatsApp, prête en 5 minutes

Axi est un SaaS de commerce conversationnel pour l'Afrique francophone, puis le monde : un commerçant crée
sa boutique en ligne, vend sur WhatsApp et les réseaux sociaux, encaisse en Mobile Money, par carte ou à la
livraison, et gère commandes, conversations, clients et campagnes depuis son téléphone.

- Marché de lancement : Bénin, Côte d'Ivoire, Sénégal, Togo (FCFA), zone Monde en euros.
- Interface 100 % française, mobile-first, pensée pour des Android d'entrée de gamme.
- **0 % de commission sur les ventes** : la plateforme facture uniquement les abonnements et les options.
- Tarifs V4 : 5 plans (Gratuit, Starter, Business, Scale, Enterprise), 10 options, crédits WhatsApp et IA.
  Détail et décisions : [`docs/PRODUIT.md`](docs/PRODUIT.md).
- Constructeur de boutique : éditeur de thème par sections et blocs avec aperçu en direct, brouillon, publication et
  versions ; menus de navigation ; fiches produits avec variantes couleur et taille (pastilles, images) ; collections
  manuelles et automatiques ; inventaire par variante ; import et export CSV. Guide :
  [`docs/GUIDE-BOUTIQUE.md`](docs/GUIDE-BOUTIQUE.md).
- Connecteur IA : serveur MCP marchand (jetons API, OAuth) et MCP vitrine public pour piloter la boutique depuis
  Claude, ChatGPT ou Cursor. Référence : [`docs/API-MCP.md`](docs/API-MCP.md).
- Vague 2 (lot 1 bis, lot 2 hors langues, lot 4A) : Wave, Orange Money, MTN MoMo et Moov Money en ligne par
  agrégateur (Paystack, pawaPay, CinetPay) ; catalogue WhatsApp synchronisé et flux Meta, Google, TikTok ;
  multi-devises ; TVA, factures et avoirs ; blog ; webhooks sortants signés et API REST `/api/v1`
  ([`docs/API-REST.md`](docs/API-REST.md)) ; éditeur avec scores qualité, animations, modèles alternatifs, champs
  personnalisés et données dynamiques, sections enregistrées et bibliothèque, contenus par audience, nouvelles
  sections. Feuille de route : [`docs/FEUILLE-DE-ROUTE.md`](docs/FEUILLE-DE-ROUTE.md).

## Aperçu

```
Site vitrine        /  /tarifs  /fonctionnalites  /marketplace  /aide  /contact
Espace marchand     /app/{storeId}   tableau de bord, commandes, produits, collections, inventaire, clients,
                                     boîte WhatsApp, entonnoir, campagnes, avis, fidélité, apparence (éditeur
                                     de thème), navigation, connecteurs IA, abonnement, options, paiements,
                                     devises, taxes et factures, blog, champs personnalisés, catalogue
                                     WhatsApp, webhooks et API
Boutique publique   /s/{slug} ou {slug}.axi.africa   catalogue, panier, checkout invité, blog, flux
                                     catalogues /s/{slug}/feeds/…, suivi /suivi/{token} (et facture)
API REST            /api/v1   lecture (Business) et écriture (Scale et plus), OpenAPI /api/openapi-2026-10.json
Administration      /admin   revenus (MRR EUR et FCFA), catalogue des prix, abonnements et factures,
                             options, crédits, boutiques, utilisateurs, paiements, tickets, tâches, audit
```

## Stack

| Couche | Choix |
|---|---|
| Framework | Next.js 16 (App Router, Server Components, Server Actions), React 19, TypeScript strict |
| Style | Tailwind CSS v4 (tokens dans `src/app/globals.css`, thèmes clair et sombre), kit UI maison `src/components/ui`, icônes Lucide |
| Données | PostgreSQL et Prisma (`prisma/schema.prisma`) |
| Auth | Sessions cookie HttpOnly, mots de passe Argon2id, vérification e-mail, rôles par boutique |
| Jobs | Outbox transactionnelle (`Job`) et worker (`/api/jobs/run` via cron, ou `pnpm jobs` en dev) |
| E-mail | Console (dev), Resend (production) |
| Médias | Stockage objet S3 compatible (Cloudflare R2 recommandé) en production, disque local en dev (`src/lib/storage`) |
| Tests | Vitest (41 fichiers, base simulée en mémoire) et Playwright (7 parcours de bout en bout) |

## Démarrage local

Prérequis : Node 22+, pnpm 10. Aucune installation de PostgreSQL n'est nécessaire.

```bash
# 1. Dépendances (postinstall : prisma generate)
pnpm install

# 2. Variables d'environnement
cp .env.example .env
#    DATABASE_URL="postgresql://axi:axi@localhost:5433/axi?schema=public"
#    APP_SECRET=<32+ caractères aléatoires>
#    node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

# 3. PostgreSQL embarqué sur le port 5433 (terminal dédié, Ctrl+C pour arrêter)
pnpm db:local       # données dans .local/pg, aucune installation système

# 4. Schéma et données de démo (autre terminal)
pnpm db:push        # crée les tables (dev). En production : pnpm prisma migrate deploy
                    # (migration initiale livrée : prisma/migrations/20261011000000_init)
pnpm db:seed        # équivalent : pnpm exec prisma db seed

# 5. Lancer
pnpm dev            # http://localhost:3000
pnpm jobs           # optionnel : worker de tâches toutes les 10 s
```

Vous préférez votre propre base ? Docker (`docker run -e POSTGRES_PASSWORD=axi -e POSTGRES_DB=axi -p 5432:5432 -d postgres:16`)
ou Supabase / Neon / Railway : copiez simplement l'URL dans `DATABASE_URL`.

## Données de démonstration

Le seed (`prisma/seed.ts`) est **idempotent** : relancez-le pour remettre la démo à zéro. Il ne touche que les
boutiques de démo (repérées par leur slug) et les comptes listés ci-dessous. Toutes les photos sont de vraies
photos (Unsplash, `src/config/media.ts`).

### Comptes

| Rôle | E-mail | Mot de passe |
|---|---|---|
| Admin plateforme | `SEED_ADMIN_EMAIL` (défaut `admin@axi.africa`) | `SEED_ADMIN_PASSWORD` (défaut `Admin-Axi-2026!`) |
| Marchand démo (3 boutiques) | `demo@axi.africa` | `Demo-Axi-2026!` |
| Marchande, Le Maquis de Tanti Rosine | `rosine@maquis-tanti-rosine.demo` | `Demo-Axi-2026!` |
| Marchande, Atelier Beauté Nafi | `nafi@atelier-beaute-nafi.demo` | `Demo-Axi-2026!` |
| Marchande, Salon Belle Tresse | `akossiwa@belle-tresse.demo` | `Demo-Axi-2026!` |
| Marchand, Cabinet Médical Santé Plus | `dr.adjovi@sante-plus.demo` | `Demo-Axi-2026!` |
| Marchande, Saveurs d'Afrique Paris | `awa@saveurs-afrique.demo` | `Demo-Axi-2026!` |
| Marchand, Bijoux de Ganvié | `senan@bijoux-ganvie.demo` | `Demo-Axi-2026!` |
| Employée (STAFF) de Dantokpa Mode | `benedicte@dantokpa-mode.demo` | `Demo-Axi-2026!` |

### Boutiques

| Boutique | Adresse | Ville | Secteur | Abonnement |
|---|---|---|---|---|
| Chez Aïcha Pâtisserie (vedette) | `/s/chez-aicha` | Abidjan | patisserie | Business en essai (FCFA) |
| Dantokpa Mode (vedette) | `/s/dantokpa-mode` | Cotonou | mode | Business mensuel actif, options membre en plus et pack marketing |
| Tech Hub Cotonou | `/s/tech-hub-cotonou` | Cotonou | general | Starter mensuel, facture de renouvellement à payer |
| Le Maquis de Tanti Rosine | `/s/maquis-tanti-rosine` | Abomey-Calavi | restaurant | Business annuel, geste commercial de crédits |
| Atelier Beauté Nafi (vedette) | `/s/atelier-beaute-nafi` | Dakar | beaute | Scale mensuel, pack IA, domaine, pack utilitaire en attente de paiement |
| Salon Belle Tresse | `/s/salon-belle-tresse` | Lomé | salon | Starter impayé (facture en retard) |
| Cabinet Médical Santé Plus | `/s/cabinet-sante-plus` | Porto-Novo | clinique | Gratuit |
| Saveurs d'Afrique Paris | `/s/saveurs-afrique-paris` | Paris | general | Business mensuel en **EUR** (zone Monde), 3 options |
| Bijoux de Ganvié | `/s/bijoux-ganvie` | Cotonou | mode | Starter annuel |

Chaque boutique a 14 à 48 commandes sur 60 jours (statuts et paiements variés, remboursements), des clients
avec consentements, un coupon, ses zones et créneaux, des avis (approuvés et en attente), des pages « À propos »
et FAQ. Les boutiques Business et Scale ont en plus : conversations WhatsApp à toutes les étapes de l'entonnoir,
réponses rapides, campagnes (brouillon, programmée, envoyée avec résultats), programme de fidélité, portefeuilles
de crédits cohérents avec la consommation. Les numéros de téléphone sont fictifs.

> Changez les mots de passe de démo avant toute mise en ligne. Ne lancez pas le seed en production.

## Structure

```
prisma/schema.prisma          modèle de données (multi-tenant : tout porte storeId)
prisma/migrations/            migration initiale 20261011000000_init (base vide vers schéma complet)
prisma/seed.ts                données de démo (tsx)
src/app/(marketing)/          site vitrine et marketplace
src/app/(auth)/               connexion, inscription, vérification, mot de passe
src/app/app/[storeId]/        espace marchand
src/app/s/[slug]/             boutique publique
src/app/suivi/[token]/        suivi de commande acheteur
src/app/admin/                administration plateforme
src/app/api/                  webhooks (ventes, facturation, WhatsApp), /api/jobs/run, /api/health
src/config/plans.ts           plans, zones, options, crédits (source unique du catalogue)
src/config/media.ts           photos (Unsplash)
src/lib/<domaine>/actions.ts  server actions ("use server")
src/lib/<domaine>/*.ts        services et fonctions pures
src/lib/billing/              facturation plateforme (service, cycle de vie, fournisseurs)
src/lib/storage/              stockage des médias (pilotes local et S3/SigV4, téléversement, quotas)
scripts/                      worker de jobs, migration et inventaire des médias
src/lib/admin/                actions et indicateurs de l'administration
src/components/ui/            kit UI
tests/                        tests Vitest (tests/helpers/fake-db.ts : base simulée en mémoire)
e2e/                          tests Playwright
docs/                         CONVENTIONS, PRODUIT, ARCHITECTURE, DEPLOIEMENT, RECETTE, GUIDE-BOUTIQUE, API-MCP…
design-system/axi/MASTER.md   identité visuelle
```

## Scripts

| Commande | Rôle |
|---|---|
| `pnpm dev` / `pnpm build` / `pnpm start` | Next.js |
| `pnpm db:local` | PostgreSQL embarqué sur le port 5433 (dev) |
| `pnpm db:push` | Synchronise le schéma (dev, sans migration) |
| `pnpm db:migrate` | `prisma migrate dev` (crée une migration) |
| `pnpm db:seed` | Données de démo (idempotent) |
| `pnpm db:studio` | Prisma Studio |
| `pnpm jobs` | Worker de tâches local (boucle 10 s) |
| `pnpm media:migrate [--dry-run]` | Déplace les anciennes images base64 de la base vers le stockage des médias (idempotent) |
| `pnpm media:orphans` | Liste les médias stockés qui ne sont plus référencés (lecture seule) |
| `pnpm typecheck` / `pnpm lint` / `pnpm test` | Vérifications |
| `pnpm e2e` / `pnpm e2e:report` | Tests Playwright et leur rapport HTML |

Vérification complète avant livraison :

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

## Tests

### Vitest (`pnpm test`)

114 fichiers, 1 483 tests (au 11/10/2026), sans PostgreSQL ni réseau : les tests qui touchent aux données utilisent une base simulée en
mémoire (`tests/helpers/fake-db.ts`). Familles, par préfixe de fichier dans `tests/` :

| Famille | Fichiers | Couvre |
|---|---|---|
| Plans et facturation | `plans`, `proration`, `billing*`, `marketing-pricing` | prix mensuels et annuels, zones, prorata, cycle de facturation, plan et crédits accordés après paiement, prix affichés sur le site vitrine |
| Commerce | `pricing*`, `order-state`, `order-variant-availability` | prix effectifs, prix surchargés et promotions, totaux et codes promo, machine d'états des commandes, variantes non commandables |
| Catalogue | `catalog-*`, `collections-*` | variantes, collections manuelles et automatiques, import et export CSV, stock en delta |
| Boutique et thème | `storefront-*`, `theme*` | rendu du catalogue et des variantes, document de thème, opérations et compatibilité de l'éditeur |
| Administration | `admin-*`, `mfa` | indicateurs, rôles plateforme, double authentification obligatoire, TOTP |
| Sécurité | `security-*` | authentification, identifiants, codes promo, liens Markdown |
| Médias | `storage-*` | signature SigV4 (vecteurs officiels AWS), octets magiques (SVG refusé), clés et traversée de chemin sur `/media`, contrôle d'accès du téléversement, quotas, migration des data-URL |
| Connecteur IA | `mcp-*` | jetons et scopes, protocole JSON-RPC, OAuth, durcissement, isolation entre boutiques |
| Divers | `utils`, `whatsapp`, `qr`, `ai-parse`, `automations` | utilitaires, messages WhatsApp, QR codes, assistant IA, automatisations |

### Playwright (`pnpm e2e`)

7 specs dans `e2e/`, à lancer sur un build de production : voir [Tests de bout en bout](#tests-de-bout-en-bout-playwright).

Recette manuelle de bout en bout : [`docs/RECETTE.md`](docs/RECETTE.md).

## Documentation

- [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) : conventions de code (à lire avant de contribuer)
- [`docs/PRODUIT.md`](docs/PRODUIT.md) : décisions produit, plans, options, crédits
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) : modèle de données, isolation, machines d'états, jobs, sécurité
- [`docs/DEPLOIEMENT.md`](docs/DEPLOIEMENT.md) : mise en production et **points d'intégration des paiements**
- [`docs/RECETTE.md`](docs/RECETTE.md) : scénarios de test manuels
- [`docs/GUIDE-BOUTIQUE.md`](docs/GUIDE-BOUTIQUE.md) : guide commerçant (éditeur de thème, produits et variantes, collections, menus, inventaire, ventes et fidélité, paiements Wave / Orange Money, catalogue WhatsApp, devises, taxes et factures, blog, webhooks, champs personnalisés)
- [`docs/CONSTRUCTEUR-BOUTIQUE.md`](docs/CONSTRUCTEUR-BOUTIQUE.md) : conception du constructeur de boutique (protocole d'aperçu, contrats du moteur de thème)
- [`docs/FEUILLE-DE-ROUTE.md`](docs/FEUILLE-DE-ROUTE.md) : lots livrés et à venir
- [`docs/AUDIT-SECURITE.md`](docs/AUDIT-SECURITE.md) : audits de sécurité et statut des correctifs
- [`docs/API-MCP.md`](docs/API-MCP.md) : connecteurs IA (serveur MCP, jetons API, OAuth 2.1, commerce agentique)
- [`docs/API-REST.md`](docs/API-REST.md) : API REST `/api/v1` et webhooks sortants (signature, événements, idempotence)
- `docs/vague2/` : rapports d'équipes de la vague 2 (historique, consolidé dans les documents ci-dessus)

## Connecteurs IA (MCP)

Chaque boutique peut être pilotée depuis Claude, ChatGPT, Cursor ou tout client MCP :

- **Serveur MCP marchand** `POST /api/mcp` (Streamable HTTP sans état, spécification 2025-06-18) : 19 outils (catalogue, stock, commandes, clients, promotions, rapports), authentification par **jeton API** (`axi_live_…`, créé dans *Boutique › Connecteurs IA*) ou **OAuth 2.1** (connexion en un clic depuis Claude.ai / ChatGPT, plan Business et plus).
- **MCP vitrine public** `POST /api/mcp/store/{slug}` et `/s/{slug}/llms.txt` : un assistant trouve les produits et prépare un lien de panier, l'acheteur valide lui-même.
- Scopes, quotas par plan, journal des appels, révocation, arrêt d'urgence dans `/admin/connecteurs-ia`. Page publique : `/developpeurs`.

```bash
claude mcp add --transport http axi http://localhost:3000/api/mcp --header "Authorization: Bearer axi_live_..."
```

Référence complète : [`docs/API-MCP.md`](docs/API-MCP.md).

## Points d'intégration laissés au porteur

Le dépôt fonctionne de bout en bout avec les paiements **manuels** : ventes en espèces ou Mobile Money avec
référence confirmée par le marchand, factures d'abonnement et d'options confirmées par l'admin. Les passerelles en
ligne (FedaPay, KkiaPay, PayDunya, Stripe), la facturation automatique et l'API WhatsApp officielle sont
structurées (adaptateurs, webhooks signés, idempotence, rapprochement) mais doivent être activées avec vos clés et
testées en sandbox : voir [`docs/DEPLOIEMENT.md`](docs/DEPLOIEMENT.md).

Vague 2 : les agrégateurs Wave / Orange Money (Paystack, pawaPay, CinetPay) sont complets mais à valider avec de vraies
clés de test (§7.1 bis) ; la synchronisation du catalogue par l'API Graph de Meta n'a pas été testée contre Meta (§7.3 bis,
`META_GRAPH_VERSION`, `SOCIAL_SYNC_DRY_RUN` en développement) ; les taux de change viennent de la BCE (§7.5,
`FX_ECB_URL`, `FX_REFRESH_DISABLED`).

Stockage des images : en local, les fichiers vont dans `.local/uploads/` (servis par `/media/…`). En production,
renseignez les variables `STORAGE_*` de votre bucket (Cloudflare R2 recommandé), puis lancez `pnpm media:migrate` :
pas à pas dans [`docs/DEPLOIEMENT.md`](docs/DEPLOIEMENT.md) §6 bis.

## Tests de bout en bout (Playwright)

7 specs dans `e2e/` (`01-public` à `07-mcp`), parcours réels dans un navigateur : vitrine, marketplace, achat client,
création de boutique jusqu'à la commande livrée, isolation entre boutiques, modules de l'espace marchand,
facturation et console admin, connecteur IA.

À lancer sur un **build de production** local (plus rapide et plus stable que `pnpm dev`) :

```bash
pnpm db:local                                  # Postgres embarqué (terminal dédié)
pnpm build
ALLOW_CONSOLE_EMAIL=1 pnpm start -p 3100       # autre terminal ; e-mails affichés dans le terminal
E2E_BASE_URL=http://localhost:3100 pnpm e2e
pnpm e2e:report                                # rapport HTML (captures et traces des échecs)
```

`ALLOW_CONSOLE_EMAIL=1` est nécessaire parce qu'un build de production refuse le mode e-mail `console` ; la dérogation
n'est acceptée que si `NEXT_PUBLIC_APP_URL` pointe sur `http://localhost` ou `http://127.0.0.1`.

Les tests créent leurs propres comptes `@e2e.test` et les suppriment à la fin. `PLAYWRIGHT_CHROMIUM` permet d'indiquer un Chromium déjà installé.
