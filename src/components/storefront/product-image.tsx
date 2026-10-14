import Image from "next/image";
import { ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { isHttps } from "./format";

/**
 * Image produit : next/image pour les URL https, <img lazy> sinon (data-URL importée), repli sobre si aucune.
 * Le conteneur impose un ratio (aucun décalage de mise en page). `priority` (image du LCP : bannière, image principale
 * de la fiche) : préchargée et demandée en priorité haute (`fetchpriority="high"`).
 */
export function ProductImage({
  src,
  alt,
  className,
  imgClassName,
  sizes = "(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw",
  priority = false,
  ratio = "aspect-[4/5]",
  fit = "cover",
  fetchPriority,
}: {
  src?: string | null;
  alt: string;
  className?: string;
  imgClassName?: string;
  sizes?: string;
  priority?: boolean;
  ratio?: string;
  fit?: "cover" | "contain";
  /** Par défaut « high » si `priority` ; « auto » pour une petite image au-dessus de la ligne de flottaison (logo). */
  fetchPriority?: "high" | "auto" | "low";
}) {
  const fp = fetchPriority ?? (priority ? "high" : undefined);
  const objectFit = fit === "contain" ? "object-contain" : "object-cover";
  return (
    <div className={cn("sf-media relative w-full overflow-hidden bg-[var(--store-primary-soft)]", ratio, className)}>
      {src ? (
        isHttps(src) ? (
          <Image src={src} alt={alt} fill sizes={sizes} priority={priority} fetchPriority={fp} className={cn(objectFit, imgClassName)} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={alt} loading={priority ? "eager" : "lazy"} fetchPriority={fp} decoding="async" width={800} height={1000} className={cn("absolute inset-0 size-full", objectFit, imgClassName)} />
        )
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-[var(--store-primary)] opacity-40" aria-hidden>
          <ImageIcon className="size-8" />
        </span>
      )}
    </div>
  );
}
