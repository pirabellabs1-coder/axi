import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb } from "./helpers/fake-db";
import { DATA_URL_WRITE_ERROR, FOREIGN_MEDIA_ERROR } from "@/lib/storage/write-guard";

/**
 * saveProduct : un produit ancien contenant encore une data-URL reste modifiable (valeur IDENTIQUE à l'existant),
 * mais aucune nouvelle data-URL ni aucun média d'une autre boutique n'est accepté.
 */

const STORE = "storeaaaa1111";
const OTHER = "storebbbb2222";
const HASH = "a".repeat(64);
const DATA = "data:image/png;base64,iVBORw0KGgo=";

const state = vi.hoisted(() => ({ fake: null as null | ReturnType<typeof import("./helpers/fake-db").createFakeDb> }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.fake!.db;
  },
}));
vi.mock("@/lib/audit", () => ({ audit: async () => ({}) }));
vi.mock("@/lib/commerce/quotas", () => ({ checkProductsQuota: async () => ({ allowed: true, used: 1, limit: null }), quotaMessage: () => "" }));
vi.mock("@/lib/collections/service", () => ({ lockStoreCategories: async () => {} }));
vi.mock("@/lib/auth/permissions", () => {
  class AuthError extends Error {}
  return {
    AuthError,
    planFeature: () => true,
    requireStore: async () => ({ store: { id: STORE, slug: "boutique" }, user: { id: "user_1" }, planId: "BUSINESS", role: "OWNER" }),
  };
});

import { saveProduct } from "@/lib/products/actions";

const PRODUCT = "prodaaaa1111";

function seed() {
  state.fake = createFakeDb({
    product: [
      {
        id: PRODUCT, storeId: STORE, name: "Sac ancien", slug: "sac-ancien", stock: 0, trackStock: false, lowStockThreshold: null,
        images: [{ url: DATA, alt: "" }], options: [], variants: [],
      },
    ],
    category: [],
    optionGroup: [],
  });
}

const payload = (images: { url: string; alt?: string }[]) => ({ productId: PRODUCT, name: "Sac ancien", price: 10000, images: images.map((i) => ({ alt: "", ...i })) });

beforeEach(seed);

describe("saveProduct : garde d'écriture des images", () => {
  it("data-URL identique à l'existant : le produit reste modifiable", async () => {
    const r = await saveProduct(STORE, payload([{ url: DATA }]));
    expect(r.ok).toBe(true);
    expect(state.fake!.tables.product[0].images).toEqual([{ url: DATA, alt: "" }]);
  });

  it("nouvelle data-URL : refusée", async () => {
    const r = await saveProduct(STORE, payload([{ url: DATA }, { url: "data:image/png;base64,QUJDRA==" }]));
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error).toBe(DATA_URL_WRITE_ERROR);
  });

  it("média d'une autre boutique : refusé ; média de la boutique : accepté", async () => {
    const foreign = await saveProduct(STORE, payload([{ url: `/media/stores/${OTHER}/2026/10/${HASH}.webp` }]));
    expect(foreign.ok ? "" : foreign.error).toBe(FOREIGN_MEDIA_ERROR);
    const own = await saveProduct(STORE, payload([{ url: `/media/stores/${STORE}/2026/10/${HASH}.webp` }]));
    expect(own.ok).toBe(true);
  });
});
