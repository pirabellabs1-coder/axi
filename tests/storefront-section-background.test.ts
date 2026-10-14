/**
 * Arrière-plan de section (image / dégradé + superposition) : `resolveSectionBackground` est une fonction pure
 * (réglages → CSS). On vérifie le repli « Aucun », l'image couvrante + cadrage, le dégradé, la superposition (%)
 * et le ton de texte forcé pour le contraste.
 */
import { describe, expect, it } from "vitest";
import { resolveSectionBackground, backgroundToneVars } from "@/lib/storefront/theme-doc";
import type { Settings } from "@/lib/theme-engine/types";

describe("resolveSectionBackground", () => {
  it("repli « Aucun » (ou réglage absent) : aucun fond", () => {
    expect(resolveSectionBackground({})).toBeNull();
    expect(resolveSectionBackground({ bg_type: "none" } as Settings)).toBeNull();
    // type image mais aucune image → pas de fond (rien de cassé)
    expect(resolveSectionBackground({ bg_type: "image" } as Settings)).toBeNull();
  });

  it("image : fond couvrant, cadrage et parallaxe", () => {
    const bg = resolveSectionBackground({
      bg_type: "image",
      bg_image: { url: "https://cdn.example.com/p.jpg" },
      bg_position: "top",
      bg_fixed: true,
    } as Settings);
    expect(bg).not.toBeNull();
    expect(bg!.kind).toBe("image");
    expect(bg!.layer.backgroundImage).toBe('url("https://cdn.example.com/p.jpg")');
    expect(bg!.layer.backgroundSize).toBe("cover");
    expect(bg!.layer.backgroundPosition).toBe("top center");
    expect(bg!.fixed).toBe(true);
    // superposition nulle par défaut, ton non forcé (on garde le schéma)
    expect(bg!.overlay).toBeNull();
    expect(bg!.tone).toBeNull();
  });

  it("image : une superposition franche force un texte clair", () => {
    const bg = resolveSectionBackground({
      bg_type: "image",
      bg_image: { url: "https://cdn.example.com/p.jpg" },
      bg_overlay: 60,
      bg_overlay_color: "#000000",
    } as Settings);
    expect(bg!.overlay).toBe("rgba(0, 0, 0, 0.6)");
    expect(bg!.tone).toBe("light");
  });

  it("dégradé : linear-gradient avec l'angle, et ton déduit", () => {
    const dark = resolveSectionBackground({
      bg_type: "gradient",
      bg_gradient_from: "#111827",
      bg_gradient_to: "#1f2937",
      bg_gradient_angle: 90,
    } as Settings);
    expect(dark!.kind).toBe("gradient");
    expect(dark!.layer.backgroundImage).toBe("linear-gradient(90deg, #111827, #1f2937)");
    expect(dark!.fixed).toBe(false);
    expect(dark!.tone).toBe("light"); // dégradé sombre → texte clair

    const light = resolveSectionBackground({
      bg_type: "gradient",
      bg_gradient_from: "#ffffff",
      bg_gradient_to: "#f5f5f5",
    } as Settings);
    expect(light!.tone).toBe("dark"); // dégradé clair → texte sombre
  });

  it("superposition : bornée à [0, 80] % et convertie en rgba", () => {
    const bg = resolveSectionBackground({
      bg_type: "gradient",
      bg_gradient_from: "#ffffff",
      bg_gradient_to: "#ffffff",
      bg_overlay: 999,
      bg_overlay_color: "#000000",
    } as Settings);
    expect(bg!.overlay).toBe("rgba(0, 0, 0, 0.8)");
    // voile noir fort sur fond blanc → le texte doit passer au clair
    expect(bg!.tone).toBe("light");
  });

  it("backgroundToneVars : surcharge cohérente de la couleur de texte", () => {
    expect(backgroundToneVars("light")["--c-ink"]).toBe("#ffffff");
    expect(backgroundToneVars("light").color).toBe("#ffffff");
    expect(backgroundToneVars("dark")["--c-ink"]).toBe("#111412");
  });
});
