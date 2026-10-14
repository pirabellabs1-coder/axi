"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Store,
  Users,
  Receipt,
  CreditCard,
  LifeBuoy,
  ListChecks,
  ScrollText,
  Menu,
  X,
  ArrowLeft,
  Tags,
  Puzzle,
  Coins,
  TicketPercent,
  Flag,
  Megaphone,
  ShieldCheck,
  SlidersHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldAlert,
  ArrowRight,
  Bot,
  LibraryBig,
  ArrowLeftRight,
  Blocks,
  Globe,
} from "lucide-react";
import { AxiMark } from "@/components/ui/logo";
import { UserMenu } from "@/components/app/user-menu";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: typeof Store; exact?: boolean; count?: number };
type NavGroup = { label: string; items: NavItem[] };

export type AdminCounts = { tickets?: number; jobs?: number; invoices?: number; addons?: number; reports?: number };

const SIDEBAR_COOKIE = "axi_admin_sidebar"; // lu par src/app/admin/layout.tsx

/**
 * Coque de la console plateforme, façon Linear :
 *  - barre latérale repliable (bouton ou touche « [ », état mémorisé dans un cookie lu côté serveur :
 *    aucun saut au chargement), libellés en infobulle quand elle est repliée ;
 *  - tiroir mobile toujours monté (transform), Échap, clic extérieur, fermeture à la navigation,
 *    focus déplacé à l'ouverture et rendu au bouton à la fermeture, défilement de la page bloqué ;
 *  - bandeau insistant tant qu'un super-administrateur n'a pas activé la double authentification.
 */
export function AdminShell({
  user,
  counts,
  roleLabel,
  mfaWarning = false,
  initialCollapsed = false,
  children,
}: {
  user: { name: string; email: string };
  counts?: AdminCounts;
  roleLabel?: string;
  mfaWarning?: boolean;
  initialCollapsed?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const closeDrawer = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  // Fermer le tiroir à chaque navigation (sans voler le focus de la nouvelle page).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => closeRef.current?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeDrawer();
      }
      // Piège à focus minimal dans le tiroir.
      if (e.key === "Tab" && drawerRef.current) {
        const f = drawerRef.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled])");
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, closeDrawer]);

  // Le tiroir se referme si l'écran passe en grand format.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = () => mq.matches && setOpen(false);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      document.cookie = `${SIDEBAR_COOKIE}=${next ? "collapsed" : "expanded"}; path=/admin; max-age=31536000; samesite=lax`;
      return next;
    });
  }, []);

  // Raccourci « [ » : replier / déplier (jamais pendant une saisie).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "[" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (document.querySelector("dialog[open]")) return;
      e.preventDefault();
      if (window.matchMedia("(min-width: 1024px)").matches) toggleCollapsed();
      else setOpen((o) => !o);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleCollapsed]);

  const groups: NavGroup[] = [
    { label: "Pilotage", items: [{ href: "/admin", label: "Vue d'ensemble", icon: LayoutDashboard, exact: true }] },
    {
      label: "Revenus",
      items: [
        { href: "/admin/abonnements", label: "Abonnements", icon: Receipt, count: counts?.invoices },
        { href: "/admin/tarifs", label: "Catalogue des prix", icon: Tags },
        { href: "/admin/codes-promo", label: "Codes promo", icon: TicketPercent },
        { href: "/admin/options", label: "Options vendues", icon: Puzzle, count: counts?.addons },
        { href: "/admin/domaines", label: "Noms de domaine", icon: Globe },
        { href: "/admin/credits", label: "Portefeuilles de crédits", icon: Coins },
        { href: "/admin/paiements", label: "Paiements des ventes", icon: CreditCard },
      ],
    },
    {
      label: "Clients",
      items: [
        { href: "/admin/boutiques", label: "Boutiques", icon: Store },
        { href: "/admin/utilisateurs", label: "Utilisateurs", icon: Users },
        { href: "/admin/tickets", label: "Tickets", icon: LifeBuoy, count: counts?.tickets },
        { href: "/admin/signalements", label: "Signalements", icon: Flag, count: counts?.reports },
      ],
    },
    {
      label: "Plateforme",
      items: [
        { href: "/admin/annonces", label: "Annonces", icon: Megaphone },
        { href: "/admin/applications", label: "Applications", icon: Blocks },
        { href: "/admin/bibliotheque", label: "Bibliothèque de sections", icon: LibraryBig },
        { href: "/admin/equipe", label: "Équipe et sécurité", icon: ShieldCheck },
        { href: "/admin/parametres", label: "Paramètres", icon: SlidersHorizontal },
        { href: "/admin/devises", label: "Taux de change", icon: ArrowLeftRight },
        { href: "/admin/connecteurs-ia", label: "Connecteurs IA", icon: Bot },
        { href: "/admin/taches", label: "Tâches et notifications", icon: ListChecks, count: counts?.jobs },
        { href: "/admin/audit", label: "Journal d'audit", icon: ScrollText },
      ],
    },
  ];

  const isActive = (i: NavItem) => (i.exact ? pathname === i.href : pathname === i.href || pathname.startsWith(`${i.href}/`));
  const current = groups.flatMap((g) => g.items).find(isActive);

  const sidebar = (mode: "rail" | "drawer") => {
    const mini = mode === "rail" && collapsed;
    return (
      <div className="flex h-full flex-col border-r border-line bg-surface">
        <div className={cn("flex h-14 shrink-0 items-center gap-2", mini ? "justify-center px-2" : "justify-between px-3.5")}>
          <Link href="/admin" className={cn("inline-flex min-h-11 items-center gap-2.5 rounded-full", !mini && "pr-2")} aria-label="Administration Axi, vue d'ensemble" tabIndex={mode === "drawer" && !open ? -1 : undefined}>
            <AxiMark size={26} />
            {!mini && (
              <>
                <span className="text-[17px] font-semibold tracking-[-0.03em] text-ink">axi</span>
                <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-ink-muted ring-1 ring-inset ring-line">Console</span>
              </>
            )}
          </Link>
          {mode === "drawer" && (
            <button ref={closeRef} type="button" className="inline-flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-surface-2 hover:text-ink" onClick={() => closeDrawer()} aria-label="Fermer le menu" tabIndex={open ? undefined : -1}>
              <X className="size-5" aria-hidden />
            </button>
          )}
        </div>

        <nav className={cn("flex-1 overflow-y-auto overflow-x-hidden pb-4 pt-1 [scrollbar-width:thin]", mini ? "scrollbar-none px-2" : "px-2.5")} aria-label="Navigation de la console">
          {groups.map((g) => (
            <div key={g.label} className={mini ? "mb-1.5 border-b border-line pb-1.5 last:border-0" : "mb-4"}>
              {!mini && <p className="px-2.5 pb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-faint">{g.label}</p>}
              <ul className="space-y-px">
                {g.items.map((i) => {
                  const active = isActive(i);
                  const badge = typeof i.count === "number" && i.count > 0;
                  return (
                    <li key={i.href}>
                      <Link
                        href={i.href}
                        aria-current={active ? "page" : undefined}
                        aria-label={mini ? `${i.label}${badge ? `, ${i.count} à traiter` : ""}` : undefined}
                        title={mini ? i.label : undefined}
                        tabIndex={mode === "drawer" && !open ? -1 : undefined}
                        onClick={() => mode === "drawer" && setOpen(false)}
                        className={cn(
                          "group/nav relative flex items-center rounded-[10px] text-[14px] transition-colors duration-150",
                          mini ? "size-10 justify-center" : "h-11 gap-2.5 px-2.5 lg:h-9 lg:text-[13.5px]",
                          active ? "bg-surface-2 font-medium text-ink ring-1 ring-inset ring-line" : "text-ink-muted hover:bg-surface-2/70 hover:text-ink",
                        )}
                      >
                        <i.icon className={cn("size-4 shrink-0", active ? "text-primary" : "text-ink-faint group-hover/nav:text-ink-muted")} aria-hidden />
                        {!mini && <span className="flex-1 truncate">{i.label}</span>}
                        {badge &&
                          (mini ? (
                            <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-accent ring-2 ring-surface" aria-hidden />
                          ) : (
                            <span className="tabular min-w-5 rounded-full bg-accent px-1.5 text-center text-[11px] font-semibold leading-5 text-on-accent">
                              {i.count}
                              <span className="sr-only"> à traiter</span>
                            </span>
                          ))}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className={cn("shrink-0 space-y-px border-t border-line", mini ? "p-2" : "p-2.5")}>
          <Link
            href="/app"
            title={mini ? "Espace marchand" : undefined}
            aria-label={mini ? "Espace marchand" : undefined}
            tabIndex={mode === "drawer" && !open ? -1 : undefined}
            className={cn("flex items-center rounded-[10px] text-[13.5px] text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink", mini ? "size-11 justify-center" : "h-11 gap-2 px-2.5 lg:h-9")}
          >
            <ArrowLeft className="size-4" aria-hidden /> {!mini && "Espace marchand"}
          </Link>
          {mode === "rail" && (
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-expanded={!collapsed}
              aria-label={collapsed ? "Déplier la barre latérale" : "Replier la barre latérale"}
              title={collapsed ? "Déplier ( [ )" : "Replier ( [ )"}
              className={cn("flex w-full items-center rounded-[10px] text-[13.5px] text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink", mini ? "size-11 justify-center" : "h-9 gap-2 px-2.5")}
            >
              {collapsed ? <PanelLeftOpen className="size-4" aria-hidden /> : <PanelLeftClose className="size-4" aria-hidden />}
              {!mini && (
                <>
                  <span className="flex-1 text-left">Replier</span>
                  <kbd className="rounded border border-line bg-surface-2 px-1.5 font-mono text-[11px] leading-5 text-ink-faint">[</kbd>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className={cn("min-h-dvh bg-canvas lg:grid lg:transition-[grid-template-columns] lg:duration-200 lg:ease-out motion-reduce:transition-none", collapsed ? "lg:grid-cols-[64px_minmax(0,1fr)]" : "lg:grid-cols-[248px_minmax(0,1fr)]")}>
      <a href="#contenu" className="sr-only z-[60] rounded-full bg-surface px-4 py-2 text-sm font-medium text-ink ring-2 ring-primary focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        Aller au contenu
      </a>
      <aside className="hidden h-dvh lg:sticky lg:top-0 lg:block" aria-label="Barre latérale">
        {sidebar("rail")}
      </aside>

      {/* Tiroir mobile : toujours monté, déplacé hors écran et inerte quand il est fermé. */}
      <div className={cn("fixed inset-0 z-50 lg:hidden", !open && "pointer-events-none")} aria-hidden={!open}>
        <div
          className={cn("absolute inset-0 bg-ink/40 transition-opacity duration-200 ease-out motion-reduce:transition-none", open ? "opacity-100" : "opacity-0")}
          onClick={() => closeDrawer()}
          aria-hidden
        />
        <div
          ref={drawerRef}
          role="dialog"
          aria-modal="true"
          aria-label="Menu de la console"
          inert={!open}
          className={cn(
            "absolute inset-y-0 left-0 w-[284px] max-w-[85vw] shadow-[var(--shadow-lg)] transition-transform duration-[260ms] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
            open ? "translate-x-0" : "-translate-x-full",
          )}
        >
          {sidebar("drawer")}
        </div>
      </div>

      <div className="flex min-h-dvh min-w-0 flex-col">
        <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-line bg-canvas/85 px-3 backdrop-blur-xl sm:px-6">
          <button
            ref={triggerRef}
            type="button"
            className="inline-flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-surface-2 lg:hidden"
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? "Fermer le menu" : "Ouvrir le menu"}
            aria-expanded={open}
          >
            <Menu className="size-5" aria-hidden />
          </button>
          <nav aria-label="Fil d'Ariane" className="min-w-0 flex-1">
            <ol className="flex items-center gap-1.5 text-sm">
              <li className="hidden text-ink-faint sm:block">Console</li>
              {current && (
                <>
                  <li className="hidden text-ink-faint sm:block" aria-hidden>/</li>
                  <li className="truncate font-medium text-ink">
                    {pathname === current.href ? <span aria-current="page">{current.label}</span> : <Link href={current.href} className="hover:text-primary">{current.label}</Link>}
                  </li>
                </>
              )}
            </ol>
          </nav>
          {roleLabel && <span className="hidden rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-ink-muted ring-1 ring-inset ring-line sm:inline-flex">{roleLabel}</span>}
          <UserMenu name={user.name} email={user.email} isAdmin compact />
        </header>

        {mfaWarning && (
          <div className="border-b border-warning/25 bg-warning-soft px-4 py-2.5 sm:px-6" role="status">
            <div className="mx-auto flex w-full max-w-[1280px] flex-wrap items-center gap-x-3 gap-y-1 text-sm text-warning">
              <ShieldAlert className="size-4 shrink-0" aria-hidden />
              <p className="min-w-0 flex-1">
                <span className="font-semibold">Double authentification non activée.</span><span className="hidden sm:inline"> Elle est obligatoire pour l'équipe plateforme : sans elle, la console se limite à la page Équipe et sécurité.</span>
              </p>
              <Link href="/admin/equipe#securite" className="inline-flex min-h-9 items-center gap-1 font-semibold underline-offset-4 hover:underline pointer-coarse:min-h-11">
                <span>Activer<span className="hidden sm:inline"> maintenant</span></span>
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </div>
          </div>
        )}

        <main id="contenu" tabIndex={-1} className="flex-1 px-4 py-6 outline-none sm:px-6 lg:px-10 lg:py-8">
          <div className="mx-auto w-full max-w-[1280px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
