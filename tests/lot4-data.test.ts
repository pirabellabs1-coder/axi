import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Lot 4A, équipe D (T5) : champs personnalisés, sections enregistrées, bibliothèque.
 * Isolation entre boutiques, plans, clonage avec nouveaux identifiants, contrôle minPlan / premium côté serveur.
 */

const state = vi.hoisted(() => ({
  fake: null as null | ReturnType<typeof import("./helpers/fake-db").createFakeDb>,
  member: "store_AAAAAAAA" as string,
  planId: "BUSINESS" as string,
  caps: new Set<string>(["theme.manage", "products.manage", "customers.manage", "store.settings"]),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.fake!.db;
  },
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => ({})) }));
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

import { createFakeDb } from "./helpers/fake-db";
import { createMetafieldDefinition, saveMetafieldValues, deleteMetafieldDefinition } from "@/lib/metafields/actions";
import { getStorefrontMetafields } from "@/lib/metafields/read";
import { saveSection, getSavedSectionForInsert, deleteSavedSection, listSavedSections } from "@/lib/saved-sections/actions";
import { clonePayload, toPayload, validateSectionPayload, stripMissingRefs } from "@/lib/saved-sections/payload";
import { getLibraryItemForInsert } from "@/lib/section-library/actions";
import { libraryAccess, effectiveMinPlan, validateLibraryPayload } from "@/lib/section-library/rules";
import { DEMO_LIBRARY_ITEMS } from "@/lib/section-library/demo-items";
import { uniqueIdFactory } from "@/lib/theme-engine/operations";
import { fallbackThemeDocument } from "@/lib/theme-engine/editor-defaults";
import type { SectionInstance } from "@/lib/theme-engine/types";

const A = "store_AAAAAAAA";
const B = "store_BBBBBBBB";
const PA = "cprodAAAAAAAA1";
const PB = "cprodBBBBBBBB1";
const CA = "ccolAAAAAAAAA1";

beforeEach(() => {
  state.member = A;
  state.planId = "BUSINESS";
  state.caps = new Set(["theme.manage", "products.manage", "customers.manage", "store.settings"]);
  state.fake = createFakeDb({
    store: [
      { id: A, slug: "boutique-a", status: "PUBLISHED", currency: "XOF" },
      { id: B, slug: "boutique-b", status: "PUBLISHED", currency: "XOF" },
    ],
    product: [
      { id: PA, storeId: A, name: "Robe wax", slug: "robe-wax", status: "ACTIVE" },
      { id: PB, storeId: B, name: "Produit B", slug: "produit-b", status: "ACTIVE" },
    ],
    category: [{ id: CA, storeId: A, name: "Robes", slug: "robes", published: true }],
    customer: [{ id: "ccustBBBBBBBB1", storeId: B, name: "Koffi" }],
    storeMenu: [],
    metafieldDefinition: [],
    metafieldValue: [],
    savedSection: [],
    sectionLibraryItem: [],
  });
});

const matiere = { ownerType: "PRODUCT" as const, namespace: "custom", key: "matiere", name: "Matière", type: "single_line_text" as const, storefrontVisible: true, pinned: true };

describe("champs personnalisés : plans et isolation", () => {
  it("plan Gratuit : création refusée", async () => {
    state.planId = "FREE";
    const r = await createMetafieldDefinition(A, matiere);
    expect(r.ok).toBe(false);
    expect(state.fake!.tables.metafieldDefinition).toHaveLength(0);
  });

  it("plan Starter : 10 définitions maximum", async () => {
    state.planId = "STARTER";
    for (let i = 0; i < 10; i++) expect((await createMetafieldDefinition(A, { ...matiere, key: `k${i}` })).ok).toBe(true);
    const r = await createMetafieldDefinition(A, { ...matiere, key: "k10" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/10/);
  });

  it("clé unique par type d'élément ; client jamais visible en boutique", async () => {
    expect((await createMetafieldDefinition(A, matiere)).ok).toBe(true);
    expect((await createMetafieldDefinition(A, matiere)).ok).toBe(false);
    const c = await createMetafieldDefinition(A, { ...matiere, ownerType: "CUSTOMER", storefrontVisible: true });
    expect(c.ok).toBe(true);
    expect(state.fake!.tables.metafieldDefinition.find((d) => d.ownerType === "CUSTOMER")!.storefrontVisible).toBe(false);
  });

  it("boutique d'un autre marchand refusée", async () => {
    const r = await createMetafieldDefinition(B, matiere);
    expect(r.ok).toBe(false);
  });

  it("valeur : propriétaire et références vérifiés dans la même boutique", async () => {
    const d = await createMetafieldDefinition(A, matiere);
    const ref = await createMetafieldDefinition(A, { ...matiere, key: "assorti", name: "Assorti", type: "product_reference" });
    if (!d.ok || !ref.ok) throw new Error("setup");
    // Produit de B : refusé
    expect((await saveMetafieldValues(A, { ownerType: "PRODUCT", ownerId: PB, values: { [d.data!.id]: "Wax" } })).ok).toBe(false);
    // Référence vers un produit de B : refusée, rien n'est écrit (tout ou rien)
    const bad = await saveMetafieldValues(A, { ownerType: "PRODUCT", ownerId: PA, values: { [d.data!.id]: "Wax", [ref.data!.id]: PB } });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.fieldErrors?.[ref.data!.id]?.[0]).toMatch(/introuvable/);
    expect(state.fake!.tables.metafieldValue).toHaveLength(0);
    // Valide
    const ok = await saveMetafieldValues(A, { ownerType: "PRODUCT", ownerId: PA, values: { [d.data!.id]: "Wax hollandais", [ref.data!.id]: PA } });
    expect(ok.ok).toBe(true);
    expect(state.fake!.tables.metafieldValue).toHaveLength(2);
    expect(state.fake!.tables.metafieldValue.every((v) => v.storeId === A)).toBe(true);
    // Valeur vide = suppression
    await saveMetafieldValues(A, { ownerType: "PRODUCT", ownerId: PA, values: { [ref.data!.id]: null } });
    expect(state.fake!.tables.metafieldValue).toHaveLength(1);
  });

  it("définition d'une autre boutique inutilisable", async () => {
    state.member = B;
    const dB = await createMetafieldDefinition(B, matiere);
    if (!dB.ok) throw new Error("setup");
    state.member = A;
    const r = await saveMetafieldValues(A, { ownerType: "PRODUCT", ownerId: PA, values: { [dB.data!.id]: "Wax" } });
    expect(r.ok).toBe(false);
    expect(state.fake!.tables.metafieldValue).toHaveLength(0);
    expect((await deleteMetafieldDefinition(A, dB.data!.id)).ok).toBe(false);
  });

  it("capacité du propriétaire exigée (client = customers.manage)", async () => {
    const d = await createMetafieldDefinition(A, { ...matiere, ownerType: "CUSTOMER" });
    state.caps.delete("customers.manage");
    const r = await saveMetafieldValues(A, { ownerType: "CUSTOMER", ownerId: "ccustAAAAAAAA1", values: { [d.ok ? d.data!.id : "x"]: "a" } });
    expect(r.ok).toBe(false);
  });

  it("lecture boutique : storefrontVisible uniquement, jamais client", async () => {
    const pub = await createMetafieldDefinition(A, matiere);
    const priv = await createMetafieldDefinition(A, { ...matiere, key: "cout", name: "Coût", storefrontVisible: false });
    if (!pub.ok || !priv.ok) throw new Error("setup");
    await saveMetafieldValues(A, { ownerType: "PRODUCT", ownerId: PA, values: { [pub.data!.id]: "Wax", [priv.data!.id]: "1200" } });
    const m = await getStorefrontMetafields(A, "PRODUCT", [PA]);
    expect(Object.keys(m[PA])).toEqual(["custom.matiere"]);
    expect(m[PA]["custom.matiere"].text).toBe("Wax");
    expect(await getStorefrontMetafields(B, "PRODUCT", [PA])).toEqual({});
    expect(await getStorefrontMetafields(A, "CUSTOMER", ["ccustAAAAAAAA1"])).toEqual({});
  });
});

const multicolumn = (extra: Record<string, unknown> = {}) => ({
  id: "multicolumn-abc",
  type: "multicolumn",
  settings: { heading: "Nos engagements", columns: "3", ...extra },
  blocks: [
    { id: "column-1", type: "column", settings: { title: "Livraison", text: "24 h" } },
    { id: "column-2", type: "column", settings: { title: "Paiement", text: "Mobile Money" } },
  ],
});

describe("sections enregistrées", () => {
  it("validation stricte ; sections obligatoires de modèle refusées", () => {
    expect(validateSectionPayload(multicolumn()).ok).toBe(true);
    expect(validateSectionPayload({ ...multicolumn(), settings: { inconnu: 1 } }).ok).toBe(false);
    expect(validateSectionPayload({ type: "main-product", settings: {}, blocks: [] }).ok).toBe(false);
    expect(validateSectionPayload({ type: "inconnu" }).ok).toBe(false);
  });

  it("clonage : nouveaux identifiants, uniques dans le document, charge sans identifiant", () => {
    const checked = validateSectionPayload(multicolumn());
    if (!checked.ok) throw new Error("setup");
    expect(JSON.stringify(checked.payload)).not.toContain("multicolumn-abc");
    expect(JSON.stringify(checked.payload)).not.toContain("column-1");
    const doc = fallbackThemeDocument();
    const ids = uniqueIdFactory(doc);
    const a = clonePayload(checked.payload, ids);
    const b = clonePayload(checked.payload, ids);
    const all = [a.id, ...a.blocks.map((x) => x.id), b.id, ...b.blocks.map((x) => x.id)];
    expect(new Set(all).size).toBe(all.length);
    expect(a.id).not.toBe("multicolumn-abc");
    expect(toPayload(a as SectionInstance)).toEqual(checked.payload);
    a.settings.heading = "modifié";
    expect(checked.payload.settings.heading).toBe("Nos engagements"); // copie profonde
  });

  it("références absentes retirées", () => {
    const fc = validateSectionPayload({ type: "featured-collection", settings: { collection: CA }, blocks: [] });
    if (!fc.ok) throw new Error(JSON.stringify(fc));
    const r = stripMissingRefs(fc.payload, { productIds: new Set(), collectionIds: new Set(), menuHandles: new Set() });
    expect(r.removed).toBe(1);
    expect(r.payload.settings.collection).toBeNull();
  });

  it("enregistrer : plan, nom unique, référence d'une autre boutique retirée, isolation", async () => {
    state.planId = "FREE";
    expect((await saveSection(A, { name: "Engagements", section: multicolumn() })).ok).toBe(false);
    state.planId = "STARTER";
    const s = await saveSection(A, { name: "Engagements", section: multicolumn() });
    expect(s.ok).toBe(true);
    expect((await saveSection(A, { name: "Engagements", section: multicolumn() })).ok).toBe(false);
    const fc = await saveSection(A, { name: "Collection B", section: { type: "featured-collection", settings: { collection: "ccolBBBBBBBBB1" }, blocks: [] } });
    expect(fc.ok && fc.data!.removedRefs).toBe(1);
    // Autre boutique : ni lecture ni suppression
    state.member = B;
    const list = await listSavedSections(B);
    expect(list.ok && list.data!.items).toHaveLength(0);
    if (!s.ok) throw new Error("setup");
    expect((await getSavedSectionForInsert(B, s.data!.id)).ok).toBe(false);
    expect((await deleteSavedSection(B, s.data!.id)).ok).toBe(false);
    state.member = A;
    const ins = await getSavedSectionForInsert(A, s.data!.id);
    expect(ins.ok).toBe(true);
    expect(state.fake!.tables.savedSection.find((r) => r.id === s.data!.id)!.usageCount).toBe(1);
  });

  it("plan Starter : 20 sections enregistrées maximum", async () => {
    state.planId = "STARTER";
    for (let i = 0; i < 20; i++) state.fake!.tables.savedSection.push({ id: `csaved000000${i}`, storeId: A, name: `S${i}`, sectionType: "multicolumn", payload: {}, usageCount: 0 });
    const r = await saveSection(A, { name: "Une de trop", section: multicolumn() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/20/);
  });
});

describe("bibliothèque : minPlan et premium contrôlés côté serveur", () => {
  it("règles d'accès", () => {
    expect(libraryAccess({ premium: false, minPlan: "FREE", published: true }, "FREE").ok).toBe(true);
    expect(libraryAccess({ premium: false, minPlan: "STARTER", published: true }, "FREE").ok).toBe(false);
    expect(libraryAccess({ premium: true, minPlan: "FREE", published: true }, "STARTER").ok).toBe(false);
    expect(effectiveMinPlan({ premium: true, minPlan: "FREE" })).toBe("BUSINESS");
    expect(libraryAccess({ premium: true, minPlan: "FREE", published: true }, "BUSINESS").ok).toBe(true);
    expect(libraryAccess({ premium: false, minPlan: "FREE", published: false }, "SCALE").ok).toBe(false);
  });

  it("charge : aucune référence d'identifiant ni média de boutique", () => {
    expect(validateLibraryPayload({ type: "featured-collection", settings: { collection: CA }, blocks: [] }).ok).toBe(false);
    expect(validateLibraryPayload({ type: "featured-collection", settings: {}, blocks: [] }).ok).toBe(true);
    const media = "/media/stores/abcdefgh12/2026/10/" + "a".repeat(64) + ".png";
    expect(validateLibraryPayload({ type: "image-with-text", settings: { image: { url: media } }, blocks: [] }).ok).toBe(false);
  });

  it("les 6 éléments de démonstration sont valides, sans référence", () => {
    expect(DEMO_LIBRARY_ITEMS).toHaveLength(6);
    expect(new Set(DEMO_LIBRARY_ITEMS.map((i) => i.slug)).size).toBe(6);
    for (const it of DEMO_LIBRARY_ITEMS) {
      const r = validateLibraryPayload(it.payload);
      expect(r.ok, `${it.slug} : ${r.ok ? "" : r.errors.join(" ; ")}`).toBe(true);
    }
  });

  it("insertion premium refusée en Starter, acceptée en Business", async () => {
    state.fake!.tables.sectionLibraryItem.push({ id: "clibpremium0001", slug: "p", name: "Premium", category: "Médias", sectionType: "multicolumn", payload: multicolumn(), premium: true, minPlan: "FREE", published: true, position: 0, tags: [] });
    state.fake!.tables.sectionLibraryItem.push({ id: "clibbrouillon01", slug: "d", name: "Brouillon", category: "Médias", sectionType: "multicolumn", payload: multicolumn(), premium: false, minPlan: "FREE", published: false, position: 1, tags: [] });
    state.planId = "STARTER";
    const no = await getLibraryItemForInsert(A, "clibpremium0001");
    expect(no.ok).toBe(false);
    state.planId = "BUSINESS";
    const yes = await getLibraryItemForInsert(A, "clibpremium0001");
    expect(yes.ok).toBe(true);
    if (yes.ok) expect(JSON.stringify(yes.data!.payload)).not.toContain("multicolumn-abc");
    expect((await getLibraryItemForInsert(A, "clibbrouillon01")).ok).toBe(false);
  });
});
