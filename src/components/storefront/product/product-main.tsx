"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BadgePercent, Check, ChevronDown, ThumbsUp, Gift, Link2, MessageCircle, Minus, Plus, Share2, ShieldCheck, ShoppingBag, Store as StoreIcon, Truck, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import { viewCurrency, viewCompareAt, viewPlain, viewPrice, type CurrencyView } from "@/lib/storefront/currency-view";
import { waLink, buildCartMessage } from "@/lib/whatsapp";
import { S } from "@/lib/storefront/theme-doc";
import { changeSelection, findVariant, initialSelection, isPurchasable, valueStatus, type ProductOption } from "@/lib/storefront/variants";
import { BACKORDER_HINT, BACKORDER_LABEL } from "@/lib/inventory/policy";
import type { ProductPageData, PromotionsData, ShopperData, StoreInfo } from "@/lib/storefront/render-types";
import type { BlockInstance } from "@/lib/theme-engine/types";
import { cartActions, type GiftCardRecipientInput } from "../cart-store";
import { FavoriteButton } from "../account/favorite-button";
import { OfferList } from "../promotions/offer-list";
import { GiftCardForm, giftCardRecipientError, cleanRecipient } from "./gift-card-form";
import { CurrencyNotice } from "../ui";
import { RichText } from "../rich-text";
import { Stars } from "../stars";
import { ProductGallery, type GalleryStyle } from "./gallery";
import { StatusShare } from "../status-share"; // Lot 4D (CAN) §15 : partage en statut WhatsApp

type Props = {
  product: ProductPageData;
  store: StoreInfo;
  blocks: BlockInstance[];
  gallery: GalleryStyle;
  zoom: boolean;
  stickyInfo: boolean;
  stickyBar: boolean;
  showSku: boolean;
  showStock: boolean;
  showShare: boolean;
  cartType: "drawer" | "page";
  base: string;
  /** Lot 1 : favoris (comptes acheteurs) et promotions de la fiche. */
  shopper?: ShopperData;
  promotions?: PromotionsData;
  showFavorite?: boolean;
  /** Lot 2 (devises) : devise d'affichage de l'acheteur. Les prix reçus restent en devise boutique. */
  view?: CurrencyView | null;
};

/**
 * Fiche produit interactive : galerie + colonne d'informations dont les blocs suivent l'ordre choisi par le commerçant.
 * La variante sélectionnée met à jour prix, prix barré, SKU, stock, image et l'URL (?variante=, partageable).
 * Montants indicatifs : le serveur recalcule tout à la commande.
 */
export function ProductMain({ product, store, blocks, gallery, zoom, stickyInfo, stickyBar, showSku, showStock, showShare, cartType, base, shopper, promotions, showFavorite = false, view }: Props) {
  const router = useRouter();
  const options = product.options;
  const variants = product.variants;
  const [selection, setSelection] = useState(() => initialSelection(options, variants, product.trackStock, product.requestedVariantId));
  const [groupSel, setGroupSel] = useState<Record<string, string[]>>({});
  const [qty, setQty] = useState(product.minQty);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [barVisible, setBarVisible] = useState(false);
  const [recipient, setRecipient] = useState<GiftCardRecipientInput>({});
  const [recipientErrors, setRecipientErrors] = useState<Partial<Record<keyof GiftCardRecipientInput, string>>>({});
  const isGiftCard = !!product.isGiftCard;
  const buyRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const variant = findVariant(options, variants, selection);
  const hasVariants = variants.length > 0;

  // Images : photos du produit + photos de variantes / de valeurs d'option absentes de la liste.
  const images = useMemo(() => {
    const list = [...product.images];
    const add = (url: string | null | undefined) => url && !list.some((i) => i.url === url) && list.push({ url, alt: product.name });
    variants.forEach((v) => add(v.imageUrl));
    options.forEach((o) => o.values.forEach((v) => add(v.image)));
    return list;
  }, [product.images, product.name, variants, options]);
  const [active, setActive] = useState(() => {
    const v = findVariant(options, variants, initialSelection(options, variants, product.trackStock, product.requestedVariantId));
    const i = v?.imageUrl ? images.findIndex((x) => x.url === v.imageUrl) : -1;
    return i >= 0 ? i : 0;
  });
  const onActive = useCallback((i: number) => setActive(i), []);

  // Variante → image et URL partageable.
  useEffect(() => {
    const img = variant?.imageUrl ?? options.flatMap((o) => o.values.filter((v) => v.image && selection[o.name] === v.value).map((v) => v.image))[0];
    if (img) {
      const i = images.findIndex((x) => x.url === img);
      if (i >= 0) setActive(i);
    }
    if (!hasVariants) return;
    const url = new URL(window.location.href);
    if (variant) url.searchParams.set("variante", variant.id);
    else url.searchParams.delete("variante");
    url.searchParams.delete("variant"); // `?variant=` des flux catalogue : remplacé par `?variante=` une fois la fiche ouverte

    if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url.href);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant?.id, selection]);

  const groupDelta = product.optionGroups.reduce((s, g) => s + (groupSel[g.id] ?? []).reduce((t, id) => t + (g.options.find((o) => o.id === id)?.priceDelta ?? 0), 0), 0);
  const base0 = variant?.price ?? product.basePrice;
  const unitPrice = base0 + groupDelta;
  const compareRaw = variant ? (variant.compareAtPrice ?? (variant.price == null ? product.compareAt : null)) : product.compareAt;
  /*
   * Prix AFFICHÉS (lot 2, devises) : conversion arrondie du prix de base (ou prix fixé de la devise pour cet
   * article), suppléments d'options convertis au plus proche. Les montants envoyés au panier, à WhatsApp et aux
   * événements d'analyse restent en devise boutique : le serveur recalcule tout à la commande.
   */
  const fixedKey = variant?.id ?? product.id;
  const shownBase = viewPrice(view, base0, fixedKey);
  const shownDelta = groupDelta !== 0 ? viewPlain(view, groupDelta) : 0;
  const shownUnit = shownBase + shownDelta;
  const shownCompareBase = viewCompareAt(view, compareRaw && compareRaw > base0 ? compareRaw : null, shownBase, fixedKey);
  const shownCompare = shownCompareBase != null ? shownCompareBase + shownDelta : null;
  const displayCurrency = viewCurrency(view);
  const fm = (amount: number) => formatMoney(amount, displayCurrency);
  // Quantité exacte connue seulement si le thème affiche le stock ; sinon inStock / lowStock (le serveur contrôle à la commande).
  const stock = variant ? variant.stock : product.stock;
  const inStock = variant ? variant.inStock : product.inStock;
  const lowStock = variant ? variant.lowStock : product.lowStock;
  // « Continuer à vendre en cas de rupture » : achetable à zéro (précommande), quantité non plafonnée au stock.
  const continueSelling = hasVariants ? !!variant?.continueSelling : product.continueSelling;
  const combinationMissing = hasVariants && options.every((o) => selection[o.name]) && !variant;
  const canBuy = (v: { available: boolean; inStock: boolean }) => v.available && v.inStock;
  const purchasable = hasVariants ? !!variant && canBuy(variant) : product.inStock;
  const allSoldOut = hasVariants ? variants.every((v) => !canBuy(v)) : !purchasable;
  // Précommande : rupture vendue quand même, ou quantité demandée au-delà du stock affiché.
  const backorder = purchasable && ((hasVariants ? !!variant?.backorder : product.backorder) || (continueSelling && stock != null && qty > stock));
  const maxQty = Math.max(1, Math.min(product.maxQty ?? 999, product.trackStock && !continueSelling && stock != null ? Math.max(1, stock) : 999));
  const sku = variant?.sku ?? product.sku;
  const optionNames = product.optionGroups.flatMap((g) => (groupSel[g.id] ?? []).map((id) => g.options.find((o) => o.id === id)?.name ?? "").filter(Boolean));
  const disabled = store.closed || !purchasable;

  // Barre d'achat collante (mobile) : visible quand le bouton principal sort de l'écran.
  useEffect(() => {
    if (!stickyBar || !buyRef.current) return;
    const io = new IntersectionObserver(([e]) => setBarVisible(!e.isIntersecting && e.boundingClientRect.top < 0), { threshold: 0 });
    io.observe(buyRef.current);
    return () => io.disconnect();
  }, [stickyBar]);

  function validate(): { message: string; target?: string } | null {
    if (hasVariants && !variant) {
      const missing = options.find((o) => !selection[o.name]);
      return { message: missing ? `Choisissez : ${missing.name.toLowerCase()}.` : "Cette combinaison n'est pas disponible.", target: missing ? `opt-${slugId(missing.name)}` : undefined };
    }
    if (!purchasable) return { message: "Cet article est épuisé pour le moment." };
    for (const g of product.optionGroups) {
      const n = (groupSel[g.id] ?? []).length;
      if (g.required && n < Math.max(1, g.minSelect)) return { message: `Choisissez « ${g.name} ».`, target: `grp-${g.id}` };
      if (n > g.maxSelect) return { message: `Maximum ${g.maxSelect} pour « ${g.name} ».`, target: `grp-${g.id}` };
    }
    if (product.trackStock && !continueSelling && stock != null && qty > stock) return { message: `Il ne reste que ${stock} en stock.` };
    if (qty < product.minQty) return { message: `Minimum ${product.minQty}.` };
    if (isGiftCard) {
      const errs = giftCardRecipientError(recipient);
      setRecipientErrors(errs);
      const first = Object.keys(errs)[0];
      if (first) return { message: "Indiquez le destinataire de la carte cadeau.", target: `gc-${first}` };
    }
    return null;
  }

  function addToCart(opts: { open?: boolean } = {}): boolean {
    const err = validate();
    if (err) {
      setError(err.message);
      if (err.target) {
        const el = document.getElementById(err.target);
        el?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.focus({ preventScroll: true });
      }
      return false;
    }
    setError(null);
    cartActions(store.slug).add(
      {
        productId: product.id,
        variantId: variant?.id ?? null,
        optionIds: product.optionGroups.flatMap((g) => groupSel[g.id] ?? []),
        quantity: qty,
        snapshot: { name: product.name, variantName: variant?.name ?? null, unitPrice, image: images[active]?.url ?? images[0]?.url ?? null, productSlug: product.slug, optionNames, ...(isGiftCard ? { isGiftCard: true } : {}), ...(product.productKind && product.productKind !== "PHYSICAL" ? { kind: product.productKind } : {}) },
        ...(isGiftCard ? { giftCard: cleanRecipient(recipient) } : {}),
      },
      { open: opts.open ?? cartType === "drawer" },
    );
    window.dispatchEvent(new CustomEvent("axi:add-to-cart", { detail: { id: product.id, name: product.name, value: unitPrice * qty, currency: store.currency, quantity: qty } }));
    setAdded(true);
    setAnnounce(`${qty} × ${product.name} ajouté au panier.`);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setAdded(false), 1800);
    return true;
  }

  function buyNow() {
    if (addToCart({ open: false })) router.push(`${base}/commander`);
  }

  const variantLabel = variant?.name ?? Object.values(selection).join(" / ");
  const waHref =
    store.whatsappOrdering && store.whatsappNumber && !store.closed && purchasable
      ? waLink(
          store.whatsappNumber,
          buildCartMessage({ storeName: store.name, items: [{ name: product.name, variantName: [variantLabel, ...optionNames].filter(Boolean).join(", ") || null, quantity: qty, lineTotal: unitPrice * qty }], currency: store.currency, total: unitPrice * qty }),
        )
      : null;

  const badge = allSoldOut ? (
    <span className="rounded-full bg-ink/85 px-3 py-1 text-xs font-semibold text-canvas">Épuisé</span>
  ) : backorder ? (
    <span className="rounded-full bg-ink/85 px-3 py-1 text-xs font-semibold text-canvas">{BACKORDER_LABEL}</span>
  ) : shownCompare ? (
    <span className="rounded-full bg-[var(--store-accent)] px-3 py-1 text-xs font-semibold tabular text-[var(--store-accent-contrast)]">-{Math.round(((shownCompare - shownUnit) / shownCompare) * 100)} %</span>
  ) : null;

  const addLabel = store.booking ? "Réserver" : backorder ? "Précommander" : isGiftCard ? "Offrir cette carte" : "Ajouter au panier";
  // Lot 1, documents antérieurs : blocs insérés automatiquement s'ils sont absents du thème (un bloc présent mais
  // masqué par le commerçant reste masqué). Carte cadeau : destinataire avant les boutons d'achat ; remises
  // automatiques après le prix ; « Souvent achetés ensemble » après les boutons.
  const has = (t: string) => blocks.some((b) => b.type === t);
  const autoForm = isGiftCard && !has("gift_card_form");
  const autoBadges = !has("discount_badges") && (promotions?.productBadges.length ?? 0) > 0;
  const autoOffers = !has("complementary") && (promotions?.productOffers.length ?? 0) > 0;
  const visible = blocks
    .filter((b) => !b.disabled)
    .flatMap((b): BlockInstance[] => {
      if (b.type === "buy_buttons") return [...(autoForm ? [{ id: "auto-gift-card-form", type: "gift_card_form", settings: {} }] : []), b, ...(autoOffers ? [{ id: "auto-complementary", type: "complementary", settings: {} }] : [])];
      if (b.type === "price" && autoBadges) return [b, { id: "auto-discount-badges", type: "discount_badges", settings: {} }];
      return [b];
    });
  const favorite = showFavorite && shopper?.accountsEnabled ? <FavoriteButton slug={store.slug} productId={product.id} productName={product.name} initial={shopper.favoriteIds.includes(product.id)} loggedIn={shopper.loggedIn} className="shadow-none" /> : null;

  const renderBlock = (b: BlockInstance): React.ReactNode => {
    switch (b.type) {
      case "vendor":
        return product.vendor ? <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-muted">{product.vendor}</p> : null;
      case "title":
        return favorite ? (
          <div className="flex items-start justify-between gap-3">
            <h1 className="sf-heading min-w-0 text-[calc(clamp(1.75rem,3.6vw,2.6rem)*var(--store-scale))] text-ink">{product.name}</h1>
            {favorite}
          </div>
        ) : (
          <h1 className="sf-heading text-[calc(clamp(1.75rem,3.6vw,2.6rem)*var(--store-scale))] text-ink">{product.name}</h1>
        );
      case "gift_card_form":
        return isGiftCard ? <GiftCardForm value={recipient} errors={recipientErrors} onChange={(v) => { setRecipient(v); setRecipientErrors({}); setError(null); }} /> : null;
      case "discount_badges": {
        const badges = promotions?.productBadges ?? [];
        if (!badges.length || isGiftCard) return null;
        return (
          <section aria-labelledby={`badges-${b.id}`} className="rounded-[min(var(--store-card-radius),16px)] bg-[var(--store-accent-soft)] p-4">
            <h2 id={`badges-${b.id}`} className="flex items-center gap-2 text-sm font-semibold text-ink">
              <BadgePercent className="size-4 text-[var(--store-primary)]" aria-hidden />
              {S.str(b.settings, "heading", "Offres disponibles") || "Offres disponibles"}
            </h2>
            <ul className="mt-2.5 space-y-2">
              {badges.map((d) => (
                <li key={d.id} className="text-sm">
                  <span className="font-semibold text-ink">{d.title}</span>
                  <span className="block text-ink-muted">{d.description} Appliquée automatiquement au panier.</span>
                </li>
              ))}
            </ul>
          </section>
        );
      }
      case "complementary": {
        const max = Math.max(1, Math.min(4, S.num(b.settings, "max", 3)));
        const offers = (promotions?.productOffers ?? []).slice(0, max);
        if (!offers.length) return null;
        return <OfferList slug={store.slug} currency={store.currency} view={view} offers={offers} heading={S.str(b.settings, "heading", "Souvent achetés ensemble") || "Souvent achetés ensemble"} />;
      }
      case "rating":
        return product.rating ? (
          <a href="#avis" className="inline-flex min-h-10 items-center gap-2 text-sm text-ink-muted hover:text-ink">
            <Stars value={product.rating.average} size="sm" />
            <span className="tabular">
              {product.rating.average.toFixed(1).replace(".", ",")} · <span className="underline underline-offset-4">{product.rating.count} avis</span>
            </span>
          </a>
        ) : (
          <a href="#avis" className="inline-flex min-h-10 items-center gap-2 text-sm text-ink-muted hover:text-ink">
            <Stars value={0} size="sm" /> Pas encore d&apos;avis
          </a>
        );
      case "price":
        return (
          <div>
            <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1" aria-live="polite">
              <span className="text-[28px] font-semibold tracking-[-0.02em] tabular text-ink">
                {shownCompare && <span className="sr-only">Prix réduit : </span>}
                {fm(shownUnit)}
              </span>
              {shownCompare && (
                <s className="text-base tabular text-ink-muted">
                  <span className="sr-only">au lieu de </span>
                  {fm(shownCompare)}
                </s>
              )}
              {shownCompare && S.bool(b.settings, "show_savings", true) && (
                <span className="rounded-full bg-[var(--store-accent-soft)] px-2.5 py-1 text-xs font-semibold text-ink">
                  Économisez {fm(shownCompare - shownUnit)} (-{Math.round(((shownCompare - shownUnit) / shownCompare) * 100)} %)
                </span>
              )}
            </p>
            {groupDelta !== 0 && <p className="mt-1 text-xs text-ink-muted">Suppléments inclus</p>}
            {/* Mention obligatoire : l'affichage converti est indicatif, l'encaissement a lieu en devise boutique. */}
            <CurrencyNotice view={view} short className="mt-1.5" />
          </div>
        );
      case "variant_picker":
        return options.length ? (
          <div className="space-y-6">
            {options.map((o) => (
              <OptionPicker key={o.name} option={o} style={S.str(b.settings, "style", "buttons") as "buttons" | "dropdown" | "swatches"} showSoldOut={S.bool(b.settings, "show_sold_out", true)} selected={selection[o.name]} status={(v) => valueStatus(options, variants, selection, o.name, v, product.trackStock)} onSelect={(v) => { setError(null); setSelection((s) => changeSelection(options, variants, s, o.name, v, product.trackStock)); }} />
            ))}
            {combinationMissing && <p className="text-sm text-ink-muted">Cette combinaison n&apos;existe pas. Choisissez une autre valeur.</p>}
          </div>
        ) : null;
      case "options":
        return product.optionGroups.length ? <OptionGroups groups={product.optionGroups} value={groupSel} view={view} onChange={(v) => { setError(null); setGroupSel(v); }} /> : null;
      case "stock": {
        if (store.booking) return null;
        // La précommande est toujours signalée (sans révéler la quantité), même si le thème masque le stock.
        if (backorder && !combinationMissing) return <StockLine tone="info">{BACKORDER_LABEL} : expédition différée</StockLine>;
        if (!showStock) return null;
        if (combinationMissing) return <StockLine tone="muted">Indisponible dans cette combinaison</StockLine>;
        if (!purchasable) return <StockLine tone="muted">Épuisé pour le moment</StockLine>;
        if (!product.trackStock) return <StockLine tone="ok">Disponible</StockLine>;
        // « Stock bas » : seuil du produit, sinon de la boutique (calculé côté serveur).
        if (stock == null) return lowStock ? <StockLine tone="warn">Bientôt épuisé, commandez vite</StockLine> : <StockLine tone="ok">{inStock ? "En stock" : "Épuisé pour le moment"}</StockLine>;
        if (lowStock) return <StockLine tone="warn">Plus que {stock} en stock, commandez vite</StockLine>;
        return <StockLine tone="ok">En stock</StockLine>;
      }
      case "quantity":
        return (
          <div>
            <span id="qty-label" className="mb-2.5 block text-sm font-semibold text-ink">
              Quantité
            </span>
            <div className="inline-flex items-center rounded-[min(var(--store-radius),999px)] bg-surface ring-1 ring-inset ring-line-strong focus-within:ring-2 focus-within:ring-[var(--store-primary)]" role="group" aria-labelledby="qty-label">
              <button type="button" aria-label="Diminuer la quantité" onClick={() => setQty((q) => Math.max(product.minQty, q - 1))} disabled={qty <= product.minQty} className="inline-flex size-12 items-center justify-center rounded-full text-ink transition-transform active:scale-90 disabled:opacity-35">
                <Minus className="size-4" aria-hidden />
              </button>
              <input type="number" inputMode="numeric" aria-labelledby="qty-label" value={qty} min={product.minQty} max={maxQty} onChange={(e) => setQty(Math.max(product.minQty, Math.min(maxQty, Number(e.target.value) || product.minQty)))} className="h-12 w-12 bg-transparent text-center text-base font-semibold tabular text-ink [appearance:textfield] focus:outline-none [&::-webkit-inner-spin-button]:appearance-none" />
              <button type="button" aria-label="Augmenter la quantité" onClick={() => setQty((q) => Math.min(maxQty, q + 1))} disabled={qty >= maxQty} className="inline-flex size-12 items-center justify-center rounded-full text-ink transition-transform active:scale-90 disabled:opacity-35">
                <Plus className="size-4" aria-hidden />
              </button>
            </div>
          </div>
        );
      case "buy_buttons":
        return (
          <div ref={buyRef} className="space-y-2.5">
            <div aria-live="assertive">
              {error && (
                <p id="product-error" role="alert" className="sf-pop mb-2 rounded-[12px] bg-danger-soft px-4 py-3 text-sm font-medium text-danger">
                  {error}
                </p>
              )}
            </div>
            <button type="button" onClick={() => addToCart()} disabled={disabled} aria-describedby={error ? "product-error" : undefined} className={cn("sf-btn h-14 w-full text-base", added ? "!bg-[#0f6b3f] !text-white" : "sf-btn-solid")}>
              {added ? <Check key="ok" className="sf-pop size-5" aria-hidden /> : <ShoppingBag key="bag" className="sf-pop size-5" aria-hidden />}
              {store.closed ? "Boutique fermée" : !purchasable ? (combinationMissing ? "Indisponible" : "Épuisé") : added ? "Ajouté au panier" : `${addLabel} · ${fm(shownUnit * qty)}`}
            </button>
            {backorder && !store.closed && !store.booking && <p className="text-xs text-ink-muted">{BACKORDER_HINT}</p>}
            {S.bool(b.settings, "show_buy_now", true) && !store.booking && (
              <button type="button" onClick={buyNow} disabled={disabled} className="sf-btn sf-btn-outline h-13 w-full">
                <Zap className="size-4" aria-hidden /> Acheter maintenant
              </button>
            )}
            {S.bool(b.settings, "show_whatsapp", true) && waHref && !isGiftCard && (
              <a href={waHref} target="_blank" rel="noopener noreferrer" className="sf-btn sf-btn-whatsapp h-13 w-full">
                <MessageCircle className="size-5" aria-hidden /> Commander sur WhatsApp
              </a>
            )}
            {added && cartType === "page" && (
              <Link href={`${base}/panier`} className="sf-pop flex min-h-11 items-center justify-center text-sm font-semibold underline underline-offset-4">
                Voir le panier
              </Link>
            )}
            {store.loyalty && purchasable && !isGiftCard && (
              <p className="flex items-center gap-2 pt-1 text-xs text-ink-muted">
                <Gift className="size-4 text-[var(--store-primary)]" aria-hidden />
                Cet achat vous rapporte {Math.floor((unitPrice * qty) / 1000) * store.loyalty.pointsPer1000} point{Math.floor((unitPrice * qty) / 1000) * store.loyalty.pointsPer1000 > 1 ? "s" : ""} de fidélité.
              </p>
            )}
            {store.closed && <p className="text-sm text-warning">La boutique est temporairement fermée : les commandes reprendront bientôt.</p>}
          </div>
        );
      case "description":
        if (!product.description) return null;
        return S.bool(b.settings, "collapsed", false) ? (
          <Collapsible title="Description">
            <p className="whitespace-pre-line">{product.description}</p>
          </Collapsible>
        ) : (
          <div className="max-w-[62ch] whitespace-pre-line text-[16px] leading-relaxed text-ink-muted">{product.description}</div>
        );
      case "collapsible_tab":
        if (S.bool(b.settings, "use_product_details", false)) {
          return product.details.length ? (
            <div className="divide-y divide-line border-y border-line">
              {product.details.map((d, i) => (
                <Collapsible key={i} title={d.title} bare>
                  <RichText text={d.body} base={base} className="space-y-2" />
                </Collapsible>
              ))}
            </div>
          ) : null;
        }
        return S.str(b.settings, "content").trim() ? (
          <Collapsible title={S.str(b.settings, "title", "Informations")}>
            <RichText text={S.str(b.settings, "content")} base={base} className="space-y-2" />
          </Collapsible>
        ) : null;
      case "delivery_info":
        return <DeliveryInfo store={store} total={unitPrice * qty} view={view} />;
      case "trust":
        return (
          <ul className="grid grid-cols-1 gap-2 text-sm text-ink-muted sm:grid-cols-3">
            {[
              { icon: ShieldCheck, text: "Paiement à la commande ou à la livraison" },
              { icon: MessageCircle, text: "Une question ? Réponse sur WhatsApp" },
              { icon: Check, text: "Prix confirmé par la boutique" },
            ].map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-2 rounded-[12px] bg-surface p-3 ring-1 ring-line">
                <Icon className="mt-0.5 size-4 shrink-0 text-[var(--store-primary)]" aria-hidden />
                {text}
              </li>
            ))}
          </ul>
        );
      case "share":
        // Lot 4D (CAN) §15 : visuel de statut WhatsApp composé côté client, à côté des partages classiques.
        return showShare ? (<div className="flex flex-wrap items-center gap-x-4 gap-y-3"><ShareRow name={product.name} /><StatusShare productName={product.name} priceLabel={fm(shownUnit)} compareLabel={shownCompare != null ? fm(shownCompare) : null} imageUrl={product.images[0]?.url ?? null} logoUrl={store.logoUrl} storeName={store.name} showPoweredBy={store.showPoweredBy} /></div>) : null;
      case "sku":
        return sku ? <p className="text-xs tabular text-ink-muted">Référence : {sku}</p> : null;
      case "metafield": {
        // Lot 4 §5 : libellé + valeur, en général liée à un champ personnalisé (résolue avant le rendu ; vide = rien).
        const value = S.str(b.settings, "value").trim();
        if (!value) return null;
        const label = S.str(b.settings, "label").trim();
        return (
          <p className="text-[15px] leading-relaxed text-ink-muted">
            {label && <span className="font-semibold text-ink">{label} : </span>}
            <span className="whitespace-pre-line">{value}</span>
          </p>
        );
      }
      case "text":
        return S.str(b.settings, "text") ? <RichText text={S.str(b.settings, "text")} base={base} className="space-y-2 text-[15px] leading-relaxed text-ink-muted" /> : null;
      default:
        return null;
    }
  };

  const hasSkuBlock = visible.some((b) => b.type === "sku");

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-14">
      <div className={cn(stickyInfo ? "" : "", gallery !== "stacked" && gallery !== "grid-2" && "lg:sticky lg:top-24 lg:self-start")}>
        <ProductGallery images={images} name={product.name} style={gallery} zoom={zoom} active={Math.min(active, Math.max(0, images.length - 1))} onActiveChange={onActive} badge={badge} />
      </div>
      <div className={cn("sf-rise flex flex-col gap-5", stickyInfo && (gallery === "stacked" || gallery === "grid-2") && "lg:sticky lg:top-24 lg:self-start")}>
        {visible.map((b) => {
          const node = renderBlock(b);
          return node ? (
            <div key={b.id} data-block={b.type}>
              {node}
            </div>
          ) : null;
        })}
        {!hasSkuBlock && showSku && sku && <p className="text-xs tabular text-ink-muted">Référence : {sku}</p>}
        <p className="sr-only" role="status" aria-live="polite">
          {announce}
        </p>
      </div>

      {stickyBar && (
        <div data-sticky-cta data-visible={barVisible} aria-hidden={!barVisible} className={cn("sf-safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-4 pt-3 backdrop-blur-xl transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] lg:hidden", barVisible ? "translate-y-0" : "pointer-events-none translate-y-full")}>
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">{product.name}</p>
              <p className="text-sm font-semibold tabular text-ink">
                {fm(shownUnit * qty)}
                {variantLabel && <span className="ml-1.5 font-normal text-ink-muted">· {variantLabel}</span>}
              </p>
            </div>
            <button type="button" tabIndex={barVisible ? 0 : -1} onClick={() => addToCart()} disabled={disabled} className={cn("sf-btn h-12 shrink-0 px-5", added ? "!bg-[#0f6b3f] !text-white" : "sf-btn-solid")}>
              {added ? <Check className="size-5" aria-hidden /> : <ShoppingBag className="size-5" aria-hidden />}
              {added ? "Ajouté" : !purchasable ? "Épuisé" : store.booking ? "Réserver" : backorder ? "Précommander" : isGiftCard ? "Offrir" : "Ajouter"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function slugId(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function StockLine({ tone, children }: { tone: "ok" | "warn" | "muted" | "info"; children: React.ReactNode }) {
  return (
    <p className={cn("flex items-center gap-2 text-sm font-medium", tone === "ok" ? "text-[#0f6b3f]" : tone === "warn" ? "text-warning" : tone === "info" ? "text-ink" : "text-ink-muted")}>
      <span className="relative inline-flex size-2" aria-hidden>
        {tone === "warn" && <span className="absolute inset-0 animate-ping rounded-full bg-current opacity-40 motion-reduce:hidden" />}
        <span className="relative size-2 rounded-full bg-current" />
      </span>
      {children}
    </p>
  );
}

function OptionPicker({ option, style, showSoldOut, selected, status, onSelect }: { option: ProductOption; style: "buttons" | "dropdown" | "swatches"; showSoldOut: boolean; selected?: string; status: (v: string) => "available" | "soldout" | "unavailable"; onSelect: (v: string) => void }) {
  const id = `opt-${slugId(option.name)}`;
  const values = option.values.filter((v) => showSoldOut || v.value === selected || status(v.value) === "available");
  if (style === "dropdown") {
    return (
      <div id={id} className="scroll-mt-28">
        <label htmlFor={`${id}-select`} className="mb-2.5 block text-sm font-semibold text-ink">
          {option.name}
        </label>
        <div className="relative">
          <select id={`${id}-select`} value={selected ?? ""} onChange={(e) => onSelect(e.target.value)} className="sf-input appearance-none pr-10">
            {!selected && <option value="">Choisir…</option>}
            {values.map((v) => {
              const st = status(v.value);
              return (
                <option key={v.value} value={v.value} disabled={st === "unavailable"}>
                  {v.value}
                  {st === "soldout" ? " (épuisé)" : st === "unavailable" ? " (indisponible)" : ""}
                </option>
              );
            })}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted" aria-hidden />
        </div>
      </div>
    );
  }
  const swatch = style === "swatches" && option.type === "color";
  return (
    <fieldset id={id} className="scroll-mt-28">
      <legend className="mb-2.5 flex w-full items-baseline gap-2 text-sm font-semibold text-ink">
        {option.name}
        <span className="font-normal text-ink-muted">{selected ?? "À choisir"}</span>
      </legend>
      <div className="flex flex-wrap gap-2">
        {values.map((v) => {
          const st = status(v.value);
          const active = selected === v.value;
          const label = `${v.value}${st === "soldout" ? " (épuisé)" : st === "unavailable" ? " (indisponible avec ce choix)" : ""}`;
          if (swatch) {
            return (
              <button key={v.value} type="button" aria-pressed={active} aria-label={label} title={label} onClick={() => onSelect(v.value)} className={cn("relative inline-flex size-11 items-center justify-center rounded-full transition-[box-shadow,transform] duration-200 active:scale-95", active ? "ring-2 ring-[var(--store-primary)] ring-offset-2 ring-offset-canvas" : "ring-1 ring-line-strong hover:ring-ink-faint")}>
                <span className="size-8 rounded-full ring-1 ring-inset ring-black/10" style={{ background: v.swatch ?? colorGuess(v.value) }} />
                {st !== "available" && <span className="absolute h-[1.5px] w-9 rotate-45 rounded bg-ink/70" aria-hidden />}
              </button>
            );
          }
          return (
            <button
              key={v.value}
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(v.value)}
              className={cn(
                "inline-flex min-h-11 min-w-12 items-center justify-center rounded-[min(var(--store-radius),12px)] px-4 text-sm font-medium transition-[background-color,color,box-shadow,transform] duration-200 active:scale-[0.97]",
                active ? "bg-ink text-canvas" : "bg-surface text-ink ring-1 ring-inset ring-line-strong hover:ring-ink",
                st === "soldout" && !active && "text-ink-faint line-through decoration-1",
                st === "unavailable" && !active && "border border-dashed border-line-strong text-ink-faint ring-0",
              )}
            >
              {v.value}
              {st !== "available" && <span className="sr-only">{st === "soldout" ? " (épuisé)" : " (indisponible avec ce choix)"}</span>}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Couleur approximative quand le commerçant n'a pas défini de pastille. */
function colorGuess(name: string): string {
  const n = name.toLowerCase();
  const map: [RegExp, string][] = [
    [/noir|black/, "#1b1b1b"], [/blanc|white|écru|ecru/, "#f4f2ec"], [/rouge|red|bordeaux/, "#b3261e"], [/bleu|blue|marine|indigo/, "#1f4e9c"], [/vert|green|kaki/, "#2f6b3a"],
    [/jaune|yellow|moutarde/, "#e2b33c"], [/orange/, "#e0702a"], [/rose|pink|fuchsia/, "#e58fb0"], [/violet|mauve|purple/, "#6c4a9c"], [/marron|brun|chocolat|brown|camel/, "#7a4b2a"],
    [/gris|grey|gray/, "#8a8d8f"], [/beige|sable|nude/, "#d9c3a5"], [/or|gold|doré/, "#c9a227"], [/argent|silver/, "#c0c4c8"],
  ];
  return map.find(([re]) => re.test(n))?.[1] ?? "conic-gradient(#e2b33c,#b3261e,#1f4e9c,#2f6b3a,#e2b33c)";
}

function OptionGroups({ groups, value, view, onChange }: { groups: ProductPageData["optionGroups"]; value: Record<string, string[]>; view?: CurrencyView | null; onChange: (v: Record<string, string[]>) => void }) {
  const toggle = (g: ProductPageData["optionGroups"][number], id: string) => {
    const cur = value[g.id] ?? [];
    if (g.maxSelect <= 1) return onChange({ ...value, [g.id]: [id] });
    if (cur.includes(id)) return onChange({ ...value, [g.id]: cur.filter((x) => x !== id) });
    if (cur.length >= g.maxSelect) return;
    onChange({ ...value, [g.id]: [...cur, id] });
  };
  return (
    <div className="space-y-6">
      {groups.map((g) => {
        const multi = g.maxSelect > 1;
        const cur = value[g.id] ?? [];
        return (
          <fieldset key={g.id} id={`grp-${g.id}`} className="scroll-mt-28">
            <legend className="mb-2.5 flex w-full flex-wrap items-baseline justify-between gap-2 text-sm font-semibold text-ink">
              <span>{g.name}</span>
              <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", g.required ? "bg-[var(--store-accent-soft)] text-ink" : "text-ink-muted")}>
                {g.required ? "Obligatoire" : "Facultatif"}
                {multi ? `, jusqu'à ${g.maxSelect}` : ""}
              </span>
            </legend>
            <div className="divide-y divide-line overflow-hidden rounded-[min(var(--store-card-radius),16px)] bg-surface ring-1 ring-line">
              {!multi && !g.required && (
                <label className="flex min-h-13 cursor-pointer items-center gap-3 px-4 py-2.5 text-[15px] transition-colors hover:bg-surface-2">
                  <input type="radio" name={`opt-${g.id}`} checked={cur.length === 0} onChange={() => onChange({ ...value, [g.id]: [] })} className="size-5 accent-[var(--store-primary)]" />
                  <span className="flex-1 text-ink-muted">Sans</span>
                </label>
              )}
              {g.options.map((o) => {
                const checked = cur.includes(o.id);
                const full = multi && !checked && cur.length >= g.maxSelect;
                return (
                  <label key={o.id} className={cn("flex min-h-13 cursor-pointer items-center gap-3 px-4 py-2.5 text-[15px] transition-colors hover:bg-surface-2", checked && "bg-[var(--store-primary-soft)]", full && "cursor-not-allowed opacity-50")}>
                    <input type={multi ? "checkbox" : "radio"} name={`opt-${g.id}`} checked={checked} disabled={full} onChange={() => toggle(g, o.id)} className="size-5 accent-[var(--store-primary)]" />
                    <span className="flex-1 text-ink">{o.name}</span>
                    {o.priceDelta !== 0 && (
                      <span className="text-sm tabular text-ink-muted">
                        {o.priceDelta > 0 ? "+" : "-"}
                        {formatMoney(viewPlain(view, Math.abs(o.priceDelta)), viewCurrency(view))}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}

function Collapsible({ title, children, bare }: { title: string; children: React.ReactNode; bare?: boolean }) {
  return (
    <details className={cn("group", !bare && "border-y border-line")}>
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-3 text-[15px] font-semibold text-ink [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown className="size-5 shrink-0 text-ink-muted transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] group-open:rotate-180" aria-hidden />
      </summary>
      <div className="pb-5 text-[15px] leading-relaxed text-ink-muted">{children}</div>
    </details>
  );
}

function DeliveryInfo({ store, total, view }: { store: StoreInfo; total: number; view?: CurrencyView | null }) {
  if (!store.deliveryEnabled && !store.pickupEnabled) return null;
  const zones = store.deliveryZones;
  const cheapest = zones.length ? Math.min(...zones.map((z) => z.fee)) : null;
  const free = store.freeShippingFrom;
  return (
    <div className="rounded-[min(var(--store-card-radius),16px)] bg-surface p-4 ring-1 ring-line">
      <ul className="space-y-3 text-sm">
        {store.deliveryEnabled && (
          <li className="flex gap-3">
            <Truck className="mt-0.5 size-[18px] shrink-0 text-[var(--store-primary)]" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-ink">
                Livraison {cheapest === 0 ? "offerte" : cheapest !== null ? `dès ${formatMoney(viewPrice(view, cheapest), viewCurrency(view))}` : ""}
                {zones[0]?.etaLabel ? <span className="font-normal text-ink-muted"> · {zones[0].etaLabel.toLowerCase()}</span> : null}
              </p>
              {free !== null && (
                <p className="mt-0.5 text-ink-muted">{total >= free ? "Cette commande peut bénéficier de la livraison offerte." : `Offerte dès ${formatMoney(viewPlain(view, free), viewCurrency(view))} d'achat (selon la zone).`}</p>
              )}
              {zones.length > 0 && (
                <details className="group mt-1">
                  <summary className="inline-flex min-h-9 cursor-pointer list-none items-center gap-1 text-[var(--store-primary)] underline-offset-4 hover:underline [&::-webkit-details-marker]:hidden">
                    Voir les {zones.length} zone{zones.length > 1 ? "s" : ""} <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden />
                  </summary>
                  <ul className="mt-2 divide-y divide-line rounded-[10px] bg-surface-2 px-3">
                    {zones.map((z) => (
                      <li key={z.name} className="flex justify-between gap-3 py-2">
                        <span className="text-ink">{z.name}</span>
                        <span className="shrink-0 text-right tabular text-ink-muted">
                          {z.fee === 0 ? "Offerte" : formatMoney(viewPrice(view, z.fee), viewCurrency(view))}
                          {z.etaLabel && <span className="block text-xs">{z.etaLabel}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          </li>
        )}
        {store.pickupEnabled && (
          <li className="flex gap-3">
            <StoreIcon className="mt-0.5 size-[18px] shrink-0 text-[var(--store-primary)]" aria-hidden />
            <p className="text-ink">
              <span className="font-medium">{store.copy.pickupTitle}</span>
              <span className="text-ink-muted">{store.address || store.city ? ` · ${[store.address, store.city].filter(Boolean).join(", ")}` : ""}</span>
            </p>
          </li>
        )}
      </ul>
    </div>
  );
}

function ShareRow({ name }: { name: string }) {
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);
  useEffect(() => setCanShare(typeof navigator !== "undefined" && "share" in navigator), []);
  const url = () => window.location.href;
  const item = "inline-flex size-11 items-center justify-center rounded-full bg-surface text-ink ring-1 ring-inset ring-line transition-colors hover:bg-surface-2";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-1 text-sm font-medium text-ink-muted">Partager</span>
      <button type="button" className={item} aria-label="Partager sur WhatsApp" onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(`${name} ${url()}`)}`, "_blank", "noopener,noreferrer")}>
        <MessageCircle className="size-[18px]" aria-hidden />
      </button>
      <button type="button" className={item} aria-label="Partager sur Facebook" onClick={() => window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url())}`, "_blank", "noopener,noreferrer")}>
        <ThumbsUp className="size-[18px]" aria-hidden />
      </button>
      <button
        type="button"
        className={item}
        aria-label={copied ? "Lien copié" : "Copier le lien"}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url());
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          } catch {
            /* presse-papiers indisponible */
          }
        }}
      >
        {copied ? <Check className="size-[18px] text-[#0f6b3f]" aria-hidden /> : <Link2 className="size-[18px]" aria-hidden />}
      </button>
      {canShare && (
        <button type="button" className={item} aria-label="Plus d'options de partage" onClick={() => navigator.share({ title: name, url: url() }).catch(() => undefined)}>
          <Share2 className="size-[18px]" aria-hidden />
        </button>
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {copied ? "Lien copié" : ""}
      </span>
    </div>
  );
}
