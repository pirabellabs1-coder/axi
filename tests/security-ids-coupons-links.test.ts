import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  rl: { ok: true, retryAfter: 0 },
  coupon: null as Record<string, unknown> | null,
  requireStore: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => h.rl),
  rateLimitMessage: (s: number) => `Trop de tentatives (${s}s)`,
}));
vi.mock("@/lib/audit", () => ({ audit: async () => {} }));
vi.mock("@/lib/db", () => ({
  db: {
    saasCoupon: { findUnique: async () => h.coupon },
    auditLog: { findFirst: async () => null },
  },
}));
vi.mock("@/lib/auth/permissions", () => ({
  requireStore: h.requireStore,
  planFeature: () => true,
  AuthError: class extends Error {},
}));
vi.mock("@/lib/commerce/quotas", () => ({ checkProductsQuota: async () => ({ allowed: true }), quotaMessage: () => "" }));
vi.mock("@/lib/collections/service", () => ({ lockStoreCategories: async () => {} }));

import { badIds } from "@/lib/action";
import { rateLimit } from "@/lib/rate-limit";
import { COUPON_PUBLIC_ERROR, precheckStoreCoupon } from "@/lib/pricing/coupons";
import { archiveProduct, duplicateProduct, toggleFeatured } from "@/lib/products/actions";
import { deleteCollection, reorderCollections, setCollectionProducts } from "@/lib/collections/actions";
import { markdownToHtml } from "@/lib/products/markdown";

describe("m8 — identifiants bruts validés en tête d'action", () => {
  beforeEach(() => h.requireStore.mockReset());

  it("badIds : chaîne cuid uniquement", () => {
    expect(badIds("clx1abcdef0001", "abc_DEF-12345")).toBeNull();
    for (const bad of [{ id: "x" }, ["clx1abcdef0001"], "", "court", "a".repeat(65), "id avec espace", "x'; DROP", null, undefined, 42]) {
      expect(badIds(bad)).toMatchObject({ ok: false, error: "Identifiant invalide" });
    }
  });

  it("refuse un objet ou un id vide sans toucher à l'autorisation ni à la base", async () => {
    const asId = (v: unknown) => v as string;
    expect(await archiveProduct("store_000001", asId({ not: "x" }))).toMatchObject({ ok: false, error: "Identifiant invalide" });
    expect(await toggleFeatured(asId({}), "prod_000001")).toMatchObject({ ok: false });
    expect(await duplicateProduct("store_000001", "")).toMatchObject({ ok: false });
    expect(await deleteCollection("store_000001", asId({ in: [] }))).toMatchObject({ ok: false, error: "Identifiant invalide" });
    expect(await setCollectionProducts("store_000001", asId(null), [])).toMatchObject({ ok: false });
    expect(await reorderCollections(asId({ a: 1 }), [])).toMatchObject({ ok: false });
    expect(await reorderCollections("store_000001", "pas-un-tableau" as unknown as string[])).toMatchObject({ ok: false, error: "Liste de collections invalide" });
    expect(h.requireStore).not.toHaveBeenCalled();
  });
});

describe("m6 — codes promo SaaS : limite et message unique", () => {
  const ctx = { storeId: "store_000001", zone: "AFRICA" as never, planId: "STARTER" as never };
  beforeEach(() => {
    h.rl = { ok: true, retryAfter: 0 };
    h.coupon = null;
    vi.mocked(rateLimit).mockClear();
  });

  it("limite 10 essais / heure / boutique avant tout contrôle", async () => {
    h.rl = { ok: false, retryAfter: 1200 };
    expect(await precheckStoreCoupon("PROMO", ctx)).toEqual({ ok: false, error: "Trop de tentatives (1200s)" });
    expect(rateLimit).toHaveBeenCalledWith("saas-coupon:store:store_000001", 10, 3600);
  });

  it("code inconnu ou inéligible : même message neutre", async () => {
    expect(await precheckStoreCoupon("INCONNU", ctx)).toEqual({ ok: false, error: COUPON_PUBLIC_ERROR });
    h.coupon = { id: "c1", code: "VIEUX", active: false, expiresAt: null, zones: [], planIds: [], maxRedemptions: null, redemptions: 0 };
    expect(await precheckStoreCoupon("VIEUX", ctx)).toEqual({ ok: false, error: COUPON_PUBLIC_ERROR });
    expect(COUPON_PUBLIC_ERROR).toBe("Code promo invalide ou non applicable.");
  });
});

describe("m9 — liens Markdown des descriptions produit", () => {
  it("garde https, chemins internes, mailto", () => {
    expect(markdownToHtml("[site](https://exemple.test/a)")).toContain('<a href="https://exemple.test/a"');
    expect(markdownToHtml("[cgv](/s/boutique/pages/cgv)")).toContain('<a href="/s/boutique/pages/cgv"');
    expect(markdownToHtml("[écrire](mailto:contact@exemple.test)")).toContain('href="mailto:contact@exemple.test"');
  });

  it("refuse http://, // et javascript: (libellé seul)", () => {
    for (const href of ["http://exemple.test", "//evil.test/x", "javascript:alert(1)"]) {
      const html = markdownToHtml(`[clic](${href})`);
      expect(html).not.toContain("<a ");
      expect(html).toContain("clic");
    }
  });
});
