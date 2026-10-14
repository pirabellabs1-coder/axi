import Image from "next/image";
import { ShoppingBag } from "lucide-react";
import { MEDIA, unsplash } from "@/config/media";
import { cn } from "@/lib/utils";
import { isLocalMediaPath } from "@/lib/storage/keys";
import type { MkImage as MkImageData } from "@/lib/marketplace/types";

/**
 * Image de la marketplace : next/image pour les URL https, <img> pour les médias téléversés (/media/…) et les data-URL,
 * sinon photo de repli (catégorie) ou placeholder sobre. Le parent impose le ratio (pas de CLS).
 */
export function MkImage({
  image,
  fallbackMedia,
  sizes,
  priority = false,
  className,
}: {
  image: MkImageData | null;
  fallbackMedia?: keyof typeof MEDIA;
  sizes: string;
  priority?: boolean;
  className?: string;
}) {
  const cls = cn("object-cover", className);
  if (image?.url.startsWith("https://")) {
    return <Image src={image.url} alt={image.alt} fill sizes={sizes} priority={priority} className={cls} />;
  }
  if (image && (image.url.startsWith("data:image/") || image.url.startsWith("/api/marketplace/image/") || isLocalMediaPath(image.url))) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={image.url} alt={image.alt} loading={priority ? "eager" : "lazy"} decoding="async" className={cn("absolute inset-0 size-full", cls)} />;
  }
  if (fallbackMedia) {
    const m = MEDIA[fallbackMedia];
    return <Image src={unsplash(m.id, 900, 700)} alt="" fill sizes={sizes} priority={priority} className={cls} />;
  }
  return <ImagePlaceholder />;
}

export function ImagePlaceholder({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("absolute inset-0 flex items-center justify-center bg-[radial-gradient(120%_90%_at_30%_10%,var(--color-primary-soft),var(--color-surface-2))]", className)}>
      <span className="inline-flex size-14 items-center justify-center rounded-2xl bg-surface/70 text-primary ring-1 ring-line">
        <ShoppingBag className="size-6" />
      </span>
    </div>
  );
}
