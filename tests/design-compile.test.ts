/**
 * Lot 4 §9 : compilateur déterministe brief → document de thème.
 * Propriété principale : TOUT brief valide au schéma produit un document VALIDE (200 briefs tirés
 * avec une graine fixe). Et : indices hors bornes ignorés, sections interdites retirées, contraste AA garanti.
 */
import { describe, expect, it } from "vitest";
import { briefSchema, ALLOWED_HOME_SECTIONS, type StoreDesignDirection } from "@/lib/ai/design/schema";
import { compileBrief, type StoreDesignData } from "@/lib/ai/design/compile";
import { colorsAreAccessible } from "@/lib/ai/design/guards";
import { validateThemeDocument } from "@/lib/theme-engine/validate";
import { FONT_IDS } from "@/lib/storefront/theme-doc";
import { buildBrandKit } from "@/lib/brand-kit/palette";

/* ───────── Données de boutique de test ───────── */

const data = (over: Partial<StoreDesignData> = {}): StoreDesignData => ({
  storeName: "Douceurs de Cotonou",
  tagline: "Pâtisserie fine, sur commande",
  sector: "patisserie",
  city: "Cotonou",
  country: "BJ",
  photos: ["https://exemple.com/p1.jpg", "https://exemple.com/p2.jpg"],
  logoUrl: "https://exemple.com/logo.png",
  bannerUrl: "https://exemple.com/banner.jpg",
  products: [
    { id: "prod-1", name: "Gâteau wax", collection: "Gâteaux", hasImage: true },
    { id: "prod-2", name: "Éclair chocolat", collection: "Pâtisseries", hasImage: true },
  ],
  collections: [
    { id: "col-1", name: "Gâteaux" },
    { id: "col-2", name: "Pâtisseries" },
  ],
  paymentMethods: ["MTN MoMo", "Espèces à la livraison"],
  deliveryZones: ["Cotonou centre", "Calavi"],
  hours: "lundi 08:00-18:00",
  hasReviews: false,
  brandKit: buildBrandKit({ colors: ["#7A2E3A", "#F4C7A1"], tone: "premium", now: new Date(0) }),
  current: null,
  ...over,
});

const refs = (d: StoreDesignData) => ({ collectionIds: new Set(d.collections.map((c) => c.id)), productIds: new Set(d.products.map((p) => p.id)) });

/* ───────── Générateur de briefs (graine fixe) ───────── */

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomDirection(rnd: () => number, i: number): unknown {
  const pick = <T>(list: readonly T[]) => list[Math.floor(rnd() * list.length)];
  const hex = () => `#${Math.floor(rnd() * 0xffffff).toString(16).padStart(6, "0")}`;
  const n = 4 + Math.floor(rnd() * 6);
  return {
    id: `d${i % 10}`,
    name: `Direction ${i}`,
    rationale: "Proposition de test",
    palette: { background: hex(), surface: hex(), text: hex(), primary: hex(), accent: hex() },
    fonts: { heading: pick(FONT_IDS), body: pick(FONT_IDS) },
    headingWeight: pick([500, 600, 700, 800]),
    buttons: { radius: Math.floor(rnd() * 25), style: pick(["solid", "outline", "soft"]) },
    cards: { radius: Math.floor(rnd() * 25), imageRatio: pick(["square", "portrait", "landscape", "natural"]) },
    density: pick(["airy", "balanced", "compact"]),
    announcement: rnd() < 0.5 ? "Commandez sur WhatsApp" : null,
    home: Array.from({ length: n }, () => ({
      type: pick(ALLOWED_HOME_SECTIONS),
      preset: Math.floor(rnd() * 9),
      scheme: pick(["default", "surface", "inverse", "brand"]),
      copy: {
        heading: rnd() < 0.8 ? "Titre de section" : undefined,
        subheading: rnd() < 0.4 ? "Sous-titre de section" : undefined,
        text: rnd() < 0.5 ? "Un texte de présentation simple et lisible." : undefined,
        button_label: rnd() < 0.3 ? "Découvrir" : undefined,
      },
      image: rnd() < 0.5 ? { photoIndex: Math.floor(rnd() * 8) } : null,
      collectionIndex: rnd() < 0.5 ? Math.floor(rnd() * 6) : null,
      productIndexes: Array.from({ length: Math.floor(rnd() * 4) }, () => Math.floor(rnd() * 6)),
    })),
    product: {
      gallery: pick(["stacked", "carousel", "thumbnails-left", "thumbnails-bottom", "grid-2"]),
      variantPicker: pick(["buttons", "dropdown", "swatches"]),
      stickyAddToCart: rnd() < 0.5,
      blocks: ["title", "price", "buy_buttons", "description"],
    },
    faq: rnd() < 0.5 ? [{ q: "Livrez-vous ?", a: "Oui, à Cotonou et à Calavi." }] : [],
  };
}

describe("propriété : tout brief valide produit un document valide", () => {
  it("200 briefs tirés avec une graine fixe", () => {
    const rnd = mulberry32(42);
    const d = data();
    const r = refs(d);
    let fallbacks = 0;
    for (let i = 0; i < 200; i++) {
      const parsed = briefSchema.safeParse({ directions: [randomDirection(rnd, i)] });
      expect(parsed.success).toBe(true);
      const direction = parsed.data!.directions[0];
      const out = compileBrief(direction, d, { refs: r });
      const check = validateThemeDocument(out.doc, { refs: r });
      expect(check.ok, `brief ${i} invalide : ${check.ok ? "" : check.errors[0]?.message}`).toBe(true);
      expect(colorsAreAccessible(out.doc.settings), `brief ${i} : contraste insuffisant`).toBe(true);
      if (out.fallback) fallbacks++;
    }
    // Le repli existe mais ne doit pas être le cas général.
    expect(fallbacks).toBeLessThan(20);
  });
});

/* ───────── Cas précis ───────── */

const base: StoreDesignDirection = briefSchema.parse({
  directions: [
    {
      id: "a",
      name: "Test",
      rationale: "",
      palette: { background: "#FFFFFF", surface: "#FFFFFF", text: "#111111", primary: "#0D3B2E", accent: "#C96A3B" },
      fonts: { heading: "geist", body: "geist" },
      headingWeight: 600,
      buttons: { radius: 12, style: "solid" },
      cards: { radius: 12, imageRatio: "portrait" },
      density: "balanced",
      announcement: null,
      home: [{ type: "hero-banner", preset: 0, scheme: "default", copy: {}, image: null, collectionIndex: null, productIndexes: [] }],
      product: { gallery: "stacked", variantPicker: "buttons", stickyAddToCart: true, blocks: [] },
      faq: [],
    },
  ],
}).directions[0];

const section = (over: Record<string, unknown>) => ({ type: "hero-banner", preset: 0, scheme: "default", copy: {}, image: null, collectionIndex: null, productIndexes: [], ...over });

function compile(home: unknown[], d = data(), extra: Partial<StoreDesignDirection> = {}) {
  const direction = { ...base, ...extra, home: home as StoreDesignDirection["home"] };
  return compileBrief(direction, d, { refs: refs(d) });
}

describe("résolution des références réelles", () => {
  it("un indice de photo hors bornes est ignoré (aucune image inventée)", () => {
    const out = compile([section({ type: "image-gallery", image: { photoIndex: 31 } })]);
    const gallery = Object.values(out.doc.templates.home.sections).find((s) => s.type === "image-gallery");
    expect(gallery).toBeDefined();
    const urls = JSON.stringify(gallery);
    expect(urls).not.toContain("undefined");
    expect(validateThemeDocument(out.doc).ok).toBe(true);
  });

  it("un indice de collection hors bornes n'écrit aucune référence", () => {
    const out = compile([section({ type: "featured-collection", collectionIndex: 99 })]);
    const s = Object.values(out.doc.templates.home.sections).find((x) => x.type === "featured-collection");
    expect(s?.settings.collection ?? "").toBe("");
  });

  it("un indice de collection valide écrit l'identifiant réel", () => {
    const out = compile([section({ type: "featured-collection", collectionIndex: 1 })]);
    const s = Object.values(out.doc.templates.home.sections).find((x) => x.type === "featured-collection");
    expect(s?.settings.collection).toBe("col-2");
  });

  it("un produit mis en avant utilise un identifiant réel", () => {
    const out = compile([section({ type: "featured-product", productIndexes: [5, 1] })]);
    const s = Object.values(out.doc.templates.home.sections).find((x) => x.type === "featured-product");
    expect(["prod-1", "prod-2"]).toContain(s?.settings.product);
  });

  it("une photo valide est posée sur la bannière", () => {
    const out = compile([section({ image: { photoIndex: 1 } })]);
    const hero = Object.values(out.doc.templates.home.sections).find((x) => x.type === "hero-banner");
    expect((hero?.settings.image as { url: string }).url).toBe("https://exemple.com/p2.jpg");
  });
});

describe("liste blanche et faux avis", () => {
  it("une section hors liste blanche est retirée", () => {
    const out = compile([section({ type: "slideshow" }), section({})]);
    expect(Object.values(out.doc.templates.home.sections).some((s) => s.type === "slideshow")).toBe(false);
    expect(out.notes.join(" ")).toContain("non autorisée");
  });

  it("aucun témoignage ni avis sans avis réels", () => {
    const out = compile([section({ type: "testimonials" }), section({ type: "reviews" }), section({})]);
    const types = Object.values(out.doc.templates.home.sections).map((s) => s.type);
    expect(types).not.toContain("testimonials");
    expect(types).not.toContain("reviews");
    expect(out.notes.join(" ")).toContain("aucun avis réel");
  });

  it("avec des avis réels, les témoignages deviennent la section « Avis clients vérifiés »", () => {
    const out = compile([section({ type: "testimonials" })], data({ hasReviews: true }));
    const types = Object.values(out.doc.templates.home.sections).map((s) => s.type);
    expect(types).toContain("reviews");
    expect(types).not.toContain("testimonials");
  });
});

describe("textes et garde-fous", () => {
  it("un titre contenant un prix est refusé, le défaut du préréglage est conservé", () => {
    const out = compile([section({ type: "rich-text", copy: { heading: "Promo 5000 FCFA", text: "Nos produits sont préparés chaque matin." } })]);
    const s = Object.values(out.doc.templates.home.sections).find((x) => x.type === "rich-text");
    expect(JSON.stringify(s)).not.toContain("5000");
    expect(JSON.stringify(s)).toContain("préparés chaque matin");
  });

  it("l'annonce est filtrée comme le reste des textes", () => {
    const out = compile([section({})], data(), { announcement: "Livraison gratuite aujourd'hui" });
    expect(out.doc.settings.header.announcement.enabled).toBe(false);
  });

  it("la FAQ ne garde que des questions complètes", () => {
    const out = compile([section({ type: "faq" })], data(), { faq: [{ q: "Où livrez-vous ?", a: "À Cotonou et Calavi." }, { q: "", a: "" }] });
    const faq = Object.values(out.doc.templates.home.sections).find((x) => x.type === "faq");
    expect(faq?.blocks).toHaveLength(1);
    expect(faq?.blocks[0].settings.question).toBe("Où livrez-vous ?");
  });

  it("contraste AA garanti même avec une palette illisible", () => {
    const out = compile([section({})], data(), { palette: { background: "#FFFFFF", surface: "#FFFFFF", text: "#FAFAFA", primary: "#FEFEFE", accent: "#FDFDFD" } });
    expect(colorsAreAccessible(out.doc.settings)).toBe(true);
  });

  it("un brief sans section donne quand même un document valide", () => {
    const out = compile([]);
    expect(validateThemeDocument(out.doc).ok).toBe(true);
    expect(out.doc.templates.home.order.length).toBeGreaterThan(0);
  });

  it("l'en-tête, le pied de page et les menus du document existant sont conservés", () => {
    const current = compile([section({})]).doc;
    current.settings.header.menu = "main";
    current.settings.footer.text = "Merci de votre visite";
    const out = compile([section({})], data({ current }));
    expect(out.doc.settings.footer.text).toBe("Merci de votre visite");
    expect(out.doc.settings.header.menu).toBe("main");
  });

  it("le préréglage du secteur sert de base (modèles autres que l'accueil intacts)", () => {
    const out = compile([section({})]);
    expect(out.doc.templates.product.order.length).toBeGreaterThan(0);
    expect(Object.values(out.doc.templates.product.sections).some((s) => s.type === "main-product")).toBe(true);
  });

  it("les blocs de la fiche produit sont réordonnés, jamais inventés", () => {
    const before = Object.values(compile([section({})]).doc.templates.product.sections).find((s) => s.type === "main-product")!;
    const out = compile([section({})], data(), { product: { ...base.product, blocks: ["price", "title"] } });
    const after = Object.values(out.doc.templates.product.sections).find((s) => s.type === "main-product")!;
    expect(after.blocks.map((b) => b.type).sort()).toEqual(before.blocks.map((b) => b.type).sort());
    expect(after.blocks[0].type).toBe("price");
    expect(after.blocks[1].type).toBe("title");
  });
});
