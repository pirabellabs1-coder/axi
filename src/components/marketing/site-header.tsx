"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { ButtonLink } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/fonctionnalites", label: "Fonctionnalités" },
  { href: "/tarifs", label: "Tarifs" },
  { href: "/developpeurs", label: "Développeurs" },
  { href: "/marketplace", label: "Marketplace" },
  { href: "/aide", label: "Aide" },
];

/**
 * Navigation « île flottante » : pilule de verre détachée du haut.
 * L'état « défilé » vient d'un IntersectionObserver sur une sentinelle (aucun écouteur de scroll).
 * Mobile : menu plein écran, burger qui se transforme en X, liens en cascade.
 */
export function SiteHeader({ loggedIn, homeHref = "/app", homeLabel = "Mon espace" }: { loggedIn: boolean; homeHref?: string; homeLabel?: string }) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const pathname = usePathname();
  const sentinel = useRef<HTMLDivElement>(null);
  const burger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(([entry]) => setScrolled(!entry.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Fermeture à chaque changement de page (ajustement d'état pendant le rendu, sans effet).
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  // Fermeture si l'écran passe en mode bureau (rotation, redimensionnement).
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setOpen(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Menu ouvert : défilement bloqué, contenu et pied de page inertes (menu en divulgation, pas en dialogue).
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const prev = root.style.overflow;
    root.style.overflow = "hidden";
    const inertTargets = [document.getElementById("contenu"), document.querySelector("footer")].filter(Boolean) as HTMLElement[];
    inertTargets.forEach((el) => el.setAttribute("inert", ""));
    const first = panel.current?.querySelector<HTMLElement>("a, button");
    const t = window.setTimeout(() => first?.focus(), 120);

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        burger.current?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      root.style.overflow = prev;
      inertTargets.forEach((el) => el.removeAttribute("inert"));
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const close = () => setOpen(false);
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <>
      <div ref={sentinel} aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-8" />
      <header className="fixed inset-x-0 top-0 z-50 px-3 sm:px-4">
        <div
          className={cn(
            "mx-auto mt-3 flex h-16 max-w-[1180px] items-center justify-between gap-4 rounded-full pl-5 pr-2 ring-1 backdrop-blur-xl transition-[background-color,box-shadow] duration-500 ease-spring sm:mt-4",
            scrolled || open ? "bg-surface/90 shadow-[var(--shadow-md)] ring-line" : "bg-surface/70 ring-line/70",
          )}
        >
          <Logo />

          <nav aria-label="Navigation principale" className="hidden lg:block">
            <ul className="flex items-center gap-1">
              {NAV.map((n) => (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    aria-current={isActive(n.href) ? "page" : undefined}
                    className={cn(
                      "inline-flex h-10 items-center rounded-full px-4 text-[14px] font-medium transition-colors duration-300 ease-spring",
                      isActive(n.href) ? "bg-surface-2 text-ink" : "text-ink-muted hover:text-ink",
                    )}
                  >
                    {n.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div className="hidden items-center gap-1.5 lg:flex">
            {loggedIn ? (
              <ButtonLink href={homeHref} variant="primary" size="sm" trailing>
                {homeLabel}
              </ButtonLink>
            ) : (
              <>
                <ButtonLink href="/connexion" variant="ghost" size="sm" className="h-10">
                  Connexion
                </ButtonLink>
                <ButtonLink href="/inscription" variant="accent" size="md" trailing>
                  Créer ma boutique
                </ButtonLink>
              </>
            )}
          </div>

          <button
            ref={burger}
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="menu-mobile"
            aria-label={open ? "Fermer le menu" : "Ouvrir le menu"}
            className="relative inline-flex size-12 items-center justify-center rounded-full bg-surface-2 text-ink lg:hidden"
          >
            <span aria-hidden className={cn("absolute h-[1.5px] w-5 rounded-full bg-current transition-transform duration-500 ease-spring", open ? "rotate-45" : "-translate-y-[4px]")} />
            <span aria-hidden className={cn("absolute h-[1.5px] w-5 rounded-full bg-current transition-transform duration-500 ease-spring", open ? "-rotate-45" : "translate-y-[4px]")} />
          </button>
        </div>
      </header>

      <div
        id="menu-mobile"
        ref={panel}
        inert={!open}
        className={cn(
          "fixed inset-0 z-40 flex flex-col overflow-y-auto overscroll-contain bg-canvas/95 px-6 pb-8 pt-28 backdrop-blur-2xl transition-[opacity,visibility] duration-500 ease-spring lg:hidden",
          open ? "visible opacity-100" : "invisible opacity-0",
        )}
      >
        <nav aria-label="Navigation mobile" className="flex-1">
          <ul className="space-y-1">
            {NAV.map((n, i) => (
              <li key={n.href} className="overflow-hidden">
                <Link
                  href={n.href}
                  onClick={close}
                  aria-current={isActive(n.href) ? "page" : undefined}
                  style={{ transitionDelay: open ? `${100 + i * 60}ms` : "0ms" }}
                  className={cn(
                    "flex min-h-14 items-center justify-between text-[1.8rem] font-semibold tracking-[-0.04em] text-ink transition-[transform,opacity] duration-700 ease-out-expo sm:text-[2.1rem]",
                    open ? "translate-y-0 opacity-100" : "translate-y-10 opacity-0",
                  )}
                >
                  {n.label}
                  <ArrowUpRight className="size-6 text-ink-faint" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div
          style={{ transitionDelay: open ? "380ms" : "0ms" }}
          className={cn("space-y-3 transition-[transform,opacity] duration-700 ease-out-expo", open ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0")}
        >
          {loggedIn ? (
            <ButtonLink href={homeHref} onClick={close} variant="primary" size="lg" className="w-full" trailing>
              {homeLabel}
            </ButtonLink>
          ) : (
            <>
              <ButtonLink href="/inscription" onClick={close} variant="accent" size="lg" className="w-full" trailing>
                Créer ma boutique
              </ButtonLink>
              <ButtonLink href="/connexion" onClick={close} variant="outline" size="lg" className="w-full">
                Connexion
              </ButtonLink>
            </>
          )}
          <div className="flex items-center justify-between pt-3">
            <span className="text-sm text-ink-muted">Apparence</span>
            <ThemeToggle />
          </div>
        </div>
      </div>
    </>
  );
}
