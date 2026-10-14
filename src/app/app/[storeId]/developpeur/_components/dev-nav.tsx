"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Blocks, Gauge, Settings, Wallet, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDevBase } from "./dev-link";

type Item = { href: string; label: string; icon: LucideIcon; exact?: boolean };

const DEV_NAV: Item[] = [
  { href: "", label: "Vue d'ensemble", icon: Gauge, exact: true },
  { href: "/apps", label: "Mes applications", icon: Blocks },
  { href: "/revenus", label: "Revenus", icon: Wallet },
  { href: "/docs", label: "Documentation", icon: BookOpen },
  { href: "/parametres", label: "Paramètres", icon: Settings },
];

/**
 * Sous-navigation du portail développeur, dans le contenu de l'admin (la barre latérale et le menu mobile
 * restent ceux de la boutique). Défilement horizontal sur mobile.
 */
export function DevNav() {
  const pathname = usePathname();
  const dev = useDevBase();
  return (
    <nav aria-label="Espace développeur" className="scrollbar-none -mx-1 mb-6 flex gap-1 overflow-x-auto border-b border-line">
      {DEV_NAV.map((i) => {
        const href = dev + i.href;
        const active = i.exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={i.label}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative inline-flex h-11 shrink-0 items-center gap-2 px-3 text-sm font-medium transition-colors duration-150",
              active ? "text-ink" : "text-ink-muted hover:text-ink",
            )}
          >
            <i.icon className="size-4" aria-hidden />
            {i.label}
            {active && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />}
          </Link>
        );
      })}
    </nav>
  );
}
