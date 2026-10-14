import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Info } from "lucide-react";
import { getPublicOrderByToken } from "@/lib/storefront/tracking";
import { getBuyerReturnView } from "@/lib/returns/buyer";
import { resolveTheme, themeCssVars, STORE_LIGHT_TOKENS } from "@/lib/storefront/theme";
import { formatDate } from "@/lib/utils";
import { Avatar } from "@/components/ui/misc";
import { StoreStyles } from "@/components/storefront/store-styles";
import { themeFontFamily } from "@/components/storefront/format";
import { ReturnRequestForm } from "@/app/s/[slug]/compte/retours/_components/return-request-form";
import { BuyerReturnList } from "@/app/s/[slug]/compte/retours/_components/return-list";

export const metadata: Metadata = { title: "Retourner des articles", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const card = "rounded-[var(--store-card-radius)] bg-surface p-5 ring-1 ring-line sm:p-6";

/** Retours d'une commande, accessibles par le jeton de suivi (preuve de possession, sans compte). */
export default async function TrackingReturnPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await getPublicOrderByToken(token);
  if (!found || found.expired) notFound();
  const { order } = found;
  const store = order.store;
  const view = await getBuyerReturnView(store.id, order.id);
  if (!view) notFound();

  const theme = resolveTheme(store.themeId, store.themeConfig);
  const fonts = themeFontFamily(theme.font);
  const vars = { ...STORE_LIGHT_TOKENS, ...themeCssVars(theme), "--store-font": fonts.body, "--store-font-heading": fonts.heading } as React.CSSProperties;
  const proof = { kind: "token" as const, token: order.trackingToken };

  return (
    <div data-store="suivi" data-theme="light" style={vars} className="flex min-h-dvh flex-col bg-canvas text-ink">
      <StoreStyles />
      <header className="sticky top-0 z-30 border-b border-line/70 bg-surface/85 backdrop-blur-xl">
        <div className="container-x flex h-16 max-w-[720px] items-center justify-between gap-4">
          <span className="flex min-w-0 items-center gap-2.5 text-[15px] font-semibold text-ink">
            <Avatar name={store.name} src={store.logoUrl} size={34} className="rounded-[10px]" />
            <span className="truncate">{store.name}</span>
          </span>
          <span className="shrink-0 text-xs text-ink-muted">Retours</span>
        </div>
      </header>
      <main className="container-x w-full max-w-[720px] flex-1 pb-12 pt-6">
        <Link href={`/suivi/${order.trackingToken}`} className="inline-flex min-h-11 items-center gap-1.5 text-sm text-ink-muted hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden /> Suivi de la commande
        </Link>
        <h1 className="mt-2 text-[clamp(1.5rem,5vw,2rem)] font-semibold tracking-[-0.02em] text-ink">Retourner des articles</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Commande <span className="font-mono font-medium text-ink">{order.reference}</span>
          {view.deadline ? ` · demande possible jusqu'au ${formatDate(view.deadline)}` : ""}
        </p>

        {view.returns.length > 0 && (
          <section className="mt-6" aria-labelledby="returns-title">
            <h2 id="returns-title" className="mb-3 text-base font-semibold text-ink">
              Vos demandes
            </h2>
            <BuyerReturnList returns={view.returns} currency={order.currency} proof={proof} instructions={view.policy.instructions} />
          </section>
        )}

        <section className={`${card} mt-6`} aria-labelledby="new-title">
          <h2 id="new-title" className="text-base font-semibold text-ink">
            {view.returns.length > 0 ? "Nouvelle demande" : "Votre demande"}
          </h2>
          {view.canRequest ? (
            <>
              <p className="mb-5 mt-1 text-sm text-ink-muted">
                {view.policy.returnShippingPaidBy === "customer" ? "Les frais de retour sont à votre charge." : "Les frais de retour sont pris en charge par la boutique."} Vous êtes prévenu à chaque étape.
              </p>
              <ReturnRequestForm
                slug={store.slug}
                proof={proof}
                items={view.items}
                currency={order.currency}
                resolutions={view.resolutions}
                requirePhotos={view.policy.requirePhotos}
              />
            </>
          ) : (
            <p className="mt-2 flex items-start gap-2 text-sm text-ink-muted">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              {!view.portalOpen
                ? "Cette boutique ne prend pas les demandes de retour en ligne. Contactez-la directement."
                : (view.eligibilityMessage ?? "Aucun article de cette commande ne peut faire l'objet d'une nouvelle demande.")}
            </p>
          )}
        </section>
      </main>
    </div>
  );
}
