/**
 * Lot 4 §8 : protocole postMessage d'édition directe (parseurs défensifs) et contrôle éditeur
 * de la valeur reçue (schéma du champ, longueur, source dynamique).
 */
import { describe, expect, it } from "vitest";
import {
  imageDropMessage,
  inlineChangeMessage,
  inlineModeMessage,
  inlineRejectMessage,
  isAcceptedInlineImage,
  MAX_INLINE_IMAGE_BYTES,
  MAX_INLINE_VALUE,
  parseImageDrop,
  parseInlineChange,
  parseInlineMode,
  parseInlineReject,
  parseInlineTarget,
  parseSectionAction,
  PREVIEW_MESSAGES,
  sectionActionMessage,
} from "@/lib/theme-engine/preview-messages";
import { editAttrs, parseEditAttr } from "@/lib/theme-engine/edit-attrs";
import { checkInlineValue } from "@/components/theme-editor/inline-check";
import { inlineImageTarget, inlineTextTargets, normalizeText, plainFromMarkdown } from "@/components/storefront/inline-edit-targets";
import { defaultThemeDocument } from "@/lib/theme-engine/defaults";
import type { ThemeDocument } from "@/lib/theme-engine/types";

const target = { sectionId: "hero-1", blockId: null, settingId: "heading" };
const doc: ThemeDocument = defaultThemeDocument("general", { name: "Boutique test" });
const homeOrder = doc.templates.home.order;
const firstSectionId = homeOrder[0];

describe("parseInlineTarget", () => {
  it("accepte une cible valide, avec ou sans bloc", () => {
    expect(parseInlineTarget({ sectionId: "hero-1", settingId: "heading" })).toEqual(target);
    expect(parseInlineTarget({ sectionId: "hero-1", blockId: "b-2", settingId: "text" })).toEqual({ sectionId: "hero-1", blockId: "b-2", settingId: "text" });
  });

  it("refuse les identifiants hors format et les objets étrangers", () => {
    expect(parseInlineTarget(null)).toBeNull();
    expect(parseInlineTarget({ sectionId: "a b", settingId: "heading" })).toBeNull();
    expect(parseInlineTarget({ sectionId: "x".repeat(65), settingId: "heading" })).toBeNull();
    expect(parseInlineTarget({ sectionId: "hero-1", settingId: "hea ding" })).toBeNull();
    expect(parseInlineTarget({ sectionId: "hero-1", blockId: "<script>", settingId: "heading" })).toBeNull();
    expect(parseInlineTarget({ sectionId: "hero-1" })).toBeNull();
  });
});

describe("axi:inline-mode", () => {
  it("construit et relit le message", () => {
    expect(parseInlineMode(inlineModeMessage(true))).toEqual({ enabled: true });
    expect(parseInlineMode(inlineModeMessage(false))).toEqual({ enabled: false });
  });
  it("refuse un autre message ou une valeur non booléenne", () => {
    expect(parseInlineMode({ type: PREVIEW_MESSAGES.inlineMode, enabled: "oui" })).toBeNull();
    expect(parseInlineMode({ type: "axi:autre", enabled: true })).toBeNull();
  });
});

describe("axi:inline-change", () => {
  it("relit une modification valide", () => {
    const m = inlineChangeMessage(target, "Bienvenue", "commit", "home");
    expect(parseInlineChange(m)).toEqual({ target, value: "Bienvenue", phase: "commit", template: "home" });
  });

  it("refuse une phase inconnue, une valeur trop longue ou non textuelle", () => {
    expect(parseInlineChange({ ...inlineChangeMessage(target, "x", "commit"), phase: "autre" })).toBeNull();
    expect(parseInlineChange({ ...inlineChangeMessage(target, "x", "input"), value: 12 })).toBeNull();
    expect(parseInlineChange({ ...inlineChangeMessage(target, "x", "input"), value: "a".repeat(MAX_INLINE_VALUE + 1) })).toBeNull();
    expect(parseInlineChange({ type: "axi:theme-preview" })).toBeNull();
  });

  it("ignore un modèle de page inconnu sans refuser le message", () => {
    expect(parseInlineChange({ ...inlineChangeMessage(target, "x", "input"), template: "inconnu" })?.template).toBeNull();
  });
});

describe("axi:inline-reject", () => {
  it("tronque le message à 200 caractères", () => {
    const m = inlineRejectMessage(target, "e".repeat(400));
    expect(m.message).toHaveLength(200);
    expect(parseInlineReject(m)?.target).toEqual(target);
  });
});

describe("axi:image-drop", () => {
  const file = (type: string, size: number) => new File([new Uint8Array(size)], "photo", { type });

  it("accepte jpeg, png, webp et avif jusqu'à 5 Mo", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp", "image/avif"]) expect(isAcceptedInlineImage(file(type, 1024))).toBe(true);
  });

  it("refuse un type non image, un fichier vide ou trop lourd, et un non-File", () => {
    expect(isAcceptedInlineImage(file("image/gif", 10))).toBe(false);
    expect(isAcceptedInlineImage(file("application/pdf", 10))).toBe(false);
    expect(isAcceptedInlineImage(file("image/png", 0))).toBe(false);
    expect(isAcceptedInlineImage(file("image/png", MAX_INLINE_IMAGE_BYTES + 1))).toBe(false);
    expect(isAcceptedInlineImage({ type: "image/png", size: 10 })).toBe(false);
  });

  it("relit un dépôt valide et refuse un fichier non conforme", () => {
    const ok = imageDropMessage({ sectionId: "hero-1", blockId: null, settingId: "image" }, file("image/png", 2048));
    expect(parseImageDrop(ok)?.target.settingId).toBe("image");
    expect(parseImageDrop({ ...ok, file: file("text/plain", 10) })).toBeNull();
    expect(parseImageDrop({ ...ok, file: "/etc/passwd" })).toBeNull();
  });
});

describe("axi:section-action", () => {
  it("accepte les six actions de la barre flottante", () => {
    for (const a of ["move-up", "move-down", "duplicate", "hide", "remove", "insert-after"] as const) {
      expect(parseSectionAction(sectionActionMessage("hero-1", a, "home"))).toEqual({ id: "hero-1", action: a, template: "home" });
    }
  });

  it("refuse une action inconnue ou un identifiant invalide", () => {
    expect(parseSectionAction({ type: PREVIEW_MESSAGES.sectionAction, id: "hero-1", action: "publish" })).toBeNull();
    expect(parseSectionAction({ type: PREVIEW_MESSAGES.sectionAction, id: "hero 1", action: "remove" })).toBeNull();
  });
});

describe("marquage (editAttrs) en aperçu uniquement", () => {
  it("aucun attribut hors aperçu", () => {
    expect(editAttrs(null, { sectionId: "hero-1", settingId: "heading", kind: "text" })).toEqual({});
    expect(editAttrs({ preview: false }, { sectionId: "hero-1", settingId: "heading", kind: "text" })).toEqual({});
  });
  it("aller-retour data-edit", () => {
    const attrs = editAttrs({ preview: true }, { sectionId: "hero-1", blockId: "b-2", settingId: "text", kind: "textarea" });
    expect(attrs["data-edit"]).toBe("hero-1:b-2:text");
    expect(parseEditAttr(attrs["data-edit"])).toEqual({ sectionId: "hero-1", blockId: "b-2", settingId: "text" });
  });
});

describe("cibles éditables d'une section", () => {
  it("liste les réglages texte de la section et de ses blocs", () => {
    const section = doc.templates.home.sections[firstSectionId];
    const targets = inlineTextTargets(section);
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.every((t) => ["text", "textarea", "richtext"].includes(t.kind))).toBe(true);
    expect(targets.every((t) => t.sectionId === section.id)).toBe(true);
  });

  it("signale un champ lié à une source dynamique", () => {
    const section = { ...doc.templates.home.sections[firstSectionId] };
    section.settings = { ...section.settings, heading: { $source: "product.title" } };
    const dyn = inlineTextTargets(section).find((t) => t.settingId === "heading");
    expect(dyn?.dynamic ?? true).toBe(true);
  });

  it("trouve la cible de dépôt d'image d'une section qui en accepte une", () => {
    const hero = Object.values(doc.templates.home.sections).find((s) => s.type === "hero-banner");
    expect(hero && inlineImageTarget(hero)?.settingId).toBe("image");
    const hours = Object.values(doc.templates.home.sections).find((s) => s.type === "opening-hours");
    if (hours) expect(inlineImageTarget(hours)).toBeNull();
  });

  it("normalise les textes pour la correspondance avec le DOM", () => {
    expect(normalizeText("  Deux   espaces \n")).toBe("Deux espaces");
    expect(plainFromMarkdown("**Gras** et [lien](https://a.b)")).toBe("Gras et lien");
  });
});

describe("contrôle éditeur de la valeur reçue", () => {
  const heroId = Object.values(doc.templates.home.sections).find((s) => s.type === "hero-banner")!.id;
  const hero = doc.templates.home.sections[heroId];
  const headingBlockId = hero.blocks.find((b) => b.type === "heading")!.id;

  it("accepte un texte de bloc et le normalise", () => {
    const r = checkInlineValue(doc, "home", { sectionId: heroId, blockId: headingBlockId, settingId: "text" }, "  Nouveau   titre \n");
    expect(r.ok && r.value).toBe("Nouveau titre");
  });

  it("refuse une section ou un réglage inconnus", () => {
    expect(checkInlineValue(doc, "home", { sectionId: "absente", blockId: null, settingId: "heading" }, "x").ok).toBe(false);
    expect(checkInlineValue(doc, "home", { sectionId: heroId, blockId: null, settingId: "overlay_opacity" }, "x").ok).toBe(false);
  });

  it("refuse une valeur plus longue que le maximum du schéma", () => {
    const r = checkInlineValue(doc, "home", { sectionId: heroId, blockId: headingBlockId, settingId: "text" }, "a".repeat(200));
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.message).toContain("120 caractères maximum");
  });

  it("refuse un champ lié à une source dynamique", () => {
    const bound: ThemeDocument = JSON.parse(JSON.stringify(doc));
    bound.templates.home.sections[heroId].blocks.find((b) => b.id === headingBlockId)!.settings.text = { $source: "product.title" };
    const r = checkInlineValue(bound, "home", { sectionId: heroId, blockId: headingBlockId, settingId: "text" }, "x");
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.message).toContain("Donnée du produit");
  });
});
