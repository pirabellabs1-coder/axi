# CLAUDE.md — Axi

SaaS de commerce WhatsApp pour l'Afrique francophone (Bénin d'abord). Textes et UI en **français**, mobile-first.

## Stack
Next.js 16 App Router (RSC + Server Actions), React 19, TypeScript strict, Tailwind v4 (tokens dans `src/app/globals.css`), Prisma + PostgreSQL, Zod 4, Lucide. Kit UI maison dans `src/components/ui` (pas de shadcn ni de lib de formulaires). Tests Vitest dans `tests/`.

## Commandes
```
pnpm install            # postinstall : prisma generate
pnpm db:push            # schéma (dev)      pnpm db:migrate  # migration
pnpm db:seed            # démo : admin (SEED_ADMIN_*) + demo@axi.africa / Demo-Axi-2026! + 3 boutiques
pnpm dev                # http://localhost:3000     pnpm jobs  # worker de tâches local
pnpm typecheck && pnpm lint && pnpm test && pnpm build   # vérification avant livraison
```

## Conventions (détail : `docs/CONVENTIONS.md`)
- Server actions : `"use server"` dans `src/lib/<domaine>/actions.ts`, pattern `guard` + `parseForm(zod)` + `requireStore(storeId, capability)` ; **toujours filtrer par `storeId`** ; `audit()` pour le sensible ; `enqueue()` dans la même transaction.
- Admin : `requirePlatformAdmin()` sur les pages ; dans les actions, `getCurrentUser` + `AuthError` (jamais de redirect) ; actions préfixées `admin.*` dans l'audit.
- `params` / `searchParams` sont des Promises. Pages dynamiques (pas de `cacheComponents`).
- UI : composants du kit, classes Tailwind avec tokens (`bg-primary`, `text-ink-muted`, `border-line`…), états vide/chargement/erreur, cibles ≥ 44 px, `<Money>` / `formatMoney`, dates via `formatDate*`.
- Montants entiers (XOF sans décimales) ; prix et stock recalculés serveur (`src/lib/commerce/pricing.ts`, `createOrder`).
- Pas de nouvelle dépendance sans raison forte. Ne pas modifier `src/components/ui`, `prisma/schema.prisma`, `src/lib/commerce/*`, `src/lib/payments/*`, `src/lib/jobs.ts` sans accord.

## Documentation
`docs/PRODUIT.md` (décisions, plans), `docs/ARCHITECTURE.md` (modèle, isolation, machines d'états, jobs, sécurité), `docs/DEPLOIEMENT.md` (mise en prod, **intégration des paiements**), `docs/RECETTE.md` (tests manuels), `design-system/axi/MASTER.md` (identité visuelle).
