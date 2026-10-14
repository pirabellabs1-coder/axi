import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb } from "./helpers/fake-db";

/**
 * Lot 2 §1.1 — actions des langues : isolation entre boutiques, quota `limits.languages`, validation des
 * champs, et garde-fous de la traduction par l'IA (crédits, anti-invention, glossaire).
 */

const state = vi.hoisted(() => ({
  fake: null as null | ReturnType<typeof import("./helpers/fake-db").createFakeDb>,
  member: "store_AAAAAAAA" as string,
  planId: "SCALE" as string,
  caps: new Set<string>(["store.settings"]),
  credits: { debited: [] as number[], refunded: 0 },
  aiText: "{}",
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: (fn: (...a: unknown[]) => unknown) => fn };
});
vi.mock("@/lib/db", () => ({
  get db() {
    return state.fake!.db;
  },
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => ({})) }));
vi.mock("@/lib/credits", () => ({
  debitCredits: vi.fn(async (_s: string, _k: string, n: number) => {
    state.credits.debited.push(n);
    return { ok: true, balance: 100 };
  }),
  refundCredits: vi.fn(async () => {
    state.credits.refunded += 1;
    return 0;
  }),
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn(async () => ({ ok: true, retryAfter: 0 })), rateLimitMessage: () => "Trop de tentatives." }));
vi.mock("@/lib/ai/client", () => ({
  isAiConfigured: () => true,
  callClaudeJson: vi.fn(async () => ({ text: state.aiText, usage: { input: 10, output: 10 } })),
  AiError: class AiError extends Error {},
}));
vi.mock("@/lib/auth/permissions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/permissions")>("@/lib/auth/permissions");
  class AuthError extends Error {}
  return {
    ...actual,
    AuthError,
    requireStore: vi.fn(async (storeId: string, cap: string) => {
      if (storeId !== state.member) throw new AuthError("Boutique introuvable ou accès refusé");
      if (!state.caps.has(cap)) throw new AuthError("Votre rôle ne permet pas cette action");
      const store = state.fake!.tables.store.find((s) => s.id === storeId)!;
      return { user: { id: "user_A" }, store, role: "OWNER", planId: state.planId, can: () => true };
    }),
  };
});

const { updateLanguages, updateGlossary, upsertTranslation, deleteTranslation, translateResources } = await import("@/lib/i18n/actions");
const { sourceHash } = await import("@/lib/i18n/hash");

const A = "store_AAAAAAAA";
const B = "store_BBBBBBBB";

function seed() {
  state.fake = createFakeDb({
    store: [
      { id: A, slug: "chez-aicha", name: "Chez Aïcha", locale: "fr", enabledLocales: ["en"], i18nConfig: null, status: "PUBLISHED", tagline: "Pagnes", description: null, orderNotes: null },
      { id: B, slug: "chez-bola", name: "Chez Bola", locale: "fr", enabledLocales: ["en"], i18nConfig: null, status: "PUBLISHED", tagline: null, description: null, orderNotes: null },
    ],
    product: [
      { id: "prod_A", storeId: A, name: "Robe en wax", slug: "robe-wax", description: "Coupe droite, tissu de Cotonou.", seoTitle: null, seoDescription: null, details: null, options: [{ name: "Taille", values: ["M", "L"] }] },
      { id: "prod_B", storeId: B, name: "Sac en raphia", slug: "sac-raphia", description: null, seoTitle: null, seoDescription: null, details: null, options: null },
    ],
    translation: [{ id: "tr_1", storeId: B, resourceType: "PRODUCT", resourceId: "prod_B", locale: "en", field: "name", value: "Raffia bag", source: "MANUAL", sourceHash: "x", updatedAt: new Date() }],
  });
  state.credits = { debited: [], refunded: 0 };
  state.planId = "SCALE";
}

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.append(k, v);
  return f;
};

beforeEach(seed);

describe("langues de la boutique", () => {
  it("enregistre les langues dans la limite du plan", async () => {
    const res = await updateLanguages(undefined, fd({ storeId: A, primary: "fr", secondary: "en,pt,ar" }));
    expect(res.ok).toBe(true);
    expect(state.fake!.tables.store.find((s) => s.id === A)!.enabledLocales).toEqual(["en", "pt", "ar"]);
  });

  it("refuse au-delà du quota du plan", async () => {
    state.planId = "BUSINESS"; // 2 langues au total
    const res = await updateLanguages(undefined, fd({ storeId: A, primary: "fr", secondary: "en,pt" }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("2 langues au total");
    state.planId = "STARTER"; // 1 langue
    const res2 = await updateLanguages(undefined, fd({ storeId: A, primary: "fr", secondary: "en" }));
    expect(res2.ok).toBe(false);
    if (!res2.ok) expect(res2.error).toContain("une seule langue");
  });

  it("refuse une langue inconnue et ignore la langue principale répétée", async () => {
    expect((await updateLanguages(undefined, fd({ storeId: A, primary: "fr", secondary: "klingon" }))).ok).toBe(false);
    await updateLanguages(undefined, fd({ storeId: A, primary: "fr", secondary: "fr,en,en" }));
    expect(state.fake!.tables.store.find((s) => s.id === A)!.enabledLocales).toEqual(["en"]);
  });

  it("n'agit jamais sur une autre boutique", async () => {
    const res = await updateLanguages(undefined, fd({ storeId: B, primary: "fr", secondary: "pt" }));
    expect(res.ok).toBe(false);
    expect(state.fake!.tables.store.find((s) => s.id === B)!.enabledLocales).toEqual(["en"]);
  });

  it("enregistre le glossaire sans écraser les autres réglages i18n", async () => {
    state.fake!.tables.store.find((s) => s.id === A)!.i18nConfig = { autre: true };
    await updateGlossary(undefined, fd({ storeId: A, terms: "Chez Aïcha\npagne wax\n\nChez Aïcha" }));
    expect(state.fake!.tables.store.find((s) => s.id === A)!.i18nConfig).toEqual({ autre: true, glossary: [{ term: "Chez Aïcha" }, { term: "pagne wax" }] });
  });
});

describe("traductions manuelles", () => {
  const base = { storeId: A, locale: "en", resourceType: "PRODUCT", resourceId: "prod_A", field: "name" };

  it("enregistre avec l'empreinte du texte source et la source MANUAL", async () => {
    const res = await upsertTranslation(undefined, fd({ ...base, value: "Wax dress" }));
    expect(res.ok).toBe(true);
    const row = state.fake!.tables.translation.find((t) => t.storeId === A && t.field === "name")!;
    expect(row).toMatchObject({ value: "Wax dress", source: "MANUAL", locale: "en", sourceHash: sourceHash("Robe en wax") });
  });

  it("refuse une langue non activée, un champ inexistant, du HTML et une valeur trop longue", async () => {
    expect((await upsertTranslation(undefined, fd({ ...base, locale: "pt", value: "Vestido" }))).ok).toBe(false);
    expect((await upsertTranslation(undefined, fd({ ...base, field: "costPrice", value: "1" }))).ok).toBe(false);
    expect((await upsertTranslation(undefined, fd({ ...base, value: "<script>alert(1)</script>" }))).ok).toBe(false);
    expect((await upsertTranslation(undefined, fd({ ...base, value: "A".repeat(400) }))).ok).toBe(false);
    expect(state.fake!.tables.translation.filter((t) => t.storeId === A)).toHaveLength(0);
  });

  it("ne touche pas aux traductions d'une autre boutique", async () => {
    const res = await upsertTranslation(undefined, fd({ ...base, storeId: B, resourceId: "prod_B", value: "Pwn" }));
    expect(res.ok).toBe(false);
    // Tentative d'écrire sur une ressource de B depuis A : le champ n'existe pas pour A, donc refusé.
    const res2 = await upsertTranslation(undefined, fd({ ...base, resourceId: "prod_B", value: "Pwn" }));
    expect(res2.ok).toBe(false);
    expect(state.fake!.tables.translation.find((t) => t.id === "tr_1")!.value).toBe("Raffia bag");
  });

  it("une valeur vide supprime la traduction (retour au texte d'origine)", async () => {
    await upsertTranslation(undefined, fd({ ...base, value: "Wax dress" }));
    const res = await upsertTranslation(undefined, fd({ ...base, value: "   " }));
    expect(res.ok).toBe(true);
    expect(state.fake!.tables.translation.filter((t) => t.storeId === A)).toHaveLength(0);
  });

  it("la suppression explicite est filtrée par boutique", async () => {
    await upsertTranslation(undefined, fd({ ...base, value: "Wax dress" }));
    await deleteTranslation(undefined, fd({ ...base, storeId: B, resourceId: "prod_B" }));
    expect(state.fake!.tables.translation.find((t) => t.id === "tr_1")!.value).toBe("Raffia bag");
    expect((await deleteTranslation(undefined, fd(base))).ok).toBe(true);
    expect(state.fake!.tables.translation.filter((t) => t.storeId === A)).toHaveLength(0);
  });
});

describe("traduction par l'IA", () => {
  const input = { storeId: A, locale: "en", resourceType: "PRODUCT" as const, ids: [] };

  it("écrit les traductions acceptées, en AI, et débite 1 crédit par 1 500 caractères", async () => {
    state.aiText = JSON.stringify({ "prod_A#name": "Wax dress", "prod_A#description": "Straight cut, fabric from Cotonou.", "prod_A#options.name.Taille": "Size", "prod_A#options.value.M": "M", "prod_A#options.value.L": "L" });
    const res = await translateResources(input);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toMatchObject({ translated: 5, creditsUsed: 1 });
    expect(state.credits.debited).toEqual([1]);
    expect(state.credits.refunded).toBe(0);
    const rows = state.fake!.tables.translation.filter((t) => t.storeId === A);
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.source === "AI" && r.locale === "en")).toBe(true);
    expect(rows.find((r) => r.field === "name")!.sourceHash).toBe(sourceHash("Robe en wax"));
  });

  it("rejette une invention (prix ajouté) et ne l'enregistre pas", async () => {
    state.aiText = JSON.stringify({ "prod_A#name": "Wax dress", "prod_A#description": "Straight cut. Only 5000 FCFA, free delivery!" });
    const res = await translateResources(input);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data!.translated).toBe(1);
      expect(res.data!.rejected.some((r) => r.reason.includes("non vérifiable"))).toBe(true);
    }
    expect(state.fake!.tables.translation.some((t) => t.storeId === A && t.field === "description")).toBe(false);
  });

  it("rejette une traduction qui perd un terme du glossaire", async () => {
    state.fake!.tables.store.find((s) => s.id === A)!.i18nConfig = { glossary: [{ term: "wax" }] };
    state.aiText = JSON.stringify({ "prod_A#name": "Printed dress" });
    const res = await translateResources({ ...input, ids: ["prod_A"] });
    // Le terme « wax » a disparu : champ rejeté. Aucun champ accepté dans ce lot, donc crédits remboursés.
    expect(res.ok).toBe(false);
    expect(state.credits.refunded).toBe(1);
    expect(state.fake!.tables.translation.some((t) => t.storeId === A && t.field === "name")).toBe(false);
  });

  it("rembourse les crédits si la réponse est illisible ou entièrement rejetée", async () => {
    state.aiText = "ceci n'est pas du JSON";
    const res = await translateResources(input);
    expect(res.ok).toBe(false);
    expect(state.credits.refunded).toBe(1);
    expect(state.fake!.tables.translation.filter((t) => t.storeId === A)).toHaveLength(0);
  });

  it("refuse hors plan et pour une langue non activée", async () => {
    state.planId = "STARTER";
    const res = await translateResources(input);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("plan Business");
    state.planId = "SCALE";
    const res2 = await translateResources({ ...input, locale: "ar" });
    expect(res2.ok).toBe(false);
    expect(state.credits.debited).toEqual([]);
  });

  it("ne traduit jamais le contenu d'une autre boutique", async () => {
    state.aiText = JSON.stringify({ "prod_B#name": "Raffia bag" });
    const res = await translateResources({ ...input, ids: ["prod_B"] });
    expect(res.ok).toBe(false);
    expect(state.fake!.tables.translation.filter((t) => t.storeId === A)).toHaveLength(0);
  });
});
