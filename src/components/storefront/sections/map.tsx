import { MapPin, Navigation } from "lucide-react";
import { S } from "@/lib/storefront/theme-doc";
import type { SectionProps } from "../render-context";
import { ProductImage } from "../product-image";
import { btnClass, SectionHeading, SectionShell } from "../ui";

/** Plan d'accès : image du plan (optionnelle) + itinéraire Google Maps (aucune carte tierce chargée). */
export default function MapSection({ section, ctx }: SectionProps) {
  const s = ctx.data.store;
  const address = S.str(section.settings, "address").trim() || [s.address, s.city].filter(Boolean).join(", ");
  const image = S.img(section.settings, "image");
  if (!address && !image) return null;
  const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${s.name} ${address}`)}`;
  return (
    <SectionShell section={section} ctx={ctx}>
      <SectionHeading section={section} ctx={ctx} fallback="Plan d'accès" />
      <div className="grid grid-cols-1 overflow-hidden rounded-[var(--store-card-radius)] bg-surface ring-1 ring-line md:grid-cols-[1.3fr_1fr]">
        {image ? (
          <ProductImage src={image.url} alt={image.alt ?? `Plan d'accès à ${s.name}`} ratio="aspect-[16/10]" sizes="(max-width: 768px) 100vw, 60vw" />
        ) : (
          <div className="relative flex aspect-[16/10] items-center justify-center bg-[var(--store-primary-soft)]" aria-hidden>
            <div className="absolute inset-0 opacity-50 [background-image:linear-gradient(var(--c-line)_1px,transparent_1px),linear-gradient(90deg,var(--c-line)_1px,transparent_1px)] [background-size:32px_32px]" />
            <span className="relative inline-flex size-14 items-center justify-center rounded-full bg-[var(--store-primary)] text-[var(--store-primary-contrast)] shadow-[var(--shadow-md)]">
              <MapPin className="size-6" />
            </span>
          </div>
        )}
        <div className="flex flex-col justify-center gap-4 p-6 sm:p-8">
          {address && (
            <p className="flex gap-3 text-[16px] leading-relaxed text-ink">
              <MapPin className="mt-0.5 size-5 shrink-0 text-[var(--store-primary)]" aria-hidden />
              {address}
            </p>
          )}
          <a href={maps} target="_blank" rel="noopener noreferrer" className={btnClass("solid")}>
            <Navigation className="size-4" aria-hidden /> Ouvrir l&apos;itinéraire
          </a>
        </div>
      </div>
    </SectionShell>
  );
}
