import { getStoreContext, listUserStores } from "@/lib/auth/permissions";
import { AppShell } from "@/components/app/app-shell";
import { PLANS } from "@/config/plans";
import { db } from "@/lib/db";
import { currentPeriod } from "@/lib/utils";
import { billingZone } from "@/lib/billing/rules";
import { PlatformAnnouncements } from "@/components/app/announcements";
import { BillingPauseBanner } from "@/components/app/billing-pause-banner";

export default async function StoreLayout({ children, params }: { children: React.ReactNode; params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const ctx = await getStoreContext(storeId);
  const store = ctx.store;
  const plan = PLANS[ctx.planId];
  const sub = store.subscription;
  const trialDaysLeft = sub?.status === "TRIALING" && sub.trialEndsAt ? Math.max(0, Math.ceil((sub.trialEndsAt.getTime() - Date.now()) / 86400000)) : null;

  const [stores, newOrders, unread, ordersUsage, productsCount, pendingReturns] = await Promise.all([
    listUserStores(ctx.user.id),
    ctx.can("orders.view") ? db.order.count({ where: { storeId: store.id, status: "NEW" } }) : Promise.resolve(0),
    db.conversation
      .aggregate({ where: { storeId: store.id, status: { not: "CLOSED" } }, _sum: { unreadCount: true } })
      .then((r) => r._sum.unreadCount ?? 0)
      .catch(() => 0),
    db.usageCounter
      .findUnique({ where: { storeId_metric_period: { storeId: store.id, metric: "orders", period: currentPeriod() } } })
      .then((r) => r?.value ?? 0),
    db.product.count({ where: { storeId: store.id, status: { not: "ARCHIVED" } } }),
    // Retours à traiter (demandes à examiner et articles reçus à résoudre), compteur de la barre latérale.
    ctx.can("orders.view") ? db.returnRequest.count({ where: { storeId: store.id, status: { in: ["REQUESTED", "RECEIVED"] } } }) : Promise.resolve(0),
  ]);

  return (
    <AppShell
      user={{ name: ctx.user.name, email: ctx.user.email, isAdmin: ctx.user.isPlatformAdmin }}
      store={{
        id: store.id,
        name: store.name,
        slug: store.slug,
        status: store.status,
        logoUrl: store.logoUrl,
        onboardingCompleted: store.onboardingCompleted,
      }}
      stores={stores.filter((s) => s.status !== "ARCHIVED").map((s) => ({ id: s.id, name: s.name, slug: s.slug, logoUrl: s.logoUrl }))}
      role={ctx.role}
      plan={{ id: ctx.planId, name: plan.name, trialDaysLeft, pastDue: sub?.status === "PAST_DUE", paused: store.status === "PAUSED" }}
      counts={{ newOrders, unread, returns: pendingReturns }}
      usage={{
        orders: { used: ordersUsage, limit: plan.limits.ordersPerMonth },
        products: { used: productsCount, limit: plan.limits.products },
      }}
    >
      <BillingPauseBanner storeId={store.id} storeStatus={store.status} sub={sub ?? null} canBill={ctx.can("billing.manage")} now={new Date()} />
      <PlatformAnnouncements planId={ctx.planId} zone={billingZone(sub, store.currency)} />
      {children}
    </AppShell>
  );
}
