import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { MembershipRole, Store, Subscription } from "@prisma/client";
import { db } from "@/lib/db";
import { getCurrentUser, type CurrentUser } from "./session";
import { PLANS, type PlanId } from "@/config/plans";
import { effectivePlanId as effectivePlanFromRules } from "@/lib/billing/rules";
import { storeRoleStillAllowed } from "@/lib/admin/roles";

/**
 * Capacités par rôle — principe du moindre privilège.
 * Chaque action serveur appelle requireStore(storeId, "capability").
 *
 * Lots 2 et 4 : les specs ne créent AUCUNE capacité ; affectation retenue pour les équipes (capacités existantes) :
 *  - langues (spec lot 2 §6), devises, taxes, blog (lot 2) : store.settings ; factures : orders.manage ; données personnelles
 *    dans les webhooks : customers.view du créateur (spec lot 2 §4.1) ;
 *  - webhooks sortants et API REST (lot 2) : integrations.manage (propriétaire ; miroir du scope MCP webhooks:write) ;
 *  - toute la personnalisation (lot 4) : theme.manage ; bibliothèque de sections : console admin, settings.manage.
 */
export type Capability =
  | "store.view"
  | "store.settings"
  | "store.publish"
  | "store.delete"
  | "products.manage"
  | "orders.view"
  | "orders.manage"
  | "orders.assign"
  | "customers.view"
  | "customers.manage"
  | "coupons.manage"
  | "delivery.manage"
  | "payments.manage"
  | "payments.confirm"
  | "team.manage"
  | "billing.manage"
  | "integrations.manage"
  | "theme.manage"
  | "export"
  // Lot 1 : cartes cadeaux, retours (les remises automatiques et offres réutilisent coupons.manage ; l'avoir, customers.manage)
  | "giftcards.manage"
  | "returns.manage"
  | "returns.receive"
  // Lot 3 : encaisser à la caisse en magasin (OWNER, MANAGER, STAFF ; plafonds de remise par rôle)
  | "pos.sell";

const ROLE_CAPS: Record<MembershipRole, Set<Capability>> = {
  OWNER: new Set<Capability>([
    "store.view", "store.settings", "store.publish", "store.delete", "products.manage", "orders.view",
    "orders.manage", "orders.assign", "customers.view", "customers.manage", "coupons.manage", "delivery.manage",
    "payments.manage", "payments.confirm", "team.manage", "billing.manage", "integrations.manage", "theme.manage", "export",
    "giftcards.manage", "returns.manage", "returns.receive", "pos.sell",
  ]),
  MANAGER: new Set<Capability>([
    "store.view", "store.settings", "store.publish", "products.manage", "orders.view", "orders.manage", "orders.assign",
    "customers.view", "customers.manage", "coupons.manage", "delivery.manage", "payments.confirm", "theme.manage", "export",
    "giftcards.manage", "returns.manage", "returns.receive", "pos.sell",
  ]),
  STAFF: new Set<Capability>(["store.view", "orders.view", "orders.manage", "returns.receive", "pos.sell"]),
  SUPPORT: new Set<Capability>(["store.view", "orders.view", "customers.view"]),
};

export function roleHas(role: MembershipRole, cap: Capability): boolean {
  return ROLE_CAPS[role].has(cap);
}

export { ROLE_LABELS } from "./roles";

export class AuthError extends Error {
  constructor(message = "Accès refusé", public code: "UNAUTHENTICATED" | "FORBIDDEN" = "FORBIDDEN") {
    super(message);
  }
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");
  return user;
}

export async function requireUserOrThrow(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError("Connexion requise", "UNAUTHENTICATED");
  // m9 : aucune action de l'espace marchand sans e-mail vérifié.
  if (!user.emailVerified) throw new AuthError("Vérifiez d'abord votre adresse e-mail.", "UNAUTHENTICATED");
  return user;
}

export async function requirePlatformAdmin(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");
  if (!user.isPlatformAdmin) redirect("/app");
  // Mêmes règles que la console (e-mail vérifié, rôle, MFA obligatoire) ; import dynamique : context.ts importe ce module.
  const { getAdminContext } = await import("@/lib/admin/context");
  return (await getAdminContext()).user;
}

export type StoreContext = {
  user: CurrentUser;
  store: Store & { subscription: Subscription | null };
  role: MembershipRole;
  planId: PlanId;
  can: (cap: Capability) => boolean;
};

/** Liste des boutiques accessibles à l'utilisateur courant. */
export const listUserStores = cache(async (userId: string) => {
  const memberships = await db.membership.findMany({
    where: { userId, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    include: { store: { select: { id: true, name: true, slug: true, status: true, logoUrl: true } } },
    orderBy: { createdAt: "asc" },
  });
  return memberships.map((m) => ({ ...m.store, role: m.role }));
});

/**
 * Charge la boutique et vérifie l'appartenance + la capacité demandée.
 * Lève AuthError (actions) — utiliser getStoreContext pour les pages (redirige).
 */
export const loadStoreContext = cache(async (storeId: string): Promise<StoreContext | null> => {
  const user = await getCurrentUser();
  if (!user) return null;
  const store = await db.store.findUnique({ where: { id: storeId }, include: { subscription: true } });
  if (!store) return null;

  let role: MembershipRole | null = null;
  const membership = await db.membership.findUnique({ where: { userId_storeId: { userId: user.id, storeId } } });
  if (membership && (!membership.expiresAt || membership.expiresAt > new Date())) role = membership.role;
  // Défense en profondeur : une adhésion SUPPORT résiduelle ne vaut que si l'utilisateur a encore support.access.
  if (role === "SUPPORT") {
    const row = await db.user.findUnique({ where: { id: user.id }, select: { isPlatformAdmin: true, platformRole: true } });
    if (!storeRoleStillAllowed(role, row)) role = null;
  }
  // Pas d'accès implicite pour l'admin plateforme : il passe par la console /admin, ou par
  // grantSupportAccess (Membership SUPPORT datée, motivée et auditée) pour entrer dans une boutique.
  if (!role) return null;

  const planId = effectivePlanId(store.subscription);
  return { user, store, role, planId, can: (cap) => roleHas(role!, cap) };
});

export async function requireStore(storeId: string, cap: Capability = "store.view"): Promise<StoreContext> {
  const ctx = await loadStoreContext(storeId);
  if (!ctx) throw new AuthError("Boutique introuvable ou accès refusé");
  if (!ctx.user.emailVerified) throw new AuthError("Vérifiez d'abord votre adresse e-mail.", "UNAUTHENTICATED");
  if (!ctx.can(cap)) throw new AuthError("Votre rôle ne permet pas cette action");
  if (ctx.store.status === "SUSPENDED" && cap !== "store.view" && cap !== "export" && cap !== "billing.manage") {
    throw new AuthError("Boutique suspendue : contactez le support");
  }
  return ctx;
}

/** Variante pour les pages : redirige au lieu de lever. */
export async function getStoreContext(storeId: string, cap: Capability = "store.view"): Promise<StoreContext> {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");
  const ctx = await loadStoreContext(storeId);
  if (!ctx) redirect("/app");
  if (!ctx.can(cap)) redirect(`/app/${storeId}?denied=1`);
  return ctx;
}

/**
 * Plan effectif (fonctions accessibles), règles V4 (détail : src/lib/billing/rules.ts) :
 *  - essai en cours : plan d'essai, seul accès payant sans facture ;
 *  - plan payant : uniquement avec une période PAYÉE (`currentPeriodEnd` n'est posé que par
 *    confirmInvoicePayment) ; une montée en gamme non réglée ne change pas `planId` ;
 *  - au-delà de PAST_DUE_GRACE_DAYS après l'échéance (= `dueAt` de la facture de renouvellement) : Gratuit ;
 *  - SUSPENDED / CANCELLED : Gratuit. Les données ne sont jamais supprimées.
 */
export function effectivePlanId(sub: Pick<Subscription, "planId" | "status" | "trialEndsAt" | "currentPeriodEnd"> | null, now = new Date()): PlanId {
  return effectivePlanFromRules(sub, now);
}

export function planFeature(planId: PlanId, feature: keyof (typeof PLANS)["FREE"]["features"]): boolean {
  return PLANS[planId].features[feature];
}
