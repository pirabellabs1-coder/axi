import Image from "next/image";
import type { Shot } from "@/lib/marketing/positioning";
import { cn } from "@/lib/utils";

/**
 * Capture réelle du produit, encadrée.
 *
 * - Les captures de l'espace marchand sont prises en thème sombre : elles restent lisibles
 *   dans les deux thèmes du site, posées sur un cadre forêt.
 * - Les captures de vitrine acheteur sont en clair (thème de la boutique, toujours clair).
 * - La hauteur est réservée par `aspect-ratio` : aucun décalage de mise en page au chargement.
 *
 * Les fichiers sont des WebP déjà dimensionnés (1800 px de large pour le bureau, 780 px pour le téléphone),
 * produits par `node scripts/vitrine-captures.mjs produit` : le loader next/image sert les chemins locaux
 * tels quels, il n'y a donc pas de redimensionnement à l'exécution.
 */
export function Shot({
  shot,
  priority = false,
  sizes,
  className,
  frame = "window",
  captionHidden = false,
}: {
  shot: Shot;
  priority?: boolean;
  sizes: string;
  className?: string;
  /** `window` : barre de fenêtre ; `phone` : cadre arrondi de téléphone ; `plain` : image seule dans son cadre. */
  frame?: "window" | "phone" | "plain";
  /** Masque la légende visible (le texte reste la description accessible de l'image). */
  captionHidden?: boolean;
}) {
  const dark = shot.tone === "dark";
  return (
    <figure className={cn("group/shot", className)}>
      <div
        className={cn(
          "overflow-hidden rounded-[var(--radius-xl)] p-1.5 ring-1 ring-inset",
          dark ? "bg-forest-deep ring-white/10" : "bg-surface-2 ring-line",
          frame === "phone" && "rounded-[var(--radius-2xl)] p-2",
        )}
      >
        {frame === "window" && (
          <div aria-hidden className="flex items-center gap-1.5 px-3 py-2">
            {["bg-white/20", "bg-white/14", "bg-white/10"].map((c, i) => (
              <span key={i} className={cn("size-2 rounded-full", dark ? c : "bg-ink/15")} />
            ))}
          </div>
        )}
        <div
          className={cn(
            "relative overflow-hidden",
            frame === "phone" ? "rounded-[calc(var(--radius-2xl)-8px)]" : "rounded-[calc(var(--radius-xl)-6px)]",
            dark ? "bg-forest-deep" : "bg-surface",
          )}
          style={{ aspectRatio: `${shot.width} / ${shot.height}` }}
        >
          <Image
            src={shot.src}
            alt={shot.alt}
            width={shot.width}
            height={shot.height}
            sizes={sizes}
            priority={priority}
            loading={priority ? undefined : "lazy"}
            className="size-full object-cover object-top"
          />
        </div>
      </div>
      <figcaption className={cn("mt-4 text-[14px] leading-relaxed text-ink-muted", captionHidden && "sr-only")}>{shot.caption}</figcaption>
    </figure>
  );
}
