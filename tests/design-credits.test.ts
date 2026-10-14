/**
 * Lot 4 §9 et §10 : crédits de la génération de boutique et de l'assistant de design, sur la base
 * PostgreSQL locale (ignoré si la base est injoignable). Client IA SIMULÉ (AI_FAKE=1).
 *
 * Vérifie : crédits offerts une seule fois par boutique, débit avant l'appel, remboursement sur sortie
 * invalide, débit de l'assistant et remboursement d'un refus, écriture du brouillon après une version
 * « Avant génération IA » sans publication, et isolation entre boutiques.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

try {
  process.loadEnvFile(".env");
} catch {
  // pas de .env : les tests sont ignorés si DATABASE_URL est absente
}

// Client IA simulé : la variable n'a d'effet qu'hors production (voir `isFakeAi`).
process.env.AI_FAKE = "1";

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

/** Le client simulé peut être rendu « cassé » pour vérifier le remboursement d'une sortie invalide. */
const fakeMode = { broken: false };
vi.mock("@/lib/ai/design/fake", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/design/fake")>();
  return {
    ...actual,
    isFakeAi: () => true,
    fakeBrief: (...args: Parameters<typeof actual.fakeBrief>) => (fakeMode.broken ? ({ directions: [] } as ReturnType<typeof actual.fakeBrief>) : actual.fakeBrief(...args)),
  };
});

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

describe.skipIf(!reachable || !demo)("crédits de la génération IA (base locale)", async () => {
  const { grantOnboardingGift, DESIGN_CREDITS, ONBOARDING_GIFT_CREDITS } = await import("@/lib/ai/design/credits");
  const { generateStoreDesign, chooseDirection, runDesignAssistant } = await import("@/lib/ai/design/actions");
  const { getBalances } = await import("@/lib/credits");

  const tag = `g${Date.now().toString(36)}`;
  let storeId = "";
  let otherStoreId = "";
  const balance = () => getBalances(storeId).then((b) => b.AI);

  const createStore = async (suffix: string) => {
    const store = await db.store.create({
      data: {
        name: `Test IA ${tag}${suffix}`,
        slug: `test-ia-${tag}${suffix}`,
        currency: "XOF",
        sector: "patisserie",
        city: "Cotonou",
        memberships: { create: { userId: demo!.id, role: "OWNER" } },
        subscription: {
          create: {
            planId: "BUSINESS",
            status: "ACTIVE",
            interval: "MONTHLY",
            zone: "AFRICA",
            currency: "XOF",
            currentPeriodStart: new Date(Date.now() - 86_400_000),
            currentPeriodEnd: new Date(Date.now() + 20 * 86_400_000),
          },
        },
        categories: { create: { name: "Gâteaux", slug: `gateaux-${tag}${suffix}`, published: true } },
      },
      select: { id: true },
    });
    return store.id;
  };

  beforeAll(async () => {
    session.user = { ...demo!, isPlatformAdmin: false, emailVerified: true };
    storeId = await createStore("a");
    otherStoreId = await createStore("b");
    await db.product.create({ data: { storeId, name: "Gâteau wax", slug: `gateau-${tag}`, price: 15000, status: "ACTIVE" } });
  });

  afterAll(async () => {
    for (const id of [storeId, otherStoreId].filter(Boolean)) {
      await db.auditLog.deleteMany({ where: { storeId: id } });
      await db.job.deleteMany({ where: { storeId: id } });
      // ThemeVersion n'a pas de relation Prisma vers Store : la suppression n'est pas en cascade.
      await db.themeVersion.deleteMany({ where: { storeId: id } });
      await db.rateLimit.deleteMany({ where: { key: { contains: id } } }).catch(() => {});
      await db.store.delete({ where: { id } });
    }
  });

  it("les 20 crédits offerts ne sont accordés qu'une fois par boutique", async () => {
    expect(await grantOnboardingGift(storeId)).toBe(ONBOARDING_GIFT_CREDITS);
    expect(await grantOnboardingGift(storeId)).toBe(0);
    expect(await balance()).toBe(ONBOARDING_GIFT_CREDITS);
    const rows = await db.creditLedger.findMany({ where: { storeId, reason: "onboarding_gift" } });
    expect(rows).toHaveLength(1);
    expect(rows[0].expiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

  let generationId = "";

  it("une génération débite 10 crédits et conserve les 3 directions", async () => {
    const r = await generateStoreDesign({ storeId, brief: "Pâtisserie fine à Cotonou, gâteaux sur commande" });
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    const d = r.ok ? r.data! : null;
    expect(d!.creditsUsed).toBe(DESIGN_CREDITS.generate);
    expect(d!.candidates).toHaveLength(3);
    expect(await balance()).toBe(ONBOARDING_GIFT_CREDITS - DESIGN_CREDITS.generate);
    generationId = d!.generationId;
    const row = await db.themeGeneration.findUniqueOrThrow({ where: { id: generationId } });
    expect(row.status).toBe("SUCCEEDED");
    expect(row.creditsUsed).toBe(DESIGN_CREDITS.generate);
    expect(await db.auditLog.count({ where: { storeId, action: "ai.store_design" } })).toBe(1);
  });

  it("aucune section de témoignage ni d'avis dans les documents candidats (pas d'avis réels)", async () => {
    const row = await db.themeGeneration.findUniqueOrThrow({ where: { id: generationId } });
    const candidates = row.candidates as unknown as { doc: { templates: Record<string, { sections: Record<string, { type: string }> }> }; notes: string[] }[];
    for (const c of candidates) {
      const types = Object.values(c.doc.templates.home.sections).map((s) => s.type);
      expect(types).not.toContain("testimonials");
      expect(types).not.toContain("reviews");
      // Le brief simulé en demande une : le garde-fou doit l'avoir retirée et l'expliquer.
      expect(c.notes.join(" ")).toContain("aucun avis réel");
    }
  });

  it("le choix écrit le brouillon après une version « Avant génération IA », sans publier", async () => {
    // Un brouillon existe déjà (cas réel : le commerçant a ouvert l'éditeur au moins une fois).
    const first = (await db.themeGeneration.findUniqueOrThrow({ where: { id: generationId } })).candidates as unknown as { doc: unknown }[];
    await db.store.update({ where: { id: storeId }, data: { themeDocDraft: first[0].doc as never } });
    const before = await db.store.findUniqueOrThrow({ where: { id: storeId }, select: { themeDoc: true, themeDocDraft: true } });

    const r = await chooseDirection(storeId, generationId, 1);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);

    const after = await db.store.findUniqueOrThrow({ where: { id: storeId }, select: { themeDoc: true, themeDocDraft: true } });
    expect(after.themeDocDraft).not.toBeNull();
    expect(JSON.stringify(after.themeDocDraft)).not.toBe(JSON.stringify(before.themeDocDraft));
    expect(JSON.stringify(after.themeDoc)).toBe(JSON.stringify(before.themeDoc)); // rien n'est publié
    const versions = await db.themeVersion.findMany({ where: { storeId } });
    expect(versions.some((v) => v.label === "Avant génération IA")).toBe(true);
    expect(versions.every((v) => v.publishedAt === null)).toBe(true);
    const row = await db.themeGeneration.findUniqueOrThrow({ where: { id: generationId } });
    expect(row.chosenIndex).toBe(1);
  });

  it("une autre boutique ne peut pas choisir cette génération", async () => {
    const r = await chooseDirection(otherStoreId, generationId, 0);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("introuvable");
  });

  it("une sortie invalide rembourse les crédits et marque la génération en échec", async () => {
    fakeMode.broken = true;
    const before = await balance();
    const r = await generateStoreDesign({ storeId, brief: "Boutique de test avec sortie invalide" });
    fakeMode.broken = false;
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("crédits n'ont pas été débités");
    expect(await balance()).toBe(before);
    const failed = await db.themeGeneration.findFirst({ where: { storeId, status: "FAILED" }, orderBy: { createdAt: "desc" } });
    expect(failed?.creditsUsed).toBe(0);
    expect(await db.creditLedger.count({ where: { storeId, reason: "refund" } })).toBeGreaterThan(0);
  });

  it("l'assistant de design débite 2 crédits par instruction", async () => {
    const doc = await db.store.findUniqueOrThrow({ where: { id: storeId }, select: { themeDocDraft: true } });
    const before = await balance();
    const r = await runDesignAssistant({ storeId, instruction: "Rends l'accueil plus luxe", docJson: JSON.stringify(doc.themeDocDraft) });
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    expect(r.ok && r.data!.operations.length).toBeGreaterThan(0);
    expect(r.ok && r.data!.creditsUsed).toBe(DESIGN_CREDITS.assistant);
    expect(await balance()).toBe(before - DESIGN_CREDITS.assistant);
  });

  it("un refus hors cadre ne coûte rien", async () => {
    const doc = await db.store.findUniqueOrThrow({ where: { id: storeId }, select: { themeDocDraft: true } });
    const before = await balance();
    const r = await runDesignAssistant({ storeId, instruction: "Ajoute un script de suivi et de faux avis", docJson: JSON.stringify(doc.themeDocDraft) });
    expect(r.ok).toBe(true);
    expect(r.ok && r.data!.refused).toBe(true);
    expect(r.ok && r.data!.operations).toHaveLength(0);
    expect(await balance()).toBe(before);
  });

  it("solde insuffisant : la génération est refusée avant tout appel", async () => {
    const left = await balance();
    if (left > 0) await db.creditLedger.create({ data: { storeId, type: "AI", delta: -left, reason: "usage", reference: `test:drain:${tag}` } });
    const r = await generateStoreDesign({ storeId, brief: "Boutique sans crédits restants" });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("insuffisant");
  });
});
