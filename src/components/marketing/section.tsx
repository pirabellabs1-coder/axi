import * as React from "react";
import { cn } from "@/lib/utils";

type Tone = "canvas" | "surface" | "deep" | "forest";

const tones: Record<Tone, string> = {
  canvas: "bg-canvas",
  surface: "bg-surface",
  deep: "bg-canvas-deep",
  forest: "bg-forest text-white",
};

/** Section marketing : rythme vertical ample (py-24 md:py-32) + conteneur 1280 px. */
export function Section({
  id,
  tone = "canvas",
  className,
  containerClassName,
  children,
  as: Tag = "section",
  labelledBy,
}: {
  id?: string;
  tone?: Tone;
  className?: string;
  containerClassName?: string;
  children: React.ReactNode;
  as?: "section" | "div";
  labelledBy?: string;
}) {
  return (
    <Tag id={id} aria-labelledby={labelledBy} className={cn("scroll-mt-28 py-24 md:py-32", tones[tone], className)}>
      <div className={cn("container-x", containerClassName)}>{children}</div>
    </Tag>
  );
}

/** Petite étiquette pilule au-dessus d'un titre. À utiliser avec parcimonie (1 pour 3 sections). */
export function Eyebrow({ children, className, light = false }: { children: React.ReactNode; className?: string; light?: boolean }) {
  return <p className={cn(light ? "inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/80 ring-1 ring-inset ring-white/15" : "eyebrow", className)}>{children}</p>;
}

/** En-tête de section empilé : (étiquette) + titre + description courte. */
export function SectionHeading({
  id,
  eyebrow,
  title,
  description,
  align = "left",
  className,
  light = false,
  level: Level = "h2",
}: {
  id?: string;
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  align?: "center" | "left";
  className?: string;
  light?: boolean;
  level?: "h1" | "h2" | "h3";
}) {
  return (
    <div className={cn("reveal max-w-2xl", align === "center" && "mx-auto text-center", className)}>
      {eyebrow && <Eyebrow light={light} className="mb-5">{eyebrow}</Eyebrow>}
      {/* Pas de cn() ici : twMerge prend « text-h2 » pour une couleur et le supprimerait face à « text-ink ». */}
      <Level id={id} className={`${Level === "h1" ? "text-h1" : "text-h2"} font-semibold ${light ? "text-white" : "text-ink"}`}>
        {title}
      </Level>
      {description && <p className={cn("mt-5 max-w-[60ch] text-[17px] leading-relaxed", align === "center" && "mx-auto", light ? "text-white/75" : "text-ink-muted")}>{description}</p>}
    </div>
  );
}

/** En-tête des pages intérieures (aide, contact, légal…). */
export function PageHero({ title, description, eyebrow, children, className }: { title: React.ReactNode; description?: React.ReactNode; eyebrow?: string; children?: React.ReactNode; className?: string }) {
  return (
    <section className={cn("relative pb-14 pt-12 md:pb-20 md:pt-20", className)}>
      <div className="container-x">
        <div className="max-w-3xl">
          {eyebrow && <Eyebrow className="mb-6 animate-fade-up">{eyebrow}</Eyebrow>}
          <h1 className="text-h1 font-semibold text-ink animate-fade-up [animation-delay:60ms]">{title}</h1>
          {description && <p className="mt-5 max-w-[60ch] text-lg leading-relaxed text-ink-muted animate-fade-up [animation-delay:120ms]">{description}</p>}
          {children && <div className="mt-8 animate-fade-up [animation-delay:180ms]">{children}</div>}
        </div>
      </div>
    </section>
  );
}
