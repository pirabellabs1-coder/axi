import { describe, expect, it } from "vitest";
import {
  checkBinding,
  compatibleSources,
  parseSource,
  resolveSection,
  resolveSetting,
  sourceKind,
  type DynamicRenderContext,
  type MetafieldDefinitionLike,
} from "@/lib/theme-engine/dynamic-sources";
import { SECTION_SCHEMAS } from "@/lib/theme-engine/schemas";
import type { SectionInstance, SettingField } from "@/lib/theme-engine/types";

const defs: MetafieldDefinitionLike[] = [
  { ownerType: "PRODUCT", namespace: "custom", key: "matiere", type: "single_line_text", name: "Matière", storefrontVisible: true },
  { ownerType: "PRODUCT", namespace: "custom", key: "cout", type: "money", name: "Coût interne", storefrontVisible: false },
  { ownerType: "PRODUCT", namespace: "custom", key: "photo", type: "image", storefrontVisible: true },
  { ownerType: "PRODUCT", namespace: "custom", key: "couleur", type: "color", storefrontVisible: true },
  { ownerType: "CUSTOMER", namespace: "custom", key: "vip", type: "boolean", storefrontVisible: true },
  { ownerType: "ORDER", namespace: "custom", key: "note", type: "single_line_text", storefrontVisible: true },
];

describe("grammaire fermée", () => {
  it.each(["product.title", "variant.price", "collection.image", "store.description", "page.url", "article.tags", "product.metafields.custom.matiere"])("accepte %s", (s) => {
    expect(parseSource(s)).not.toBeNull();
  });
  it.each([
    "customer.email",
    "order.total",
    "customer.metafields.custom.vip",
    "order.metafields.custom.note",
    "product.title.x",
    "product.password",
    "product.metafields.Custom.matiere",
    "product.metafields.custom",
    "constructor.title",
    "product.__proto__",
    "",
    "product.metafields.custom." + "a".repeat(65),
  ])("refuse %s", (s) => {
    expect(parseSource(s)).toBeNull();
    expect(checkBinding("text", s).ok).toBe(false);
  });
});

describe("compatibilité", () => {
  it("matrice du §5", () => {
    expect(checkBinding("text", "product.title").ok).toBe(true);
    expect(checkBinding("text", "product.price").ok).toBe(true); // nombre / montant → texte
    expect(checkBinding("image", "product.image").ok).toBe(true);
    expect(checkBinding("image", "product.title").ok).toBe(false);
    expect(checkBinding("url", "product.url").ok).toBe(true);
    expect(checkBinding("richtext", "product.description").ok).toBe(true);
    expect(checkBinding("color", "product.metafields.custom.couleur", { definitions: defs }).ok).toBe(true);
    expect(checkBinding("color", "product.title").ok).toBe(false);
    expect(checkBinding("range", "product.title").ok).toBe(false); // type de champ non connectable
    expect(checkBinding("checkbox", "product.title").ok).toBe(false);
  });
  it("champ personnalisé : public, du bon propriétaire, existant", () => {
    expect(checkBinding("text", "product.metafields.custom.matiere", { definitions: defs }).ok).toBe(true);
    expect(checkBinding("text", "product.metafields.custom.cout", { definitions: defs })).toMatchObject({ ok: false, reason: expect.stringContaining("non visible") });
    expect(checkBinding("text", "variant.metafields.custom.matiere", { definitions: defs }).ok).toBe(false); // autre propriétaire
    expect(checkBinding("text", "product.metafields.custom.absent", { definitions: defs }).ok).toBe(false);
    expect(sourceKind("product.metafields.custom.cout", defs)).toBeNull();
  });
  it("disponibilité selon le modèle", () => {
    expect(checkBinding("text", "product.title", { template: "home" }).ok).toBe(false);
    expect(checkBinding("text", "store.title", { template: "home" }).ok).toBe(true);
    expect(checkBinding("text", "collection.title", { template: "catalog" }).ok).toBe(true);
  });
  it("sélecteur : uniquement des sources compatibles et publiques", () => {
    const opts = compatibleSources("text", "product", defs).map((o) => o.source);
    expect(opts).toContain("product.title");
    expect(opts).toContain("product.metafields.custom.matiere");
    expect(opts).not.toContain("product.metafields.custom.cout");
    expect(opts).not.toContain("product.image");
    expect(opts.some((s) => s.includes("vip") || s.includes("note"))).toBe(false);
    expect(compatibleSources("image", "product", defs).map((o) => o.source)).toEqual(expect.arrayContaining(["product.image", "product.metafields.custom.photo"]));
  });
});

const textField: SettingField = { type: "text", id: "heading", label: "Titre", default: "Par défaut", maxLength: 20 };
const imageField: SettingField = { type: "image", id: "image", label: "Image" };
const urlField: SettingField = { type: "url", id: "link", label: "Lien", default: "/catalogue" };

const ctx: DynamicRenderContext = {
  product: {
    title: "Robe wax <script>alert(1)</script> très longue",
    price: 15000,
    image: { url: "https://cdn.example.com/robe.webp", alt: "Robe" },
    url: "javascript:alert(1)",
    tags: ["wax", "été"],
    metafields: {
      "custom.matiere": { type: "single_line_text", value: "Coton", storefrontVisible: true },
      "custom.cout": { type: "money", value: 4000, storefrontVisible: false },
      "custom.photo": { type: "image", value: "http://insecure.example.com/a.png", storefrontVisible: true },
    },
  },
  store: { title: "Chez Aïcha" },
};

describe("resolveSetting", () => {
  it("valeur fixe inchangée", () => {
    expect(resolveSetting({ heading: "Fixe" }, "heading", ctx, [textField])).toBe("Fixe");
  });
  it("source résolue puis repassée par sanitize (longueur maximale)", () => {
    const v = resolveSetting({ heading: { $source: "product.title" } }, "heading", ctx, [textField]);
    expect(v).toBe("Robe wax <script>ale"); // texte brut, tronqué à maxLength (le rendu échappe)
  });
  it("champ personnalisé public", () => {
    expect(resolveSetting({ heading: { $source: "product.metafields.custom.matiere" } }, "heading", ctx, [textField])).toBe("Coton");
  });
  it("champ non public jamais exposé, même transmis par erreur : défaut", () => {
    expect(resolveSetting({ heading: { $source: "product.metafields.custom.cout" } }, "heading", ctx, [textField])).toBe("Par défaut");
  });
  it("montant formaté", () => {
    const v = String(resolveSetting({ heading: { $source: "product.price" } }, "heading", ctx, [textField]));
    expect(v.replace(/\D/g, "")).toBe("15000");
    expect(v.endsWith("FCFA")).toBe(true);
  });
  it("liste jointe", () => {
    expect(resolveSetting({ heading: { $source: "product.tags" } }, "heading", ctx, [textField])).toBe("wax, été");
  });
  it("image : https acceptée, http refusée → défaut (null)", () => {
    expect(resolveSetting({ image: { $source: "product.image" } }, "image", ctx, [imageField])).toEqual({ url: "https://cdn.example.com/robe.webp", alt: "Robe" });
    expect(resolveSetting({ image: { $source: "product.metafields.custom.photo" } }, "image", ctx, [imageField])).toBeNull();
  });
  it("lien dangereux refusé → défaut", () => {
    expect(resolveSetting({ link: { $source: "product.url" } }, "link", ctx, [urlField])).toBe("/catalogue");
  });
  it("objet absent du contexte → défaut", () => {
    expect(resolveSetting({ heading: { $source: "collection.title" } }, "heading", ctx, [textField])).toBe("Par défaut");
  });
  it("source incompatible stockée (document forgé) → défaut", () => {
    expect(resolveSetting({ heading: { $source: "product.image" } }, "heading", ctx, [textField])).toBe("Par défaut");
  });
});

describe("resolveSection", () => {
  const section = (settings: SectionInstance["settings"]): SectionInstance => ({
    id: "s1",
    type: "rich-text",
    settings: { align: "left", scheme: "default", padding_top: 48, padding_bottom: 48, ...settings },
    blocks: [{ id: "b1", type: "heading", settings: { text: { $source: "product.metafields.custom.matiere" }, size: "lg" } }],
  });
  it("blocs résolus, section sans source renvoyée telle quelle", () => {
    const r = resolveSection(section({}), ctx);
    expect(r.section.blocks[0].settings.text).toBe("Coton");
    expect(r.hidden).toBe(false);
    const plain: SectionInstance = { id: "p", type: "rich-text", settings: {}, blocks: [] };
    expect(resolveSection(plain, ctx).section).toBe(plain);
  });
  it("hide_if_empty : masquée quand une source est vide", () => {
    const empty = section({ hide_if_empty: true });
    expect(resolveSection(empty, {}).hidden).toBe(true);
    expect(resolveSection(section({}), {}).hidden).toBe(false);
    expect(resolveSection(empty, ctx).hidden).toBe(false);
  });
  it("le type de bloc résolu existe dans le schéma", () => {
    expect(SECTION_SCHEMAS["rich-text"].blocks?.some((b) => b.type === "heading")).toBe(true);
  });
});
