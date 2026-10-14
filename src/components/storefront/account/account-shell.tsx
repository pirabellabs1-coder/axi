import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { StoreChrome } from "@/components/storefront/storefront-view";
import { cn } from "@/lib/utils";

export type AccountTab = "home" | "orders" | "addresses" | "favorites" | "returns";

const TABS: { id: AccountTab; label: string; path: string }[] = [
  { id: "home", label: "Mon compte", path: "" },
  { id: "orders", label: "Commandes", path: "/commandes" },
  { id: "addresses", label: "Adresses", path: "/adresses" },
  { id: "favorites", label: "Favoris", path: "/favoris" },
  { id: "returns", label: "Retours", path: "/retours" },
];

/**
 * Cadre de l'espace client (thème clair de la boutique, en-tête et pied de page complets) : titre, navigation
 * par onglets défilants (mobile d'abord). Réutilisable par les pages Retours (équipe D) avec `active="returns"`.
 */
export function AccountShell({
  slug,
  title,
  description,
  active,
  back,
  hideNav = false,
  readOnlyNotice,
  children,
}: {
  slug: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  active?: AccountTab;
  back?: { href: string; label: string };
  hideNav?: boolean;
  readOnlyNotice?: boolean;
  children: React.ReactNode;
}) {
  const base = `/s/${slug}/compte`;
  return (
    <StoreChrome slug={slug} minimal={false}>
      <div className="sf-container max-w-[960px] pb-20 pt-4 sm:pt-8">
        {back && (
          <Link href={back.href} className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-full px-2 text-sm text-ink-muted hover:text-ink">
            <ChevronLeft className="size-4" aria-hidden /> {back.label}
          </Link>
        )}
        <header className="sf-rise mb-6 mt-1">
          <h1 className="text-[clamp(1.75rem,4.5vw,2.4rem)] font-semibold leading-[1.05] tracking-[-0.035em] text-ink" style={{ fontFamily: "var(--store-font-heading, inherit)" }}>
            {title}
          </h1>
          {description && <p className="mt-2 max-w-[60ch] text-[15px] leading-relaxed text-ink-muted">{description}</p>}
        </header>
        {!hideNav && (
          <nav aria-label="Espace client" className="-mx-4 mb-7 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
            <ul className="flex w-max gap-1.5 rounded-full bg-surface-2 p-1.5 ring-1 ring-line sm:w-auto sm:flex-wrap">
              {TABS.map((t) => {
                const current = t.id === active;
                return (
                  <li key={t.id}>
                    <Link
                      href={`${base}${t.path}`}
                      aria-current={current ? "page" : undefined}
                      className={cn(
                        "inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold transition-[background-color,color,box-shadow] duration-200",
                        current ? "bg-surface text-ink shadow-[var(--shadow-card)] ring-1 ring-line" : "text-ink-muted hover:text-ink",
                      )}
                    >
                      {t.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}
        {readOnlyNotice && (
          <p role="status" className="mb-6 rounded-[14px] bg-sun-soft px-4 py-3 text-sm text-ink">
            La boutique est temporairement fermée : votre compte reste consultable, les modifications reprendront à sa réouverture.
          </p>
        )}
        {children}
      </div>
    </StoreChrome>
  );
}

/** Carte de l'espace client (rayon des cartes du thème). */
export function AccountCard({ className, children, as: Tag = "section", ...props }: React.HTMLAttributes<HTMLElement> & { as?: "section" | "div" | "li" | "article" }) {
  return (
    <Tag className={cn("rounded-[var(--store-card-radius,20px)] bg-surface p-5 ring-1 ring-line sm:p-6", className)} {...props}>
      {children}
    </Tag>
  );
}
