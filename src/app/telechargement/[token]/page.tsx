import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Download, FileDown, LinkIcon, PackageSearch, Store as StoreIcon } from "lucide-react";
import { loadGrantByToken } from "@/lib/digital/service";
import { downloadsLabel, formatFileSize, grantProblemMessage, grantState } from "@/lib/digital/rules";
import { resolveTheme, themeCssVars, STORE_LIGHT_TOKENS } from "@/lib/storefront/theme";
import { formatDate, formatDateTime } from "@/lib/utils";
import { Logo } from "@/components/ui/logo";
import { Avatar } from "@/components/ui/misc";
import { StoreStyles } from "@/components/storefront/store-styles";

/**
 * Page publique de téléchargement (vague 2), sur le modèle de `/suivi/[token]` : hors `/s/**`, sans compte,
 * accès par JETON (256 bits, seule son empreinte HMAC est en base). Jamais indexée.
 *
 * Elle n'expose aucune URL de stockage : chaque bouton pointe vers
 * `/telechargement/{jeton}/fichier/{assetId}`, qui vérifie le jeton, l'expiration, la limite et le débit,
 * puis relaie le fichier depuis le stockage objet.
 */
export const metadata: Metadata = { title: "Vos fichiers", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const card = "rounded-[var(--store-card-radius)] bg-surface p-5 ring-1 ring-line sm:p-6";

export default async function DownloadPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const grant = await loadGrantByToken(token);

  if (!grant) {
    return (
      <Shell vars={STORE_LIGHT_TOKENS as React.CSSProperties}>
        <div className="flex flex-col items-center rounded-[var(--radius-xl)] bg-surface px-6 py-14 text-center ring-1 ring-line">
          <span className="mb-5 inline-flex size-14 items-center justify-center rounded-full bg-surface-2 text-ink">
            <PackageSearch className="size-6" aria-hidden />
          </span>
          <h1 className="text-xl font-semibold tracking-[-0.02em] text-ink">Lien de téléchargement introuvable</h1>
          <p className="mt-2 max-w-[42ch] text-sm text-ink-muted">
            Vérifiez le lien reçu : il doit être copié en entier, sans espace. Si votre commande a été annulée ou remboursée, le lien ne fonctionne plus.
          </p>
          <Link href="/" className="mt-6 inline-flex h-12 items-center rounded-full bg-primary px-6 text-sm font-semibold text-on-primary">
            Aller sur Axi
          </Link>
        </div>
      </Shell>
    );
  }

  const theme = resolveTheme(grant.storeThemeId, grant.storeThemeConfig as never);
  const vars = { ...STORE_LIGHT_TOKENS, ...themeCssVars(theme) } as React.CSSProperties;
  const storeVisible = grant.storeStatus === "PUBLISHED" || grant.storeStatus === "CLOSED_TEMPORARILY";
  const now = new Date();
  const state = grantState(grant, now);
  const problem = grantProblemMessage(state);

  return (
    <Shell vars={vars} store={{ name: grant.storeName, logoUrl: grant.storeLogoUrl, slug: storeVisible ? grant.storeSlug : "" }}>
      <header className="sf-rise">
        <p className="text-sm text-ink-muted">Commande {grant.reference}</p>
        <h1 className="mt-1 text-[clamp(1.5rem,4.6vw,2rem)] font-semibold tracking-[-0.02em] text-ink">Vos fichiers</h1>
        <p className="mt-1 text-[15px] text-ink-muted">{grant.itemName}</p>
      </header>

      {problem && (
        <div className={`${card} mt-6 flex items-start gap-3`} role="alert">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
          <div>
            <p className="text-sm font-semibold text-ink">Téléchargement indisponible</p>
            <p className="mt-1 text-sm text-ink-muted">{problem}</p>
          </div>
        </div>
      )}

      <section className={`${card} mt-4`} aria-labelledby="files-title">
        <h2 id="files-title" className="flex items-center gap-2 text-base font-semibold text-ink">
          <FileDown className="size-5 text-[var(--store-primary)]" aria-hidden /> {grant.files.length} fichier{grant.files.length > 1 ? "s" : ""}
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          {downloadsLabel(grant, now)}
          {grant.expiresAt ? ` · lien valable jusqu'au ${formatDate(grant.expiresAt, { day: "numeric", month: "long", year: "numeric" })}` : " · sans date limite"}
        </p>
        {grant.files.length === 0 ? (
          <p className="mt-4 rounded-[12px] bg-surface-2 px-4 py-3 text-sm text-ink">
            Aucun fichier n&apos;est disponible pour le moment. La boutique les met en ligne : revenez avec ce lien dans quelques instants.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-line">
            {grant.files.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{f.name}</p>
                  <p className="text-xs text-ink-muted">
                    {formatFileSize(f.bytes)}
                    {f.version > 1 ? ` · version ${f.version}` : ""}
                  </p>
                </div>
                {state.usable ? (
                  <a
                    href={`/telechargement/${encodeURIComponent(token)}/fichier/${f.id}`}
                    className="inline-flex h-12 shrink-0 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-on-primary transition-transform active:scale-[0.98]"
                    download
                  >
                    <Download className="size-4" aria-hidden /> Télécharger
                  </a>
                ) : (
                  <span className="inline-flex h-12 shrink-0 items-center rounded-full bg-surface-2 px-5 text-sm font-semibold text-ink-muted">Indisponible</span>
                )}
              </li>
            ))}
          </ul>
        )}
        {grant.lastDownloadAt && <p className="mt-4 text-xs text-ink-muted">Dernier téléchargement : {formatDateTime(grant.lastDownloadAt)}.</p>}
      </section>

      {grant.instructions && (
        <section className={`${card} mt-4`} aria-labelledby="instr-title">
          <h2 id="instr-title" className="text-base font-semibold text-ink">
            À savoir
          </h2>
          <p className="mt-2 whitespace-pre-line text-sm text-ink-muted">{grant.instructions}</p>
        </section>
      )}

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Link
          href={`/suivi/${grant.trackingToken}`}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-surface px-6 text-sm font-semibold text-ink ring-1 ring-inset ring-line-strong hover:bg-surface-2"
        >
          <LinkIcon className="size-4" aria-hidden /> Suivi de ma commande
        </Link>
        {storeVisible && (
          <Link
            href={`/s/${grant.storeSlug}`}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-surface px-6 text-sm font-semibold text-ink ring-1 ring-inset ring-line-strong hover:bg-surface-2"
          >
            <StoreIcon className="size-4" aria-hidden /> Voir la boutique
          </Link>
        )}
      </div>
    </Shell>
  );
}

function Shell({ children, store, vars }: { children: React.ReactNode; store?: { name: string; logoUrl: string | null; slug: string }; vars: React.CSSProperties }) {
  return (
    <div data-store="telechargement" data-theme="light" style={vars} className="flex min-h-dvh flex-col bg-canvas text-ink">
      <StoreStyles />
      <header className="sticky top-0 z-30 border-b border-line/70 bg-surface/85 backdrop-blur-xl">
        <div className="container-x flex h-16 max-w-[720px] items-center justify-between gap-4">
          {store ? (
            store.slug ? (
              <Link href={`/s/${store.slug}`} className="flex min-w-0 items-center gap-2.5 text-[15px] font-semibold text-ink">
                <Avatar name={store.name} src={store.logoUrl} size={34} className="rounded-[10px] bg-[var(--store-primary-soft)] text-[var(--store-primary)]" />
                <span className="truncate">{store.name}</span>
              </Link>
            ) : (
              <span className="flex min-w-0 items-center gap-2.5 text-[15px] font-semibold text-ink">
                <Avatar name={store.name} src={store.logoUrl} size={34} className="rounded-[10px]" />
                <span className="truncate">{store.name}</span>
              </span>
            )
          ) : (
            <Logo size={26} />
          )}
          <span className="shrink-0 text-xs text-ink-muted">Téléchargement</span>
        </div>
      </header>
      <main className="container-x w-full max-w-[720px] flex-1 pb-12 pt-8">{children}</main>
      <footer className="container-x flex max-w-[720px] flex-wrap items-center justify-between gap-3 border-t border-line py-5 text-xs text-ink-muted">
        <span>Lien personnel : ne le partagez pas, chaque téléchargement est compté.</span>
        <Link href="/" className="inline-flex min-h-10 items-center gap-1.5 hover:text-ink">
          Propulsé par Axi
        </Link>
      </footer>
    </div>
  );
}
