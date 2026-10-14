import Link from "next/link";
import { MapPin, Package, Star } from "lucide-react";
import { Avatar } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { STORE_CATEGORIES, getCountry } from "@/config/site";
import { cn } from "@/lib/utils";

export type MarketplaceStore = {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  category: string;
  city: string | null;
  country: string;
  logoUrl: string | null;
  bannerUrl: string | null;
  isFeatured: boolean;
  _count: { products: number; orders?: number };
};

const BANNER_TONES = ["bg-primary-soft", "bg-sun-soft", "bg-accent-soft", "bg-info-soft", "bg-surface-2"];

function toneFor(slug: string) {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return BANNER_TONES[h % BANNER_TONES.length];
}

export function StoreCard({ store, className }: { store: MarketplaceStore; className?: string }) {
  const category = STORE_CATEGORIES.find((c) => c.id === store.category)?.label ?? "Boutique";
  const country = getCountry(store.country).name;
  const place = [store.city, country].filter(Boolean).join(", ");
  const count = store._count.products;

  return (
    <article className={cn("group relative flex flex-col overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface shadow-[var(--shadow-card)] transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)] has-[a:focus-visible]:outline-2 has-[a:focus-visible]:-outline-offset-2 has-[a:focus-visible]:outline-primary", className)}>
      <div className={cn("relative h-24", toneFor(store.slug))}>
        {store.bannerUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={store.bannerUrl} alt="" className="size-full object-cover" loading="lazy" width={400} height={96} />
        ) : (
          <svg aria-hidden className="absolute inset-0 size-full opacity-40" viewBox="0 0 400 96" preserveAspectRatio="none">
            <path d="M0 70 Q100 20 200 60 T400 40 V96 H0Z" fill="currentColor" className="text-white" />
          </svg>
        )}
        {store.isFeatured && (
          <Badge tone="sun" className="absolute left-3 top-3 shadow-sm">
            <Star className="size-3" aria-hidden /> En vedette
          </Badge>
        )}
      </div>

      <div className="relative -mt-6 flex flex-1 flex-col px-4 pb-4">
        <Avatar name={store.name} src={store.logoUrl} size={48} className="ring-4 ring-surface" />
        <h3 className="mt-2 font-display text-base font-semibold leading-tight text-ink">
          <Link href={`/s/${store.slug}`} className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none">
            {store.name}
          </Link>
        </h3>
        <p className="mt-1 line-clamp-2 min-h-10 text-sm text-ink-muted">{store.tagline ?? `Boutique ${category.toLowerCase()} sur Axi.`}</p>

        <dl className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
          {place && (
            <div className="flex items-center gap-1">
              <dt className="sr-only">Lieu</dt>
              <MapPin className="size-3.5" aria-hidden />
              <dd>{place}</dd>
            </div>
          )}
          <div className="flex items-center gap-1">
            <dt className="sr-only">Produits</dt>
            <Package className="size-3.5" aria-hidden />
            <dd>
              {count} {count > 1 ? "produits" : "produit"}
            </dd>
          </div>
        </dl>

        <div className="mt-3">
          <Badge tone="neutral">{category}</Badge>
        </div>
      </div>
    </article>
  );
}
