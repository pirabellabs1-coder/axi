import "server-only";
import { notFound } from "next/navigation";
import { canPreviewStore, getStorefront } from "@/lib/storefront/data";
import { cartLinesSnapshot, getThemeDocument, loadRenderData } from "@/lib/theme-engine/resolve";
import { TEMPLATE_IDS } from "@/lib/storefront/theme-doc";
import { loadCartDraft } from "@/lib/carts/actions";
import { db } from "@/lib/db";
import { effectivePlanId } from "@/lib/auth/permissions";
import type { RenderData } from "@/lib/storefront/render-types";
import { loadPromotions, loadShopper } from "./lot1-data";
import type { TemplateId, ThemeDocument } from "@/lib/theme-engine/types";
import { parseTemplateKey, resolveTemplate, templateKey } from "@/lib/theme-engine/alternates";
import { applyScheduledTheme } from "@/lib/theme-schedules/storefront"; // Lot 4 §11 (équipe EXP)
import { applyExperiments } from "@/lib/experiments/storefront"; // Lot 4 §13 (équipe EXP)
import { ExperimentRuntime } from "@/components/experiments/experiment-runtime"; // Lot 4 §13 (équipe EXP)
import { requestCurrencyPicker } from "@/lib/storefront/currency-context";
import { loadRenderMetafields, loadTemplateSuffix, requestAudience, requestMotionEnv } from "./lot4-data";
import { localizeStorefront } from "@/lib/i18n/resolve";
import { LivePreview } from "./live-preview";
import { StoreFrame } from "./store-frame";
import { TemplateRenderer } from "./template-renderer";

export type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Aperçu demandé (`?preview=1`) ET visiteur membre de la boutique. */
export async function isPreview(storeId: string, sp: SP): Promise<boolean> {
  return first(sp.preview) === "1" && (await canPreviewStore(storeId));
}

/**
 * Page de la boutique rendue par le moteur de sections. En aperçu (membres), le modèle peut être forcé par
 * `?template=` (données d'exemple si besoin) et le rendu passe par l'îlot client `LivePreview`.
 */
export async function StorefrontView({ slug, template, searchParams = {}, productSlug, collectionHandle, pageSlug }: { slug: string; template: TemplateId; searchParams?: SP; productSlug?: string; collectionHandle?: string; pageSlug?: string }) {
  const sf = await getStorefront(slug);
  if (!sf) notFound();
  const { store } = sf;
  const preview = await isPreview(store.id, searchParams);
  // Aperçu : `?template=product` ou clé de modèle alternatif `?template=product:luxe` (lot 4 §6).
  const requestedKey = preview ? parseTemplateKey(first(searchParams.template)) : null;
  const requested = requestedKey?.base;
  const tpl: TemplateId = preview && template === "home" && requested && TEMPLATE_IDS.includes(requested) ? requested : template;
  const baseDoc = getThemeDocument(store, { preview: preview || !!sf.preview?.draft });
  // Lot 4 §11 (équipe EXP) : thème programmé actif à l'instant de la requête, ou à la date demandée en aperçu (`?at=`).
  const scheduled = await applyScheduledTheme(store, baseDoc, { now: new Date(), preview, at: searchParams.at });
  // Lot 4 §6 : modèle alternatif de l'élément (suffixe en base), ou celui demandé par l'aperçu de l'éditeur.
  const item = await loadTemplateSuffix(store.id, tpl, { productSlug, collectionHandle, pageSlug });
  const suffix = requestedKey?.base === tpl && requestedKey.suffix ? requestedKey.suffix : item.suffix;
  // Lot 4 §13 (équipe EXP) : variante du test A/B affectée à ce visiteur (déterministe, recalculée côté serveur).
  const experiments = await applyExperiments(store, { doc: scheduled.doc, templateKey: templateKey(tpl, suffix), preview, searchParams });
  const doc = experiments.doc;
  const resolved = resolveTemplate(doc, tpl, suffix);
  // Les réglages lus par loadRenderData (avis, référence, produits par page) viennent du modèle réellement rendu.
  const dataDoc: ThemeDocument = resolved.suffix ? { ...doc, templates: { ...doc.templates, [tpl]: resolved.template } } : doc;
  const data = await loadRenderData(store, dataDoc, { template: tpl, searchParams, productSlug, collectionHandle, pageSlug, sample: preview }, { unpublished: !!sf.preview?.unpublished });
  if (!data) notFound();

  // Lien de relance de panier abandonné : /s/{slug}?panier={jeton}
  const token = first(searchParams.panier);
  if (tpl === "home" && token && !preview) {
    const r = await loadCartDraft(store.slug, token);
    data.restoredCart = r.ok ? { token, lines: await cartLinesSnapshot(store.id, r.items) } : { error: r.error };
  }

  await withLot1Data(store, data, { preview });
  await (await import("@/lib/blog/render-data")).withBlogData(store, doc, tpl, data, { preview }); // Lot 2 (équipe Blog) : « Derniers articles », aperçu blog/article

  // Lot 4 : champs personnalisés publics (sources dynamiques, caractéristiques), audience, animations.
  const now = new Date(data.now);
  const [metafields, audience, motionEnv, currency] = await Promise.all([
    loadRenderMetafields(store.id, data, { pageId: item.pageId }),
    preview ? Promise.resolve(null) : requestAudience(store, { now }),
    requestMotionEnv(),
    preview ? Promise.resolve(null) : requestCurrencyPicker(store).catch(() => null),
  ]);
  data.metafields = metafields;

  if (preview) return <LivePreview initialDoc={doc} template={tpl} data={data} templateSuffix={suffix} motionEnv={motionEnv} />;
  // Lot 2 §1.1 (langues) : langue de l'URL (`x-axi-locale`), textes traduits dans `data`, liens préfixés,
  // champs texte du thème localisés. En langue principale, `doc` et `data` ressortent inchangés.
  const { doc: viewDoc } = await localizeStorefront(store, doc, data);
  return (
    <StoreFrame doc={viewDoc} data={data} motionEnv={motionEnv} currency={currency} template={tpl}>
      <TemplateRenderer doc={viewDoc} template={tpl} data={data} templateSuffix={resolved.suffix} audience={audience} motionEnv={motionEnv} />
      {experiments.runtime && <ExperimentRuntime slug={store.slug} {...experiments.runtime} />}
    </StoreFrame>
  );
}

type StorefrontStore = NonNullable<Awaited<ReturnType<typeof getStorefront>>>["store"];

/**
 * Lot 1 : acheteur connecté (icône Compte, favoris), carte cadeau de la fiche, offres et remises automatiques.
 * Ajouts optionnels de `RenderData` : les sections les ignorent quand ils sont absents.
 */
async function withLot1Data(store: StorefrontStore, data: RenderData, opts: { preview: boolean }) {
  if (data.product) {
    const p = await db.product.findFirst({ where: { id: data.product.id, storeId: store.id }, select: { isGiftCard: true } });
    data.product.isGiftCard = !!p?.isGiftCard;
  }
  const ref = { id: store.id, slug: store.slug, accountsEnabled: store.accountsEnabled, currency: store.currency, timezone: store.timezone };
  const [shopper, promotions] = await Promise.all([loadShopper(ref, opts), loadPromotions({ ...ref, planId: effectivePlanId(store.subscription) }, data)]);
  data.shopper = shopper;
  data.promotions = promotions;
}

/** Cadre seul (commande, confirmation) : thème publié, en-tête et pied de page réduits. */
export async function StoreChrome({ slug, children, minimal = true }: { slug: string; children: React.ReactNode; minimal?: boolean }) {
  const sf = await getStorefront(slug);
  if (!sf) notFound();
  const doc = getThemeDocument(sf.store, { preview: !!sf.preview?.draft });
  const data = await loadRenderData(sf.store, doc, { template: null }, { unpublished: !!sf.preview?.unpublished });
  if (!data) notFound();
  if (!minimal) await withLot1Data(sf.store, data, { preview: false });
  // Lot 2 §1.1 : commande et confirmation dans la langue de l'URL.
  const { doc: viewDoc } = await localizeStorefront(sf.store, doc, data);
  return (
    <StoreFrame doc={viewDoc} data={data} minimal={minimal}>
      {children}
    </StoreFrame>
  );
}
