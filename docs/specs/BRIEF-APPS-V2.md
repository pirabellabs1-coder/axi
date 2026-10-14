# Brief commun : App Store v2 (13/10/2026)

Refonte de l'espace développeur et de l'intégration des applications EXTERNES, façon Shopify :
le développeur héberge son app sur SON serveur, la connecte à Axi (identifiants OAuth, API, webhooks),
et l'app s'affiche dans l'admin du marchand (page embarquée).

Déjà en place : modèles `App`, `AppInstallation`, `StoreCollaborator` (migrations appliquées — NE PAS toucher
`prisma/schema.prisma` ni `prisma/migrations/**` ; si un champ manque, contourner et le signaler) ;
`src/lib/apps/{types,queries,actions,dev-actions,dev-logic,admin-actions,admin-logic,billing,billing-lifecycle,collaborators}.ts` ;
OAuth 2.1 (`src/lib/mcp/oauth.ts`, `src/app/oauth/authorize/**`, `src/app/api/oauth/{token,register,revoke}`) ;
API REST `/api/v1` ; webhooks sortants + anti-SSRF (`src/lib/webhooks/**`).

## Propriété des fichiers (exclusive)

| Équipe | Fichiers |
|---|---|
| **DEV — Portail développeur** | `src/app/developpeur/**`, `src/lib/apps/dev-actions.ts`, `src/lib/apps/dev-logic.ts`, nouveaux `src/lib/apps/dev-*.ts` |
| **INT — Intégration apps externes** | `src/lib/apps/actions.ts`, `src/lib/apps/queries.ts`, `src/app/app/[storeId]/applications/**`, `src/app/api/apps/**` (nouveau), nouveaux `src/lib/apps/install-*.ts`, `session-token*.ts`, `lifecycle-webhooks*.ts`, et `src/app/oauth/**` + `src/app/api/oauth/token/**` + `src/lib/mcp/oauth.ts` (extension seulement, sans casser le flux MCP existant) |
| **COL — Collaborateurs** | `src/lib/apps/collaborator-actions.ts`, `src/lib/apps/collaborator-logic.ts`, `src/app/app/[storeId]/developpeurs/**` (nouveau, côté marchand), `src/app/invitation-developpeur/**` (acceptation) |

Partagé en lecture : `src/lib/apps/collaborators.ts` (`listCollaboratorStores`, `hasCollaboratorPermission`). Ajout d'UNE ligne seulement (relire avant) dans `src/components/app/app-shell.tsx`.

## Règles
- Conventions `CLAUDE.md` / `docs/CONVENTIONS.md`. Kit `src/components/ui` NON modifiable. UI FR, mobile-first, AA, cibles ≥ 44 px, états vide/chargement/erreur.
- Ne jamais lancer `next build`, `prisma migrate/generate`, ni tuer un serveur. Dev sur http://localhost:3000.
- Vérification : `pnpm exec tsc --noEmit` (ignorer `.next/dev/types`), `pnpm lint` 0 erreur, `pnpm exec vitest run` vert, Playwright headless (Chrome système `C:/Program Files/Google/Chrome/Application/chrome.exe`, demo@axi.africa / Demo-Axi-2026!, admin@axi.africa / Admin-Axi-2026!). Captures `docs/captures/apps-v2-<equipe>-*.png`. Rate limit : supprimer les `RateLimit` dont la clé commence par `login:`.
- Doc : chaque équipe écrit `docs/apps-v2/<equipe>.md`.
