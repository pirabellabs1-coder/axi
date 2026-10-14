import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Heart, MapPin, Package, UserRound } from "lucide-react";
import { getStorefront } from "@/lib/storefront/data";
import { getBuyer } from "@/lib/buyer/session";
import { getAccountSettings, getBuyerKillSwitch } from "@/lib/buyer/settings";
import { getCountry } from "@/config/site";
import { AccountCard, AccountShell } from "@/components/storefront/account/account-shell";
import { LoginForm } from "@/components/storefront/account/login-form";
import { AccountDisabled } from "@/components/storefront/account/account-disabled";

export const metadata: Metadata = { title: "Connexion à votre compte", robots: { index: false, follow: false } };

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function BuyerLoginPage({ params, searchParams }: Props) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const sf = await getStorefront(slug);
  if (!sf) notFound();
  const store = sf.store;
  if (store.status !== "PUBLISHED" && store.status !== "CLOSED_TEMPORARILY") notFound();

  const base = `/s/${store.slug}`;
  const rawNext = first(sp.next);
  const next = rawNext && rawNext.startsWith(`${base}/`) && !rawNext.includes("//") ? rawNext : undefined;

  if (!store.accountsEnabled) return <AccountDisabled slug={store.slug} />;

  if (await getBuyer(store)) redirect(next ?? `${base}/compte`);

  const [settings, kill] = await Promise.all([getAccountSettings(store.id), getBuyerKillSwitch()]);
  const dialCode = getCountry(store.country).dialCode;
  const loggedOut = first(sp.deconnecte) === "1";
  const deleted = first(sp.suppression) === "1";

  return (
    <AccountShell
      slug={store.slug}
      hideNav
      title="Votre compte client"
      description={settings.welcomeText || `Retrouvez vos commandes, vos adresses et vos favoris chez ${store.name}, sans mot de passe.`}
    >
      <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_300px] md:items-start">
        <AccountCard className="sf-rise">
          {deleted && (
            <p role="status" className="mb-5 rounded-[12px] bg-surface-2 px-4 py-3 text-sm text-ink">
              Votre demande de suppression a été transmise à {store.name}. Vous avez été déconnecté de tous vos appareils.
            </p>
          )}
          {loggedOut && !deleted && (
            <p role="status" className="mb-5 rounded-[12px] bg-surface-2 px-4 py-3 text-sm text-ink">
              Vous avez été déconnecté de tous vos appareils.
            </p>
          )}
          {kill.enabled ? (
            <p role="alert" className="rounded-[12px] bg-sun-soft px-4 py-3 text-sm text-ink">
              {kill.message || "La connexion aux comptes clients est momentanément indisponible. Vous pouvez toujours commander sans compte."}
            </p>
          ) : (
            <LoginForm slug={store.slug} dialCode={dialCode} next={next} />
          )}
        </AccountCard>

        <aside aria-label="Avantages du compte" className="rounded-[var(--store-card-radius,20px)] bg-surface-2 p-5 sm:p-6">
          <p className="text-sm font-semibold text-ink">Avec votre compte</p>
          <ul className="mt-4 space-y-3.5 text-sm text-ink-muted">
            {[
              { icon: Package, text: "Suivez vos commandes et recommandez en un geste." },
              { icon: MapPin, text: "Enregistrez vos adresses de livraison." },
              { icon: Heart, text: "Gardez vos produits favoris." },
              { icon: UserRound, text: "Utilisez vos points et votre avoir." },
            ].map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3">
                <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-surface text-[var(--store-primary)] ring-1 ring-line">
                  <Icon className="size-4" aria-hidden />
                </span>
                <span className="pt-1.5">{text}</span>
              </li>
            ))}
          </ul>
          <p className="mt-5 text-[13px] leading-relaxed text-ink-muted">La commande sans compte reste toujours possible.</p>
        </aside>
      </div>
    </AccountShell>
  );
}
