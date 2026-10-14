/**
 * Parcours de facturation sur la base PostgreSQL locale (ignoré si la base est injoignable) :
 * montée en gamme → facture OPEN sans changement de plan ni crédits → « Marquer payée » admin →
 * plan et crédits accordés ; zone posée par l'admin conservée ; double confirmation de facture.
 * Les données de test (boutique temporaire) sont supprimées en fin de fichier (cascade).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

try {
  process.loadEnvFile(".env");
} catch {
  // pas de .env : les tests sont ignorés si DATABASE_URL est absente
}

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => {
    throw new Error("hors requête");
  },
  cookies: async () => ({ get: () => undefined }),
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
const demo = reachable ? await db.user.findFirst({ where: { email: "demo@axi.africa" }, select: { id: true, email: true, name: true } }) : null;

describe.skipIf(!reachable || !demo)("parcours facturation (base locale)", async () => {
  const { changePlan, payInvoiceOnline } = await import("@/lib/billing/actions");
  const { markInvoicePaid, setPricingZone } = await import("@/lib/admin/actions");
  const { confirmInvoicePayment, CHANGE_REQUESTED_ACTION } = await import("@/lib/billing/service");
  const { grantMonthlyCredits } = await import("@/lib/credits");
  const { effectivePlanId } = await import("@/lib/auth/permissions");

  const tag = `t${Date.now().toString(36)}`;
  let storeId = "";
  let subId = "";
  const now = new Date();
  const asOwner = () => (session.user = { ...demo!, isPlatformAdmin: false, emailVerified: true });
  const asAdmin = () => (session.user = { ...demo!, isPlatformAdmin: true, emailVerified: true });
  const sub = () => db.subscription.findUniqueOrThrow({ where: { id: subId } });
  const credits = async (type: "WA_UTILITY" | "AI") => (await db.creditLedger.aggregate({ where: { storeId, type }, _sum: { delta: true } }))._sum.delta ?? 0;

  beforeAll(async () => {
    const store = await db.store.create({
      data: {
        name: `Test facturation ${tag}`,
        slug: `test-billing-${tag}`,
        currency: "XOF",
        memberships: { create: { userId: demo!.id, role: "OWNER" } },
        subscription: {
          create: { planId: "STARTER", status: "ACTIVE", interval: "MONTHLY", zone: "AFRICA", currency: "XOF", currentPeriodStart: new Date(now.getTime() - 10 * 86_400_000), currentPeriodEnd: new Date(now.getTime() + 20 * 86_400_000) },
        },
      },
      include: { subscription: true },
    });
    storeId = store.id;
    subId = store.subscription!.id;
    await db.invoice.create({
      data: { subscriptionId: subId, number: `TEST-${tag}-1`, planId: "STARTER", amount: 5000, currency: "XOF", status: "PAID", paidAt: new Date(now.getTime() - 10 * 86_400_000), periodStart: new Date(now.getTime() - 10 * 86_400_000), periodEnd: new Date(now.getTime() + 20 * 86_400_000), dueAt: new Date(now.getTime() - 3 * 86_400_000) },
    });
  });

  afterAll(async () => {
    if (!storeId) return;
    await db.auditLog.deleteMany({ where: { storeId } });
    await db.job.deleteMany({ where: { storeId } });
    await db.store.delete({ where: { id: storeId } });
  });

  let upgradeInvoiceId = "";

  it("une montée en gamme émet une facture OPEN sans changer le plan", async () => {
    asOwner();
    await expect(changePlan(storeId, "BUSINESS", "MONTHLY")).rejects.toMatchObject({ digest: expect.stringContaining("/abonnement/factures/") });
    const s = await sub();
    expect(s.planId).toBe("STARTER");
    expect(effectivePlanId(s)).toBe("STARTER");
    const inv = await db.invoice.findFirstOrThrow({ where: { subscriptionId: subId, status: "OPEN", planId: "BUSINESS" } });
    expect(inv.currency).toBe("XOF");
    expect(inv.amount).toBeLessThan(15000); // prorata du temps restant sur Starter
    expect(await db.auditLog.count({ where: { action: CHANGE_REQUESTED_ACTION, target: inv.id } })).toBe(1);
    upgradeInvoiceId = inv.id;
  });

  it("aucun crédit Business n'est accordé tant que la facture n'est pas payée", async () => {
    await grantMonthlyCredits(storeId);
    expect(await credits("WA_UTILITY")).toBe(0);
    expect(await credits("AI")).toBe(0);
  });

  it("« Marquer payée » (admin) active le plan, puis les crédits sont accordés", async () => {
    asAdmin();
    const r = await markInvoicePaid(upgradeInvoiceId, "MP-TEST");
    expect(r.ok).toBe(true);
    const s = await sub();
    expect(s.planId).toBe("BUSINESS");
    expect(s.status).toBe("ACTIVE");
    expect(effectivePlanId(s)).toBe("BUSINESS");
    expect(s.currentPeriodEnd!.getTime()).toBeGreaterThan(now.getTime() + 27 * 86_400_000);
    await grantMonthlyCredits(storeId);
    expect(await credits("WA_UTILITY")).toBe(300);
    expect(await credits("AI")).toBe(50);
  });

  it("une seconde confirmation de la même facture est sans effet", async () => {
    const before = await sub();
    const again = await confirmInvoicePayment(upgradeInvoiceId, { via: "webhook", providerRef: "MP-TEST" });
    expect(again).toMatchObject({ ok: true, already: true });
    const after = await sub();
    expect(after.currentPeriodEnd).toEqual(before.currentPeriodEnd);
    expect(await db.invoice.count({ where: { id: upgradeInvoiceId, status: "PAID" } })).toBe(1);
  });

  it("la zone posée par l'admin n'est pas écrasée par une nouvelle facture", async () => {
    asAdmin();
    expect((await setPricingZone(storeId, "WORLD", "Client facturé en euros")).ok).toBe(true);
    asOwner();
    await expect(changePlan(storeId, "SCALE", "MONTHLY")).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
    const s = await sub();
    expect(s.zone).toBe("WORLD");
    expect(s.currency).toBe("EUR");
    expect(s.planId).toBe("BUSINESS");
    const inv = await db.invoice.findFirstOrThrow({ where: { subscriptionId: subId, status: "OPEN", planId: "SCALE" } });
    expect(inv.currency).toBe("EUR");
    // Paiement en ligne non configuré en local : refus propre, sans écrire la zone.
    const pay = await payInvoiceOnline(storeId, inv.id);
    expect(pay.ok).toBe(false);
    expect((await sub()).zone).toBe("WORLD");
  });
});
