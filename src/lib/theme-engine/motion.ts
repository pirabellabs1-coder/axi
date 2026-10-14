/**
 * Lot 4 §2 : préréglages d'animation (module PUR, client et serveur).
 *
 * Contrat de rendu (T3) :
 *  1. `effectiveMotion(settings.motion, env)` → réglages effectifs (`enabled: false` sous Save-Data, mode économie
 *     `axi_lite=1`, aperçu « Réduire les animations », préréglage « none »).
 *  2. Racine de la boutique : `motionRootAttrs(m)` (`data-motion`, `data-motion-hover`, `data-motion-parallax`).
 *     Sans `data-motion`, aucune règle de `MOTION_CSS` ne s'applique.
 *  3. Section : `sectionMotionAttrs(section, m)` → `data-anim="fade-up"` (rien si aucune animation).
 *     Éléments animés : `motionItemAttrs(i)` (6 au maximum par section, décalage ≤ 60 ms) ; sans élément marqué,
 *     la section entière est animée (`data-anim-self`).
 *  4. `MotionObserver` (client) pose `data-motion-ready` sur la racine au montage, puis `data-in-view` sur chaque
 *     `[data-anim]` visible (IntersectionObserver, une seule fois). Sans JavaScript, rien n'est jamais masqué.
 *  5. `MOTION_CSS` (dans store-styles.tsx) : tout est sous `@media (prefers-reduced-motion: no-preference)`,
 *     uniquement `transform` et `opacity`, 200 à 600 ms, `cubic-bezier(0.2, 0, 0, 1)`, jamais `transition: all`.
 *     Parallaxe : `animation-timeline: view()` sous `@supports`, sinon statique (aucun écouteur de défilement).
 *     Zoom au survol : `[data-hover-zoom]` (cartes, images de section).
 */
import { DEFAULT_MOTION, MOTION_PRESETS, type MotionSettings, type SectionAnimation, type SectionInstance } from "./types";

export const MOTION_EASING = "cubic-bezier(0.2, 0, 0, 1)";
export const MAX_ANIMATED_ITEMS_PER_SECTION = 6;
export const MAX_STAGGER_MS = 60;

type Preset = Exclude<MotionSettings["preset"], "none">;

/** Durées (200 à 600 ms), distances et décalages par préréglage. */
export const MOTION_TIMINGS: Record<Preset, { durationMs: number; distancePx: number; staggerMs: number; zoomFrom: number; hoverScale: number }> = {
  subtle: { durationMs: 360, distancePx: 12, staggerMs: 40, zoomFrom: 0.97, hoverScale: 1.03 },
  lively: { durationMs: 560, distancePx: 28, staggerMs: 60, zoomFrom: 0.92, hoverScale: 1.06 },
};

/** Animation appliquée quand la section hérite du réglage global (`inherit` ou absente). */
export const DEFAULT_SECTION_ANIMATION: Exclude<SectionAnimation, "inherit" | "none"> = "fade-up";

export type MotionEnv = {
  /** En-tête `Save-Data: on`. */
  saveData?: boolean;
  /** Mode économie de données (cookie `axi_lite=1`, §14). */
  lite?: boolean;
  /** Aperçu de l'éditeur : case « Réduire les animations ». */
  reduce?: boolean;
};

export type EffectiveMotion = MotionSettings & { enabled: boolean };

/** Lecture des signaux de requête (valeurs brutes d'en-tête et de cookie). */
export function motionEnvFromRequest(input: { saveDataHeader?: string | null; liteCookie?: string | null; reduce?: boolean }): MotionEnv {
  return {
    saveData: typeof input.saveDataHeader === "string" && input.saveDataHeader.trim().toLowerCase() === "on",
    lite: input.liteCookie === "1",
    reduce: input.reduce === true,
  };
}

/** Réglages effectifs : défauts complétés (documents antérieurs), tout désactivé par Save-Data / économie / réduction. */
export function effectiveMotion(motion: Partial<MotionSettings> | null | undefined, env: MotionEnv = {}): EffectiveMotion {
  const m: MotionSettings = {
    preset: motion?.preset && (MOTION_PRESETS as readonly string[]).includes(motion.preset) ? motion.preset : DEFAULT_MOTION.preset,
    reveal: typeof motion?.reveal === "boolean" ? motion.reveal : DEFAULT_MOTION.reveal,
    parallax: typeof motion?.parallax === "boolean" ? motion.parallax : DEFAULT_MOTION.parallax,
    hoverZoom: typeof motion?.hoverZoom === "boolean" ? motion.hoverZoom : DEFAULT_MOTION.hoverZoom,
  };
  const off = env.saveData || env.lite || env.reduce || m.preset === "none";
  if (off) return { preset: "none", reveal: false, parallax: false, hoverZoom: false, enabled: false };
  return { ...m, enabled: true };
}

/** Attributs de la racine de la boutique (vide si désactivé). */
export function motionRootAttrs(m: EffectiveMotion): Record<string, string> {
  if (!m.enabled) return {};
  const out: Record<string, string> = { "data-motion": m.preset };
  if (m.hoverZoom) out["data-motion-hover"] = "";
  if (m.parallax) out["data-motion-parallax"] = "";
  return out;
}

/** Animation effective d'une section (`none` si désactivé ou si l'apparition est coupée globalement). */
export function sectionAnimation(section: Pick<SectionInstance, "animation">, m: EffectiveMotion): Exclude<SectionAnimation, "inherit"> {
  if (!m.enabled || !m.reveal) return "none";
  const a = section.animation ?? "inherit";
  return a === "inherit" ? DEFAULT_SECTION_ANIMATION : a;
}

/** Attributs de l'élément racine d'une section. */
export function sectionMotionAttrs(section: Pick<SectionInstance, "animation">, m: EffectiveMotion): Record<string, string> {
  const a = sectionAnimation(section, m);
  return a === "none" ? {} : { "data-anim": a };
}

/**
 * Attributs d'un élément animé dans une section (cartes, colonnes, blocs). Au-delà de 6, rien : l'élément s'affiche
 * avec sa section sans animation propre. `--anim-i` porte le rang pour le décalage.
 */
export function motionItemAttrs(index: number): Record<string, string> {
  if (!Number.isInteger(index) || index < 0 || index >= MAX_ANIMATED_ITEMS_PER_SECTION) return {};
  return { "data-anim-item": "", style: `--anim-i:${index}` };
}

/** Variante React : style en objet (`style={{ "--anim-i": 2 }}`). */
export function motionItemProps(index: number): { "data-anim-item"?: ""; style?: Record<string, number> } {
  if (!Number.isInteger(index) || index < 0 || index >= MAX_ANIMATED_ITEMS_PER_SECTION) return {};
  return { "data-anim-item": "", style: { "--anim-i": index } };
}

/* ───────────── CSS ───────────── */

const FROM: Record<Exclude<SectionAnimation, "inherit" | "none">, (t: (typeof MOTION_TIMINGS)[Preset]) => string> = {
  "fade-up": (t) => `opacity: 0; transform: translate3d(0, ${t.distancePx}px, 0);`,
  fade: () => "opacity: 0;",
  "zoom-in": (t) => `opacity: 0; transform: scale(${t.zoomFrom});`,
  "slide-left": (t) => `opacity: 0; transform: translate3d(${t.distancePx * 2}px, 0, 0);`,
};

function presetCss(preset: Preset): string {
  const t = MOTION_TIMINGS[preset];
  const root = `[data-motion="${preset}"][data-motion-ready]`;
  const targets = (anim: string, state: string) =>
    `${root} [data-anim="${anim}"]${state} [data-anim-item], ${root} [data-anim="${anim}"][data-anim-self]${state}`;
  const lines: string[] = [];
  // Transition (propriétés explicites uniquement), décalage borné à 60 ms × rang (rang < 6).
  lines.push(
    `${root} [data-anim] [data-anim-item], ${root} [data-anim][data-anim-self] { transition-property: opacity, transform; transition-duration: ${t.durationMs}ms; transition-timing-function: ${MOTION_EASING}; transition-delay: calc(min(var(--anim-i, 0), ${MAX_ANIMATED_ITEMS_PER_SECTION - 1}) * ${t.staggerMs}ms); }`,
  );
  for (const [anim, from] of Object.entries(FROM)) lines.push(`${targets(anim, ":not([data-in-view])")} { ${from(t)} }`);
  // Zoom au survol (cartes et images marquées), clavier compris.
  lines.push(`[data-motion="${preset}"][data-motion-hover] [data-hover-zoom] img { transition-property: transform; transition-duration: ${Math.min(600, t.durationMs + 120)}ms; transition-timing-function: ${MOTION_EASING}; }`);
  lines.push(`[data-motion="${preset}"][data-motion-hover] [data-hover-zoom]:hover img, [data-motion="${preset}"][data-motion-hover] [data-hover-zoom]:focus-within img { transform: scale(${t.hoverScale}); }`);
  return lines.join("\n  ");
}

/**
 * Feuille de style des animations (statique, identique pour toutes les boutiques : l'activation passe par les
 * attributs de la racine). À insérer telle quelle dans store-styles.tsx.
 */
export const MOTION_CSS = `@media (prefers-reduced-motion: no-preference) {
  ${presetCss("subtle")}
  ${presetCss("lively")}
  @supports (animation-timeline: view()) {
    @keyframes axi-parallax { from { transform: translate3d(0, -6%, 0) scale(1.12); } to { transform: translate3d(0, 6%, 0) scale(1.12); } }
    [data-motion][data-motion-parallax] [data-parallax] { animation-name: axi-parallax; animation-duration: 1ms; animation-timing-function: linear; animation-fill-mode: both; animation-timeline: view(); animation-range: cover; }
  }
}`;
