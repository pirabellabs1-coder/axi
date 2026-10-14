import { describe, it, expect } from "vitest";
import { assignVariant, bucketOf, evenWeights, fnv1a32, HASH_BUCKETS, isVisitorId, newVisitorId } from "@/lib/experiments/assign";
import { applyVariant, parseVariants, sectionIsPresent, serializeVariants, validateVariantSection, variantLabel, experimentAllowance } from "@/lib/experiments/rules";
import { detectFirstTouchSource } from "@/lib/experiments/visitor";
import { defaultThemeDocument } from "@/lib/theme-engine/defaults";
import { SECTOR_PRESETS } from "@/lib/storefront/theme";
import type { SectionInstance } from "@/lib/theme-engine/types";

/** Lot 4 §13 (équipe EXP) : affectation déterministe, poids, application au document, limites de plan. */

const variants2 = [
  { key: "A" as const, weight: 50, kind: "current" as const, section: null },
  { key: "B" as const, weight: 50, kind: "hidden" as const, section: null },
];

describe("hachage et affectation", () => {
  it("est déterministe pour un même visiteur et un même test", () => {
    const vid = "a".repeat(32);
    const first = assignVariant(variants2, vid, "exp_1")!.key;
    for (let i = 0; i < 50; i++) expect(assignVariant(variants2, vid, "exp_1")!.key).toBe(first);
  });

  it("dépend du test : deux tests sont indépendants", () => {
    const vid = "7f3c1a9b2d4e5f60718293a4b5c6d7e8";
    const keys = new Set(["exp_1", "exp_2", "exp_3", "exp_4", "exp_5"].map((e) => assignVariant(variants2, vid, e)!.key));
    expect(keys.size).toBeGreaterThan(1);
  });

  it("reste dans l'intervalle des seaux", () => {
    for (let i = 0; i < 200; i++) {
      const b = bucketOf(newVisitorId(), `exp_${i}`);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(HASH_BUCKETS);
    }
    expect(fnv1a32("")).toBe(0x811c9dc5);
    expect(fnv1a32("axi")).toBe(fnv1a32("axi"));
  });

  it("respecte les poids à quelques points près", () => {
    const weighted = [
      { key: "A" as const, weight: 80, kind: "current" as const, section: null },
      { key: "B" as const, weight: 20, kind: "hidden" as const, section: null },
    ];
    let a = 0;
    const total = 20_000;
    for (let i = 0; i < total; i++) if (assignVariant(weighted, `vid${i}`.padEnd(32, "0"), "exp_w")!.key === "A") a++;
    const share = a / total;
    expect(share).toBeGreaterThan(0.77);
    expect(share).toBeLessThan(0.83);
  });

  it("répartit équitablement trois variantes", () => {
    const three = evenWeights(3).map((weight, i) => ({ key: (["A", "B", "C"] as const)[i], weight, kind: "current" as const, section: null }));
    expect(three.reduce((s, v) => s + v.weight, 0)).toBe(100);
    const counts = { A: 0, B: 0, C: 0 } as Record<string, number>;
    for (let i = 0; i < 9000; i++) counts[assignVariant(three, `v${i}`.padEnd(32, "0"), "exp_3")!.key]++;
    for (const k of ["A", "B", "C"]) {
      expect(counts[k] / 9000).toBeGreaterThan(0.29);
      expect(counts[k] / 9000).toBeLessThan(0.38);
    }
  });

  it("n'affecte personne sans identifiant visiteur ni poids", () => {
    expect(assignVariant(variants2, null, "exp_1")).toBeNull();
    expect(assignVariant(variants2, "", "exp_1")).toBeNull();
    expect(assignVariant([], "a".repeat(32), "exp_1")).toBeNull();
    expect(assignVariant(variants2.map((v) => ({ ...v, weight: 0 })), "a".repeat(32), "exp_1")).toBeNull();
  });

  it("n'accepte qu'un identifiant visiteur de 128 bits", () => {
    expect(isVisitorId(newVisitorId())).toBe(true);
    for (const bad of ["", "abc", "A".repeat(32), "f".repeat(31), "f".repeat(33), 42, null]) expect(isVisitorId(bad)).toBe(false);
  });

  it("evenWeights borne le nombre de variantes", () => {
    expect(evenWeights(0)).toEqual([100]);
    expect(evenWeights(2)).toEqual([50, 50]);
    expect(evenWeights(3)).toEqual([34, 33, 33]);
    expect(evenWeights(9)).toEqual([34, 33, 33]);
  });
});

describe("lecture défensive des variantes", () => {
  it("ignore ce qui n'est pas exploitable", () => {
    expect(parseVariants(null)).toEqual([]);
    expect(parseVariants("nope")).toEqual([]);
    expect(parseVariants([{ key: "Z" }, { key: "A", weight: 50, kind: "current" }, { key: "A", weight: 10 }])).toHaveLength(1);
    expect(parseVariants([{ key: "B", weight: 1000, kind: "hidden" }])[0].weight).toBe(100);
    // Variante « section » sans section : rejetée.
    expect(parseVariants([{ key: "B", weight: 50, kind: "section" }])).toEqual([]);
  });

  it("fait l'aller-retour sérialisation", () => {
    const back = parseVariants(serializeVariants(variants2));
    expect(back).toEqual(variants2);
    expect(variantLabel(variants2[1])).toContain("masquée");
  });
});

describe("application au document", () => {
  const doc = defaultThemeDocument(SECTOR_PRESETS[0].sector, { name: "Boutique" });
  const sectionId = doc.templates.home.order.find((id) => !["announcement-bar"].includes(doc.templates.home.sections[id].type))!;
  const section = doc.templates.home.sections[sectionId];

  it("la variante A ne change rien", () => {
    const next = applyVariant(doc, "home", sectionId, { key: "A", weight: 50, kind: "current", section: null });
    expect(next).toBe(doc);
  });

  it("la variante masquée retire la section de l'ordre, sans toucher au reste", () => {
    const next = applyVariant(doc, "home", sectionId, { key: "B", weight: 50, kind: "hidden", section: null });
    expect(next.templates.home.order).not.toContain(sectionId);
    expect(next.templates.home.order.length).toBe(doc.templates.home.order.length - 1);
    expect(doc.templates.home.order).toContain(sectionId); // document d'origine intact
  });

  it("la variante de section garde l'identifiant et le type d'origine", () => {
    const variantSection = { ...structuredClone(section), id: "autre-id", type: "faq" } as SectionInstance;
    const next = applyVariant(doc, "home", sectionId, { key: "B", weight: 50, kind: "section", section: variantSection });
    const applied = next.templates.home.sections[sectionId];
    expect(applied.id).toBe(sectionId);
    expect(applied.type).toBe(section.type);
  });

  it("ne fait rien si la section est absente (thème programmé sans cette section)", () => {
    expect(applyVariant(doc, "home", "section-inconnue", { key: "B", weight: 50, kind: "hidden", section: null })).toBe(doc);
    expect(sectionIsPresent(doc, "home", "section-inconnue")).toBe(false);
    expect(sectionIsPresent(doc, "home", sectionId)).toBe(true);
  });

  it("ne masque jamais une section obligatoire", () => {
    const productId = doc.templates.product.order.find((id) => doc.templates.product.sections[id].type === "main-product")!;
    const next = applyVariant(doc, "product", productId, { key: "B", weight: 50, kind: "hidden", section: null });
    expect(next.templates.product.order).toContain(productId);
  });

  it("revalide la section d'une variante par le moteur de thème", () => {
    const ok = validateVariantSection(doc, "home", section);
    expect(ok.ok).toBe(true);
    // Réglage inventé, type inconnu, lien dangereux : refusés.
    expect(validateVariantSection(doc, "home", { ...section, type: "inexistant" }).ok).toBe(false);
    expect(validateVariantSection(doc, "home", null).ok).toBe(false);
    expect(validateVariantSection(doc, "home", { ...section, settings: { ...section.settings, inventé: "x" } }).ok).toBe(false);
  });
});

describe("limites de plan", () => {
  it("suit le catalogue : rien avant Scale", () => {
    expect(experimentAllowance("FREE")).toBe(0);
    expect(experimentAllowance("STARTER")).toBe(0);
    expect(experimentAllowance("BUSINESS")).toBe(0);
    expect(experimentAllowance("SCALE")).toBe(3);
    expect(experimentAllowance("ENTERPRISE")).toBe(10);
  });
});

describe("source de premier contact (axi_src)", () => {
  it("lit utm_source, ref puis le référent", () => {
    expect(detectFirstTouchSource({ searchParams: { utm_source: "WhatsApp" } })).toBe("whatsapp");
    expect(detectFirstTouchSource({ searchParams: { utm_source: "whatsapp_status" } })).toBe("whatsapp");
    expect(detectFirstTouchSource({ searchParams: { ref: "ig" } })).toBe("instagram");
    expect(detectFirstTouchSource({ searchParams: { utm_campaign: "soldes" } })).toBe("campaign");
    expect(detectFirstTouchSource({ referer: "https://www.instagram.com/p/123" })).toBe("instagram");
    expect(detectFirstTouchSource({ referer: "https://www.google.sn/search?q=x" })).toBe("google");
    expect(detectFirstTouchSource({ referer: "https://l.facebook.com/" })).toBe("facebook");
    expect(detectFirstTouchSource({})).toBe("direct");
  });

  it("une navigation interne reste « direct »", () => {
    expect(detectFirstTouchSource({ referer: "https://maboutique.axi.africa/p/x", host: "maboutique.axi.africa" })).toBe("direct");
  });

  it("n'accepte qu'une valeur de la liste fermée", () => {
    expect(detectFirstTouchSource({ searchParams: { utm_source: "<script>" } })).toBe("direct");
    expect(detectFirstTouchSource({ searchParams: { utm_source: "linkedin" } })).toBe("direct");
    expect(detectFirstTouchSource({ referer: "pas une url" })).toBe("direct");
  });
});
