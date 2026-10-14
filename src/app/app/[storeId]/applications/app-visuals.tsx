import {
  Megaphone, ShoppingBag, Truck, BarChart3, Palette, Sparkles, Gift, Headset, Blocks, type LucideIcon,
} from "lucide-react";
import type { AppCategory } from "@/lib/apps/types";
import { cn } from "@/lib/utils";

/** Pictogramme lucide de repli par catégorie (quand une app n'a pas d'icône). */
export const CATEGORY_ICON: Record<AppCategory, LucideIcon> = {
  marketing: Megaphone,
  ventes: ShoppingBag,
  logistique: Truck,
  analytics: BarChart3,
  design: Palette,
  ia: Sparkles,
  fidelite: Gift,
  support: Headset,
  autre: Blocks,
};

function isAppCategoryKey(v: string): v is AppCategory {
  return v in CATEGORY_ICON;
}

/**
 * Icône d'une app : son `iconUrl` si présent, sinon le pictogramme lucide de sa catégorie.
 * Les images décoratives portent un alt vide (le nom de l'app est déjà annoncé à côté).
 */
export function AppIcon({
  name,
  iconUrl,
  category,
  size = 48,
  className,
}: {
  name: string;
  iconUrl: string | null;
  category: string;
  size?: number;
  className?: string;
}) {
  const style = { width: size, height: size };
  const radius = size >= 56 ? "rounded-[var(--radius-lg)]" : "rounded-[var(--radius-md)]";
  if (iconUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={iconUrl}
        alt=""
        width={size}
        height={size}
        style={style}
        className={cn("shrink-0 object-cover ring-1 ring-inset ring-line", radius, className)}
      />
    );
  }
  const Icon = isAppCategoryKey(category) ? CATEGORY_ICON[category] : Blocks;
  return (
    <span
      style={style}
      aria-hidden
      title={name}
      className={cn("inline-flex shrink-0 items-center justify-center bg-primary-soft text-primary ring-1 ring-inset ring-primary/10", radius, className)}
    >
      <Icon style={{ width: size * 0.46, height: size * 0.46 }} />
    </span>
  );
}
