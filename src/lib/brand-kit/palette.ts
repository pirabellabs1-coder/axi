/**
 * Lot 4 §7 : kit de marque (module PUR, testé : tests/brand-palette.test.ts).
 *
 * À partir des couleurs extraites du logo (`extract.ts`), construit une palette complète et UTILISABLE :
 *  - `primary` : la couleur la plus saturée et utilisable (ni trop claire ni trop sombre pour un bouton) ;
 *  - `primaryText` : `readableOn(primary)` ;
 *  - `accent` : couleur complémentaire (teinte opposée), ramenée à un niveau utilisable ;
 *  - neutres teintés : fond, surface, texte, texte secondaire, bordure, tous dérivés de la teinte de `primary` ;
 *  - schémas de section « marque » et « sombre » (la boutique reste en thème clair : le sombre est un schéma).
 *
 * Contrôle AA : 4,5:1 pour le texte courant, 3:1 pour les grands titres et les composants. Toute paire qui
 * échoue est corrigée automatiquement par ajustement de la LUMINANCE HSL (la teinte de la marque est conservée).
 *
 * Aucun appel IA, aucun crédit : le kit est déterministe et gratuit.
 */
import { z } from "zod";
import { contrastRatio, FONT_IDS, readableOn } from "@/lib/storefront/theme-doc";
import type { FontId, GlobalSettings } from "@/lib/theme-engine/types";
import { fromHex, toHex, type Rgb } from "./extract";

/* ───────────── Seuils ───────────── */

export const AA_TEXT = 4.5;
export const AA_LARGE = 3;

export const BRAND_TONES = ["chaleureux", "premium", "direct", "festif"] as const;
export type BrandTone = (typeof BRAND_TONES)[number];

export type BrandPalette = {
  background: string;
  surface: string;
  text: string;
  muted: string;
  primary: string;
  primaryText: string;
  accent: string;
  border: string;
};

export type BrandScheme = { id: string; name: string; background: string; text: string; primary: string; primaryText: string };

export type BrandKit = {
  logoUrl: string | null;
  /** Couleurs brutes extraites du logo (ordre : de la plus présente à la moins présente). */
  palette: string[];
  primary: string;
  accent: string;
  fontPair: { heading: FontId; body: FontId };
  voice: { tone: BrandTone; formal: boolean };
  /** Palette complète dérivée (neutres teintés compris), déjà corrigée AA. */
  colors: BrandPalette;
  schemes: BrandScheme[];
  updatedAt: string;
};

/* ───────────── HSL ───────────── */

export type Hsl = { h: number; s: number; l: number };

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === rn ? ((gn - bn) / d + (gn < bn ? 6 : 0)) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const hh = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] =
    hh < 60 ? [c, x, 0] : hh < 120 ? [x, c, 0] : hh < 180 ? [0, c, x] : hh < 240 ? [0, x, c] : hh < 300 ? [x, 0, c] : [c, 0, x];
  return { r: (r1 + m) * 255, g: (g1 + m) * 255, b: (b1 + m) * 255 };
}

export function hexToHsl(hex: string): Hsl {
  return rgbToHsl(fromHex(hex));
}

export function hslToHex(hsl: Hsl): string {
  return toHex(hslToRgb({ h: hsl.h, s: clamp01(hsl.s), l: clamp01(hsl.l) }));
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Même teinte, luminance imposée. */
export function withLightness(hex: string, l: number): string {
  const c = hexToHsl(hex);
  return hslToHex({ ...c, l: clamp01(l) });
}

/**
 * Correction AA par ajustement de la LUMINANCE HSL : on éclaircit ou on assombrit `fg` par pas de 2 %
 * (dans la direction qui éloigne de `bg`) jusqu'à atteindre `min`. En dernier recours, noir ou blanc.
 * Idempotente : une couleur déjà conforme est renvoyée telle quelle.
 */
export function adjustLuminance(fg: string, bg: string, min = AA_TEXT): string {
  if (contrastRatio(fg, bg) >= min) return fg;
  const c = hexToHsl(fg);
  const darken = hexToHsl(bg).l > 0.5;
  for (let step = 0.02; step <= 1; step += 0.02) {
    const l = darken ? c.l - step : c.l + step;
    if (l < 0 || l > 1) break;
    const candidate = hslToHex({ ...c, l });
    if (contrastRatio(candidate, bg) >= min) return candidate;
  }
  // Teinte conservée impossible : on tente l'autre direction avant de tomber sur noir / blanc.
  for (let step = 0.02; step <= 1; step += 0.02) {
    const l = darken ? c.l + step : c.l - step;
    if (l < 0 || l > 1) break;
    const candidate = hslToHex({ ...c, l });
    if (contrastRatio(candidate, bg) >= min) return candidate;
  }
  return readableOn(bg);
}

/**
 * Couleur de BOUTON utilisable : assez contrastée avec le fond (composant, 3:1) ET capable de porter
 * un texte lisible (4,5:1 avec du blanc ou du noir). On déplace la luminance par pas de 2 % en gardant
 * la teinte, d'abord vers le sombre puis vers le clair. Dernier recours : une version très sombre.
 */
export function usableButtonColor(color: string, background: string, minBg = AA_LARGE, minText = AA_TEXT): string {
  const start = adjustLuminance(color, background, minBg);
  const ok = (c: string) => contrastRatio(c, background) >= minBg && contrastRatio(readableOn(c), c) >= minText;
  if (ok(start)) return start;
  const hsl = hexToHsl(start);
  for (const direction of [-1, 1]) {
    for (let step = 0.02; step <= 1; step += 0.02) {
      const l = hsl.l + direction * step;
      if (l < 0.04 || l > 0.96) break;
      const candidate = hslToHex({ ...hsl, l });
      if (ok(candidate)) return candidate;
    }
  }
  return hslToHex({ ...hsl, l: 0.18 });
}

/* ───────────── Choix des couleurs ───────────── */

export function saturation(hex: string): number {
  return hexToHsl(hex).s;
}

/** Une couleur « utilisable » comme couleur principale : ni quasi blanche ni quasi noire, et un minimum colorée. */
export function isUsablePrimary(hex: string): boolean {
  const { s, l } = hexToHsl(hex);
  return l >= 0.12 && l <= 0.72 && s >= 0.12;
}

/** Couleur principale : la plus saturée parmi les utilisables ; sinon la plus saturée ramenée à une luminance utilisable. */
export function pickPrimary(colors: string[]): string {
  const valid = colors.filter(isHex);
  if (!valid.length) return "#0D3B2E";
  const usable = valid.filter(isUsablePrimary);
  const pool = usable.length ? usable : valid;
  const best = [...pool].sort((a, b) => saturation(b) - saturation(a))[0];
  if (isUsablePrimary(best)) return best;
  const c = hexToHsl(best);
  return hslToHex({ h: c.h, s: Math.max(0.35, c.s), l: Math.min(0.55, Math.max(0.3, c.l)) });
}

/** Couleur complémentaire : teinte opposée (+160°), saturée et utilisable. */
export function complementary(primary: string): string {
  const c = hexToHsl(primary);
  return hslToHex({ h: (c.h + 160) % 360, s: Math.max(0.45, Math.min(0.85, c.s + 0.1)), l: c.l < 0.45 ? 0.62 : 0.42 });
}

/** Accent : une 2e couleur du logo suffisamment éloignée en teinte, sinon la complémentaire. */
export function pickAccent(colors: string[], primary: string): string {
  const hp = hexToHsl(primary).h;
  const candidate = colors
    .filter((c) => isHex(c) && c.toUpperCase() !== primary.toUpperCase())
    .filter((c) => {
      const d = Math.abs(hexToHsl(c).h - hp);
      return Math.min(d, 360 - d) >= 40 && saturation(c) >= 0.2;
    })
    .sort((a, b) => saturation(b) - saturation(a))[0];
  if (!candidate) return complementary(primary);
  const c = hexToHsl(candidate);
  return hslToHex({ h: c.h, s: Math.max(0.35, c.s), l: Math.min(0.68, Math.max(0.32, c.l)) });
}

/** Neutres teintés : la teinte de la marque est présente partout, à très faible saturation. */
export function tintedNeutrals(primary: string): Pick<BrandPalette, "background" | "surface" | "text" | "muted" | "border"> {
  const { h } = hexToHsl(primary);
  return {
    background: hslToHex({ h, s: 0.14, l: 0.975 }),
    surface: "#FFFFFF",
    text: hslToHex({ h, s: 0.22, l: 0.1 }),
    muted: hslToHex({ h, s: 0.1, l: 0.42 }),
    border: hslToHex({ h, s: 0.12, l: 0.9 }),
  };
}

export const TONE_FONTS: Record<BrandTone, { heading: FontId; body: FontId }> = {
  chaleureux: { heading: "outfit", body: "dm-sans" },
  premium: { heading: "cormorant", body: "manrope" },
  direct: { heading: "inter-tight", body: "inter-tight" },
  festif: { heading: "fraunces", body: "plus-jakarta" },
};

function isHex(v: unknown): v is string {
  return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);
}

/* ───────────── Construction et contrôle AA ───────────── */

/** Palette complète, déjà corrigée AA (texte 4,5:1, composants 3:1). */
export function buildPalette(colors: string[]): BrandPalette {
  const primary = pickPrimary(colors);
  const accent = pickAccent(colors, primary);
  const n = tintedNeutrals(primary);
  const text = adjustLuminance(n.text, n.background, AA_TEXT);
  const muted = adjustLuminance(n.muted, n.background, AA_TEXT);
  // Le fond des boutons doit se détacher du fond de page (3:1) et porter un texte lisible (4,5:1).
  const button = usableButtonColor(primary, n.background);
  return {
    background: n.background,
    surface: n.surface,
    text,
    muted,
    border: n.border,
    primary: button,
    primaryText: readableOn(button),
    accent: adjustLuminance(accent, n.background, AA_LARGE),
  };
}

export function buildSchemes(p: BrandPalette): BrandScheme[] {
  const darkBg = withLightness(p.text, 0.11);
  const brandButton = usableButtonColor(p.accent, p.primary);
  const darkButton = usableButtonColor(p.accent, darkBg);
  return [
    { id: "marque", name: "Marque", background: p.primary, text: readableOn(p.primary), primary: brandButton, primaryText: readableOn(brandButton) },
    { id: "sombre", name: "Sombre", background: darkBg, text: adjustLuminance(p.background, darkBg, AA_TEXT), primary: darkButton, primaryText: readableOn(darkButton) },
  ];
}

/**
 * Kit de marque complet. `colors` vient de l'extraction du logo (client) ; `tone` du commerçant.
 * Entièrement déterministe : mêmes entrées, même kit (hors `updatedAt`).
 */
export function buildBrandKit(input: { colors: string[]; logoUrl?: string | null; tone?: BrandTone; formal?: boolean; fontPair?: { heading: FontId; body: FontId }; now?: Date }): BrandKit {
  const colors = input.colors.filter(isHex).map((c) => c.toUpperCase()).slice(0, 8);
  const tone: BrandTone = BRAND_TONES.includes(input.tone as BrandTone) ? (input.tone as BrandTone) : "chaleureux";
  const palette = buildPalette(colors);
  const fontPair = input.fontPair && FONT_IDS.includes(input.fontPair.heading) && FONT_IDS.includes(input.fontPair.body) ? input.fontPair : TONE_FONTS[tone];
  return {
    logoUrl: typeof input.logoUrl === "string" && input.logoUrl ? input.logoUrl : null,
    palette: colors,
    primary: palette.primary,
    accent: palette.accent,
    fontPair,
    voice: { tone, formal: input.formal !== false },
    colors: palette,
    schemes: buildSchemes(palette),
    updatedAt: (input.now ?? new Date()).toISOString(),
  };
}

export type ContrastCheck = { id: string; label: string; ratio: number; min: number; ok: boolean };

/** Contrôle AA affiché au commerçant (après correction automatique : tout doit être au vert). */
export function contrastReport(p: BrandPalette, schemes: BrandScheme[] = []): ContrastCheck[] {
  const checks: ContrastCheck[] = [
    { id: "text", label: "Texte sur le fond", ratio: contrastRatio(p.text, p.background), min: AA_TEXT, ok: false },
    { id: "muted", label: "Texte secondaire sur le fond", ratio: contrastRatio(p.muted, p.background), min: AA_TEXT, ok: false },
    { id: "surface", label: "Texte sur les cartes", ratio: contrastRatio(p.text, p.surface), min: AA_TEXT, ok: false },
    { id: "button", label: "Texte des boutons", ratio: contrastRatio(p.primaryText, p.primary), min: AA_TEXT, ok: false },
    { id: "primary", label: "Bouton sur le fond", ratio: contrastRatio(p.primary, p.background), min: AA_LARGE, ok: false },
    { id: "accent", label: "Accent sur le fond", ratio: contrastRatio(p.accent, p.background), min: AA_LARGE, ok: false },
    ...schemes.map((s) => ({ id: `scheme:${s.id}`, label: `Schéma « ${s.name} »`, ratio: contrastRatio(s.text, s.background), min: AA_TEXT, ok: false })),
  ];
  return checks.map((c) => ({ ...c, ratio: Math.round(c.ratio * 100) / 100, ok: c.ratio >= c.min }));
}

/* ───────────── Application à un thème ───────────── */

/** Applique le kit aux réglages globaux d'un document (couleurs, schémas, polices). Fonction pure. */
export function applyBrandKit(settings: GlobalSettings, kit: BrandKit): GlobalSettings {
  const p = kit.colors;
  const others = settings.colors.schemes.filter((s) => !kit.schemes.some((k) => k.id === s.id));
  return {
    ...settings,
    colors: { ...settings.colors, ...p, schemes: [...kit.schemes, ...others].slice(0, 8) },
    typography: { ...settings.typography, heading: kit.fontPair.heading, body: kit.fontPair.body },
    header: { ...settings.header, logo: kit.logoUrl ? { url: kit.logoUrl, alt: settings.header.logo?.alt ?? "" } : settings.header.logo },
  };
}

/* ───────────── Validation serveur ───────────── */

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Couleur invalide (format #RRGGBB attendu).");
const fontId = z.enum(FONT_IDS as [FontId, ...FontId[]]);

export const brandKitSchema = z.object({
  logoUrl: z.string().max(2000).nullable().default(null),
  palette: z.array(hex).max(8).default([]),
  primary: hex,
  accent: hex,
  fontPair: z.object({ heading: fontId, body: fontId }),
  voice: z.object({ tone: z.enum(BRAND_TONES), formal: z.boolean().default(true) }),
  colors: z.object({ background: hex, surface: hex, text: hex, muted: hex, primary: hex, primaryText: hex, accent: hex, border: hex }),
  schemes: z.array(z.object({ id: z.string().regex(/^[a-z0-9-]{1,24}$/), name: z.string().trim().min(1).max(40), background: hex, text: hex, primary: hex, primaryText: hex })).max(8).default([]),
  updatedAt: z.string().max(40).optional(),
});

export type BrandKitInput = z.input<typeof brandKitSchema>;

/**
 * Lecture défensive d'un kit stocké (`Store.brandKit`) : forme validée puis contraste RECORRIGÉ
 * (un kit ancien ou modifié à la main ne peut pas rendre la boutique illisible).
 */
export function parseBrandKit(raw: unknown): BrandKit | null {
  const p = brandKitSchema.safeParse(raw);
  if (!p.success) return null;
  const d = p.data;
  const colors: BrandPalette = {
    ...d.colors,
    text: adjustLuminance(d.colors.text, d.colors.background, AA_TEXT),
    muted: adjustLuminance(d.colors.muted, d.colors.background, AA_TEXT),
    primary: usableButtonColor(d.colors.primary, d.colors.background),
    accent: adjustLuminance(d.colors.accent, d.colors.background, AA_LARGE),
  };
  colors.primaryText = readableOn(colors.primary, d.colors.primaryText);
  return {
    logoUrl: d.logoUrl,
    palette: d.palette.map((c) => c.toUpperCase()),
    primary: colors.primary,
    accent: colors.accent,
    fontPair: d.fontPair,
    voice: d.voice,
    colors,
    schemes: d.schemes.length
      ? d.schemes.map((s) => {
          const primary = usableButtonColor(s.primary, s.background);
          return { ...s, text: adjustLuminance(s.text, s.background, AA_TEXT), primary, primaryText: readableOn(primary, s.primaryText) };
        })
      : buildSchemes(colors),
    updatedAt: d.updatedAt ?? new Date(0).toISOString(),
  };
}
