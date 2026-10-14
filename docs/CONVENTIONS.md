# Conventions de code — Axi

Lire aussi : `design-system/axi/MASTER.md` (identité visuelle) et `docs/PRODUIT.md` (décisions produit).

## Stack
- Next.js 16 App Router (`src/app`), TypeScript strict, Tailwind v4 (tokens dans `src/app/globals.css` via `@theme`), Prisma + PostgreSQL (`prisma/schema.prisma`), Zod 4, Lucide icons.
- `cacheComponents` est désactivé : modèle classique. Les pages qui lisent cookies/DB sont dynamiques ; `export const dynamic = "force-dynamic"` est déjà posé sur `src/app/app/layout.tsx`.
- `params` et `searchParams` sont des **Promises** : `const { storeId } = await params;`.
- Server Components par défaut ; `"use client"` uniquement pour l'interactivité.
- **Proxy** (`src/proxy.ts`, ex-middleware) : sous-domaine `{slug}.{APP_DOMAIN}` → `/s/{slug}` ; domaine custom → `/d/{host}`.
- Pas de nouvelles dépendances sans raison forte (pas de shadcn, pas de lib de formulaires). Tout est dans `src/components/ui`.

## Arborescence
```
src/app/(marketing)/…        site vitrine (layout avec SiteHeader/SiteFooter)
src/app/(auth)/…             connexion, inscription, vérification, mot de passe
src/app/app/…                espace marchand (layout force-dynamic, exige user vérifié)
src/app/app/[storeId]/…      modules de la boutique (layout = AppShell avec sidebar)
src/app/s/[slug]/…           boutique publique
src/app/suivi/[token]/…      suivi de commande acheteur
src/app/admin/…              administration plateforme
src/app/api/…                route handlers (webhooks, jobs, health)
src/lib/<domaine>/actions.ts server actions ("use server")
src/lib/<domaine>/*.ts       services / fonctions pures
src/components/ui/*          kit UI (Button, Field/Input/Select/Textarea/Checkbox/Switch, Badge, Card, Table, Dialog, Toast, Tabs, misc: Money/Avatar/EmptyState/Skeleton/Stat/PageHeader/Alert)
src/components/forms/*       SubmitButton (useFormStatus), FormMessage + fieldError
src/components/app/*         AppShell, UserMenu
src/components/marketing/*   SiteHeader, SiteFooter, RevealObserver
```

## Server actions (pattern obligatoire)
```ts
"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireStore } from "@/lib/auth/permissions";
import { guard, parseForm, fail, success, zBool, zOptionalString, type ActionResult } from "@/lib/action";

const schema = z.object({ storeId: z.string(), name: z.string().trim().min(2) });

export async function createThing(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(schema, formData);
    if ("error" in parsed) return parsed.error;
    const ctx = await requireStore(parsed.data.storeId, "products.manage"); // ← capacité (voir permissions.ts)
    // … db.* toujours filtré par storeId: ctx.store.id
    revalidatePath(`/app/${ctx.store.id}/produits`);
    return success(undefined, "Enregistré");
  });
}
```
- **Toujours** `requireStore(storeId, capability)` ; **toujours** filtrer par `storeId` (isolation multi-tenant).
- Vérifier les quotas/fonctionnalités de plan via `ctx.planId` + `PLANS[ctx.planId].features.x` ou `checkXQuota()` (`src/lib/commerce/quotas.ts`). Message d'upsell clair avec lien `/app/{storeId}/abonnement`.
- Journaliser les actions sensibles avec `audit()` (`src/lib/audit.ts`).
- Événements métier : `enqueue()` (`src/lib/jobs.ts`) **dans la même transaction**.
- Côté client : `const [state, action] = useActionState(createThing, undefined)` + `<FormMessage state={state} />` + `fieldError(state, "name")` + `<SubmitButton>`. Pour les actions sans formulaire : `useTransition` + `toast.success/error`.

## UI
- Composants du kit uniquement ; classes Tailwind avec les tokens (`bg-primary`, `text-ink-muted`, `border-line`, `rounded-[var(--radius-lg)]`…). Pas de couleurs hex en dur dans les composants (sauf thème de boutique).
- Chaque écran : état vide (`EmptyState`), chargement (`loading.tsx` avec `Skeleton`), erreur (`error.tsx`), succès (toast).
- Textes en **français**, vouvoiement, concis. Montants via `<Money amount currency />` ou `formatMoney()`. Dates via `formatDate/formatDateTime/relativeTime`.
- Mobile-first : tables dans `<Table>` (scroll horizontal) ; cibles ≥ 44px ; `inputMode` adapté.
- Icônes : `lucide-react` uniquement. Jamais d'emoji comme icône.

## Données
- Montants entiers (XOF sans décimales). Jamais de calcul de prix côté client pour la validation : `src/lib/commerce/pricing.ts` + `createOrder()`.
- Secrets de passerelles : `encryptSecret()` avant écriture, jamais renvoyés au client.
- Images : champ JSON `images: [{url, alt}]` (et `imageUrl` ailleurs). On n'enregistre **que des URL** : https, ou un média
  téléversé via `uploadImage()` (`src/lib/storage/client.ts` → `POST /api/stores/{storeId}/media`). Ne jamais produire de
  data-URL (encore lues pour les données anciennes ; `pnpm media:migrate`). Valider avec `isStoredMediaUrl()` /
  `isDisplayableImageUrl()` (`src/lib/storage/public-url.ts`) ; pour Open Graph / JSON-LD, `shareableImageUrl()`.

## Vérification
```
pnpm prisma generate && pnpm typecheck && pnpm lint && pnpm test
```
