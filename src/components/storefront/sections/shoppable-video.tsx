import { S } from "@/lib/storefront/theme-doc";
import { waLink } from "@/lib/whatsapp";
import { formatMoney } from "@/lib/money";
import { viewCompareAt, viewCurrency, viewPrice } from "@/lib/storefront/currency-view";
import type { CardProduct } from "@/lib/storefront/render-types";
import type { SectionProps } from "../render-context";
import { SectionHeading, SectionShell } from "../ui";
import { ShoppableBody, type TaggedItem } from "../live/shoppable-body";
import { fallbackVisual } from "./hero-banner";

/**
 * Vidéo achetable (lot 4 §17, équipe CAN). Le serveur prépare les produits étiquetés (prix dans la devise
 * d'affichage, lien WhatsApp prérempli, ajout direct possible) ; le lecteur et la mise en avant du produit
 * courant vivent dans un seul composant client (`ShoppableBody`).
 *
 * Sans vidéo lisible, la section affiche la couverture et la liste des produits : rien ne disparaît.
 * Section masquée si aucun produit n'est étiqueté et qu'aucune couverture n'est disponible.
 */

/** Fichier vidéo lisible par `<video>` : MP4 ou WebM en https (YouTube et Vimeo ne le sont pas). */
export function isDirectVideoUrl(v: string | null | undefined): v is string {
  return typeof v === "string" && /^https:\/\/[^\s<>"']+\.(mp4|webm)(\?[^\s<>"']*)?$/i.test(v);
}

/** Fichier de sous-titres : `.vtt` en https ou média de la boutique. */
function captionsUrl(v: string): string | null {
  if (!v) return null;
  if (/^https:\/\/[^\s<>"']+\.vtt(\?[^\s<>"']*)?$/i.test(v)) return v;
  return /^\/[\w\-./]+\.vtt$/i.test(v) ? v : null;
}

export default function ShoppableVideo({ section, ctx }: SectionProps) {
  const st = section.settings;
  const data = ctx.data;
  const store = data.store;
  const view = data.currency;
  const currency = viewCurrency(view);
  const quickAddAllowed = ctx.settings.cards.quickAdd && !store.closed;

  const items: TaggedItem[] = [];
  for (const b of section.blocks) {
    if (b.disabled || b.type !== "tagged_product") continue;
    const p: CardProduct | undefined = data.products[S.str(b.settings, "product")];
    if (!p || items.some((i) => i.id === p.id)) continue;
    const price = viewPrice(view, p.price, p.simple ? p.id : null);
    const compare = viewCompareAt(view, p.compareAt, price, p.simple ? p.id : null);
    items.push({
      id: p.id,
      slug: p.slug,
      name: p.name,
      priceLabel: `${p.range ? "À partir de " : ""}${formatMoney(price, currency)}`,
      compareLabel: compare != null ? formatMoney(compare, currency) : null,
      image: p.images[0]?.url ?? null,
      at: Math.max(0, Math.round(S.num(b.settings, "at", 0))),
      note: S.str(b.settings, "note").slice(0, 60),
      soldOut: p.soldOut,
      quickAdd: quickAddAllowed && p.simple && !p.soldOut,
      line: { productId: p.id, variantId: null, optionIds: [], quantity: p.minQty, snapshot: { name: p.name, variantName: null, unitPrice: p.unitPrice, image: p.images[0]?.url ?? null, productSlug: p.slug } },
      waHref:
        store.whatsappOrdering && store.whatsappNumber
          ? waLink(store.whatsappNumber, `Bonjour ${store.name}, je voudrais commander « ${p.name} » (${formatMoney(price, currency)}).`)
          : null,
    });
  }
  items.sort((a, b) => a.at - b.at);

  const video = S.str(st, "video");
  const poster = S.img(st, "poster") ?? fallbackVisual(ctx);
  if (!items.length && !poster) return null;

  const heading = S.str(st, "heading", "Vu dans la vidéo");
  return (
    <SectionShell section={section} ctx={ctx}>
      <SectionHeading section={section} ctx={ctx} fallback="Vu dans la vidéo" />
      <ShoppableBody
        src={isDirectVideoUrl(video) ? video : null}
        poster={poster?.url ?? null}
        autoplay={S.bool(st, "autoplay", true)}
        loop={S.bool(st, "loop", true)}
        captions={captionsUrl(S.str(st, "captions"))}
        label={heading || "vidéo de la boutique"}
        items={items}
        slug={store.slug}
        base={ctx.base}
        addLabel={store.copy.addLabel}
        side={S.str(st, "layout", "side") === "side"}
        ratio={S.str(st, "ratio", "portrait")}
      />
    </SectionShell>
  );
}
