import { getCurrentUser } from "@/lib/auth/session";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { RevealObserver } from "@/components/marketing/reveal";

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  return (
    <>
      {/* Sans JavaScript, le contenu « .reveal » reste visible. */}
      <noscript>
        <style>{`.reveal{opacity:1!important;transform:none!important;filter:none!important}`}</style>
      </noscript>
      <a href="#contenu" className="sr-only z-[70] rounded-full bg-ink px-4 py-2 text-sm font-medium text-canvas focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        Aller au contenu
      </a>
      <SiteHeader loggedIn={!!user} homeHref={user?.isPlatformAdmin ? "/admin" : "/app"} homeLabel={user?.isPlatformAdmin ? "Administration" : "Mon espace"} />
      <main id="contenu" tabIndex={-1} className="pt-24 outline-none">
        {children}
      </main>
      <SiteFooter />
      <RevealObserver />
    </>
  );
}
