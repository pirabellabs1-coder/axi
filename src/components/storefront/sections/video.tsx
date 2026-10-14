import { Play } from "lucide-react";
import { S } from "@/lib/storefront/theme-doc";
import type { SectionProps } from "../render-context";
import { ProductImage } from "../product-image";
import { SectionHeading, SectionShell } from "../ui";
import { fallbackVisual } from "./hero-banner";

/**
 * Vidéo : couverture cliquable qui ouvre la vidéo (YouTube, Vimeo, MP4) dans un nouvel onglet.
 * Pas d'iframe tierce (politique de sécurité de la boutique, aucun traceur chargé sans action du visiteur).
 */
export default function Video({ section, ctx }: SectionProps) {
  const url = S.str(section.settings, "url");
  const cover = S.img(section.settings, "cover") ?? youtubeThumb(url) ?? fallbackVisual(ctx);
  if (!url && !cover) return null;
  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  })();
  const label = host.includes("youtu") ? "Regarder sur YouTube" : host.includes("vimeo") ? "Regarder sur Vimeo" : "Regarder la vidéo";
  const media = (
    <div className="relative">
      <ProductImage src={cover?.url} alt={cover?.alt ?? ""} ratio="aspect-video" className="rounded-[var(--store-card-radius)]" imgClassName="sf-img-main" sizes="(max-width: 1280px) 100vw, 1280px" />
      <span className="absolute inset-0 rounded-[var(--store-card-radius)] bg-black/25" aria-hidden />
      {url && (
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="inline-flex items-center gap-3 rounded-full bg-white py-2 pl-2 pr-5 text-sm font-semibold text-[#111412] shadow-[0_20px_40px_-16px_rgb(0_0_0/0.6)] transition-transform duration-300 group-hover:scale-[1.04]">
            <span className="inline-flex size-10 items-center justify-center rounded-full bg-[#111412] text-white">
              <Play className="size-4 translate-x-px" fill="currentColor" aria-hidden />
            </span>
            {label}
          </span>
        </span>
      )}
    </div>
  );
  return (
    <SectionShell section={section} ctx={ctx}>
      <SectionHeading section={section} ctx={ctx} />
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className="sf-card group block">
          {media}
          <span className="sr-only"> (nouvel onglet)</span>
        </a>
      ) : (
        media
      )}
    </SectionShell>
  );
}

function youtubeThumb(url: string): { url: string; alt: string } | null {
  const m = /(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{11})/.exec(url);
  return m ? { url: `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg`, alt: "" } : null;
}
