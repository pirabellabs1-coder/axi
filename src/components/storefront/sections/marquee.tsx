import { Sparkle } from "lucide-react";
import { S } from "@/lib/storefront/theme-doc";
import { cn } from "@/lib/utils";
import { href, type SectionProps } from "../render-context";
import { SectionShell } from "../ui";

const DURATION: Record<string, string> = { slow: "48s", normal: "32s", fast: "20s" };

/**
 * Bandeau défilant (bibliothèque premium, lot 4 §4). Liste réelle lue une fois par les lecteurs d'écran ; la copie
 * qui assure la boucle est `aria-hidden` et ses liens hors tabulation. Défilement par `transform` (classe `.sf-marquee`,
 * store-styles) : arrêté sous `prefers-reduced-motion`, sans `data-motion` (Save-Data, mode économie), au survol et au focus.
 */
export default function Marquee({ section, ctx }: SectionProps) {
  const st = section.settings;
  const items = section.blocks
    .filter((b) => !b.disabled && b.type === "item" && S.str(b.settings, "text").trim())
    .map((b) => ({ id: b.id, text: S.str(b.settings, "text").trim(), link: href(ctx, S.str(b.settings, "link") || null) }));
  if (!items.length) return null;
  const large = S.str(st, "size", "md") === "lg";
  const reverse = S.str(st, "direction", "left") === "right";
  const list = (copy: boolean) => (
    <ul aria-hidden={copy || undefined} className="flex shrink-0 items-center gap-8 pr-8 sm:gap-12 sm:pr-12">
      {items.map((it) => (
        <li key={it.id} className="flex items-center gap-8 whitespace-nowrap sm:gap-12">
          {it.link ? (
            <a href={it.link} tabIndex={copy ? -1 : undefined} className="underline-offset-4 hover:underline" {...(it.link.startsWith("https://") ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
              {it.text}
            </a>
          ) : (
            <span>{it.text}</span>
          )}
          <Sparkle className="size-4 shrink-0 opacity-60" aria-hidden />
        </li>
      ))}
    </ul>
  );
  return (
    <SectionShell section={section} ctx={ctx} full label="Messages de la boutique">
      <div className="sf-marquee-wrap overflow-hidden">
        <div className={cn("sf-marquee !gap-0", reverse && "sf-marquee-reverse", large ? "text-[calc(clamp(1.5rem,4vw,2.5rem)*var(--store-scale))] sf-heading" : "text-[15px] font-semibold uppercase tracking-[0.08em]")} style={{ "--sf-marquee-dur": DURATION[S.str(st, "speed", "normal")] ?? DURATION.normal } as React.CSSProperties}>
          {list(false)}
          {list(true)}
        </div>
      </div>
    </SectionShell>
  );
}
