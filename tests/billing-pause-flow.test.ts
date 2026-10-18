/**
 * Plus de plan Gratuit — parcours sur la base PostgreSQL locale (ignoré si la base est injoignable) :
 * création ⇒ essai Business 14 j ; boutique supplémentaire couverte ; rappels J-3 / J-1 uniques ;
 * fin d'essai ⇒ pause (vitrine fermée, aucune commande, jobs sortants coupés) ; paiement ⇒ reprise ;
 * migration idempotente des abonnements Gratuits hérités.
 * Données de test (utilisateur et boutiques temporaires) supprimées en fin de fichier.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

try {
  process.loadEnvFile(".env");
} catch {
  // pas de .env : les tests sont ignorés si DATABASE_URL est absente
}

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "10.77.0.1" }),
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;replace;${url};307;` });
  },
  notFound: () => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  },
}));
vi.mock("@/lib/email", () => ({ sendMail: vi.fn(async () => ({ ok: true })) }));
// Administration : permission plateforme accordée sans MFA (seul l'effet métier est testé ici).
vi.mock("@/lib/admin/context", () => ({ requireAdminPermission: async () => ({ user: session.user, can: () => true }) }));

type U = { id: string; email: string; name: string; isPlatformAdmin: boolean; emailVerified: boolean };
const session: { user: U | null } = { user: null };
vi.mock("@/lib/auth/session", () => ({
  SESSION_COOKIE: "axi_session",
  getCurrentUser: async () => session.user,
  createSession: vi.fn(),
  destroySession: vi.fn(),
}));

const { db } = await import("@/lib/db");
const reachable = !!process.env.DATABASE_URL && (await db.$queryRaw`SELECT 1`.then(() => true).catch(() => false));

describe.skipIf(!reachable)("plus de plan Gratuit : essai, pause et reprise (base locale)", async () => {
  const { createStore, setStoreStatus, publishStore } = await import("@/lib/store/actions");
  const { changePlan, setCancelAtPeriodEnd } = await import("@/lib/billing/actions");
  const { confirmInvoicePayment } = await import("@/lib/billing/service");
  const { syncSubscription, divergentCoveredSubscriptionIds } = await import("@/lib/billing/lifecycle");
  const { reactivateStore } = await import("@/lib/admin/actions");
  const { pauseReasonOf } = await import("@/lib/billing/rules");
  const pause = await import("@/lib/billing/pause");
  const { getPublicStore, getStorefront, getPausedStorefront } = await import("@/lib/storefront/data");
  const { previewTotals, placeOrder } = await import("@/lib/storefront/actions");
  const { executeCampaign } = await import("@/lib/campaigns/service");

  const DAY = 86_400_000;
  const tag = `p${Date.now().toString(36)}`;
  let user: U;
  const storeIds: string[] = [];
  let mainId = "";
  let extraId = "";
  let productId = "";

  const form = (o: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(o)) f.set(k, v);
    return f;
  };
  const create = async (slug: string) => {
    const r = await createStore(undefined, form({ name: `Pause ${slug}`, slug, country: "FR", currency: "EUR", sector: "mode", city: "", doneForYou: "" })).catch((e: { digest?: string }) => e);
    const digest = (r as { digest?: string }).digest ?? "";
    expect(digest, JSON.stringify(r)).toContain("/app/");
    const s = await db.store.findUniqueOrThrow({ where: { slug }, include: { subscription: true } });
    storeIds.push(s.id);
    return s;
  };
  const subOf = (storeId: string) => db.subscription.findUniqueOrThrow({ where: { storeId } });
  const storeOf = (storeId: string) => db.store.findUniqueOrThrow({ where: { id: storeId } });
  const inapp = (storeId: string, prefix: string) => db.notification.count({ where: { storeId, channel: "inapp", payload: { path: ["key"], string_starts_with: prefix } } });
  const emails = (storeId: string, template: string) => db.notification.count({ where: { storeId, channel: "email", template } });

  beforeAll(async () => {
    const u = await db.user.create({ data: { email: `${tag}@pause.test`, name: "Test Pause", passwordHash: "x", emailVerifiedAt: new Date() } });
    user = { id: u.id, email: u.email, name: u.name, isPlatformAdmin: false, emailVerified: true };
    session.user = user;
  });

  afterAll(async () => {
    session.user = null;
    if (storeIds.length) {
      await db.auditLog.deleteMany({ where: { storeId: { in: storeIds } } });
      await db.job.deleteMany({ where: { storeId: { in: storeIds } } });
      await db.store.deleteMany({ where: { id: { in: storeIds } } });
    }
    if (user) {
      await db.auditLog.deleteMany({ where: { actorId: user.id } });
      await db.user.delete({ where: { id: user.id } }).catch(() => undefined);
    }
  });

  it("création : la première boutique démarre en essai Business de 14 jours, sans carte", async () => {
    const s = await create(`${tag}-main`);
    mainId = s.id;
    const sub = s.subscription!;
    expect(sub).toMatchObject({ planId: "BUSINESS", status: "TRIALING", coveredBySubscriptionId: null });
    const days = (sub.trialEndsAt!.getTime() - Date.now()) / DAY;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThanOrEqual(14.05); // addDays calendaire : +1 h au passage à l'heure d'hiver
    expect(await db.invoice.count({ where: { subscriptionId: sub.id } })).toBe(0);
  });

  it("boutique supplémentaire (option « Boutique en plus » payée) : couverte par l'abonnement principal, pas de second essai", async () => {
    // Sans place : refusée (quota au niveau du compte).
    const refused = await createStore(undefined, form({ name: "Refus", slug: `${tag}-nope`, country: "FR", currency: "EUR", sector: "mode", city: "", doneForYou: "" }));
    expect(refused).toMatchObject({ ok: false });
    await db.addOnPurchase.create({ data: { storeId: mainId, addOnId: "EXTRA_STORE", quantity: 1, unitPrice: 900, currency: "EUR", status: "ACTIVE", startsAt: new Date(Date.now() - DAY), endsAt: new Date(Date.now() + 30 * DAY) } });
    const s = await create(`${tag}-extra`);
    extraId = s.id;
    const main = await subOf(mainId);
    expect(s.subscription).toMatchObject({ coveredBySubscriptionId: main.id, planId: "BUSINESS", status: "TRIALING" });
    expect(s.subscription!.trialEndsAt!.getTime()).toBe(main.trialEndsAt!.getTime());
    // La boutique couverte ne souscrit pas elle-même.
    expect(await changePlan(extraId, "STARTER", "MONTHLY")).toMatchObject({ ok: false });
  });

  it("préparation : boutique principale publiée avec un produit", async () => {
    const p = await db.product.create({ data: { storeId: mainId, name: "Robe test", slug: `robe-${tag}`, price: 2500, status: "ACTIVE" } });
    productId = p.id;
    await db.store.update({ where: { id: mainId }, data: { status: "PUBLISHED", publishedAt: new Date(), whatsappNumber: "+33600000000" } });
    // TikTok Shop connecté : la pause doit mettre les annonces à 0 (job non filtré), la reprise les rétablir.
    await db.integration.create({ data: { storeId: mainId, kind: "tiktok_shop", status: "active", config: {} } });
    expect(await getPublicStore(`${tag}-main`)).not.toBeNull();
  });

  it("rappels J-3 puis J-1 (e-mail + in-app), chacun une seule fois", async () => {
    const sub = await subOf(mainId);
    const end = sub.trialEndsAt!;
    const j3 = new Date(end.getTime() - 2.5 * DAY);
    await syncSubscription(sub, j3);
    await syncSubscription(await subOf(mainId), j3);
    await Promise.all([pause.sendTrialReminderIfDue(sub, j3), pause.sendTrialReminderIfDue(sub, j3)]);
    expect(await inapp(mainId, "billing.trial_reminder:")).toBe(1);
    expect(await emails(mainId, "billing.trial_reminder")).toBe(1);
    const j1 = new Date(end.getTime() - 0.5 * DAY);
    await syncSubscription(await subOf(mainId), j1);
    await syncSubscription(await subOf(mainId), j1);
    expect(await inapp(mainId, "billing.trial_reminder:")).toBe(2);
    expect(await emails(mainId, "billing.trial_reminder")).toBe(2);
    // La boutique couverte n'envoie pas de rappels propres.
    expect(await inapp(extraId, "billing.trial_reminder:")).toBe(0);
  });

  it("fin d'essai sans plan payant ⇒ abonnement PAUSED, boutique EN PAUSE (statut précédent conservé), rien supprimé", async () => {
    const sub = await subOf(mainId);
    const after = new Date(sub.trialEndsAt!.getTime() + 3600_000);
    await syncSubscription(sub, after);
    await syncSubscription(await subOf(mainId), after); // idempotent
    const s2 = await subOf(mainId);
    expect(s2).toMatchObject({ status: "PAUSED", planId: "FREE" });
    expect(s2.pausedAt).not.toBeNull();
    const st = await storeOf(mainId);
    expect(st).toMatchObject({ status: "PAUSED", statusBeforePause: "PUBLISHED" });
    expect(await db.product.count({ where: { storeId: mainId, status: "ACTIVE" } })).toBe(1);
    // Notification de mise en pause : une seule (in-app + e-mail).
    expect(await inapp(mainId, "billing.paused:")).toBe(1);
    expect(await emails(mainId, "billing.paused")).toBe(1);
    // TikTok : un job de mise à 0 du stock, jamais écarté par la pause.
    const stockJobs = await db.job.findMany({ where: { storeId: mainId, type: "tiktok_shop.stock_state" } });
    expect(stockJobs).toHaveLength(1);
    expect(await pause.skipJobForPause({ type: "tiktok_shop.stock_state", storeId: mainId, payload: {} })).toBe(false);
    // Boutique couverte : en pause aussi (sans notification propre).
    await syncSubscription(await subOf(extraId), after);
    expect((await subOf(extraId)).status).toBe("PAUSED");
    expect((await storeOf(extraId)).status).toBe("PAUSED");
  });

  it("vitrine en pause : aucun catalogue exposé, aucune commande possible", async () => {
    session.user = null; // visiteur anonyme
    expect(await getPublicStore(`${tag}-main`)).toBeNull();
    expect(await getStorefront(`${tag}-main`)).toBeNull();
    const closed = await getPausedStorefront(`${tag}-main`);
    expect(closed).toEqual({ id: mainId, slug: `${tag}-main`, name: `Pause ${tag}-main`, logoUrl: null });
    expect(Object.keys(closed!)).not.toContain("products");
    const items = [{ productId, quantity: 1, optionIds: [] }];
    expect(await previewTotals({ storeSlug: `${tag}-main`, items, fulfillmentType: "WHATSAPP" })).toMatchObject({ ok: false });
    const order = await placeOrder({ storeSlug: `${tag}-main`, items, fulfillmentType: "WHATSAPP", idempotencyKey: `idem-${tag}-0001`, customer: { name: "Client Test", phone: "+33611111111" } } as Parameters<typeof placeOrder>[0]);
    expect(order).toMatchObject({ ok: false });
    expect(await db.order.count({ where: { storeId: mainId } })).toBe(0);
    session.user = user;
  });

  it("intégrations sortantes suspendues : jobs écartés, campagnes refusées", async () => {
    for (const type of ["social.sync", "tiktok_shop.sync", "automation.run", "cart.check", "push.send"]) {
      expect(await pause.skipJobForPause({ type, storeId: mainId, payload: {} })).toBe(true);
    }
    // Commande TikTok entrante (déjà payée) : toujours importée, même en pause.
    expect(await pause.skipJobForPause({ type: "tiktok_shop.order", storeId: null, payload: { storeId: mainId } })).toBe(false);
    expect(await pause.skipJobForPause({ type: "tiktok_shop.publish", storeId: null, payload: { storeId: mainId } })).toBe(true);
    // Transactionnel non concerné.
    expect(await pause.skipJobForPause({ type: "order.status_changed", storeId: mainId, payload: {} })).toBe(false);
    const c = await db.campaign.create({ data: { storeId: mainId, name: `Promo ${tag}`, message: "Bonjour", channel: "whatsapp", status: "DRAFT", segment: {} } });
    await expect(executeCampaign(mainId, c.id, null)).rejects.toThrow(/pause/);
  });

  it("le marchand ne peut pas republier une boutique en pause (contrôle serveur)", async () => {
    expect(await publishStore(mainId)).toMatchObject({ ok: false });
    expect(await setStoreStatus(mainId, "PUBLISHED")).toMatchObject({ ok: false });
    expect(await changePlan(mainId, "FREE", "MONTHLY")).toMatchObject({ ok: false });
    expect((await storeOf(mainId)).status).toBe("PAUSED");
  });

  it("paiement confirmé ⇒ reprise automatique (statut précédent restauré), boutique couverte comprise", async () => {
    const r = await changePlan(mainId, "STARTER", "MONTHLY").catch((e: { digest?: string }) => e);
    expect((r as { digest?: string }).digest).toContain("/abonnement/factures/");
    const inv = await db.invoice.findFirstOrThrow({ where: { subscription: { storeId: mainId }, status: "OPEN" }, orderBy: { createdAt: "desc" } });
    expect(inv.currency).toBe("EUR"); // zone de facturation de la boutique, jamais FCFA par défaut
    const ok = await confirmInvoicePayment(inv.id, { via: "admin" });
    expect(ok).toMatchObject({ ok: true, kind: "plan" });
    expect(await subOf(mainId)).toMatchObject({ status: "ACTIVE", planId: "STARTER", pausedAt: null });
    expect(await storeOf(mainId)).toMatchObject({ status: "PUBLISHED", statusBeforePause: null, statusReason: null });
    expect(await getPublicStore(`${tag}-main`)).not.toBeNull();
    expect(await pause.skipJobForPause({ type: "social.sync", storeId: mainId, payload: {} })).toBe(false);
    expect(await subOf(extraId)).toMatchObject({ status: "ACTIVE", planId: "STARTER" });
    expect((await storeOf(extraId)).status).toBe("DRAFT");
    // Reprise : second job TikTok (stock réel rétabli).
    expect(await db.job.count({ where: { storeId: mainId, type: "tiktok_shop.stock_state" } })).toBe(2);
    // Boutique couverte alignée : plus divergente pour le cron.
    expect(await divergentCoveredSubscriptionIds()).not.toContain((await subOf(extraId)).id);
  });

  it("résiliation : programmée en fin de période, puis pause à l'échéance", async () => {
    expect(await setCancelAtPeriodEnd(mainId, true)).toMatchObject({ ok: true });
    const sub = await subOf(mainId);
    expect(sub.cancelAtPeriodEnd).toBe(true);
    await syncSubscription(sub, new Date(sub.currentPeriodEnd!.getTime() + 3600_000));
    expect(await subOf(mainId)).toMatchObject({ status: "PAUSED", planId: "FREE", trialEndsAt: null });
    expect((await storeOf(mainId)).status).toBe("PAUSED");
    // Motif : résiliation (et non « essai terminé » hérité de l'essai d'origine).
    expect(pauseReasonOf(await subOf(mainId))).toBe("cancelled");
  });

  it("cron : une boutique couverte qui diverge est détectée (et seulement elle)", async () => {
    const extraSub = await subOf(extraId);
    await syncSubscription(extraSub); // alignée sur la principale
    expect(await divergentCoveredSubscriptionIds()).not.toContain(extraSub.id);
    await db.subscription.update({ where: { id: extraSub.id }, data: { status: "ACTIVE", planId: "SCALE" } });
    expect(await divergentCoveredSubscriptionIds()).toContain(extraSub.id);
    await syncSubscription(await subOf(extraId));
    expect(await subOf(extraId)).toMatchObject({ status: "PAUSED", planId: "FREE" });
    expect(await divergentCoveredSubscriptionIds()).not.toContain(extraSub.id);
  });

  it("verrou : pause concurrente (cron et page) appliquée une seule fois", async () => {
    await db.store.update({ where: { id: mainId }, data: { status: "PUBLISHED", statusBeforePause: null } });
    const pausedCount = () => db.auditLog.count({ where: { storeId: mainId, action: "store.paused_billing" } });
    const before = await pausedCount();
    const outcomes = await Promise.all([1, 2, 3].map(() => db.$transaction((tx) => pause.reconcileStorePause(tx, mainId))));
    expect(outcomes.filter((o) => o === "paused")).toHaveLength(1);
    expect((await pausedCount()) - before).toBe(1);
    expect(await storeOf(mainId)).toMatchObject({ status: "PAUSED", statusBeforePause: "PUBLISHED" });
  });

  it("réactivation admin d'une boutique suspendue sans plan : reste en pause, pas en ligne", async () => {
    await db.store.update({ where: { id: mainId }, data: { status: "SUSPENDED", statusBeforePause: null } });
    session.user = { ...user, isPlatformAdmin: true };
    expect(await reactivateStore(mainId, "Contrôle terminé")).toMatchObject({ ok: true });
    session.user = user;
    expect(await storeOf(mainId)).toMatchObject({ status: "PAUSED", statusBeforePause: "PUBLISHED" });
  });

  it("archivage : statusBeforePause remis à null ; tout archiver puis recréer ne redonne PAS d'essai", async () => {
    await setStoreStatus(mainId, "ARCHIVED").catch(() => undefined); // redirige vers /app
    expect(await storeOf(mainId)).toMatchObject({ status: "ARCHIVED", statusBeforePause: null });
    await db.store.update({ where: { id: extraId }, data: { status: "ARCHIVED" } });
    const again = await create(`${tag}-again`);
    expect(again.subscription).toMatchObject({ planId: "FREE", status: "PAUSED", trialEndsAt: null, coveredBySubscriptionId: null });
    expect(again).toMatchObject({ status: "PAUSED", statusBeforePause: "DRAFT" });
    // Chemin de paiement disponible.
    const r = await changePlan(again.id, "STARTER", "MONTHLY").catch((e: { digest?: string }) => e);
    expect((r as { digest?: string }).digest).toContain("/abonnement/factures/");
  });

  it("migration : la boutique Gratuite secondaire d'un compte payant est rattachée, pas mise en essai", async () => {
    const u2 = await db.user.create({ data: { email: `${tag}-2@pause.test`, name: "Compte payant", passwordHash: "x", emailVerifiedAt: new Date() } });
    const now = new Date();
    const paid = await db.store.create({
      data: { name: `Payante ${tag}`, slug: `${tag}-paid`, currency: "EUR", status: "PUBLISHED", memberships: { create: { userId: u2.id, role: "OWNER" } }, subscription: { create: { planId: "BUSINESS", status: "ACTIVE", zone: "WORLD", currency: "EUR", currentPeriodStart: now, currentPeriodEnd: new Date(now.getTime() + 20 * DAY) } } },
      include: { subscription: true },
    });
    const second = await db.store.create({
      data: { name: `Seconde ${tag}`, slug: `${tag}-second`, currency: "EUR", status: "PUBLISHED", memberships: { create: { userId: u2.id, role: "OWNER" } }, subscription: { create: { planId: "FREE", status: "ACTIVE", zone: "WORLD", currency: "EUR" } } },
      include: { subscription: true },
    });
    storeIds.push(paid.id, second.id);
    try {
      expect(await pause.planLegacyFreeMigration(second.subscription!)).toEqual({ kind: "covered", parentId: paid.subscription!.id });
      expect(await pause.migrateLegacyFreeSubscription(second.subscription!, now)).toBe("covered");
      expect(await subOf(second.id)).toMatchObject({ coveredBySubscriptionId: paid.subscription!.id, planId: "BUSINESS", status: "ACTIVE" });
      expect((await storeOf(second.id)).status).toBe("PUBLISHED");
      expect(await pause.migrateLegacyFreeSubscription(second.subscription!, now)).toBeNull();
    } finally {
      await db.auditLog.deleteMany({ where: { storeId: { in: [paid.id, second.id] } } });
      await db.store.deleteMany({ where: { id: { in: [paid.id, second.id] } } });
      await db.user.delete({ where: { id: u2.id } });
    }
  });

  it("migration des abonnements Gratuits hérités : nouvel essai de 14 jours, idempotente", async () => {
    const legacy = await db.store.create({
      data: { name: `Legacy ${tag}`, slug: `${tag}-legacy`, currency: "XOF", status: "PUBLISHED", subscription: { create: { planId: "FREE", status: "ACTIVE", zone: "AFRICA", currency: "XOF" } } },
      include: { subscription: true },
    });
    storeIds.push(legacy.id);
    const at = new Date();
    expect(await pause.migrateLegacyFreeSubscription(legacy.subscription!, at)).toBe("trial");
    const s = await subOf(legacy.id);
    expect(s).toMatchObject({ planId: "BUSINESS", status: "TRIALING" });
    expect(s.trialEndsAt!.getTime()).toBe(at.getTime() + 14 * DAY);
    // Rejouée (script, cron) : aucun effet, un seul marqueur, pas de pause.
    expect(await pause.migrateLegacyFreeSubscription(legacy.subscription!, at)).toBeNull();
    await syncSubscription(await subOf(legacy.id), at); // chemin du cycle de vie (limité à cette boutique)
    expect(await subOf(legacy.id)).toMatchObject({ status: "TRIALING", trialEndsAt: s.trialEndsAt });
    expect(await db.auditLog.count({ where: { action: pause.LEGACY_FREE_MIGRATED_ACTION, target: s.id } })).toBe(1);
    expect((await storeOf(legacy.id)).status).toBe("PUBLISHED");
    expect(await inapp(legacy.id, pause.LEGACY_FREE_MIGRATED_ACTION)).toBe(1);
  });
});
