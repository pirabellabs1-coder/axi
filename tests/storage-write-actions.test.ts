import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./helpers/fake-db";
import { DATA_URL_WRITE_ERROR, FOREIGN_MEDIA_ERROR } from "@/lib/storage/write-guard";

/** M1 / n1 appliqués dans une action réelle : enregistrement de l'image d'une collection. */
const state = vi.hoisted(() => ({ fake: null as null | ReturnType<typeof import("./helpers/fake-db").createFakeDb> }));

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
  return { AuthError, requireStore: async (storeId: string) => ({ store: { id: storeId, slug: "boutique-a" } }) };
});

import { saveCollection } from "@/lib/collections/actions";

const STORE = "storeaaaa01";
const HASH = "cd".repeat(32);
const legacy = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";

describe("saveCollection : règles d'écriture de l'image", () => {
  beforeEach(() => {
    state.fake = createFakeDb({ category: [{ id: "colaaaa0001", storeId: STORE, slug: "robes", name: "Robes", imageUrl: legacy, position: 0, rules: { type: "manual", productIds: [] } }] });
  });

  const save = (imageUrl: string, id?: string) => saveCollection(STORE, { id, name: "Robes", slug: id ? "robes" : "nouvelle", imageUrl, rules: { type: "manual", productIds: [] } });

  it("refuse une nouvelle data-URL (création ou remplacement)", async () => {
    const created = await save("data:image/jpeg;base64,/9j/4AAQSkZJRg==");
    expect(created).toMatchObject({ ok: false, error: DATA_URL_WRITE_ERROR });
    const replaced = await save("data:image/jpeg;base64,/9j/4AAQSkZJRg==", "colaaaa0001");
    expect(replaced).toMatchObject({ ok: false, error: DATA_URL_WRITE_ERROR });
  });

  it("refuse le média d'une autre boutique", async () => {
    const r = await save(`/media/stores/storebbbb02/2026/10/${HASH}.jpg`);
    expect(r).toMatchObject({ ok: false, error: FOREIGN_MEDIA_ERROR });
  });

  it("laisse passer la data-URL déjà en base renvoyée à l'identique, et un média de la boutique", async () => {
    for (const r of [await save(legacy, "colaaaa0001"), await save(`/media/stores/${STORE}/2026/10/${HASH}.jpg`)]) {
      if (!r.ok) expect([DATA_URL_WRITE_ERROR, FOREIGN_MEDIA_ERROR]).not.toContain(r.error);
    }
  });
});
