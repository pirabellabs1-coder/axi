import type { Metadata } from "next";
import Link from "next/link";
import { Search, Blocks, LayoutGrid, Check, ArrowRight, Settings2, Code2, AppWindow } from "lucide-react";
import { getStoreContext } from "@/lib/auth/permissions";
import { listCatalog, listStoreInstallations } from "@/lib/apps/queries";
import { APP_CATEGORIES, APP_CATEGORY_LABELS, formatAppPrice, isAppCategory } from "@/lib/apps/types";
import { formatBillingStatus } from "@/lib/apps/billing";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/field";
import { cn, formatDate } from "@/lib/utils";
import { AppIcon } from "./app-visuals";

export const metadata: Metadata = { title: "Applications" };

type SearchParams = { q?: string; categorie?: string; vue?: string };

export default async function AppStorePage({
  params,
  searchParams,
}: {
  params: Promise<{ storeId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { storeId } = await params;
  const sp = await searchParams;
  await getStoreContext(storeId, "store.view");
  const base = `/app/${storeId}/applications`;

  const q = sp.q?.trim() ?? "";
  const category = sp.categorie && isAppCategory(sp.categorie) ? sp.categorie : undefined;
  const tab = sp.vue === "mes-apps" ? "mes-apps" : "catalogue";

  const [catalog, installations] = await Promise.all([
    listCatalog({ q: q || undefined, category }),
    listStoreInstallations(storeId),
  ]);
  const activeInstalls = installations.filter((i) => i.status === "ACTIVE");
  const installedAppIds = new Set(activeInstalls.map((i) => i.appId));

  const buildHref = (next: Partial<SearchParams>) => {
    const u = new URLSearchParams();
    const vue = next.vue ?? (tab === "mes-apps" ? "mes-apps" : undefined);
    if (vue) u.set("vue", vue);
    const qq = next.q ?? q;
    if (qq) u.set("q", qq);
    const cat = next.categorie === "" ? undefined : (next.categorie ?? category);
    if (cat) u.set("categorie", cat);
    const s = u.toString();
    return s ? `${base}?${s}` : base;
  };

  return (
    <>
      <PageHeader
        title="Applications"
        description="Enrichissez votre boutique avec des applications : marketing, logistique, statistiques, intelligence artificielle. Installez en un clic, désinstallez quand vous voulez."
      />

      {/* Accès à l'espace développeur (créer sa propre app / inviter un développeur) */}
      <div className="mb-6 flex flex-col gap-3 rounded-[var(--radius-lg)] border border-line bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-[var(--radius-md)] bg-surface-2 text-ink" aria-hidden>
            <Code2 className="size-5" />
          </span>
          <div>
            <p className="text-sm font-medium text-ink">Vous créez des applications ?</p>
            <p className="text-sm text-ink-muted">Publiez votre propre application sur l'App Store, ou invitez un développeur à en créer une pour votre boutique.</p>
          </div>
        </div>
        <Link
          href={`/app/${storeId}/developpeur`}
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-full bg-surface px-5 text-sm font-medium text-ink ring-1 ring-inset ring-line-strong transition-colors hover:bg-surface-2"
        >
          Espace développeur <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>

      {/* Onglets Catalogue / Mes applications */}
      <div role="tablist" aria-label="Vue des applications" className="mb-6 flex gap-1 border-b border-line">
        <Link
          role="tab"
          aria-selected={tab === "catalogue"}
          href={buildHref({ vue: undefined })}
          className={cn(
            "relative -mb-px inline-flex min-h-11 items-center gap-2 px-3 text-sm font-medium transition-colors",
            tab === "catalogue" ? "border-b-2 border-primary text-ink" : "border-b-2 border-transparent text-ink-muted hover:text-ink",
          )}
        >
          <LayoutGrid className="size-4" aria-hidden /> Catalogue
        </Link>
        <Link
          role="tab"
          aria-selected={tab === "mes-apps"}
          href={buildHref({ vue: "mes-apps" })}
          className={cn(
            "relative -mb-px inline-flex min-h-11 items-center gap-2 px-3 text-sm font-medium transition-colors",
            tab === "mes-apps" ? "border-b-2 border-primary text-ink" : "border-b-2 border-transparent text-ink-muted hover:text-ink",
          )}
        >
          <Check className="size-4" aria-hidden /> Mes applications
          {activeInstalls.length > 0 && (
            <Badge tone="neutral" className="tabular">{activeInstalls.length}</Badge>
          )}
        </Link>
      </div>

      {tab === "mes-apps" ? (
        <section aria-label="Applications installées">
          {activeInstalls.length === 0 ? (
            <EmptyState
              icon={Blocks}
              title="Aucune application installée"
              description="Parcourez le catalogue pour trouver des applications qui font grandir votre boutique."
              action={
                <Link href={buildHref({ vue: undefined, q: "", categorie: "" })} className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-primary px-5 text-sm font-medium text-on-primary hover:bg-primary-hover">
                  Explorer le catalogue
                </Link>
              }
            />
          ) : (
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {activeInstalls.map((inst) => (
                <li key={inst.id} className="flex h-full flex-col rounded-[var(--radius-lg)] bg-surface p-4 ring-1 ring-line transition-shadow hover:ring-line-strong">
                  <div className="flex items-start gap-3.5">
                    <AppIcon name={inst.app.name} iconUrl={inst.app.iconUrl} category={inst.app.category} size={48} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate font-semibold text-ink">{inst.app.name}</span>
                        {inst.app.status === "SUSPENDED" && <Badge tone="warning">Suspendue</Badge>}
                      </span>
                      <span className="mt-0.5 block truncate text-sm text-ink-muted">{inst.app.tagline ?? inst.app.developerName}</span>
                      {inst.billingStatus && inst.billingStatus !== "none" && (
                        <span className="mt-1.5 block text-xs text-ink-muted">
                          Facturation : <span className="font-medium text-ink">{formatBillingStatus(inst.billingStatus)}</span>
                          {inst.billingStatus === "trialing" && inst.trialEndsAt ? ` · fin d'essai le ${formatDate(inst.trialEndsAt)}` : ""}
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {inst.app.appUrl && inst.app.status !== "SUSPENDED" && (
                      <a
                        href={`${base}/${inst.app.slug}/ouvrir`}
                        aria-label={`Ouvrir l'application ${inst.app.name}`}
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-medium text-on-primary transition-colors hover:bg-primary-hover"
                      >
                        {/* <a> et non <Link> : la CSP de /ouvrir (frame-src élargi) ne s’applique qu’au chargement complet du document. */}
                        <AppWindow className="size-4" aria-hidden /> Ouvrir
                      </a>
                    )}
                    <Link
                      href={`${base}/${inst.app.slug}`}
                      aria-label={`Gérer l'application ${inst.app.name}`}
                      className="group inline-flex min-h-11 items-center gap-1 rounded-full px-4 text-sm font-medium text-primary ring-1 ring-inset ring-line transition-colors hover:ring-line-strong"
                    >
                      <Settings2 className="size-3.5" aria-hidden /> Gérer
                      <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <section aria-label="Catalogue d'applications">
          {/* Recherche (GET, fonctionne sans JS) */}
          <form role="search" action={base} method="get" className="relative mb-4 max-w-md">
            {category && <input type="hidden" name="categorie" value={category} />}
            <label htmlFor="app-search" className="sr-only">Rechercher une application</label>
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-faint" aria-hidden />
            <Input
              id="app-search"
              name="q"
              type="search"
              defaultValue={q}
              placeholder="Rechercher une application"
              enterKeyHint="search"
              className="pl-10"
            />
          </form>

          {/* Filtres par catégorie */}
          <div className="mb-6 flex flex-wrap gap-2">
            <Link
              href={buildHref({ categorie: "" })}
              aria-current={!category ? "true" : undefined}
              className={cn(
                "inline-flex min-h-9 items-center rounded-full px-3.5 text-sm font-medium ring-1 ring-inset transition-colors",
                !category ? "bg-primary text-on-primary ring-primary" : "bg-surface text-ink-muted ring-line hover:text-ink hover:ring-line-strong",
              )}
            >
              Toutes
            </Link>
            {APP_CATEGORIES.map((c) => (
              <Link
                key={c.id}
                href={buildHref({ categorie: c.id })}
                aria-current={category === c.id ? "true" : undefined}
                className={cn(
                  "inline-flex min-h-9 items-center rounded-full px-3.5 text-sm font-medium ring-1 ring-inset transition-colors",
                  category === c.id ? "bg-primary text-on-primary ring-primary" : "bg-surface text-ink-muted ring-line hover:text-ink hover:ring-line-strong",
                )}
              >
                {c.label}
              </Link>
            ))}
          </div>

          {catalog.length === 0 ? (
            <EmptyState
              icon={Search}
              title="Aucune application trouvée"
              description={q ? `Aucun résultat pour « ${q} ».` : "Aucune application dans cette catégorie pour le moment."}
              action={
                (q || category) ? (
                  <Link href={base} className="inline-flex min-h-11 items-center rounded-full bg-surface px-5 text-sm font-medium text-ink ring-1 ring-inset ring-line-strong hover:bg-surface-2">
                    Réinitialiser
                  </Link>
                ) : undefined
              }
            />
          ) : (
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {catalog.map((app) => {
                const installed = installedAppIds.has(app.id);
                return (
                  <li key={app.id}>
                    <Link
                      href={`${base}/${app.slug}`}
                      className="group flex h-full flex-col rounded-[var(--radius-lg)] bg-surface p-4 ring-1 ring-line transition-shadow hover:ring-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                      <div className="flex items-start gap-3.5">
                        <AppIcon name={app.name} iconUrl={app.iconUrl} category={app.category} size={48} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <h3 className="truncate font-semibold text-ink">{app.name}</h3>
                            {installed ? (
                              <Badge tone="success" dot>Installée</Badge>
                            ) : app.pricingType !== "FREE" && app.priceAmount > 0 ? (
                              <Badge tone={app.pricingType === "SUBSCRIPTION" && app.trialDays > 0 ? "primary" : "neutral"}>
                                {app.pricingType === "SUBSCRIPTION" && app.trialDays > 0 ? "Essai" : "Payante"}
                              </Badge>
                            ) : null}
                          </div>
                          <p className="mt-0.5 text-xs text-ink-muted">{APP_CATEGORY_LABELS[isAppCategory(app.category) ? app.category : "autre"]}</p>
                        </div>
                      </div>
                      {app.tagline && <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-ink-muted">{app.tagline}</p>}
                      <p className="mt-3 pt-1 text-sm font-medium text-ink">
                        {formatAppPrice(app.pricingType, app.priceAmount, app.priceInterval, app.trialDays)}
                      </p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
