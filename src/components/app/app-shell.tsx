"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard, Package, ShoppingBag, Users, Ticket, Truck, MessageCircle, CreditCard, Palette, UserPlus, Receipt, Settings,
  Menu, ExternalLink, Rocket, ChevronsUpDown, Globe, Zap, Search, Filter, Megaphone, Gift, Star, Undo2, FileText, Smartphone, Coins, Languages,
  Plus, Store as StoreIcon, Check, MoreHorizontal, Home, Sparkles, PanelLeftClose, PanelLeftOpen, X, Bell, Share2, LayoutGrid, ListTree, Boxes, Bot, WalletCards, Blocks, type LucideIcon, Clapperboard } from "lucide-react";
import { Newspaper } from "lucide-react"; // Lot 2 (équipe Blog)
import { CalendarClock, FlaskConical } from "lucide-react"; // Lot 4 §11 et §13 (équipe EXP)
import { Download as DownloadIcon, Radio } from "lucide-react"; // Lot 4D §14 et §18 (équipe CAN)
import { Warehouse, Calculator } from "lucide-react"; // Lot 3 §1.1 et §2 (équipe OPS)
import type { MembershipRole } from "@prisma/client";
import { AxiMark } from "@/components/ui/logo";
import { UserMenu } from "@/components/app/user-menu";
import { NotificationBell } from "@/components/app/notification-bell";
import { Avatar, Kbd } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Sheet } from "@/components/ui/sheet";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Tooltip } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownItem, DropdownLabel, DropdownSeparator } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { activeNavHref, navItemMatches } from "./nav-active";

type NavItem = { href: string; label: string; icon: LucideIcon; roles?: MembershipRole[]; count?: number; tag?: string; exact?: boolean };
type NavGroup = { title: string; items: NavItem[] };

type Usage = { used: number; limit: number | null };

const MGR: MembershipRole[] = ["OWNER", "MANAGER"];
const CATALOG: MembershipRole[] = ["OWNER", "MANAGER", "SUPPORT"];

/* Repli de la barre latérale (ordinateur).
 * L'état vit sur <html data-sidebar="collapsed"> : le script anti-flash du layout racine le pose avant
 * le premier rendu (aucun saut de mise en page au chargement), il est mémorisé dans localStorage
 * et toute la mise en forme repliée est en CSS (SHELL_CSS). */
const SIDEBAR_KEY = "axi-sidebar";
const SIDEBAR_EVENT = "axi-sidebar-change";
const readCollapsed = () => document.documentElement.dataset.sidebar === "collapsed";
const subscribeCollapsed = (cb: () => void) => {
  window.addEventListener(SIDEBAR_EVENT, cb);
  return () => window.removeEventListener(SIDEBAR_EVENT, cb);
};
function setCollapsed(next: boolean) {
  const root = document.documentElement;
  if (next) root.dataset.sidebar = "collapsed";
  else delete root.dataset.sidebar;
  try {
    if (next) localStorage.setItem(SIDEBAR_KEY, "collapsed");
    else localStorage.removeItem(SIDEBAR_KEY);
  } catch {}
  window.dispatchEvent(new Event(SIDEBAR_EVENT));
}

const SHELL_CSS = `
.axi-plan-mini{display:none}
.axi-tip{display:none}
@media (min-width:1024px){
  .axi-shell{grid-template-columns:260px minmax(0,1fr);transition:grid-template-columns 240ms cubic-bezier(0.32,0.72,0,1)}
  html[data-sidebar=collapsed] .axi-shell{grid-template-columns:64px minmax(0,1fr)}
  .axi-aside .axi-fade{transition:opacity 160ms cubic-bezier(0.23,1,0.32,1)}
  html[data-sidebar=collapsed] .axi-aside .axi-fade{opacity:0;pointer-events:none}
  .axi-aside .axi-dot{opacity:0;transition:opacity 160ms ease-out}
  html[data-sidebar=collapsed] .axi-aside .axi-dot{opacity:1}
  html[data-sidebar=collapsed] .axi-aside .axi-plan-full{display:none}
  html[data-sidebar=collapsed] .axi-aside .axi-plan-mini{display:inline-flex}
  html[data-sidebar=collapsed] .axi-tip{display:block}
}
@media (prefers-reduced-motion:reduce){.axi-shell,.axi-aside .axi-fade,.axi-aside .axi-dot{transition:none}}
`;

export function AppShell({
  user,
  store,
  stores,
  role,
  plan,
  counts,
  usage,
  children,
}: {
  user: { name: string; email: string; isAdmin: boolean };
  store: { id: string; name: string; slug: string; status: string; logoUrl: string | null; onboardingCompleted: boolean };
  stores: { id: string; name: string; slug: string; logoUrl?: string | null }[];
  role: MembershipRole;
  plan: { id: string; name: string; trialDaysLeft: number | null; pastDue?: boolean; paused?: boolean };
  counts?: { newOrders: number; unread: number; returns?: number };
  usage?: { orders: Usage; products: Usage };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);
  const collapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false);
  const toggleCollapsed = useCallback(() => setCollapsed(!readCollapsed()), []);
  const [tip, setTip] = useState<{ label: string; top: number } | null>(null);
  const base = `/app/${store.id}`;
  const newOrders = counts?.newOrders ?? 0;
  const unread = counts?.unread ?? 0;

  // Ferme le tiroir à chaque navigation (ajustement pendant le rendu, sans effet).
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setDrawer(false);
  }

  // Raccourci « [ » : replie / déplie la barre latérale (ordinateur, hors champ de saisie).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "[" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      if (!window.matchMedia("(min-width: 1024px)").matches) return;
      e.preventDefault();
      toggleCollapsed();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [toggleCollapsed]);

  // Le tiroir mobile n'a plus de raison d'être ouvert si la fenêtre passe en largeur ordinateur.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = () => {
      if (mq.matches) setDrawer(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const groups: NavGroup[] = [
    {
      title: "Vendre",
      items: [
        ...(!store.onboardingCompleted ? [{ href: `${base}/demarrage`, label: "Démarrage", icon: Rocket, tag: "À finir", roles: MGR }] : []),
        { href: base, label: "Tableau de bord", icon: LayoutDashboard, exact: true },
        { href: `${base}/commandes`, label: "Commandes", icon: ShoppingBag, count: newOrders },
        { href: `${base}/retours`, label: "Retours", icon: Undo2, count: counts?.returns ?? 0, roles: ["OWNER", "MANAGER", "STAFF"] },
        { href: `${base}/conversations`, label: "Conversations", icon: MessageCircle, count: unread, roles: ["OWNER", "MANAGER", "STAFF"] },
        { href: `${base}/entonnoir`, label: "Entonnoir", icon: Filter, roles: MGR },
        { href: `${base}/produits`, label: "Produits", icon: Package, roles: CATALOG },
        { href: `${base}/collections`, label: "Collections", icon: LayoutGrid, roles: CATALOG },
        { href: `${base}/produits/stock`, label: "Inventaire", icon: Boxes, roles: CATALOG },
        { href: `${base}/depots`, label: "Dépôts", icon: Warehouse, roles: CATALOG, tag: "Nouveau" },
        // La barre latérale mène à la page de RÉGLAGE ET DE SUIVI, dans l'espace marchand : l'écran de
        // vente plein écran (`/caisse/[storeId]`) s'ouvre depuis un bouton explicite, jamais par surprise.
        { href: `${base}/caisse`, label: "Caisse", icon: Calculator, roles: ["OWNER", "MANAGER", "STAFF"], tag: "Nouveau" },
        { href: `${base}/clients`, label: "Clients", icon: Users, roles: CATALOG },
        { href: `${base}/notifications`, label: "Notifications", icon: Bell },
      ],
    },
    {
      title: "Marketing",
      items: [
        { href: `${base}/campagnes`, label: "Campagnes", icon: Megaphone, roles: MGR },
        { href: `${base}/promotions`, label: "Codes promo", icon: Ticket, roles: MGR },
        { href: `${base}/fidelite`, label: "Fidélité", icon: Gift, roles: MGR },
        { href: `${base}/cartes-cadeaux`, label: "Cartes cadeaux", icon: WalletCards, roles: MGR },
        { href: `${base}/avis`, label: "Avis", icon: Star, roles: MGR },
        { href: `${base}/automatisations`, label: "Automatisations", icon: Zap, roles: MGR },
      ],
    },
    {
      title: "Boutique",
      items: [
        { href: `${base}/apparence`, label: "Apparence", icon: Palette, roles: MGR },
        { href: `${base}/apparence/programmations`, label: "Thèmes programmés", icon: CalendarClock, roles: MGR, tag: "Nouveau" },
        { href: `${base}/apparence/tests`, label: "Tests A/B", icon: FlaskConical, roles: MGR, tag: "Nouveau" },
        { href: `${base}/apparence/pwa`, label: "Installation et notifications", icon: DownloadIcon, roles: MGR, tag: "Nouveau" },
        { href: `${base}/live`, label: "Direct", icon: Radio, roles: MGR, tag: "Nouveau" },
        { href: `${base}/pages`, label: "Pages", icon: FileText, roles: MGR },
        { href: `${base}/blog`, label: "Blog", icon: Newspaper, roles: MGR },
        { href: `${base}/navigation`, label: "Navigation", icon: ListTree, roles: MGR },
        { href: `${base}/partager`, label: "Partager", icon: Share2, roles: MGR },
        { href: `${base}/livraison`, label: "Livraison", icon: Truck, roles: MGR },
        { href: `${base}/paiements`, label: "Paiements", icon: CreditCard, roles: ["OWNER"] },
        { href: `${base}/parametres/taxes`, label: "Taxes et factures", icon: Receipt, roles: MGR },
        { href: `${base}/devises`, label: "Devises", icon: Coins, roles: MGR },
        { href: `${base}/langues`, label: "Langues", icon: Languages, roles: MGR, tag: "Nouveau" },
        { href: `${base}/whatsapp`, label: "WhatsApp", icon: Smartphone, roles: MGR },
        { href: `${base}/integrations/whatsapp-catalogue`, label: "Catalogue WhatsApp", icon: Boxes, roles: MGR, tag: "Nouveau" },
        { href: `${base}/integrations/tiktok-shop`, label: "TikTok Shop", icon: Clapperboard, roles: MGR, tag: "Nouveau" },
        { href: `${base}/integrations/ia`, label: "Connecteurs IA", icon: Bot, roles: MGR, tag: "Nouveau" },
        { href: `${base}/applications`, label: "Applications", icon: Blocks, roles: MGR, tag: "Nouveau" },
        { href: `${base}/developpeurs`, label: "Développeurs", icon: Users, roles: ["OWNER"], tag: "Nouveau" },
        { href: `${base}/developpeur`, label: "Espace développeur", icon: Rocket, tag: "Nouveau" }, // Apps v2 (équipe DEV)
        { href: `${base}/integrations/webhooks`, label: "Webhooks et API", icon: Zap, roles: ["OWNER"], tag: "Nouveau" },
        { href: `${base}/domaine`, label: "Domaine", icon: Globe, roles: ["OWNER"] },
      ],
    },
    {
      title: "Compte",
      items: [
        { href: `${base}/equipe`, label: "Équipe", icon: UserPlus, roles: ["OWNER"] },
        { href: `${base}/abonnement`, label: "Abonnement", icon: Receipt, roles: ["OWNER"] },
        { href: `${base}/options`, label: "Options et crédits", icon: Coins, roles: ["OWNER"] },
        { href: `${base}/parametres`, label: "Paramètres", icon: Settings, roles: MGR },
      ],
    },
  ];

  const visible = groups
    .map((g) => ({ ...g, items: g.items.filter((i) => !i.roles || i.roles.includes(role)) }))
    .filter((g) => g.items.length);

  // Menu latéral : un seul élément actif, le plus précis (évite « Paramètres » + « Taxes et factures » à la fois).
  const activeHref = activeNavHref(pathname, visible.flatMap((g) => g.items));
  const isNavActive = (i: Pick<NavItem, "href">) => i.href === activeHref;
  const isActive = (i: Pick<NavItem, "href" | "exact">) => navItemMatches(pathname, i);

  const storeUrl = `/s/${store.slug}`;
  const published = store.status === "PUBLISHED";

  const showTip = (label: string, el: HTMLElement) => {
    if (!collapsed) return;
    const r = el.getBoundingClientRect();
    setTip({ label, top: r.top + r.height / 2 });
  };
  const hideTip = () => setTip(null);

  const renderSidebar = (inDrawer: boolean) => {
    const tipProps = (label: string) =>
      inDrawer
        ? {}
        : {
            onPointerEnter: (e: React.PointerEvent<HTMLElement>) => showTip(label, e.currentTarget),
            onPointerLeave: hideTip,
            onFocus: (e: React.FocusEvent<HTMLElement>) => showTip(label, e.currentTarget),
            onBlur: hideTip,
          };
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center gap-1 px-3 pt-3">
          <div className="min-w-0 flex-1">
            <StoreSwitcher store={store} stores={stores} storeUrl={storeUrl} published={published} />
          </div>
          {inDrawer && (
            <button
              type="button"
              onClick={() => setDrawer(false)}
              aria-label="Fermer le menu"
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <X className="size-5" aria-hidden />
            </button>
          )}
        </div>

        <nav
          className="scrollbar-none mt-3 min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-3 pb-4"
          aria-label="Navigation principale"
          onScroll={hideTip}
        >
          {visible.map((g) => (
            <div key={g.title}>
              <p className="axi-fade mb-1 truncate whitespace-nowrap px-2.5 text-[11px] font-medium tracking-[0.02em] text-ink-muted">{g.title}</p>
              <ul className="space-y-px">
                {g.items.map((i) => {
                  const active = isNavActive(i);
                  const count = i.count ?? 0;
                  return (
                    <li key={i.href}>
                      <Link
                        href={i.href}
                        aria-current={active ? "page" : undefined}
                        onClick={() => {
                          hideTip();
                          if (inDrawer) setDrawer(false);
                        }}
                        {...tipProps(i.label)}
                        className={cn(
                          "group relative flex items-center gap-2.5 overflow-hidden rounded-[10px] px-[11px] text-[13.5px] font-medium transition-colors duration-150",
                          inDrawer ? "h-11" : "h-9",
                          active ? "bg-surface text-ink shadow-[0_1px_2px_rgb(var(--c-shadow)/0.08),0_0_0_1px_var(--c-line)]" : "text-ink-muted hover:bg-surface-2 hover:text-ink",
                        )}
                      >
                        <span className="relative inline-flex shrink-0">
                          <i.icon className={cn("size-[18px] transition-colors", active ? "text-primary" : "text-ink-faint group-hover:text-ink-muted")} aria-hidden />
                          {(count > 0 || i.tag) && <span className="axi-dot absolute -right-1 -top-1 size-2 rounded-full bg-accent ring-2 ring-canvas" aria-hidden />}
                        </span>
                        <span className="axi-fade min-w-0 flex-1 truncate whitespace-nowrap">{i.label}</span>
                        {i.tag && <Badge tone="accent" className="axi-fade shrink-0 whitespace-nowrap px-2 text-[11px] leading-[18px]">{i.tag}</Badge>}
                        {count > 0 && (
                          <span className="axi-fade tabular inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold leading-5 text-on-accent">
                            {count > 99 ? "99+" : count}
                            <span className="sr-only">{(i.href.endsWith("conversations") ? " non lue" : " nouvelle") + (count > 1 ? "s" : "")}</span>
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="shrink-0 p-3 pt-0">
          <div className="axi-plan-full">
            <PlanCard base={base} plan={plan} usage={usage} canBill={role === "OWNER"} />
          </div>
          {!inDrawer && role === "OWNER" && (
            <Link
              href={`${base}/abonnement`}
              aria-label={`Plan ${plan.name}, gérer l'abonnement`}
              {...tipProps(`Plan ${plan.name}`)}
              className="axi-plan-mini size-10 items-center justify-center rounded-[12px] bg-surface text-primary ring-1 ring-line transition-colors hover:bg-surface-2"
            >
              <Sparkles className="size-[18px]" aria-hidden />
            </Link>
          )}
        </div>
      </div>
    );
  };

  const tabs: (NavItem & { onClick?: () => void })[] = [
    { href: base, label: "Accueil", icon: Home, exact: true },
    { href: `${base}/commandes`, label: "Commandes", icon: ShoppingBag, count: newOrders },
    { href: `${base}/conversations`, label: "Messages", icon: MessageCircle, count: unread },
    { href: `${base}/produits`, label: "Produits", icon: Package },
  ];

  return (
    <div className="axi-shell min-h-dvh bg-canvas lg:grid">
      <style>{SHELL_CSS}</style>
      <a href="#contenu" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[80] focus:rounded-full focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-[var(--shadow-md)]">
        Aller au contenu
      </a>

      <aside className="axi-aside z-30 hidden h-dvh min-w-0 border-r border-line bg-canvas lg:sticky lg:top-0 lg:block" aria-label="Barre latérale">
        {renderSidebar(false)}
      </aside>

      {/* Infobulle de la barre repliée : position fixe, pour ne pas être rognée par la zone qui défile. */}
      {collapsed && tip && (
        <span
          aria-hidden
          className="axi-tip pointer-events-none fixed left-[72px] z-[70] -translate-y-1/2 whitespace-nowrap rounded-[10px] bg-ink px-2.5 py-1.5 text-xs font-medium text-canvas shadow-[var(--shadow-md)]"
          style={{ top: tip.top }}
        >
          {tip.label}
        </span>
      )}

      <Sheet open={drawer} onClose={() => setDrawer(false)} title="Menu" side="left" hideHeader className="bg-canvas">
        {renderSidebar(true)}
      </Sheet>

      <div className="flex min-h-dvh min-w-0 flex-col">
        <header className="sticky top-0 z-40 border-b border-line bg-canvas/85 backdrop-blur-xl">
          <div className="flex h-14 items-center gap-2 px-3 sm:px-5 lg:px-6">
            <button
              type="button"
              className="inline-flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-surface-2 hover:text-ink lg:hidden"
              onClick={() => setDrawer(true)}
              aria-label="Ouvrir le menu"
              aria-expanded={drawer}
            >
              <Menu className="size-5" aria-hidden />
            </button>
            <Tooltip content={<span className="inline-flex items-center gap-1.5">{collapsed ? "Déplier le menu" : "Replier le menu"} <Kbd>[</Kbd></span>} side="bottom" className="left-0 translate-x-0">
              <button
                type="button"
                onClick={toggleCollapsed}
                aria-label={collapsed ? "Déplier le menu latéral" : "Replier le menu latéral"}
                aria-expanded={!collapsed}
                aria-keyshortcuts="["
                className="-ml-1 hidden size-9 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink lg:inline-flex"
              >
                {collapsed ? <PanelLeftOpen className="size-[18px]" aria-hidden /> : <PanelLeftClose className="size-[18px]" aria-hidden />}
              </button>
            </Tooltip>
            <Link href={base} className="mr-1 shrink-0 lg:hidden" aria-label={`${store.name}, tableau de bord`}>
              <AxiMark size={28} />
            </Link>

            <GlobalSearch base={base} />

            <div className="ml-auto flex items-center gap-1.5">
              {!published && (
                <Link href={`${base}/demarrage`} className="hidden md:inline-flex">
                  <Badge tone="sun" dot>
                    {store.status === "DRAFT" ? "Non publiée" : store.status === "SUSPENDED" ? "Suspendue" : "Fermée"}
                  </Badge>
                </Link>
              )}
              <Link
                href={storeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hidden h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-ink-muted ring-1 ring-inset ring-line transition-colors hover:bg-surface hover:text-ink sm:inline-flex"
              >
                Voir ma boutique <ExternalLink className="size-3.5" aria-hidden />
                <span className="sr-only">(nouvel onglet)</span>
              </Link>
              <NotificationBell storeId={store.id} />
              <ThemeToggle className="hidden xl:inline-flex" />
              <UserMenu name={user.name} email={user.email} isAdmin={user.isAdmin} compact />
            </div>
          </div>
        </header>

        <main id="contenu" tabIndex={-1} className="flex-1 px-4 pb-28 pt-5 focus:outline-none sm:px-6 lg:px-8 lg:pb-12 lg:pt-7">
          <div className="mx-auto w-full max-w-[1240px]">{children}</div>
        </main>
      </div>

      {/* Barre d'onglets inférieure (mobile) */}
      <nav
        aria-label="Navigation rapide"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
      >
        <ul className="mx-auto grid max-w-md grid-cols-5">
          {tabs.map((t) => {
            const active = isActive(t);
            return (
              <li key={t.href}>
                <Link
                  href={t.href}
                  aria-current={active ? "page" : undefined}
                  className={cn("relative flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors", active ? "text-ink" : "text-ink-muted")}
                >
                  <span className={cn("relative inline-flex h-7 w-12 items-center justify-center rounded-full transition-colors duration-200", active && "bg-primary-soft")}>
                    <t.icon className={cn("size-5", active ? "text-primary" : "")} aria-hidden />
                    {!!t.count && t.count > 0 && (
                      <span className="tabular absolute -right-0.5 -top-1 min-w-[18px] rounded-full bg-accent px-1 text-center text-[10px] font-semibold leading-[18px] text-on-accent ring-2 ring-surface">
                        {t.count > 99 ? "99+" : t.count}
                      </span>
                    )}
                  </span>
                  {t.label}
                  {!!t.count && t.count > 0 && <span className="sr-only">, {t.count} en attente</span>}
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={() => setDrawer(true)}
              aria-expanded={drawer}
              className="flex h-16 w-full flex-col items-center justify-center gap-1 text-[11px] font-medium text-ink-muted"
            >
              <span className="inline-flex h-7 w-12 items-center justify-center rounded-full">
                <MoreHorizontal className="size-5" aria-hidden />
              </span>
              Plus
            </button>
          </li>
        </ul>
      </nav>
    </div>
  );
}

/* ───────────────────────── Sélecteur de boutique ───────────────────────── */

function StoreSwitcher({
  store,
  stores,
  storeUrl,
  published,
}: {
  store: { id: string; name: string; slug: string; logoUrl: string | null };
  stores: { id: string; name: string; slug: string; logoUrl?: string | null }[];
  storeUrl: string;
  published: boolean;
}) {
  return (
    <DropdownMenu
      align="start"
      label="Boutiques"
      className="w-[236px]"
      wrapperClassName="flex w-full"
      trigger={(p) => (
        <button
          {...p}
          aria-label={`Boutique ${store.name}, changer de boutique`}
          className="group flex h-12 w-full min-w-0 items-center gap-2.5 overflow-hidden rounded-[14px] px-1 text-left transition-colors hover:bg-surface-2 aria-expanded:bg-surface-2"
        >
          {store.logoUrl ? (
            <Avatar name={store.name} src={store.logoUrl} size={32} className="rounded-[10px]" />
          ) : (
            <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-forest text-[13px] font-semibold text-lime" aria-hidden>
              {store.name.trim().charAt(0).toUpperCase() || "B"}
            </span>
          )}
          <span className="axi-fade min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-ink">{store.name}</span>
            <span className="flex items-center gap-1.5 text-xs text-ink-muted">
              <span className={cn("size-1.5 rounded-full", published ? "bg-primary" : "bg-sun")} aria-hidden />
              {published ? "En ligne" : "Non publiée"}
            </span>
          </span>
          <ChevronsUpDown className="axi-fade size-4 shrink-0 text-ink-faint" aria-hidden />
        </button>
      )}
    >
      <DropdownLabel>Vos boutiques</DropdownLabel>
      {stores.map((s) => (
        <DropdownItem key={s.id} href={`/app/${s.id}`} icon={s.id === store.id ? Check : StoreIcon}>
          {s.name}
        </DropdownItem>
      ))}
      <DropdownSeparator />
      <DropdownItem href={storeUrl} icon={ExternalLink} external>
        Voir ma boutique
      </DropdownItem>
      <DropdownItem href="/app/nouvelle-boutique" icon={Plus}>
        Nouvelle boutique
      </DropdownItem>
    </DropdownMenu>
  );
}

/* ───────────────────────── Carte plan + usage ───────────────────────── */

function PlanCard({
  base,
  plan,
  usage,
  canBill,
}: {
  base: string;
  plan: { id: string; name: string; trialDaysLeft: number | null; pastDue?: boolean; paused?: boolean };
  usage?: { orders: Usage; products: Usage };
  canBill: boolean;
}) {
  const content = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-semibold text-ink">{plan.id === "FREE" ? "Aucun plan actif" : `Plan ${plan.name}`}</span>
        {plan.paused ? (
          <Badge tone="warning">En pause</Badge>
        ) : plan.pastDue ? (
          <Badge tone="danger">Impayé</Badge>
        ) : plan.trialDaysLeft != null ? (
          <Badge tone="sun">Essai, {plan.trialDaysLeft} j</Badge>
        ) : null}
      </div>
      {usage && (
        <div className="mt-3 space-y-2.5">
          <Progress size="sm" label="Commandes ce mois" showValue value={usage.orders.used} max={usage.orders.limit} />
          <Progress size="sm" label="Produits" showValue value={usage.products.used} max={usage.products.limit} />
        </div>
      )}
      {canBill && (
        <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary">
          <Sparkles className="size-3.5" aria-hidden />
          {plan.id === "FREE" || plan.trialDaysLeft != null ? "Choisir un plan" : "Gérer l'abonnement"}
        </span>
      )}
    </>
  );
  const cls = "bezel block !rounded-[18px] !p-[3px] [&>div]:!rounded-[15px]";
  if (!canBill) {
    return (
      <div className={cls}>
        <div className="bezel-core p-3">{content}</div>
      </div>
    );
  }
  return (
    <Link href={`${base}/abonnement`} className={cn(cls, "transition-transform duration-150 ease-out active:scale-[0.99]")}>
      <div className="bezel-core p-3">{content}</div>
    </Link>
  );
}

/* ───────────────────────── Recherche globale ───────────────────────── */

function GlobalSearch({ base }: { base: string }) {
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");

  // « / » ou Ctrl/Cmd+K : focus sur la recherche (hors champ de saisie)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName);
      if ((e.key === "/" && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k")) {
        e.preventDefault();
        ref.current?.focus();
        ref.current?.select();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <form
      role="search"
      className="relative min-w-0 max-w-md flex-1"
      onSubmit={(e) => {
        e.preventDefault();
        const v = q.trim();
        if (v) router.push(`${base}/recherche?q=${encodeURIComponent(v)}`);
      }}
    >
      <label htmlFor="global-search" className="sr-only">
        Rechercher une commande, un client ou un produit
      </label>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-faint" aria-hidden />
      {/*
        Avertissement d'hydratation signalé ici : aucun écart côté code (rendu serveur et client identiques, vérifié sans
        extension). Il venait d'attributs injectés dans le champ avant l'hydratation par l'outil de navigation
        (`style="caret-color: transparent"`), comme le font aussi des extensions (gestionnaires de mots de passe,
        correcteurs). Ce champ étant présent sur toutes les pages marchandes, on ignore ces écarts d'attributs (ce
        seul élément, pas ses enfants).
      */}
      <input
        suppressHydrationWarning
        ref={ref}
        id="global-search"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Rechercher"
        autoComplete="off"
        enterKeyHint="search"
        className="h-10 w-full rounded-full border-0 bg-surface pl-10 pr-12 text-base sm:text-sm text-ink ring-1 ring-inset ring-line placeholder:text-ink-faint transition-shadow duration-150 hover:ring-line-strong focus:outline-none focus:ring-2 focus:ring-primary [&::-webkit-search-cancel-button]:hidden"
      />
      <span className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 sm:block" aria-hidden>
        <Kbd>/</Kbd>
      </span>
    </form>
  );
}
