<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Axi — résumé pour les agents

- **Stack** : Next.js 16 App Router, React 19, TypeScript strict, Tailwind v4, Prisma + PostgreSQL, Zod 4, Lucide, Vitest.
- **Commandes** : `pnpm db:push` · `pnpm db:seed` · `pnpm dev` · `pnpm jobs` · `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- **Conventions** : voir `docs/CONVENTIONS.md` (server actions `guard` + `parseForm` + `requireStore`, isolation par `storeId`, kit UI `src/components/ui`, textes français, mobile-first). Résumé complet dans `CLAUDE.md`.
- **Docs** : `docs/PRODUIT.md`, `docs/ARCHITECTURE.md`, `docs/DEPLOIEMENT.md` (points d'intégration paiements), `docs/RECETTE.md`.
