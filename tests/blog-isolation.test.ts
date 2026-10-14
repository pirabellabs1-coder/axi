import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb } from "./helpers/fake-db";

/**
 * Lot 2 D : isolation entre boutiques et contrôle de plan des actions du blog.
 * Un membre de A ne peut ni modifier, ni publier, ni supprimer un article de B, ni utiliser une catégorie de B ;
 * le plan Gratuit n'a pas de blog ; le plan Starter est limité à 20 articles ; une adresse en double reçoit -2.
 */

const state = vi.hoisted(() => ({
  fake: null as null | ReturnType<typeof import("./helpers/fake-db").createFakeDb>,
  member: "store_AAAAAAAA" as string,
  planId: "STARTER" as string,
  caps: new Set<string>(["store.settings"]),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.fake!.db;
  },
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => ({})) }));
vi.mock("@/lib/credits", () => ({ debitCredits: vi.fn(async () => ({ ok: true, balance: 10 })), refundCredits: vi.fn(async () => 0) }));
vi.mock("@/lib/ai/client", () => ({ isAiConfigured: () => false, callClaudeJson: vi.fn(), AiError: class extends Error {} }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn(async () => ({ ok: true, retryAfter: 0 })), rateLimitMessage: () => "Trop de tentatives." }));
vi.mock("@/lib/auth/permissions", () => {
  class AuthError extends Error {}
  return {
    AuthError,
    requireStore: vi.fn(async (storeId: string, cap: string) => {
      if (storeId !== state.member) throw new AuthError("Boutique introuvable ou accès refusé");
      if (!state.caps.has(cap)) throw new AuthError("Votre rôle ne permet pas cette action");
      const store = state.fake!.tables.store.find((s) => s.id === storeId)!;
      return { user: { id: "user_A" }, store, role: "OWNER", planId: state.planId, can: () => true };
    }),
  };
});

import { savePost, setPostStatus, deletePost, saveCategory, deleteCategory, draftPostWithAi } from "@/lib/blog/actions";

const A = "store_AAAAAAAA";
const B = "store_BBBBBBBB";

function fd(o: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
}
const post = (o: Record<string, string> = {}) => fd({ storeId: A, title: "Bien conserver vos gâteaux", body: "Un texte assez long pour être publié sur la boutique.", intent: "publish", ...o });

beforeEach(() => {
  state.member = A;
  state.planId = "STARTER";
  state.caps = new Set(["store.settings"]);
  state.fake = createFakeDb({
    store: [
      { id: A, slug: "boutique-a", status: "PUBLISHED", timezone: "Africa/Abidjan" },
      { id: B, slug: "boutique-b", status: "PUBLISHED", timezone: "Africa/Abidjan" },
    ],
    blogCategory: [{ id: "blogcat_B1", storeId: B, slug: "conseils", name: "Conseils", position: 0 }],
    blogPost: [{ id: "blogpost_B1", storeId: B, slug: "secret", title: "Article de B", body: "Texte de la boutique B, brouillon.", status: "DRAFT", publishedAt: null, tags: [], coverImage: null, readingMinutes: 1 }],
  });
});

describe("blog : isolation entre boutiques", () => {
  it("modifier un article d'une autre boutique : introuvable, rien n'est écrit", async () => {
    const r = await savePost(undefined, post({ postId: "blogpost_B1", title: "Piraté" }));
    expect(r.ok).toBe(false);
    expect(state.fake!.tables.blogPost.find((p) => p.id === "blogpost_B1")!.title).toBe("Article de B");
  });
  it("publier / archiver / supprimer un article de B depuis A : refusé", async () => {
    expect((await setPostStatus(A, "blogpost_B1", "publish")).ok).toBe(false);
    expect((await deletePost(A, "blogpost_B1")).ok).toBe(false);
    expect(state.fake!.tables.blogPost.find((p) => p.id === "blogpost_B1")!.status).toBe("DRAFT");
  });
  it("agir sur la boutique B sans en être membre : refusé", async () => {
    expect((await setPostStatus(B, "blogpost_B1", "publish")).ok).toBe(false);
    expect((await savePost(undefined, post({ storeId: B }))).ok).toBe(false);
  });
  it("catégorie d'une autre boutique : refusée (article et suppression)", async () => {
    const r = await savePost(undefined, post({ categoryId: "blogcat_B1" }));
    expect(r.ok).toBe(false);
    expect((await deleteCategory(A, "blogcat_B1")).ok).toBe(false);
    expect(state.fake!.tables.blogCategory).toHaveLength(1);
  });
  it("image téléversée par une autre boutique : refusée", async () => {
    const foreign = `/media/stores/${B.toLowerCase().replace(/_/g, "")}/2026/10/${"a".repeat(64)}.webp`;
    const r = await savePost(undefined, post({ coverUrl: foreign }));
    expect(r.ok).toBe(false);
  });
  it("rôle sans store.settings : refusé", async () => {
    state.caps = new Set(["orders.view"]);
    expect((await savePost(undefined, post())).ok).toBe(false);
  });
});

describe("blog : écriture", () => {
  it("création, adresse en double → suffixe -2, publication datée", async () => {
    const r1 = await savePost(undefined, post());
    const r2 = await savePost(undefined, post());
    expect(r1.ok && r2.ok).toBe(true);
    const mine = state.fake!.tables.blogPost.filter((p) => p.storeId === A);
    expect(mine.map((p) => p.slug).sort()).toEqual(["bien-conserver-vos-gateaux", "bien-conserver-vos-gateaux-2"]);
    expect(mine.every((p) => p.status === "PUBLISHED" && p.publishedAt instanceof Date)).toBe(true);
  });
  it("même adresse que la boutique B : autorisée (unicité par boutique)", async () => {
    const r = await savePost(undefined, post({ title: "Secret", slug: "secret" }));
    expect(r.ok).toBe(true);
    expect(state.fake!.tables.blogPost.find((p) => p.storeId === A)!.slug).toBe("secret");
  });
  it("programmation : date future requise, statut SCHEDULED", async () => {
    expect((await savePost(undefined, post({ intent: "schedule", scheduledAt: "2020-01-01T10:00" }))).ok).toBe(false);
    const r = await savePost(undefined, post({ intent: "schedule", scheduledAt: "2099-01-01T10:00" }));
    expect(r.ok).toBe(false); // au-delà d'un an
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 16);
    const ok = await savePost(undefined, post({ intent: "schedule", scheduledAt: soon }));
    expect(ok.ok).toBe(true);
    expect(state.fake!.tables.blogPost.find((p) => p.storeId === A)!.status).toBe("SCHEDULED");
  });
  it("Markdown dangereux refusé", async () => {
    const r = await savePost(undefined, post({ body: "Bonjour <script>alert(1)</script> à tous les clients" }));
    expect(r.ok).toBe(false);
  });
  it("supprimer une catégorie : ses articles restent, sans catégorie", async () => {
    const c = await saveCategory(undefined, fd({ storeId: A, name: "Recettes" }));
    expect(c.ok).toBe(true);
    const catId = (c as { data: { id: string } }).data.id;
    await savePost(undefined, post({ categoryId: catId }));
    expect((await deleteCategory(A, catId)).ok).toBe(true);
    const p = state.fake!.tables.blogPost.find((x) => x.storeId === A)!;
    expect(p.categoryId).toBeNull();
  });
});

describe("blog : plan", () => {
  it("plan Gratuit : pas de blog", async () => {
    state.planId = "FREE";
    const r = await savePost(undefined, post());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Starter/);
    expect((await saveCategory(undefined, fd({ storeId: A, name: "Recettes" }))).ok).toBe(false);
  });
  it("plan Starter : 20 articles maximum (tous statuts)", async () => {
    for (let i = 0; i < 20; i++) state.fake!.tables.blogPost.push({ id: `blogpost_A${i}`, storeId: A, slug: `a-${i}`, title: "x", body: "x", status: "ARCHIVED", tags: [] });
    const r = await savePost(undefined, post());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/20 articles/);
    // Modifier un article existant reste possible.
    const edit = await savePost(undefined, post({ postId: "blogpost_A0", intent: "draft" }));
    expect(edit.ok).toBe(true);
  });
  it("plan Business : illimité", async () => {
    state.planId = "BUSINESS";
    for (let i = 0; i < 25; i++) state.fake!.tables.blogPost.push({ id: `blogpost_A${i}`, storeId: A, slug: `a-${i}`, title: "x", body: "x", status: "DRAFT", tags: [] });
    expect((await savePost(undefined, post())).ok).toBe(true);
  });
  it("IA : refusée sans assistant configuré, aucun crédit débité", async () => {
    state.planId = "BUSINESS";
    const r = await draftPostWithAi({ storeId: A, topic: "Conserver un gâteau" });
    expect(r.ok).toBe(false);
    const { debitCredits } = await import("@/lib/credits");
    expect(debitCredits).not.toHaveBeenCalled();
  });
});
