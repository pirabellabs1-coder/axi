/**
 * Achat / renouvellement de noms de domaine sur la base PostgreSQL locale (ignoré si la base est injoignable),
 * avec le registrar SIMULÉ (DOMAINS_FAKE=1). Couvre : aucun achat sans facture payée, idempotence register /
 * renew, transitions de statut, rattachement à la boutique, isolation par storeId, rappels d'échéance,
 * facture de renouvellement J-30, impayé ⇒ auto-renouvellement coupé chez le registrar, échec + relance admin.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

try {
  process.loadEnvFile(".env");
} catch {
  // pas de .env : tests ignorés
}
process.env.DOMAINS_FAKE = "1";
process.env.DOMAINS_ALLOWED_TLDS = "com,shop,store";

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

describe.skipIf(!reachable || !demo)("noms de domaine : achat et renouvellement (base locale, registrar simulé)", async () => {
  const svc = await import("@/lib/domains/service");
  const { runDomainLifecycle } = await import("@/lib/domains/lifecycle");
  const { confirmInvoicePayment, nonDebtInvoiceIds } = await import("@/lib/billing/service");
  const { buyDomain, setDomainAutoRenewAction, renewDomainNow } = await import("@/lib/domains/purchase-actions");
  const { resetFakeRegistrar, fakeRegistrarState } = await import("@/lib/domains/registrar/fake");
  const { fakeRegistrarEnabled } = await import("@/lib/domains/registrar");
  const { clearRatesMemo } = await import("@/lib/currency/rates");

  const tag = `t${Date.now().toString(36)}`;
  const domain = `axitest${tag}.com`;
  const storeIds: string[] = [];
  let storeId = "";
  let otherStoreId = "";
  let createdRate = false;
  const archived: string[] = [];
  const contact = { firstName: "Ada", lastName: "Kossou", email: "ada@example.com", phone: "+22997000000", address1: "Rue 12", city: "Cotonou", country: "BJ" };
  const asOwner = () => (session.user = { ...demo!, isPlatformAdmin: false, emailVerified: true });

  const mkStore = async (slug: string, currency: string) => {
    const s = await db.store.create({
      data: {
        name: `Test domaines ${slug}`,
        slug,
        currency,
        memberships: { create: { userId: demo!.id, role: "OWNER" } },
        subscription: { create: { planId: "BUSINESS", status: "ACTIVE", interval: "MONTHLY", zone: currency === "XOF" ? "AFRICA" : "WORLD", currency, currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 20 * 86_400_000) } },
      },
    });
    storeIds.push(s.id);
    return s.id;
  };

  beforeAll(async () => {
    resetFakeRegistrar();
    // Taux EUR → USD frais (créé seulement s'il manque, supprimé en fin de test)
    const existing = await db.exchangeRate.findUnique({ where: { base_quote: { base: "EUR", quote: "USD" } } });
    if (!existing) {
      await db.exchangeRate.create({ data: { base: "EUR", quote: "USD", rate: "1.08", source: "manual", fetchedAt: new Date() } });
      createdRate = true;
    } else if (Date.now() - existing.fetchedAt.getTime() > 48 * 3600_000) {
      await db.exchangeRate.update({ where: { id: existing.id }, data: { fetchedAt: new Date() } });
    }
    clearRatesMemo();
    storeId = await mkStore(`test-dom-${tag}`, "XOF");
    otherStoreId = await mkStore(`test-dom2-${tag}`, "EUR");
  });

  afterAll(async () => {
    for (const id of storeIds) {
      await db.auditLog.deleteMany({ where: { storeId: id } });
      await db.job.deleteMany({ where: { storeId: id } });
      await db.store.delete({ where: { id } });
    }
    await db.auditLog.deleteMany({ where: { action: { startsWith: "domain." }, storeId: null } });
    // Lignes archivées (boutiques supprimées) : nettoyage explicite des données de test
    const orphanRegs = await db.domainRegistration.findMany({ where: { OR: [{ id: { in: archived } }, { storeId: null, domainName: { contains: tag } }] }, select: { id: true } });
    await db.domainCharge.deleteMany({ where: { registrationId: { in: orphanRegs.map((r) => r.id) } } });
    await db.domainRegistration.deleteMany({ where: { id: { in: orphanRegs.map((r) => r.id) } } });
    if (createdRate) await db.exchangeRate.deleteMany({ where: { base: "EUR", quote: "USD", source: "manual" } });
  });

  it("le registrar simulé est actif hors production uniquement", () => {
    expect(fakeRegistrarEnabled()).toBe(true);
    expect(fakeRegistrarEnabled({ DOMAINS_FAKE: "1", NODE_ENV: "production" } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });

  let invoiceId = "";
  let registrationId = "";
  let chargeId = "";

  it("la commande crée une facture OPEN dans la devise de la boutique, sans appel registrar", async () => {
    asOwner();
    const fd = new FormData();
    for (const [k, v] of Object.entries({ ...contact, storeId, domain: domain.toUpperCase(), years: "1", accept: "on" })) fd.set(k, v);
    await expect(buyDomain(undefined, fd)).rejects.toMatchObject({ digest: expect.stringContaining("/abonnement/factures/") });
    const reg = await db.domainRegistration.findFirstOrThrow({ where: { storeId, domainName: domain }, include: { charges: { include: { invoice: true } } } });
    expect(reg.status).toBe("AWAITING_PAYMENT");
    expect(reg.currency).toBe("XOF");
    expect(reg.charges).toHaveLength(1);
    const c = reg.charges[0];
    expect(c.invoice!.status).toBe("OPEN");
    expect(c.invoice!.currency).toBe("XOF");
    expect(c.invoice!.amount % 100).toBe(0);
    expect(c.invoiceNumber).toBe(c.invoice!.number);
    expect(c.margin).toBeGreaterThan(0);
    expect(fakeRegistrarState().calls.register).toBe(0);
    invoiceId = c.invoiceId!;
    registrationId = reg.id;
    chargeId = c.id;
    // Une facture de domaine n'est pas une dette d'abonnement
    expect((await nonDebtInvoiceIds([invoiceId])).has(invoiceId)).toBe(true);
  });

  it("double clic : la commande en attente est réutilisée (même durée, même titulaire)", async () => {
    const r = await svc.createDomainPurchase({ storeId, actorId: demo!.id, domain, years: 1, contact });
    expect(r).toMatchObject({ ok: true, invoiceId, reused: true });
  });

  it("F2 : durée ou titulaire différents ⇒ ancienne commande annulée et recréée", async () => {
    const other = `f2${tag}.store`;
    const a = await svc.createDomainPurchase({ storeId, actorId: demo!.id, domain: other, years: 1, contact });
    const b = await svc.createDomainPurchase({ storeId, actorId: demo!.id, domain: other, years: 2, contact });
    const c = await svc.createDomainPurchase({ storeId, actorId: demo!.id, domain: other, years: 2, contact: { ...contact, city: "Parakou" } });
    expect(a.ok && b.ok && c.ok).toBe(true);
    if (!a.ok || !b.ok || !c.ok) return;
    expect(new Set([a.invoiceId, b.invoiceId, c.invoiceId]).size).toBe(3);
    expect((await db.invoice.findUniqueOrThrow({ where: { id: a.invoiceId } })).status).toBe("VOID");
    expect((await db.invoice.findUniqueOrThrow({ where: { id: b.invoiceId } })).status).toBe("VOID");
    expect((await db.domainRegistration.findUniqueOrThrow({ where: { id: a.registrationId } })).status).toBe("CANCELLED");
    const live = await db.domainRegistration.findUniqueOrThrow({ where: { id: c.registrationId } });
    expect(live.years).toBe(2);
    expect((live.contact as { city: string }).city).toBe("Parakou");
  });

  it("une autre boutique ne peut pas acheter le même nom pendant l'attente", async () => {
    const r = await svc.createDomainPurchase({ storeId: otherStoreId, actorId: demo!.id, domain, years: 1, contact });
    expect(r.ok).toBe(false);
  });

  it("jamais d'achat sans facture payée : le job ne fait rien sur une charge OPEN", async () => {
    expect(await svc.processDomainCharge(chargeId)).toBe("skipped");
    expect(fakeRegistrarState().calls.register).toBe(0);
  });

  it("paiement confirmé : un seul job domain.register (confirmation idempotente)", async () => {
    const r1 = await confirmInvoicePayment(invoiceId, { via: "admin", actorId: demo!.id });
    const r2 = await confirmInvoicePayment(invoiceId, { via: "admin", actorId: demo!.id });
    expect(r1).toMatchObject({ ok: true, kind: "domain" });
    expect(r2).toMatchObject({ ok: true, already: true });
    expect(await db.job.count({ where: { storeId, type: "domain.register" } })).toBe(1);
    expect((await db.domainRegistration.findUniqueOrThrow({ where: { id: registrationId } })).status).toBe("PENDING");
    // L'abonnement n'est pas touché
    const sub = await db.subscription.findUniqueOrThrow({ where: { storeId } });
    expect(sub.planId).toBe("BUSINESS");
  });

  it("enregistrement : un seul appel registrar, domaine rattaché et vérifié (apex + www)", async () => {
    expect(await svc.processDomainCharge(chargeId)).toBe("applied");
    expect(await svc.processDomainCharge(chargeId)).toBe("skipped");
    expect(fakeRegistrarState().calls.register).toBe(1);
    const reg = await db.domainRegistration.findUniqueOrThrow({ where: { id: registrationId } });
    expect(reg.status).toBe("REGISTERED");
    // F3 : titulaire anonymisé une fois le domaine enregistré
    expect(reg.contact).toEqual({ anonymized: true, country: "BJ" });
    expect(fakeRegistrarState().domains.get(domain)!.autoRenew).toBe(false);
    expect(reg.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 360 * 86_400_000);
    expect(reg.dnsConfiguredAt).not.toBeNull();
    expect(reg.hostedZoneId).toMatch(/hostedzone/);
    const hosts = await db.domain.findMany({ where: { storeId, registrationId }, orderBy: { hostname: "asc" } });
    expect(hosts.map((h) => [h.hostname, h.verified])).toEqual([[domain, true], [`www.${domain}`, true]]);
    expect(hosts.find((h) => h.hostname === domain)!.isPrimary).toBe(true);
    expect((await db.domainCharge.findUniqueOrThrow({ where: { id: chargeId } })).status).toBe("APPLIED");
  });

  it("isolation : une autre boutique ne peut ni piloter ni renouveler ce domaine", async () => {
    // L'utilisateur démo n'est pas membre : on passe par l'action avec un storeId étranger au domaine
    const r = await setDomainAutoRenewAction(otherStoreId, registrationId, false);
    expect(r).toMatchObject({ ok: false, error: "Domaine introuvable." });
    const r2 = await renewDomainNow(otherStoreId, registrationId);
    expect(r2.ok).toBe(false);
    expect((await db.domainRegistration.findUniqueOrThrow({ where: { id: registrationId } })).autoRenew).toBe(true);
  });

  it("rappels J-30 / J-7 / J-1 : un seul envoi par seuil, et facture de renouvellement J-30 unique", async () => {
    const expiresAt = new Date(Date.now() + 25 * 86_400_000);
    await db.domainRegistration.update({ where: { id: registrationId }, data: { expiresAt } });
    fakeRegistrarState().domains.get(domain)!.expiresAt = expiresAt;
    const r1 = await runDomainLifecycle();
    const r2 = await runDomainLifecycle();
    expect(r1.renewals).toBeGreaterThanOrEqual(1);
    expect(r2.renewals).toBe(0);
    const reg = await db.domainRegistration.findUniqueOrThrow({ where: { id: registrationId } });
    expect(reg.reminders).toEqual([`${expiresAt.toISOString().slice(0, 10)}:30`]);
    const renewCharges = await db.domainCharge.findMany({ where: { registrationId, kind: "RENEW" }, include: { invoice: true } });
    expect(renewCharges).toHaveLength(1);
    expect(renewCharges[0].status).toBe("OPEN");
    expect(renewCharges[0].invoice!.dueAt.getTime()).toBe(expiresAt.getTime() - 7 * 86_400_000);
    // J-5 : seuil 7 jours envoyé une fois
    const near = new Date(Date.now() + 5 * 86_400_000);
    await db.domainRegistration.update({ where: { id: registrationId }, data: { expiresAt: near } });
    await db.domainCharge.update({ where: { id: renewCharges[0].id }, data: { expectedExpiry: near } });
    await db.invoice.update({ where: { id: renewCharges[0].invoiceId! }, data: { dueAt: new Date(Date.now() + 86_400_000) } });
    fakeRegistrarState().domains.get(domain)!.expiresAt = near;
    await runDomainLifecycle();
    await runDomainLifecycle();
    expect((await db.domainRegistration.findUniqueOrThrow({ where: { id: registrationId } })).reminders).toEqual([`${expiresAt.toISOString().slice(0, 10)}:30`, `${near.toISOString().slice(0, 10)}:7`]);
  });

  it("E2 : impayé à l'échéance ⇒ alerte unique ; l'auto-renouvellement AWS reste désactivé, jamais réactivé", async () => {
    const charge = await db.domainCharge.findFirstOrThrow({ where: { registrationId, kind: "RENEW" } });
    await db.invoice.update({ where: { id: charge.invoiceId! }, data: { dueAt: new Date(Date.now() - 3600_000) } });
    const r = await runDomainLifecycle();
    expect(r.unpaidAlerts).toBe(1);
    expect((await runDomainLifecycle()).unpaidAlerts).toBe(0);
    expect(fakeRegistrarState().domains.get(domain)!.autoRenew).toBe(false);
    expect(fakeRegistrarState().calls.autoRenew.every((c) => !c.enabled)).toBe(true);
    expect(fakeRegistrarState().calls.renew).toBe(0); // aucun renouvellement sans paiement
  });

  it("E2 : le réglage marchand ne touche jamais AWS", async () => {
    const before = fakeRegistrarState().calls.autoRenew.length;
    expect((await setDomainAutoRenewAction(storeId, registrationId, false)).ok).toBe(true);
    expect((await setDomainAutoRenewAction(storeId, registrationId, true)).ok).toBe(true);
    expect(fakeRegistrarState().calls.autoRenew.length).toBe(before);
    expect(fakeRegistrarState().domains.get(domain)!.autoRenew).toBe(false);
  });

  it("renouvellement payé en retard : un seul RenewDomain, échéance prolongée d'un an", async () => {
    const charge = await db.domainCharge.findFirstOrThrow({ where: { registrationId, kind: "RENEW" } });
    const before = (await db.domainRegistration.findUniqueOrThrow({ where: { id: registrationId } })).expiresAt!;
    await confirmInvoicePayment(charge.invoiceId!, { via: "admin", actorId: demo!.id });
    expect(await db.job.count({ where: { storeId, type: "domain.renew" } })).toBe(1);
    expect(await svc.processDomainCharge(charge.id)).toBe("applied");
    expect(await svc.processDomainCharge(charge.id)).toBe("skipped");
    expect(fakeRegistrarState().calls.renew).toBe(1);
    const after = (await db.domainRegistration.findUniqueOrThrow({ where: { id: registrationId } })).expiresAt!;
    expect(after.getUTCFullYear()).toBe(before.getUTCFullYear() + 1);
  });

  it("renouvellement interrompu puis rejoué : pas de second RenewDomain si l'échéance a déjà bougé", async () => {
    const reg = await db.domainRegistration.findUniqueOrThrow({ where: { id: registrationId } });
    const r = await svc.issueRenewalInvoice(registrationId);
    expect(r.ok).toBe(true);
    const charge = await db.domainCharge.findFirstOrThrow({ where: { registrationId, kind: "RENEW", status: "OPEN" } });
    await confirmInvoicePayment(charge.invoiceId!, { via: "admin", actorId: demo!.id });
    // Simule un crash : charge PROCESSING sans opération, alors que le registrar a déjà prolongé
    await db.domainCharge.update({ where: { id: charge.id }, data: { status: "PROCESSING" } });
    const d = fakeRegistrarState().domains.get(domain)!;
    d.expiresAt = new Date(reg.expiresAt!.getTime() + 365 * 86_400_000);
    const calls = fakeRegistrarState().calls.renew;
    expect(await svc.processDomainCharge(charge.id)).toBe("applied");
    expect(fakeRegistrarState().calls.renew).toBe(calls);
  });

  it("échec registrar après paiement : FAILED, puis relance admin", async () => {
    const failing = `fail${tag}.com`;
    const p = await svc.createDomainPurchase({ storeId: otherStoreId, actorId: demo!.id, domain: failing, years: 1, contact });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    await confirmInvoicePayment(p.invoiceId, { via: "admin", actorId: demo!.id });
    const charge = await db.domainCharge.findUniqueOrThrow({ where: { invoiceId: p.invoiceId } });
    expect(charge.currency).toBe("EUR");
    expect(await svc.processDomainCharge(charge.id)).toBe("failed");
    const reg = await db.domainRegistration.findUniqueOrThrow({ where: { id: p.registrationId } });
    expect(reg.status).toBe("FAILED");
    expect(reg.lastError).toMatch(/Registrar/);
    expect(await db.domain.count({ where: { registrationId: reg.id } })).toBe(0);

    const { retryDomainCharge } = await import("@/lib/domains/admin-actions");
    session.user = { ...demo!, isPlatformAdmin: false, emailVerified: true };
    expect((await retryDomainCharge(charge.id)).ok).toBe(false); // non-admin refusé
    expect((await db.domainCharge.findUniqueOrThrow({ where: { id: charge.id } })).status).toBe("FAILED");
  });

  it("facture d'achat impayée à l'échéance : annulée, nom libéré", async () => {
    const other = `libre${tag}.shop`;
    const p = await svc.createDomainPurchase({ storeId, actorId: demo!.id, domain: other, years: 1, contact });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    await db.invoice.update({ where: { id: p.invoiceId }, data: { dueAt: new Date(Date.now() - 1000) } });
    await runDomainLifecycle();
    expect((await db.invoice.findUniqueOrThrow({ where: { id: p.invoiceId } })).status).toBe("VOID");
    expect((await db.domainRegistration.findUniqueOrThrow({ where: { id: p.registrationId } })).status).toBe("CANCELLED");
    expect((await confirmInvoicePayment(p.invoiceId, { via: "admin" })).ok).toBe(false);
    const again = await svc.createDomainPurchase({ storeId: otherStoreId, actorId: demo!.id, domain: other, years: 1, contact });
    expect(again.ok).toBe(true);
  });

  /* ───────── E1 : appels facturés au résultat inconnu ───────── */

  const paidPurchase = async (name: string) => {
    const p = await svc.createDomainPurchase({ storeId: otherStoreId, actorId: demo!.id, domain: name, years: 1, contact });
    if (!p.ok) throw new Error(p.error);
    await confirmInvoicePayment(p.invoiceId, { via: "admin", actorId: demo!.id });
    return db.domainCharge.findUniqueOrThrow({ where: { invoiceId: p.invoiceId } });
  };

  it("E1 : réponse perdue après soumission ⇒ PROCESSING sans opération, puis réconciliation ListOperations, un seul RegisterDomain", async () => {
    const charge = await paidPurchase(`e1a${tag}.com`);
    const calls = fakeRegistrarState().calls.register;
    fakeRegistrarState().nextFault = "timeout_after";
    await expect(svc.processDomainCharge(charge.id)).rejects.toThrow(/timeout/);
    const mid = await db.domainCharge.findUniqueOrThrow({ where: { id: charge.id } });
    expect(mid.status).toBe("PROCESSING");
    expect(mid.operationId).toBeNull();
    expect(mid.claimedAt).not.toBeNull();
    expect(await svc.processDomainCharge(charge.id)).toBe("applied");
    expect(fakeRegistrarState().calls.register).toBe(calls + 1);
    const done = await db.domainCharge.findUniqueOrThrow({ where: { id: charge.id } });
    expect(done.operationId).toMatch(/^fake-op-/);
    expect(await db.auditLog.count({ where: { action: "domain.operation_reconciled", target: done.registrationId } })).toBe(1);
  });

  it("E1 : délai dépassé avant soumission ⇒ réconciliation sans résultat = FAILED ; relance admin = réconciliation puis un seul envoi", async () => {
    const charge = await paidPurchase(`e1b${tag}.com`);
    const calls = fakeRegistrarState().calls.register;
    fakeRegistrarState().nextFault = "timeout_before";
    await expect(svc.processDomainCharge(charge.id)).rejects.toThrow();
    expect((await db.domainCharge.findUniqueOrThrow({ where: { id: charge.id } })).status).toBe("PROCESSING");
    expect(await svc.processDomainCharge(charge.id)).toBe("failed");
    expect(fakeRegistrarState().calls.register).toBe(calls);
    // Chemin de la relance admin (job domain.poll { resubmit: true }) : PROCESSING + réconciliation
    await db.domainCharge.update({ where: { id: charge.id }, data: { status: "PROCESSING" } });
    expect(await svc.processDomainCharge(charge.id, 0, new Date(), { resubmit: true })).toBe("applied");
    expect(fakeRegistrarState().calls.register).toBe(calls + 1);
  });

  it("E1 : refus explicite AWS (4xx) ⇒ FAILED sans retour à PAID ; limitation (429) ⇒ retour à PAID", async () => {
    const refused = await paidPurchase(`e1c${tag}.com`);
    fakeRegistrarState().nextFault = "refused";
    expect(await svc.processDomainCharge(refused.id)).toBe("failed");
    expect((await db.domainCharge.findUniqueOrThrow({ where: { id: refused.id } })).status).toBe("FAILED");
    const throttled = await paidPurchase(`e1d${tag}.com`);
    fakeRegistrarState().nextFault = "throttled";
    await expect(svc.processDomainCharge(throttled.id)).rejects.toThrow(/Rate/);
    const t = await db.domainCharge.findUniqueOrThrow({ where: { id: throttled.id } });
    expect(t.status).toBe("PAID");
    expect(t.claimedAt).toBeNull();
  });

  it("F1 : à l'expiration, les domaines rattachés ne sont plus vérifiés (plus de certificat)", async () => {
    const charge = await paidPurchase(`f1${tag}.com`);
    expect(await svc.processDomainCharge(charge.id)).toBe("applied");
    const past = new Date(Date.now() - 86_400_000);
    await db.domainRegistration.update({ where: { id: charge.registrationId }, data: { expiresAt: past } });
    fakeRegistrarState().domains.get(`f1${tag}.com`)!.expiresAt = past;
    await runDomainLifecycle();
    expect((await db.domainRegistration.findUniqueOrThrow({ where: { id: charge.registrationId } })).status).toBe("EXPIRED");
    const hosts = await db.domain.findMany({ where: { registrationId: charge.registrationId } });
    expect(hosts.length).toBe(2);
    expect(hosts.every((h) => !h.verified)).toBe(true);
  });

  it("M1 : suppression de la boutique ⇒ achats conservés, titulaire anonymisé, nom de boutique figé", async () => {
    const sid = await mkStore(`test-dom3-${tag}`, "XOF");
    const p = await svc.createDomainPurchase({ storeId: sid, actorId: demo!.id, domain: `m1${tag}.com`, years: 1, contact });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    await db.auditLog.deleteMany({ where: { storeId: sid } });
    await db.store.delete({ where: { id: sid } });
    storeIds.splice(storeIds.indexOf(sid), 1);
    const reg = await db.domainRegistration.findUniqueOrThrow({ where: { id: p.registrationId } });
    expect(reg.storeId).toBeNull();
    expect(reg.storeName).toBe(`Test domaines test-dom3-${tag}`);
    expect(reg.contact).toEqual({ anonymized: true });
    const charge = await db.domainCharge.findFirstOrThrow({ where: { registrationId: reg.id } });
    expect(charge.storeId).toBeNull();
    expect(charge.invoiceId).toBeNull();
    expect(charge.invoiceNumber).toMatch(/^AXI-/);
    archived.push(reg.id);
  });
});
