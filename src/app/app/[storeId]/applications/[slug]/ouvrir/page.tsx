import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Settings2, AppWindow } from "lucide-react";
import { getStoreContext } from "@/lib/auth/permissions";
import { getActiveInstallationBySlug } from "@/lib/apps/queries";
import { createSessionToken } from "@/lib/apps/session-token";
import { appBaseUrl } from "@/lib/mcp/runtime";
import { EmptyState } from "@/components/ui/misc";
import { AppIcon } from "../../app-visuals";

/**
 * Application embarquée : `app.appUrl` dans un iframe sous l'en-tête Axi, avec `shop`, `host` et un jeton de
 * session court (5 min, HMAC propre à l'app) que l'app valide sur POST /api/apps/session/verify.
 * Contrat : docs/apps-v2/int.md §5. Rendu dynamique, jamais mis en cache (le jeton est dans le HTML).
 *
 * Sûreté : iframe sandboxé (pas de navigation du parent, pas de modales bloquantes), `referrerPolicy=no-referrer`,
 * aucune permission matérielle. Les cookies d'Axi (HttpOnly, SameSite=Lax, origine Axi) ne sont jamais lisibles ni
 * envoyés par l'app, d'une autre origine. La CSP de cette seule route autorise frame-src https: (next.config.ts).
 */

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Application", referrer: "no-referrer" };

/**
 * URL de l'iframe : appUrl + shop + host + session (paramètres existants conservés). Refuse la propre origine d'Axi :
 * `allow-scripts` + `allow-same-origin` sur du contenu de même origine annuleraient le sandbox.
 */
function embedUrl(appUrl: string, params: { shop: string; host: string; session: string }): string | null {
  try {
    const u = new URL(appUrl);
    if (u.origin === new URL(params.host).origin) return null;
    if (u.protocol !== "https:" && !(u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1"))) return null;
    u.searchParams.set("shop", params.shop);
    u.searchParams.set("host", params.host);
    u.searchParams.set("session", params.session);
    return u.toString();
  } catch {
    return null;
  }
}

export default async function OpenAppPage({ params }: { params: Promise<{ storeId: string; slug: string }> }) {
  const { storeId, slug } = await params;
  const ctx = await getStoreContext(storeId, "store.view");
  const base = `/app/${storeId}/applications`;
  if (!/^[a-z0-9-]{2,64}$/.test(slug)) notFound();

  const install = await getActiveInstallationBySlug(storeId, slug);
  if (!install) notFound();
  const app = install.app;

  const src = app.appUrl && app.status !== "SUSPENDED"
    ? embedUrl(app.appUrl, {
        shop: ctx.store.slug,
        host: appBaseUrl(),
        session: createSessionToken({
          iss: appBaseUrl(),
          aud: app.oauthClientId ?? app.id,
          appId: app.id,
          shop: ctx.store.slug,
          storeId,
          userId: ctx.user.id,
        }).token,
      })
    : null;

  return (
    <div className="flex flex-col">
      <div className="mb-3 flex min-h-11 flex-wrap items-center gap-x-3 gap-y-2">
        <Link href={base + "?vue=mes-apps"} className="inline-flex min-h-11 items-center gap-1.5 rounded-full pr-2 text-sm font-medium text-ink-muted transition-colors hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden /> Mes applications
        </Link>
        <span className="hidden h-5 w-px bg-line sm:block" aria-hidden />
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <AppIcon name={app.name} iconUrl={app.iconUrl} category={app.category} size={28} />
          <h1 className="truncate text-base font-semibold tracking-tight text-ink">{app.name}</h1>
        </div>
        <Link
          href={`${base}/${app.slug}`}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-ink-muted ring-1 ring-inset ring-line transition-colors hover:text-ink hover:ring-line-strong"
        >
          <Settings2 className="size-4" aria-hidden /> Gérer
        </Link>
      </div>

      {src ? (
        <iframe
          key={src}
          src={src}
          title={`Application ${app.name}`}
          sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads"
          referrerPolicy="no-referrer"
          allow=""
          loading="eager"
          className="h-[calc(100dvh-13rem)] min-h-[480px] w-full rounded-[var(--radius-lg)] border border-line bg-surface lg:h-[calc(100dvh-9.5rem)]"
        />
      ) : (
        <EmptyState
          icon={AppWindow}
          title={app.status === "SUSPENDED" ? "Application suspendue" : "Cette application n'a pas d'interface dans Axi"}
          description={
            app.status === "SUSPENDED"
              ? "Axi a suspendu cette application : elle n'a plus accès à votre boutique. Vous pouvez la désinstaller depuis sa fiche."
              : "Elle fonctionne en arrière-plan avec les autorisations accordées. Consultez sa fiche pour la gérer."
          }
          action={
            <Link href={`${base}/${app.slug}`} className="inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-sm font-medium text-on-primary hover:bg-primary-hover">
              Voir la fiche
            </Link>
          }
        />
      )}
    </div>
  );
}
