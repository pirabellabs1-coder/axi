# Brief commun — refonte V4 (à lire par chaque équipe)

Le porteur a rejeté la v1 : « ça ressemble à du DIY, les skills n'ont pas été utilisés, la marketplace est une catastrophe ».
Objectif : un produit au niveau Take App / Shopify / Linear, conforme au **cahier des charges V4** (tarifs en euros, 5 plans, 10 options, crédits, boîte WhatsApp partagée, entonnoir, campagnes, avis, fidélité, modèles par secteur).

## À lire avant d'écrire une ligne
1. `design-system/axi/MASTER.md` (v2 : Forest + Lime, Geist, boutons pilule, double-bezel, mouvement).
2. `docs/CONVENTIONS.md` (pattern des server actions, `requireStore`, isolation par `storeId`).
3. `src/config/plans.ts` (plans V4, `planPrice(planId, zone, interval)`, `zoneForCurrency`, `ADD_ONS`, `CREDIT_LABELS`, `COMPARISON`).
4. `src/config/media.ts` (photos réelles Unsplash : `unsplash(id, w, h)`, `MEDIA`, `PRODUCT_PHOTOS`).
5. `prisma/schema.prisma` (nouveaux modèles : AddOnPurchase, CreditLedger, Conversation, Message, QuickReply, Campaign, Review, LoyaltyLedger, StorePage ; Store.sector/metaPixelId/gaMeasurementId/loyaltyConfig ; Subscription.zone/currency ; PlanId = FREE | STARTER | BUSINESS | SCALE | ENTERPRISE).
6. Kit UI `src/components/ui/*` (déjà restylé : `Button`/`ButtonLink` avec prop `trailing`, `Card`, `Bezel`, `Field`/`Input`/`Select`/`Textarea`, `Badge`, `Table`, `Dialog`, `toast`, `EmptyState`, `Skeleton`, `Stat`, `PageHeader`, `Alert`, `ThemeToggle`).

## Skills à charger (outil Skill) et appliquer
`ui-ux-pro-max` (lire `.claude/skills/ui-ux-pro-max/SKILL.md`, checklist pré-livraison), `high-end-visual-design`, `design-taste-frontend` (pré-flight check §14), `emil-design-eng`, `premium-web-motion`, `accessibility-wcag`, `responsive-design`. Selon le périmètre : `landing-page-cro`, `marketing-copywriting`, `forms-and-validation`, `dataviz`.

## Règles non négociables
- Français partout, vouvoiement, **zéro tiret cadratin « — » et demi-cadratin « – »** dans les textes visibles (utiliser « - », virgule, point, deux-points).
- Tarifs en **euros** (zone Monde) avec bascule **FCFA** (zone Afrique). Formatage via `formatMoney(amount, currency)` : EUR en centimes, XOF entier.
- Vraies photos (`MEDIA`, `PRODUCT_PHOTOS`) via `next/image` (`sizes`, `priority` au-dessus de la ligne de flottaison). Aucune fausse capture d'écran en `<div>` dans un hero : préférer une vraie photo + une petite carte UI réelle (composant) superposée.
- Thème clair et sombre (tokens), mobile-first (375 / 768 / 1280), cibles ≥ 44 px, `prefers-reduced-motion`.
- Server Components par défaut ; `"use client"` pour l'interactivité seulement. `params`/`searchParams` sont des Promises.
- Ne pas modifier : `prisma/schema.prisma`, `src/config/plans.ts`, `src/config/media.ts`, `src/lib/commerce/*`, `src/lib/payments/*`, `src/lib/jobs.ts`, `src/app/globals.css`, `src/components/ui/*` (sauf l'équipe « Espace marchand cœur » qui possède le kit). Besoin d'un changement ? Le signaler dans le rapport final ; créer ses propres composants dans son dossier.
- Pas de `pnpm install`, pas de `pnpm dev` (un serveur tourne déjà sur http://localhost:3000), ne tuer aucun processus node.

## Vérifier
- `pnpm exec tsc --noEmit` : zéro erreur dans ton périmètre.
- `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/<route>` sur chacune de tes routes (200 attendu). Espace marchand : ajouter `-b "axi_session=testsession0000000000000000000000000000000000000000000000000001"` (propriétaire démo, boutique `chez-aicha` id `cmv2fe4d00002ibj0dtjvx5kf`). Admin : `...0002`. Vérifier dans le HTML qu'aucun message d'erreur (« Un problème est survenu ») n'apparaît.
- Rapport final court : fichiers créés/modifiés, choix de design, ce qui reste à faire, besoins de changement hors périmètre.
