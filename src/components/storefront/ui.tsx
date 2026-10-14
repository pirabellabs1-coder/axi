import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { schemeVars, S, resolveSectionBackground, backgroundToneVars, resolveSectionWidth } from "@/lib/storefront/theme-doc";
import { SECTION_SCHEMAS } from "@/lib/theme-engine/schemas";
import { motionItemProps, sectionMotionAttrs } from "@/lib/theme-engine/motion";
import type { SectionInstance, SectionType } from "@/lib/theme-engine/types";
import { chargeNotice, chargeNoticeShort, viewCompareAt, viewCurrency, viewMoney, viewPlainMoney, viewPrice, type CurrencyView } from "@/lib/storefront/currency-view";
import type { RenderCtx } from "./render-context";

/** Classes de bouton de la boutique (formes et styles pilotés par les réglages globaux, voir store-styles). */
export function btnClass(style: "solid" | "secondary" | "outline" | "link" | "soft" | "light" | "ghost-light" = "solid", size: "md" | "lg" | "sm" = "md") {
  // Taille « md » pilotée par les variables globales (--store-btn-h / --store-btn-px) via `.sf-btn-md`.
  const sz = size === "lg" ? "h-13 px-7 text-[15px]" : size === "sm" ? "h-10 px-4 text-sm" : "sf-btn-md text-[15px]";
  if (style === "link") return "sf-link inline-flex min-h-11 items-center gap-1.5 text-[15px] font-semibold underline-offset-4 hover:underline";
  return cn("sf-btn", `sf-btn-${style}`, sz);
}

export function ButtonLink({ href, label, style = "solid", size = "md", arrow, className }: { href: string | null; label: string; style?: "solid" | "secondary" | "outline" | "link" | "soft" | "light" | "ghost-light"; size?: "md" | "lg" | "sm"; arrow?: boolean; className?: string }) {
  if (!href || !label) return null;
  const external = href.startsWith("https://");
  const content = (
    <>
      {label}
      {arrow && <ArrowRight className="size-4 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-0.5" aria-hidden />}
    </>
  );
  return external ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cn("group", btnClass(style, size), className)}>
      {content}
    </a>
  ) : (
    <Link href={href} className={cn("group", btnClass(style, size), className)}>
      {content}
    </Link>
  );
}

const PAD_DEFAULT = 48;

/** Sections jamais animées : structure, et contenu principal d'un modèle (porte le LCP de la page). */
const STATIC_SECTIONS = new Set<SectionType>(["announcement-bar", "custom-spacer"]);

/**
 * Lot 4 §2 : attributs d'apparition d'une section. Rien pour la première section du modèle ni pour les sections
 * de modèle (fiche, collection, page, panier) : l'élément du LCP n'est jamais masqué. `items` : la section marque
 * elle-même ses éléments (`motionItemProps`, 6 au maximum) ; sinon elle est animée d'un bloc (`data-anim-self`).
 */
export function sectionAnimAttrs(section: SectionInstance, ctx: RenderCtx, items = false): Record<string, string> {
  if (!ctx.motion?.enabled || ctx.first || STATIC_SECTIONS.has(section.type) || SECTION_SCHEMAS[section.type]?.category === "Modèle") return {};
  const attrs = sectionMotionAttrs(section, ctx.motion);
  if (!attrs["data-anim"]) return {};
  return items ? attrs : { ...attrs, "data-anim-self": "" };
}

/** Élément animé d'une section (`animItems`) : rang 0 à 5, rien au-delà (contrat motion.ts). */
export function animItem(index: number): { "data-anim-item"?: ""; style?: React.CSSProperties } {
  const p = motionItemProps(index);
  return p.style ? { "data-anim-item": "", style: p.style as React.CSSProperties } : {};
}

/**
 * Enveloppe commune : ancre `data-section-id` (sélection dans l'éditeur), schéma de couleur et marges de la section,
 * conteneur à la largeur de page du thème, attributs d'animation (`animItems` : éléments marqués par la section).
 */
export function SectionShell({ section, ctx, children, className, full, label, as: Tag = "section", padded = true, animItems = false }: { section: SectionInstance; ctx: RenderCtx; children: React.ReactNode; className?: string; full?: boolean; label?: string; as?: "section" | "div"; padded?: boolean; animItems?: boolean }) {
  const scheme = S.str(section.settings, "scheme", "default");
  const vars = schemeVars(ctx.settings, scheme);
  const hasPad = "padding_top" in section.settings || "padding_bottom" in section.settings;
  const gap = ctx.settings.layout.sectionSpacing;
  const top = hasPad ? S.num(section.settings, "padding_top", PAD_DEFAULT) : gap / 2;
  const bottom = hasPad ? S.num(section.settings, "padding_bottom", PAD_DEFAULT) : gap / 2;
  // Arrière-plan personnalisé (image/dégradé + superposition) : posé derrière le contenu ; le ton de texte est
  // forcé pour garder le contraste quand le fond est franchement sombre ou clair (readableOn, voir theme-doc).
  const bg = resolveSectionBackground(section.settings);
  const toneVars = bg?.tone ? backgroundToneVars(bg.tone) : null;
  // Largeur de section (helper SECTION_WIDTH) : variable `--section-max` lue par `.sf-container`. Défauts = largeur
  // de page, soit le rendu actuel ; « Pleine largeur » étend le contenu (le fond est déjà bord à bord via `<main>`).
  const width = resolveSectionWidth(section.settings);
  const style: React.CSSProperties = { ...(vars ?? {}), ...(toneVars ?? {}), ...width.vars, ...(padded ? { paddingTop: `calc(${top}px * var(--sf-pad, 1))`, paddingBottom: `calc(${bottom}px * var(--sf-pad, 1))` } : {}) } as React.CSSProperties;
  const content = full ? children : <div className={cn("sf-container", bg && "relative z-[1]")}>{children}</div>;
  return (
    <Tag id={`section-${section.id}`} data-section-id={section.id} data-section-type={section.type} aria-label={label} style={style} className={cn("sf-section relative", (vars || toneVars) && "sf-schemed", className)} {...sectionAnimAttrs(section, ctx, animItems)}>
      {bg && (
        <div aria-hidden className="sf-bg-wrap">
          <div className={cn("sf-bg", bg.fixed && "sf-bg-fixed")} style={bg.layer as React.CSSProperties} />
          {bg.overlay && <div className="sf-bg-overlay" style={{ background: bg.overlay }} />}
        </div>
      )}
      {bg && full ? <div className="relative z-[1]">{children}</div> : content}
    </Tag>
  );
}

const H_SIZES: Record<string, string> = {
  sm: "text-[calc(1.25rem*var(--store-scale))]",
  md: "text-[calc(clamp(1.5rem,3vw,2rem)*var(--store-scale))]",
  lg: "text-[calc(clamp(1.8rem,4vw,2.75rem)*var(--store-scale))]",
  xl: "text-[calc(clamp(2.2rem,6vw,4.25rem)*var(--store-scale))]",
};

export function headingClass(size: string) {
  return cn("sf-heading text-balance text-ink", H_SIZES[size] ?? H_SIZES.md);
}

export function SectionHeading({ section, ctx, fallback = "", aside, align, id }: { section: SectionInstance; ctx?: RenderCtx; fallback?: string; aside?: React.ReactNode; align?: "left" | "center"; id?: string }) {
  void ctx;
  const text = S.str(section.settings, "heading", fallback);
  if (!text && !aside) return null;
  const center = (align ?? S.str(section.settings, "align", "left")) === "center";
  return (
    <div className={cn("mb-6 flex flex-wrap items-end gap-x-6 gap-y-3 sm:mb-8", center ? "flex-col items-center text-center" : "justify-between")}>
      {text ? (
        <h2 id={id} className={headingClass(S.str(section.settings, "heading_size", "md"))}>
          {text}
        </h2>
      ) : (
        <span />
      )}
      {aside}
    </div>
  );
}

/** Montant d'une section formaté dans la devise d'affichage de l'acheteur (lot 2, devises). */
export function money(ctx: Pick<RenderCtx, "data">, amount: number, itemKey?: string | null) {
  return viewMoney(ctx.data.currency, amount, itemKey);
}

/** Montant informatif (remise, seuil) dans la devise d'affichage : conversion au plus proche, sans arrondi commercial. */
export function plainMoney(ctx: Pick<RenderCtx, "data">, amount: number) {
  return viewPlainMoney(ctx.data.currency, amount);
}

/**
 * Prix « dès » + prix barré, lisible par les lecteurs d'écran. Les montants reçus sont TOUJOURS en devise
 * boutique : la conversion d'affichage (devise choisie par l'acheteur, prix fixés par devise) est faite ici.
 */
export function PriceTag({ price, compareAt, range, view, itemKey, soldOut, className, size = "md" }: { price: number; compareAt: number | null; range?: boolean; view?: CurrencyView | null; itemKey?: string | null; soldOut?: boolean; className?: string; size?: "md" | "lg" }) {
  const shown = viewPrice(view, price, itemKey);
  const shownCompare = viewCompareAt(view, compareAt, shown, itemKey);
  const currency = viewCurrency(view);
  return (
    <p className={cn("flex flex-wrap items-baseline gap-x-2 gap-y-0.5", soldOut ? "text-ink-muted" : "text-ink", className)}>
      <span className={cn("font-semibold tabular", size === "lg" ? "text-[26px] tracking-[-0.02em]" : "text-[15px]", shownCompare != null && !soldOut && "text-[var(--sf-sale,inherit)]")}>
        {range && <span className="font-normal text-ink-muted">dès </span>}
        {shownCompare != null && <span className="sr-only">Prix réduit : </span>}
        {formatMoney(shown, currency)}
      </span>
      {shownCompare != null && (
        <s className={cn("text-ink-muted tabular", size === "lg" ? "text-base" : "text-[13px]")}>
          <span className="sr-only">au lieu de </span>
          {formatMoney(shownCompare, currency)}
        </s>
      )}
    </p>
  );
}

/**
 * Mention obligatoire quand les prix affichés sont convertis (au moins une fois par page) : les montants sont
 * encaissés dans la devise de la boutique. Rien si l'affichage est déjà dans la devise de la boutique.
 */
export function CurrencyNotice({ view, short = false, className }: { view?: CurrencyView | null; short?: boolean; className?: string }) {
  const text = short ? chargeNoticeShort(view) : chargeNotice(view);
  if (!text) return null;
  return (
    <p data-currency-notice className={cn("text-xs leading-relaxed text-ink-muted", className)}>
      {text}
    </p>
  );
}

export function EmptyNote({ title, text, action }: { title: string; text?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-[var(--store-card-radius)] bg-surface px-6 py-12 text-center ring-1 ring-line">
      <p className="text-base font-semibold text-ink">{title}</p>
      {text && <p className="mt-1 max-w-[46ch] text-sm leading-relaxed text-ink-muted">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
