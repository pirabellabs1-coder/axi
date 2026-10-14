import { shareableImageUrl } from "@/lib/storage/public-url";
import { SYSTEM_FONT_STACK } from "@/lib/pwa/lite";
import { platformVapidKeys } from "@/lib/push/vapid";
import { pwaContextFor, requestHost, requestLite } from "@/lib/pwa/service";
import { PLANS } from "@/config/plans";
import { db } from "@/lib/db";
import { effectivePlanId } from "@/lib/billing/rules";
import { InstallPrompt } from "./install-prompt";
import { SwRegister } from "./sw-register";

/**
 * Entrée unique du lot 4D dans le document de la boutique (lot 4 §14 et §19), montée par
 * `src/app/s/[slug]/layout.tsx`. React hisse `<link>` et `<meta>` dans le `<head>`.
 *
 *  - manifeste et `theme-color` de la boutique (si la boutique est installable) ;
 *  - mode économie de données : police système imposée AVANT la première peinture (aucun téléchargement de
 *    police décorative), et marquage `Save-Data` pour le service worker ;
 *  - enregistrement du service worker et invitation discrète à l'installation ;
 *  - clé publique VAPID exposée aux composants client (elle n'est pas secrète, RFC 8292 §2).
 *
 * Rendu côté serveur uniquement : l'aperçu en direct de l'éditeur ne monte pas ce composant (il rend
 * `StoreFrame`, pas le layout), donc aucun service worker n'est enregistré depuis l'éditeur.
 */
export async function PwaHead({ slug }: { slug: string }) {
  const [ctx, { lite }] = await Promise.all([pwaContextFor(slug, await requestHost()), requestLite()]);
  const pushKey = await storePushKey(slug);
  const scope = ctx?.scope ?? `/s/${slug}/`;
  return (
    <>
      {ctx?.active && (
        <>
          <link rel="manifest" href={`${scope}manifest.webmanifest`} crossOrigin="use-credentials" />
          <meta name="theme-color" content={ctx.manifest.theme_color} />
          {ctx.config.icon192 && <link rel="apple-touch-icon" href={shareableImageUrl(ctx.config.icon192) ?? ctx.config.icon192} />}
          <meta name="apple-mobile-web-app-title" content={ctx.manifest.short_name} />
          <meta name="mobile-web-app-capable" content="yes" />
        </>
      )}
      {/* Lu par les composants client du pied de page (interrupteur d'économie, abonnement aux notifications). */}
      <meta name="axi-pwa" content={JSON.stringify({ slug, scope, sw: !!ctx?.active, lite, push: !!pushKey })} />
      {pushKey && <meta name="axi-push-key" content={pushKey} />}
      {lite && (
        // `!important` : les variables du thème sont posées en style en ligne sur la racine de la boutique
        // (themeCssVars) ; c'est la seule façon de les remplacer avant la première peinture, donc avant
        // qu'une police décorative ne soit téléchargée.
        <style>
          {`[data-store-root],[data-store]{--store-font:${SYSTEM_FONT_STACK} !important;--store-font-heading:${SYSTEM_FONT_STACK} !important;}`}
        </style>
      )}
      {ctx?.active && <SwRegister scope={scope} lite={lite} />}
      {ctx?.active && ctx.config.prompt && <InstallPrompt storeName={ctx.manifest.short_name} scope={scope} />}
    </>
  );
}

/** Clé publique VAPID, exposée uniquement si la boutique a le push à son plan et que la plateforme est configurée. */
async function storePushKey(slug: string): Promise<string | null> {
  const keys = platformVapidKeys();
  if (!keys) return null;
  const store = await db.store.findFirst({ where: { slug, status: { in: ["PUBLISHED", "CLOSED_TEMPORARILY"] } }, select: { subscription: true } });
  if (!store) return null;
  return PLANS[effectivePlanId(store.subscription)].features.webPush ? keys.publicKey : null;
}
