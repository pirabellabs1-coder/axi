import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb } from "./helpers/fake-db";
import { mergeCollectionOrder, moveId } from "@/lib/collections/order";

const state = vi.hoisted(() => ({
  fake: null as null | ReturnType<typeof import("./helpers/fake-db").createFakeDb>,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.fake!.db;
  },
}));
vi.mock("@/lib/auth/permissions", () => {
  class AuthError extends Error {}
  return {
    AuthError,
    requireStore: async (storeId: string) => {
      if (storeId !== "store_aaaa") throw new AuthError("Accès refusé");
      return { store: { id: "store_aaaa", slug: "boutique-a" } };
    },
  };
});

import { reorderCollections } from "@/lib/collections/actions";

describe("ordre des collections : fonctions pures", () => {
  it("moveId déplace et borne l'index", () => {
    expect(moveId(["a", "b", "c"], "c", 0)).toEqual(["c", "a", "b"]);
    expect(moveId(["a", "b", "c"], "a", 1)).toEqual(["b", "a", "c"]);
    expect(moveId(["a", "b", "c"], "a", 99)).toEqual(["b", "c", "a"]);
    expect(moveId(["a", "b", "c"], "b", -5)).toEqual(["b", "a", "c"]);
    expect(moveId(["a", "b"], "z", 0)).toEqual(["a", "b"]);
  });

  it("mergeCollectionOrder : ids inconnus et doublons ignorés, oubliés ajoutés à la suite dans l'ordre actuel", () => {
    expect(mergeCollectionOrder(["c", "a", "x", "a"], ["a", "b", "c", "d"])).toEqual(["c", "a", "b", "d"]);
    expect(mergeCollectionOrder([], ["a", "b"])).toEqual(["a", "b"]);
  });
});

describe("reorderCollections", () => {
  const col = (id: string, storeId: string, position: number) => ({ id, storeId, position, name: id, slug: id });

  beforeEach(() => {
    state.fake = createFakeDb({
      category: [col("col_aaaa_1", "store_aaaa", 0), col("col_aaaa_2", "store_aaaa", 1), col("col_aaaa_3", "store_aaaa", 2), col("col_bbbb_1", "store_bbbb", 0)],
    });
  });

  const positions = (storeId: string) =>
    Object.fromEntries(state.fake!.tables.category.filter((c) => c.storeId === storeId).map((c) => [c.id, c.position]));

  it("enregistre les positions 0..n-1 dans l'ordre demandé", async () => {
    const r = await reorderCollections("store_aaaa", ["col_aaaa_3", "col_aaaa_1", "col_aaaa_2"]);
    expect(r.ok).toBe(true);
    expect(positions("store_aaaa")).toEqual({ col_aaaa_3: 0, col_aaaa_1: 1, col_aaaa_2: 2 });
  });

  it("isolation : une collection d'une autre boutique n'est jamais modifiée", async () => {
    const r = await reorderCollections("store_aaaa", ["col_bbbb_1", "col_aaaa_2"]);
    expect(r.ok).toBe(true);
    expect(positions("store_bbbb")).toEqual({ col_bbbb_1: 0 });
    // Liste partielle : les oubliées suivent, pas d'ex æquo.
    expect(positions("store_aaaa")).toEqual({ col_aaaa_2: 0, col_aaaa_1: 1, col_aaaa_3: 2 });
  });

  it("refuse les identifiants invalides et l'accès à une autre boutique", async () => {
    expect((await reorderCollections("store_aaaa", ["x"])).ok).toBe(false);
    expect((await reorderCollections("store_aaaa", "nope" as unknown as string[])).ok).toBe(false);
    expect((await reorderCollections("store_bbbb", ["col_bbbb_1"])).ok).toBe(false);
    expect(positions("store_bbbb")).toEqual({ col_bbbb_1: 0 });
  });
});
