# Brief commun : vague 3 (langues, lot 3, lots 4B, 4C, 4D) — 12/10/2026

Équipes en parallèle sur la même copie du dépôt, la même base Postgres (port 5433) et le même serveur de dev (port 3000). Ce document fixe la propriété des fichiers et prime sur les tableaux d'équipes des specs.

## Règles communes
- Lire : `CLAUDE.md`, `docs/CONVENTIONS.md`, la spec du lot (`docs/specs/LOT-2-international-contenu.md` §1.1 pour les langues, `docs/specs/LOT-3-operations.md`, `docs/specs/LOT-4-personnalisation.md`), `docs/FEUILLE-DE-ROUTE.md`, `design-system/axi/MASTER.md` pour l'UI, et les acquis de la vague 2 dans `docs/vague2/*.md`.
- **Un seul responsable du schéma** : l'équipe OPS (lot 3). Personne d'autre ne touche `prisma/schema.prisma` ni `prisma/migrations/`. Le schéma des lots 4B, 4C et 4D est DÉJÀ en base (migration `20261011190000_lot4_personnalisation`) : modèles `ThemeSchedule`, `ThemeGeneration`, `Experiment`, `ExperimentStat`, `PushSubscription`, `SocialCatalogSync`, `LiveEvent`, `SavedSection`, `SectionLibraryItem`, `MetafieldDefinition`, `MetafieldValue`, plus `Store.brandKit`, `Store.pwaConfig`, `ConsentChannel.PUSH`. Le schéma des langues (`Translation`) est en base depuis `20261011180000_lot2_international_contenu`. Si un champ manque : contourner proprement et le signaler dans le rapport.
- Clés de plan, scopes MCP et types de jobs des lots 4 existent déjà (`src/config/plans.ts`, `src/lib/mcp/scopes.ts`, `src/lib/jobs.ts` : gestionnaires vides `export const handlers: JobHandlers = {}` dans le dossier de chaque équipe). Ne modifier ces fichiers partagés que par ajout d'une ligne, après les avoir relus juste avant.
- **Ne jamais modifier un fichier possédé par une autre équipe.** Exception : ajout d'UNE ligne d'enregistrement (import, entrée de registre, lien de menu dans `src/components/app/app-shell.tsx`), en relisant le fichier juste avant.
- Documentation : chaque équipe écrit dans un fichier NOUVEAU à elle, `docs/vague3/<equipe>.md`. Une étape finale consolidera. Ne pas éditer les documents principaux (`GUIDE-BOUTIQUE`, `RECETTE`, `ARCHITECTURE`, `CONSTRUCTEUR-BOUTIQUE`, `DEPLOIEMENT`, `AUDIT-SECURITE`, `API-MCP`, `API-REST`).
- Machine partagée : tests ciblés pendant le travail, suite complète une seule fois à la fin. Un seul navigateur Playwright à la fois par équipe. **Ne jamais lancer `next build`, ne jamais tuer un serveur** (dev 3000, prod 3100). Si la connexion au compte démo est bloquée, supprimer uniquement les lignes `RateLimit` dont la clé commence par `login:`.
- Qualité : actions serveur `guard` + zod + `requireStore(capacité)` + filtre `storeId` + `audit()` + `enqueue()` en transaction ; UI en français, kit `src/components/ui` non modifiable, états vide/chargement/erreur, mobile d'abord, AA, cibles ≥ 44 px ; contrôle de plan côté serveur ; tests Vitest des fonctions pures et de l'isolation entre boutiques ; aucune nouvelle dépendance sans raison forte.
- Fin de mission : `pnpm exec tsc --noEmit`, `pnpm exec vitest run`, `pnpm lint` (0 erreur), vérification réelle sur http://localhost:3000 (Playwright headless, Chrome système `C:/Program Files/Google/Chrome/Application/chrome.exe` ; demo@axi.africa / Demo-Axi-2026! et admin@axi.africa / Admin-Axi-2026!), captures dans `docs/captures/vague3-<equipe>-*.png`, rapport en français : livré, vérifié comment, écarts, fichiers hors périmètre touchés, lignes à insérer par d'autres équipes.

## Propriété des fichiers

| Équipe | Propriété exclusive |
|---|---|
| **L — Langues (lot 2 A)** | `src/i18n/**`, `src/lib/i18n/**`, `src/proxy.ts`, `src/app/s/[slug]/layout.tsx`, `src/app/app/[storeId]/langues/**`, segment de langue des routes de boutique |
| **OPS — Lot 3 (expédition, dépôts, caisse)** | `prisma/schema.prisma` et `prisma/migrations/**` (responsable unique de la vague), `src/lib/shipping/**`, `src/lib/carriers/**`, `src/lib/warehouses/**`, `src/lib/pos/**`, `src/app/app/[storeId]/livraison/**`, `src/app/app/[storeId]/expeditions/**`, `src/app/caisse/**`, `src/app/api/pos/**`, `src/app/api/webhooks/carriers/**` |
| **IA — Lot 4B** | `src/lib/ai/**`, `src/lib/brand-kit/**`, `src/app/app/[storeId]/apparence/generer/**`, `src/components/theme-editor/**` (édition en place et assistant), `src/components/storefront/live-preview.tsx` et `inline-edit*` |
| **EXP — Lot 4C** | `src/lib/theme-schedules/**`, `src/lib/experiments/**`, `src/app/app/[storeId]/apparence/{programmations,tests}/**`, `src/app/api/s/[slug]/events/**`, `src/config/occasions.ts` |
| **CAN — Lot 4D** | `src/lib/pwa/**`, `src/lib/push/**`, `src/lib/live/**`, `src/app/s/[slug]/{manifest.webmanifest,sw.js}/**`, `src/components/storefront/{status-share,sections/shoppable-video,sections/stories,sections/live-shopping}.tsx` et leurs `section-schemas/*`, `src/app/app/[storeId]/live/**` |

Zones partagées à ne toucher que par ajout d'une ligne, après relecture : `src/components/app/app-shell.tsx`, `src/lib/mcp/merchant/server.ts`, `src/lib/mcp/reference.ts`, `src/lib/theme-engine/schemas.ts` (agrégateur), `src/lib/theme-engine/render-registry.tsx`, `src/lib/jobs.ts`, `src/config/plans.ts`.

Hors vague 3, en cours par d'autres agents : site vitrine (`src/app/(marketing)/**`) et suites `e2e/**`. Ne pas y toucher.
