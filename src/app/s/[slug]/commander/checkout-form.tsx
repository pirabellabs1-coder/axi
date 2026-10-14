"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { summarizeCartKinds } from "@/lib/digital/kinds";
import Link from "next/link";
import { Store, Truck, MessageCircle, Loader2, ChevronDown, Check, CalendarClock, Lock, Gift, Sparkles, Wallet, Info, MapPin, UserRound } from "lucide-react";
import { Field, Input, Textarea, Select, Checkbox } from "@/components/ui/field";
import { Alert, Money } from "@/components/ui/misc";
import { cn, phonePlaceholder } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import { readCartGiftCards, readCartNote, readCartToken, readOfferAttribution, useCart, writeCartGiftCards, writeCartNote, writeCartToken } from "@/components/storefront/cart-store";
import { ProductImage } from "@/components/storefront/product-image";
import { dayLabelByIndex, storePath } from "@/components/storefront/format";
import { GiftCardInput } from "@/components/storefront/gift-card-input";
import { CartOffers } from "@/components/storefront/promotions/offer-list";
import { previewTotals, placeOrder, type PreviewResult } from "@/lib/storefront/actions";
import { saveCheckoutDraft } from "@/lib/carts/actions";
import { chargePlan } from "@/lib/currency/payment";
import { formatRateBps } from "@/lib/tax/compute";
import { channelLabel } from "@/lib/payments/channels";

export type CheckoutStore = {
  slug: string;
  name: string;
  currency: string;
  dialCode: string;
  countryName: string;
  minOrderAmount: number;
  orderNotes: string | null;
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  whatsappOrdering: boolean;
  deliveryZones: { id: string; name: string; fee: number; freeAbove: number | null; etaLabel: string | null }[];
  pickupSlots: { id: string; dayOfWeek: number; startTime: string; endTime: string }[];
  paymentMethods: { id: string; kind: "CASH_ON_DELIVERY" | "MOBILE_MONEY_MANUAL" | "BANK_TRANSFER_MANUAL" | "GATEWAY"; provider: string | null; label: string; instructions: string | null; accountNumber: string | null; accountName: string | null; currencies?: string[]; channels?: string[] }[];
  /** Salon / clinique : le retrait devient un rendez-vous. */
  booking: boolean;
  copy: { pickupTitle: string; pickupHint: string; slotLabel: string; confirmLabel: string };
  /** Plan Gratuit au-delà du quota : la commande WhatsApp passe en premier (rien n'est bloqué). */
  preferWhatsapp: boolean;
  /** Lot 1 : comptes acheteurs (lien de connexion), cartes cadeaux utilisables, offres au checkout. */
  accountsEnabled?: boolean;
  giftCardsEnabled?: boolean;
  cartOffersEnabled?: boolean;
  /** Lot 2 : case « Facture au nom d'une entreprise » (boutique qui applique les taxes). */
  companyInvoice?: boolean;
  /** Lot 2 : devise d'affichage courante (cookie relu par le serveur) ; son changement relance l'aperçu. */
  displayCurrency?: string;
};

/** Lot 1 : acheteur connecté par code (jamais déduit d'une saisie ; le serveur relit la session). */
export type CheckoutAccount = {
  name: string;
  /** Numéro national (sans indicatif). */
  phone: string;
  /** Téléphone vérifié par code : non modifiable ici. */
  phoneLocked: boolean;
  email: string;
  addresses: { id: string; label: string | null; text: string; zoneId: string | null; isDefault: boolean }[];
};

type Mode = "PICKUP" | "DELIVERY" | "WHATSAPP" | "DIGITAL";
type Errors = Partial<Record<string, string>>;

const FIELD_LABELS: Record<string, string> = {
  name: "Nom complet",
  phone: "Numéro de téléphone",
  email: "E-mail",
  deliveryZoneId: "Zone de livraison",
  deliveryAddress: "Adresse ou repère",
  couponCode: "Code promo",
  giftCardCodes: "Carte cadeau",
  paymentMethodId: "Moyen de paiement",
  buyerCompany: "Raison sociale",
  payerPhone: "Numéro du portefeuille",
};

/** Agrégateurs capables d'envoyer la demande de paiement directement sur le téléphone (lot 1 bis). */
const PUSH_PROVIDERS = new Set(["pawapay"]);

const SECTION = "rounded-[var(--store-card-radius)] bg-surface p-5 ring-1 ring-line sm:p-7";
const SAVE_TONE = "text-[#0f6b3f]";

export function CheckoutForm({ store, account = null }: { store: CheckoutStore; account?: CheckoutAccount | null }) {
  const cart = useCart(store.slug);

  // Nature des lignes : même règle que le serveur (cartes cadeaux ET produits numériques ou services).
  const giftLines = cart.lines.filter((l) => l.snapshot.isGiftCard);
  const kinds = useMemo(
    () => summarizeCartKinds(cart.lines.map((l) => ({ kind: l.snapshot.kind, isGiftCard: l.snapshot.isGiftCard }))),
    [cart.lines],
  );
  const digitalOnly = kinds.digitalOnly;
  const hasGiftCardLine = giftLines.length > 0;

  const modes = useMemo(() => {
    if (digitalOnly) return ["DIGITAL"] as Mode[];
    const m: Mode[] = [];
    if (store.preferWhatsapp && store.whatsappOrdering) m.push("WHATSAPP");
    if (store.pickupEnabled) m.push("PICKUP");
    if (store.deliveryEnabled) m.push("DELIVERY");
    if (store.whatsappOrdering && !m.includes("WHATSAPP")) m.push("WHATSAPP");
    return m;
  }, [store.pickupEnabled, store.deliveryEnabled, store.whatsappOrdering, store.preferWhatsapp, digitalOnly]);

  // Carte cadeau ou produit numérique : jamais de paiement à la livraison (remise après paiement confirmé).
  const paymentMethods = useMemo(() => (kinds.prepaymentRequired ? store.paymentMethods.filter((p) => p.kind !== "CASH_ON_DELIVERY") : store.paymentMethods), [store.paymentMethods, kinds.prepaymentRequired]);
  const codHidden = kinds.prepaymentRequired && paymentMethods.length !== store.paymentMethods.length;

  const defaultAddress = account?.addresses.find((a) => a.isDefault) ?? account?.addresses[0] ?? null;
  const zoneExists = (id: string | null | undefined) => !!id && store.deliveryZones.some((z) => z.id === id);

  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [name, setName] = useState(account?.name ?? "");
  const [phone, setPhone] = useState(account?.phone ?? "");
  const [email, setEmail] = useState(account?.email ?? "");
  const [note, setNote] = useState("");
  const [modeState, setMode] = useState<Mode>(modes[0] ?? "PICKUP");
  const mode: Mode = modes.includes(modeState) ? modeState : (modes[0] ?? "PICKUP");
  const [savedAddressId, setSavedAddressId] = useState<string>(defaultAddress?.id ?? "");
  const [zoneId, setZoneId] = useState(zoneExists(defaultAddress?.zoneId) ? defaultAddress!.zoneId! : (store.deliveryZones[0]?.id ?? ""));
  const [address, setAddress] = useState(defaultAddress?.text ?? "");
  const [slotId, setSlotId] = useState("");
  const [paymentMethodState, setPaymentMethodId] = useState(store.paymentMethods[0]?.id ?? "");
  const paymentMethodId = paymentMethods.some((p) => p.id === paymentMethodState) ? paymentMethodState : (paymentMethods[0]?.id ?? "");
  const [paymentReference, setPaymentReference] = useState("");
  const [walletChannel, setWalletChannel] = useState("");
  const [payerPhone, setPayerPhone] = useState("");
  const [couponInput, setCouponInput] = useState("");
  const [coupon, setCoupon] = useState<string | null>(null);
  const [giftCodes, setGiftCodes] = useState<string[]>([]);
  const [giftError, setGiftError] = useState<string | null>(null);
  const [usePoints, setUsePoints] = useState(false);
  const [useCredit, setUseCredit] = useState(false);
  const [consent, setConsent] = useState(false);
  const [asCompany, setAsCompany] = useState(false);
  const [buyerCompany, setBuyerCompany] = useState("");
  const [buyerTaxId, setBuyerTaxId] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [summaryErrors, setSummaryErrors] = useState<string[]>([]);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [errorToken, setErrorToken] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const previewSeq = useRef(0);
  const summaryRef = useRef<HTMLDivElement>(null);
  const [previewing, startPreview] = useTransition();
  const [submitting, startSubmit] = useTransition();
  const submittedRef = useRef(false);

  const cartTokenRef = useRef<string | null>(null);
  const draftSeq = useRef(0);

  useEffect(() => {
    // Clé d'idempotence créée au montage et conservée pour les nouvelles tentatives.
    setIdempotencyKey(makeIdempotencyKey());
    // Jeton du brouillon de panier (relance), note et cartes cadeaux saisies dans le panier.
    cartTokenRef.current = readCartToken(store.slug);
    const n = readCartNote(store.slug);
    if (n) setNote(n);
    const codes = readCartGiftCards(store.slug);
    if (codes.length) setGiftCodes(codes);
  }, [store.slug]);

  const items = useMemo(
    () => cart.lines.map((l) => ({ productId: l.productId, variantId: l.variantId, optionIds: l.optionIds, quantity: l.quantity, ...(l.giftCard ? { giftCard: l.giftCard } : {}) })),
    [cart.lines],
  );
  const itemsKey = JSON.stringify(items);
  const previewItems = useMemo(() => items.map(({ productId, variantId, optionIds, quantity }) => ({ productId, variantId, optionIds, quantity })), [items]);

  // Points de fidélité : paliers entiers de `rewardPoints` (le serveur plafonne au pourcentage autorisé).
  const acct = preview?.ok ? preview.account : null;
  const pointsUsable = acct && acct.loyaltyEnabled && acct.rewardPoints > 0 ? Math.floor(acct.loyaltyBalance / acct.rewardPoints) * acct.rewardPoints : 0;
  const loyaltyPoints = usePoints && pointsUsable > 0 ? pointsUsable : 0;
  const creditUsable = acct?.storeCreditBalance ?? 0;
  const useStoreCredit = useCredit && creditUsable > 0;
  const giftField = !!store.giftCardsEnabled && !digitalOnly;
  // Lot 2 : en devise d'affichage étrangère, les cartes cadeaux ne sont pas utilisables (devise boutique uniquement).
  const foreignDisplay = !!(preview?.ok && preview.presentment);
  const sentGiftCodes = giftField && !foreignDisplay ? giftCodes : [];

  /**
   * Brouillon de panier côté serveur (paniers abandonnés) : au blur du téléphone puis à chaque changement
   * du panier, avec anti-rebond. Rien n'est conservé côté serveur tant qu'aucun numéro n'est saisi.
   */
  const saveDraft = useRef<() => void>(() => undefined);
  useEffect(() => {
    saveDraft.current = () => {
      if (phone.replace(/\D/g, "").length < 6) return;
      const seq = ++draftSeq.current;
      void saveCheckoutDraft(store.slug, { cartToken: cartTokenRef.current, items: previewItems, customer: { name: name.trim().slice(0, 80), phone: phone.trim().slice(0, 20) }, marketingConsent: consent })
        .then((r) => {
          if (r.ok && seq === draftSeq.current) {
            cartTokenRef.current = r.cartToken;
            writeCartToken(store.slug, r.cartToken);
          }
        })
        .catch(() => undefined);
    };
  });
  const draftArmed = useRef(!!account?.phone);
  useEffect(() => {
    if (!cart.hydrated || !draftArmed.current) return;
    const t = setTimeout(() => saveDraft.current(), 1200);
    return () => clearTimeout(t);
  }, [itemsKey, consent, cart.hydrated]);

  // Aperçu des totaux recalculés côté serveur (débounce léger, réponses obsolètes ignorées).
  const giftKey = sentGiftCodes.join(",");
  useEffect(() => {
    if (!cart.hydrated || items.length === 0) return;
    const t = setTimeout(() => {
      const seq = ++previewSeq.current;
      startPreview(async () => {
        const r = await previewTotals({
          storeSlug: store.slug,
          // Panier serveur : cotation de change verrouillée 15 min et limite d'essais des cartes cadeaux.
          cartToken: cartTokenRef.current,
          items: previewItems,
          fulfillmentType: mode,
          deliveryZoneId: mode === "DELIVERY" ? zoneId || null : null,
          couponCode: coupon,
          giftCardCodes: sentGiftCodes,
          loyaltyPoints,
          useStoreCredit,
        });
        if (seq !== previewSeq.current) return;
        if (!r.ok && r.field === "couponCode") {
          setErrors((e) => ({ ...e, couponCode: r.error }));
          setCoupon(null);
          return;
        }
        if (!r.ok && r.field === "giftCardCodes") {
          // Dernière carte saisie refusée (message unique « Carte cadeau invalide ») : retirée, aperçu relancé.
          setGiftError(r.error);
          setGiftCodes((c) => {
            const next = c.slice(0, -1);
            writeCartGiftCards(store.slug, next);
            return next;
          });
          return;
        }
        setPreview(r);
      });
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey, mode, zoneId, coupon, cart.hydrated, store.slug, giftKey, loyaltyPoints, useStoreCredit, store.displayCurrency]);

  const totals = preview?.ok ? preview.totals : null;
  const total = totals?.total ?? cart.total;
  const tendered = (totals?.giftCardAmount ?? 0) + (totals?.storeCreditAmount ?? 0);
  const amountDue = totals ? totals.amountDue : total;
  const belowMin = store.minOrderAmount > 0 && (totals?.subtotal ?? cart.total) < store.minOrderAmount;
  const previewBlocking = !!preview && !preview.ok && preview.field !== "couponCode" && preview.field !== "giftCardCodes";
  const nothingToPay = !!totals && tendered > 0 && amountDue === 0;

  function setField(key: string, value: string) {
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
    return value;
  }

  function focusField(field?: string) {
    if (!field) return;
    const el = document.getElementById(field) ?? document.querySelector<HTMLElement>(`[name="${field}"]`);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  function applyCoupon() {
    const code = couponInput.trim().toUpperCase();
    setErrors((e) => ({ ...e, couponCode: undefined }));
    setCoupon(code || null);
  }

  function chooseSavedAddress(id: string) {
    setSavedAddressId(id);
    const a = account?.addresses.find((x) => x.id === id);
    if (!a) return;
    setAddress(a.text);
    setErrors((e) => ({ ...e, deliveryAddress: undefined, deliveryZoneId: undefined }));
    if (zoneExists(a.zoneId)) setZoneId(a.zoneId!);
  }

  /** Portefeuille choisi (demande poussée) : seulement pour le moyen en ligne sélectionné qui le propose. */
  function walletPayload(): { paymentChannel?: "wave" | "orange_money" | "mtn_momo" | "moov_money" | "card"; payerPhone?: string } {
    if (mode === "WHATSAPP" || nothingToPay || !walletChannel) return {};
    const pm = paymentMethods.find((p) => p.id === paymentMethodId);
    if (!pm || pm.kind !== "GATEWAY" || !pm.provider || !PUSH_PROVIDERS.has(pm.provider) || !(pm.channels ?? []).includes(walletChannel)) return {};
    return { paymentChannel: walletChannel as "wave", payerPhone: (payerPhone.trim() || phone).slice(0, 20) };
  }

  /** Validation locale (confort) : le serveur revalide tout dans placeOrder / createOrder. */
  function validateLocal(): Errors {
    const next: Errors = {};
    if (name.trim().length < 2) next.name = "Indiquez votre nom (2 caractères minimum).";
    if (phone.replace(/\D/g, "").length < 6) next.phone = "Indiquez un numéro valide, par exemple 97 00 00 00.";
    if (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())) next.email = "Adresse e-mail invalide, par exemple nom@exemple.com.";
    if (mode === "DELIVERY" && !zoneId) next.deliveryZoneId = "Choisissez une zone de livraison.";
    if (mode === "DELIVERY" && address.trim().length < 5) next.deliveryAddress = "Indiquez une adresse ou un repère (quartier, pharmacie, carrefour…).";
    if (asCompany && buyerCompany.trim().length < 2) next.buyerCompany = "Indiquez la raison sociale de l'entreprise.";
    return next;
  }

  function onBlurValidate(key: "name" | "phone" | "email" | "deliveryAddress") {
    const v = validateLocal();
    setErrors((e) => ({ ...e, [key]: v[key] }));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || submittedRef.current) return;
    const next = validateLocal();
    const keys = Object.keys(next).filter((k) => next[k]);
    if (keys.length) {
      setErrors(next);
      if (keys.length > 1) {
        setSummaryErrors(keys);
        requestAnimationFrame(() => summaryRef.current?.focus());
      } else {
        setSummaryErrors([]);
        focusField(keys[0]);
      }
      return;
    }
    setSummaryErrors([]);
    setGlobalError(null);
    setErrorToken(null);
    submittedRef.current = true;
    const offers = readOfferAttribution(store.slug);
    startSubmit(async () => {
      try {
        const r = await placeOrder({
          storeSlug: store.slug,
          idempotencyKey,
          items,
          fulfillmentType: mode,
          deliveryZoneId: mode === "DELIVERY" ? zoneId : null,
          deliveryAddress: mode === "DELIVERY" ? address : undefined,
          pickupSlotId: mode === "PICKUP" && slotId ? slotId : null,
          customer: { name, phone, email: email || "", note: note || undefined },
          couponCode: coupon,
          paymentMethodId: mode === "WHATSAPP" || nothingToPay ? null : paymentMethodId || null,
          paymentReference: paymentReference || undefined,
          ...walletPayload(),
          marketingConsent: consent,
          cartToken: cartTokenRef.current,
          giftCardCodes: sentGiftCodes,
          useStoreCredit,
          loyaltyPoints,
          attribution: offers.length ? { offers } : null,
          buyerCompany: asCompany ? buyerCompany.trim() : undefined,
          buyerTaxId: asCompany && buyerTaxId.trim() ? buyerTaxId.trim() : undefined,
        });
        // La redirection interrompt l'action : si on arrive ici, c'est une erreur.
        if (r && !r.ok) {
          submittedRef.current = false;
          if (r.trackingToken) setErrorToken(r.trackingToken);
          if (r.field === "giftCardCodes") {
            setGiftError(r.error);
            focusField("gift-cards");
          } else if (r.field && FIELD_LABELS[r.field]) {
            setErrors((er) => ({ ...er, [r.field!]: r.error }));
            focusField(r.field);
          } else {
            setGlobalError(r.error);
            requestAnimationFrame(() => summaryRef.current?.focus());
          }
        }
      } catch (err) {
        // redirect() lève une exception interne Next : ne pas la masquer.
        if (err && typeof err === "object" && "digest" in err && String((err as { digest?: string }).digest).startsWith("NEXT_")) throw err;
        submittedRef.current = false;
        setGlobalError("Connexion instable. Vérifiez votre réseau puis réessayez : votre commande ne sera pas dupliquée.");
        requestAnimationFrame(() => summaryRef.current?.focus());
      }
    });
  }

  if (!cart.hydrated) return <CheckoutSkeletonInline />;

  if (cart.lines.length === 0 && !errorToken) {
    return (
      <div className="flex flex-col items-center rounded-[var(--store-card-radius)] bg-surface px-6 py-14 text-center ring-1 ring-line">
        <p className="text-lg font-semibold text-ink">Votre panier est vide</p>
        <p className="mt-1 text-sm text-ink-muted">Ajoutez des articles avant de passer commande.</p>
        <Link href={storePath(store.slug)} className="mt-6 inline-flex h-12 items-center rounded-full bg-[var(--store-primary)] px-6 text-sm font-semibold text-[var(--store-primary-contrast)]">
          Retour à la boutique
        </Link>
      </div>
    );
  }

  const modeLabel: Record<Mode, { title: string; hint: string; icon: typeof Store }> = {
    PICKUP: { title: store.copy.pickupTitle, hint: store.copy.pickupHint, icon: store.booking ? CalendarClock : Store },
    DELIVERY: { title: "Livraison", hint: "Livré à l'adresse ou au repère indiqué.", icon: Truck },
    WHATSAPP: { title: "Finaliser sur WhatsApp", hint: "Vous envoyez le récapitulatif, le commerçant vous répond.", icon: MessageCircle },
    DIGITAL: { title: "Envoi numérique", hint: "Carte envoyée au destinataire dès la confirmation du paiement. Aucune livraison.", icon: Gift },
  };

  const lines = preview?.ok
    ? preview.lines.map((l, i) => ({ ...l, image: (cart.lines.find((c) => c.key === l.key) ?? cart.lines[i])?.snapshot.image ?? null }))
    : cart.lines.map((l) => ({ key: l.key, name: l.snapshot.name, variantName: l.snapshot.variantName, optionNames: l.snapshot.optionNames ?? [], quantity: l.quantity, lineTotal: l.snapshot.unitPrice * l.quantity, image: l.snapshot.image, isGiftCard: l.snapshot.isGiftCard }));

  // Lot 2 : montants affichés dans la devise de l'acheteur (calculés par le serveur APRÈS le pipeline) ;
  // l'encaissement reste en devise boutique sauf passerelle compatible (mention « Vous serez débité de … »).
  const pres = preview?.ok ? preview.presentment : null;
  const dc = pres?.currency ?? store.currency;
  const shown = {
    subtotal: pres ? pres.subtotal : (totals?.subtotal ?? cart.total),
    discount: pres ? pres.discount : (totals?.discount ?? 0),
    deliveryFee: pres ? pres.deliveryFee : (totals?.deliveryFee ?? 0),
    total: pres ? pres.total : total,
    storeCredit: pres ? pres.storeCreditAmount : (totals?.storeCreditAmount ?? 0),
    amountDue: pres ? pres.amountDue : amountDue,
    taxTotal: pres ? pres.taxTotal : (totals?.taxTotal ?? 0),
    taxLines: pres ? pres.taxLines : (totals?.taxLines ?? []),
    taxesIncluded: totals?.taxesIncluded ?? true,
  };
  const selectedMethod = mode === "WHATSAPP" || nothingToPay ? null : (paymentMethods.find((p) => p.id === paymentMethodId) ?? null);
  const charge = totals ? chargePlan({ method: selectedMethod, storeCurrency: store.currency, storeDue: amountDue, presentment: pres }) : null;
  const taxMention = preview?.ok ? preview.taxMention : null;

  const discounts = preview?.ok ? preview.discounts : [];
  const messages = preview?.ok ? preview.messages : [];
  const appliedCards = preview?.ok ? preview.giftCards : [];
  const notCombinable = messages.find((m) => m.code === "coupon_not_combinable");
  const progress = messages.filter((m) => m.code !== "coupon_not_combinable" && m.code !== "loyalty_capped");

  const summary = (
    <div>
      <ul className="space-y-3">
        {lines.map((l, i) => (
          <li key={`${l.key}-${i}`} className="flex items-center gap-3">
            <span className="relative w-14 shrink-0">
              <ProductImage src={l.image} alt="" ratio="aspect-square" className="rounded-[12px]" sizes="56px" />
              <span className="absolute -right-1.5 -top-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-ink px-1 text-[11px] font-semibold tabular text-white" aria-hidden>
                {l.quantity}
              </span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-ink">
                <span className="sr-only">{l.quantity} × </span>
                {l.name}
              </span>
              {(l.variantName || l.optionNames.length > 0) && <span className="block truncate text-xs text-ink-muted">{[l.variantName, ...l.optionNames].filter(Boolean).join(", ")}</span>}
              {l.isGiftCard && <span className="block text-xs text-ink-muted">Carte cadeau</span>}
              {(l as { backorder?: boolean }).backorder === true && <span className="block text-xs font-medium text-ink">Précommande : expédition différée</span>}
            </span>
            <span className="shrink-0 text-right text-sm tabular text-ink">
              {"discountAllocated" in l && l.discountAllocated > 0 ? (
                <>
                  <s className="block text-xs text-ink-muted">
                    <span className="sr-only">au lieu de </span>
                    <Money amount={pres?.lines[i]?.lineTotal ?? l.lineTotal} currency={dc} />
                  </s>
                  <Money amount={pres?.lines[i]?.netTotal ?? l.netTotal} currency={dc} />
                </>
              ) : (
                <Money amount={pres?.lines[i]?.lineTotal ?? l.lineTotal} currency={dc} />
              )}
            </span>
          </li>
        ))}
      </ul>
      {preview && !preview.ok && previewBlocking && (
        <p className="mt-4 rounded-[12px] bg-danger-soft px-3 py-2.5 text-sm text-danger" role="alert">
          {preview.error}
        </p>
      )}
      {preview?.ok && preview.warnings.length > 0 && (
        <ul className="mt-4 space-y-1 rounded-[12px] bg-warning-soft px-3 py-2.5 text-sm text-warning" role="status">
          {preview.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      {(progress.length > 0 || notCombinable) && (
        <ul className="mt-4 space-y-1.5" aria-live="polite">
          {notCombinable && (
            <li className="flex gap-2 rounded-[12px] bg-surface-2 px-3 py-2.5 text-sm text-ink">
              <Info className="mt-0.5 size-4 shrink-0 text-[var(--store-primary)]" aria-hidden />
              {notCombinable.text}
            </li>
          )}
          {progress.map((m, i) => (
            <li key={`${m.code}-${i}`} className="flex gap-2 rounded-[12px] bg-[var(--store-primary-soft)] px-3 py-2.5 text-sm text-ink">
              <Sparkles className="mt-0.5 size-4 shrink-0 text-[var(--store-primary)]" aria-hidden />
              {m.text}
            </li>
          ))}
        </ul>
      )}
      {store.cartOffersEnabled && !digitalOnly && (
        <div className="mt-4">
          <CartOffers slug={store.slug} currency={store.currency} placement="CHECKOUT" heading="À ajouter avant de valider" />
        </div>
      )}
      <dl className={cn("mt-5 space-y-2 border-t border-line pt-4 text-sm transition-opacity duration-200", previewing && "opacity-60")} aria-busy={previewing}>
        <Row label="Sous-total" amount={shown.subtotal} currency={dc} />
        {discounts.length > 0
          ? discounts.map((d, i) => {
              const amount = pres ? (d.presentedAmount ?? 0) : d.amount;
              return amount > 0 ? <Row key={`${d.source}-${i}`} label={d.source === "coupon" && coupon ? `${d.label} (${coupon})` : d.label} amount={-amount} currency={dc} tone={SAVE_TONE} /> : null;
            })
          : totals && totals.discount > 0 && <Row label={`Remise${coupon ? ` (${coupon})` : ""}`} amount={-shown.discount} currency={dc} tone={SAVE_TONE} />}
        {mode === "DELIVERY" && <Row label="Livraison" amount={shown.deliveryFee} currency={dc} free={totals ? shown.deliveryFee === 0 : false} />}
        {/* Taxes HT : ajoutées, une ligne par taux. */}
        {!shown.taxesIncluded && shown.taxLines.map((t) => <Row key={`${t.name}-${t.rateBps}`} label={`${t.name} (${formatRateBps(t.rateBps)})`} amount={t.amount} currency={dc} />)}
        <div className="flex items-baseline justify-between border-t border-line pt-3">
          <dt className={cn("font-semibold text-ink", tendered > 0 ? "text-sm" : "text-base")}>Total{shown.taxTotal > 0 ? " TTC" : ""}</dt>
          <dd className={cn("font-semibold tabular text-ink", tendered > 0 ? "text-base" : "text-xl tracking-[-0.02em]")}>
            <Money amount={shown.total} currency={dc} />
          </dd>
        </div>
        {/* Taxes TTC : contenues dans les prix (« dont TVA »). */}
        {shown.taxesIncluded &&
          shown.taxLines.map((t) => (
            <div key={`${t.name}-${t.rateBps}`} className="flex justify-between gap-3 text-xs text-ink-muted">
              <dt>
                dont {t.name} ({formatRateBps(t.rateBps)})
              </dt>
              <dd className="tabular">
                <Money amount={t.amount} currency={dc} />
              </dd>
            </div>
          ))}
        {taxMention && shown.taxTotal === 0 && <p className="text-xs text-ink-muted">{taxMention}</p>}
        {appliedCards.map((g) => (
          <Row key={g.last4} label={`Carte cadeau •••• ${g.last4}`} amount={-g.applied} currency={store.currency} tone={SAVE_TONE} />
        ))}
        {shown.storeCredit > 0 && <Row label="Avoir" amount={-shown.storeCredit} currency={dc} tone={SAVE_TONE} />}
        {tendered > 0 && (
          <div className="flex items-baseline justify-between border-t border-line pt-3">
            <dt className="text-base font-semibold text-ink">Reste à payer</dt>
            <dd className="text-xl font-semibold tracking-[-0.02em] tabular text-ink">
              <Money amount={shown.amountDue} currency={dc} />
            </dd>
          </div>
        )}
      </dl>
      {charge?.mention && (
        <p className="mt-3 flex gap-2 rounded-[12px] bg-surface-2 px-3 py-2.5 text-sm text-ink" role="status">
          <Info className="mt-0.5 size-4 shrink-0 text-[var(--store-primary)]" aria-hidden />
          <span>
            {charge.mention}. Montants en {dc} donnés à titre indicatif.
          </span>
        </p>
      )}
      {totals && totals.discount > 0 && (
        <p className={cn("mt-3 text-sm font-medium", SAVE_TONE)}>
          Vous économisez <span className="tabular">{formatMoney(shown.discount, dc)}</span>.
        </p>
      )}
      {belowMin && (
        <p className="mt-3 text-sm text-danger" role="alert">
          Commande minimum : {formatMoney(store.minOrderAmount, store.currency)} (hors livraison).
        </p>
      )}
    </div>
  );

  const submitLabel = mode === "WHATSAPP" ? "Continuer sur WhatsApp" : store.copy.confirmLabel;
  const showPayment = mode !== "WHATSAPP";
  const loginHref = `/s/${store.slug}/compte/connexion?next=${encodeURIComponent(`/s/${store.slug}/commander`)}`;
  const pointsValue = acct && acct.rewardPoints > 0 ? Math.floor(pointsUsable / acct.rewardPoints) * acct.rewardValue : 0;
  const loyaltyCapped = messages.find((m) => m.code === "loyalty_capped");

  return (
    <form onSubmit={onSubmit} noValidate className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-10">
      {/* Récapitulatif repliable (mobile) */}
      <details className="group rounded-[var(--store-card-radius)] bg-surface ring-1 ring-line lg:hidden">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-2 text-sm font-medium text-[var(--store-primary)]">
            <span className="group-open:hidden">Afficher le récapitulatif</span>
            <span className="hidden group-open:inline">Masquer le récapitulatif</span>
            <ChevronDown className="size-4 transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
          </span>
          <span className="text-right">
            {totals && totals.discount > 0 && (
              <s className="mr-2 text-xs tabular text-ink-muted max-[400px]:hidden">
                <span className="sr-only">au lieu de </span>
                <Money amount={shown.total + shown.discount} currency={dc} />
              </s>
            )}
            <span className="text-base font-semibold tabular text-ink">
              <Money amount={shown.amountDue} currency={dc} />
            </span>
          </span>
        </summary>
        <div className="border-t border-line px-5 pb-5 pt-4">{summary}</div>
      </details>

      <div className="space-y-5">
        <div ref={summaryRef} tabIndex={-1} className="space-y-3 focus:outline-none" aria-live="assertive">
          {summaryErrors.length > 1 && (
            <Alert tone="danger" title={`${summaryErrors.length} champs à corriger`}>
              <ul className="mt-1 list-inside list-disc space-y-0.5">
                {summaryErrors.map((k) => (
                  <li key={k}>
                    <a
                      href={`#${k}`}
                      onClick={(e) => {
                        e.preventDefault();
                        focusField(k);
                      }}
                      className="underline underline-offset-2"
                    >
                      {FIELD_LABELS[k] ?? k}
                    </a>
                  </li>
                ))}
              </ul>
            </Alert>
          )}
          {globalError && (
            <Alert tone="danger" title="La commande n'a pas pu être envoyée">
              {globalError}
              {errorToken && (
                <span className="mt-2 block">
                  <Link href={storePath(store.slug, `/merci/${errorToken}`)} className="font-semibold underline underline-offset-2">
                    Voir ma commande
                  </Link>
                </span>
              )}
            </Alert>
          )}
        </div>
        {store.orderNotes && <Alert tone="info">{store.orderNotes}</Alert>}

        {!account && store.accountsEnabled && (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[var(--store-card-radius)] bg-surface px-5 py-3.5 text-sm text-ink-muted ring-1 ring-line">
            <UserRound className="size-4 shrink-0 text-[var(--store-primary)]" aria-hidden />
            Déjà client ?
            <Link href={loginHref} className="inline-flex min-h-11 items-center font-semibold text-ink underline underline-offset-4">
              Connectez-vous pour utiliser vos points ou votre avoir
            </Link>
          </p>
        )}

        {/* 1. Coordonnées */}
        <section className={SECTION} aria-labelledby="step-1">
          <StepTitle id="step-1" n={1} done={name.trim().length >= 2 && phone.replace(/\D/g, "").length >= 6}>
            Vos coordonnées
          </StepTitle>
          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="name" label="Nom complet" required error={errors.name} className="sm:col-span-2">
              {(p) => <Input {...p} name="name" autoComplete="name" value={name} onBlur={() => errors.name !== undefined && onBlurValidate("name")} onChange={(e) => setName(setField("name", e.target.value))} />}
            </Field>
            <Field
              id="phone"
              label="Numéro WhatsApp"
              required
              error={errors.phone}
              hint={account?.phoneLocked ? "Numéro vérifié par code. Pour le changer, déconnectez-vous." : `Numéro ${store.countryName}. Le commerçant vous contacte sur ce numéro.`}
              className="sm:col-span-2"
            >
              {(p) => (
                <div className="flex">
                  <span className="inline-flex h-12 items-center rounded-l-[var(--radius-md)] bg-surface-2 px-3.5 text-sm font-medium tabular text-ink-muted ring-1 ring-inset ring-line-strong" aria-hidden>
                    +{store.dialCode}
                  </span>
                  <Input
                    {...p}
                    name="phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel-national"
                    placeholder={phonePlaceholder(store.dialCode)}
                    value={phone}
                    readOnly={account?.phoneLocked}
                    aria-readonly={account?.phoneLocked || undefined}
                    onBlur={() => {
                      if (!phone || account?.phoneLocked) return;
                      onBlurValidate("phone");
                      draftArmed.current = true;
                      saveDraft.current();
                    }}
                    onChange={(e) => !account?.phoneLocked && setPhone(setField("phone", e.target.value))}
                    className={cn("rounded-l-none", account?.phoneLocked && "bg-surface-2 text-ink-muted")}
                  />
                  {account?.phoneLocked && (
                    <span className="-ml-10 inline-flex w-10 items-center justify-center text-ink-muted" aria-hidden>
                      <Lock className="size-4" />
                    </span>
                  )}
                </div>
              )}
            </Field>
            <Field id="email" label="E-mail (facultatif)" error={errors.email}>
              {(p) => <Input {...p} name="email" type="email" inputMode="email" autoComplete="email" value={email} onBlur={() => email && onBlurValidate("email")} onChange={(e) => setEmail(setField("email", e.target.value))} />}
            </Field>
            <Field id="note" label="Note (facultatif)">
              {(p) => (
                <Input
                  {...p}
                  name="note"
                  maxLength={500}
                  value={note}
                  onChange={(e) => {
                    setNote(e.target.value);
                    writeCartNote(store.slug, e.target.value);
                  }}
                  placeholder="Allergie, précision…"
                />
              )}
            </Field>
          </div>
        </section>

        {/* 2. Mode */}
        <section className={SECTION} aria-labelledby="step-2">
          <StepTitle id="step-2" n={2}>
            {digitalOnly ? "Remise de la carte" : store.booking ? "Rendez-vous ou livraison" : "Retrait ou livraison"}
          </StepTitle>
          {store.preferWhatsapp && store.whatsappOrdering && !digitalOnly && (
            <div className="mt-4 flex gap-3 rounded-[14px] bg-[#e8f6ef] px-4 py-3 text-sm text-[#0b5a3f]">
              <MessageCircle className="mt-0.5 size-5 shrink-0" aria-hidden />
              <p>
                <span className="font-semibold">Recommandé : finalisez sur WhatsApp.</span> {store.name} reçoit beaucoup de commandes ce mois-ci : en envoyant votre récapitulatif sur WhatsApp, vous obtenez une réponse directe et plus rapide.
              </p>
            </div>
          )}
          {modes.length === 0 ? (
            <Alert tone="warning" className="mt-4">
              Aucun mode de commande n&apos;est disponible pour le moment.
            </Alert>
          ) : (
            <fieldset className="mt-5">
              <legend className="sr-only">Mode de commande</legend>
              <div className="grid gap-2.5">
                {modes.map((m, i) => {
                  const Icon = modeLabel[m].icon;
                  const active = mode === m;
                  return (
                    <label key={m} className={cn("relative flex min-h-16 cursor-pointer items-center gap-3.5 rounded-[16px] px-4 py-3 ring-1 ring-inset transition-[box-shadow,background-color] duration-200", active ? "bg-[var(--store-primary-soft)] ring-2 ring-[var(--store-primary)]" : "ring-line-strong hover:bg-surface-2")}>
                      <input type="radio" name="fulfillmentType" value={m} checked={active} onChange={() => setMode(m)} className="peer sr-only" />
                      <span className={cn("inline-flex size-10 shrink-0 items-center justify-center rounded-full", active ? "bg-[var(--store-primary)] text-[var(--store-primary-contrast)]" : "bg-surface-2 text-ink")}>
                        <Icon className="size-5" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-ink">
                          {modeLabel[m].title}
                          {store.preferWhatsapp && m === "WHATSAPP" && i === 0 && <span className="rounded-full bg-[#0f7a5c] px-2 py-0.5 text-[11px] font-semibold text-white">Recommandé</span>}
                        </span>
                        <span className="block text-sm text-ink-muted">{modeLabel[m].hint}</span>
                      </span>
                      <span className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded-full ring-1 ring-inset", active ? "bg-[var(--store-primary)] text-[var(--store-primary-contrast)] ring-transparent" : "ring-line-strong")} aria-hidden>
                        {active && <Check className="sf-pop size-3.5" />}
                      </span>
                      <span className="pointer-events-none absolute inset-0 rounded-[16px] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--store-primary)]" aria-hidden />
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}

          {mode === "DELIVERY" && (
            <div className="mt-5 grid gap-4">
              {account && account.addresses.length > 0 && (
                <fieldset>
                  <legend className="mb-2 text-sm font-medium text-ink">Mes adresses</legend>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {account.addresses.map((a) => {
                      const active = savedAddressId === a.id;
                      const zoneMissing = !!a.zoneId && !zoneExists(a.zoneId);
                      return (
                        <label key={a.id} className={cn("flex min-h-14 cursor-pointer items-start gap-3 rounded-[14px] px-3.5 py-3 ring-1 ring-inset transition-colors", active ? "bg-[var(--store-primary-soft)] ring-2 ring-[var(--store-primary)]" : "ring-line-strong hover:bg-surface-2")}>
                          <input type="radio" name="savedAddress" value={a.id} checked={active} onChange={() => chooseSavedAddress(a.id)} className="mt-0.5 size-5 accent-[var(--store-primary)]" />
                          <span className="min-w-0 flex-1 text-sm">
                            <span className="flex items-center gap-1.5 font-medium text-ink">
                              <MapPin className="size-3.5 shrink-0 text-ink-muted" aria-hidden />
                              {a.label || "Adresse"}
                              {a.isDefault && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-ink-muted">Par défaut</span>}
                            </span>
                            <span className="line-clamp-2 block text-ink-muted">{a.text}</span>
                            {zoneMissing && <span className="block text-xs font-medium text-warning">Zone à choisir de nouveau</span>}
                          </span>
                        </label>
                      );
                    })}
                    <label className={cn("flex min-h-14 cursor-pointer items-center gap-3 rounded-[14px] px-3.5 py-3 ring-1 ring-inset transition-colors", savedAddressId === "" ? "bg-[var(--store-primary-soft)] ring-2 ring-[var(--store-primary)]" : "ring-line-strong hover:bg-surface-2")}>
                      <input
                        type="radio"
                        name="savedAddress"
                        value=""
                        checked={savedAddressId === ""}
                        onChange={() => {
                          setSavedAddressId("");
                          setAddress("");
                        }}
                        className="size-5 accent-[var(--store-primary)]"
                      />
                      <span className="text-sm font-medium text-ink">Une autre adresse</span>
                    </label>
                  </div>
                </fieldset>
              )}
              <fieldset>
                <legend className="mb-2 text-sm font-medium text-ink">
                  Zone de livraison <span className="text-danger" aria-hidden>*</span>
                </legend>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" id="deliveryZoneId" tabIndex={-1}>
                  {store.deliveryZones.map((z) => {
                    const active = zoneId === z.id;
                    return (
                      <label key={z.id} className={cn("flex min-h-14 cursor-pointer items-start gap-3 rounded-[14px] px-3.5 py-3 ring-1 ring-inset transition-colors", active ? "bg-[var(--store-primary-soft)] ring-2 ring-[var(--store-primary)]" : "ring-line-strong hover:bg-surface-2")}>
                        <input type="radio" name="deliveryZoneId" value={z.id} checked={active} onChange={() => setZoneId(setField("deliveryZoneId", z.id))} className="mt-0.5 size-5 accent-[var(--store-primary)]" />
                        <span className="min-w-0 flex-1 text-sm">
                          <span className="block font-medium text-ink">{z.name}</span>
                          <span className="block text-ink-muted">
                            {z.fee === 0 ? "Gratuit" : formatMoney(z.fee, store.currency)}
                            {z.etaLabel ? `, ${z.etaLabel}` : ""}
                          </span>
                          {z.freeAbove != null && <span className="block text-xs text-ink-muted">Offerte dès {formatMoney(z.freeAbove, store.currency)}</span>}
                        </span>
                      </label>
                    );
                  })}
                </div>
                {errors.deliveryZoneId && (
                  <p role="alert" className="mt-1.5 text-[13px] font-medium text-danger">
                    {errors.deliveryZoneId}
                  </p>
                )}
              </fieldset>
              <Field id="deliveryAddress" label="Adresse ou repère" required error={errors.deliveryAddress} hint="Quartier, rue, point de repère connu (pharmacie, carrefour, école…).">
                {(p) => (
                  <Textarea
                    {...p}
                    name="deliveryAddress"
                    rows={2}
                    maxLength={300}
                    autoComplete="street-address"
                    value={address}
                    onBlur={() => address && onBlurValidate("deliveryAddress")}
                    onChange={(e) => {
                      setSavedAddressId("");
                      setAddress(setField("deliveryAddress", e.target.value));
                    }}
                    className="min-h-20"
                  />
                )}
              </Field>
            </div>
          )}

          {mode === "PICKUP" && store.pickupSlots.length > 0 && (
            <div className="mt-5">
              <Field id="pickupSlotId" label={`${store.copy.slotLabel}${store.booking ? "" : " (facultatif)"}`} hint={store.booking ? "La boutique vous confirme l'horaire exact sur WhatsApp." : undefined}>
                {(p) => (
                  <Select {...p} name="pickupSlotId" value={slotId} onChange={(e) => setSlotId(e.target.value)}>
                    <option value="">{store.booking ? "Premier créneau disponible" : "Dès que possible"}</option>
                    {store.pickupSlots.map((s) => (
                      <option key={s.id} value={s.id}>
                        {dayLabelByIndex(s.dayOfWeek)}, {s.startTime} à {s.endTime}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
          )}

          {mode === "WHATSAPP" && <p className="mt-4 text-sm leading-relaxed text-ink-muted">Après validation, WhatsApp s&apos;ouvre avec votre récapitulatif prérempli. Le paiement et la remise se règlent directement avec {store.name}.</p>}
          {mode === "DIGITAL" && (
            <ul className="mt-4 space-y-1.5 text-sm text-ink-muted">
              {giftLines.map((l) => (
                <li key={l.key} className="flex gap-2">
                  <Gift className="mt-0.5 size-4 shrink-0 text-[var(--store-primary)]" aria-hidden />
                  <span>
                    {l.quantity} × {l.snapshot.name}
                    {l.snapshot.variantName ? ` (${l.snapshot.variantName})` : ""}
                    {l.giftCard?.recipientName ? `, pour ${l.giftCard.recipientName}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 3. Paiement et confirmation */}
        <section className={SECTION} aria-labelledby="step-3">
          <StepTitle id="step-3" n={3}>
            {mode === "WHATSAPP" ? "Confirmation" : "Paiement"}
          </StepTitle>

          {/* Avantages du compte : points de fidélité et avoir (acheteur connecté par code uniquement). */}
          {account && (pointsUsable > 0 || creditUsable > 0) && (
            <fieldset className="mt-5">
              <legend className="mb-2 text-sm font-medium text-ink">Vos avantages</legend>
              <div className="grid gap-2.5">
                {pointsUsable > 0 && (
                  <OptionToggle
                    checked={usePoints}
                    onChange={setUsePoints}
                    icon={Sparkles}
                    title={`Utiliser ${(usePoints && totals?.loyaltyPointsRedeemed ? totals.loyaltyPointsRedeemed : pointsUsable).toLocaleString("fr-FR")} points (−${formatMoney(usePoints && totals?.loyaltyDiscount ? totals.loyaltyDiscount : pointsValue, store.currency)})`}
                    hint={loyaltyCapped && usePoints ? loyaltyCapped.text : `Solde : ${acct!.loyaltyBalance.toLocaleString("fr-FR")} points.`}
                  />
                )}
                {creditUsable > 0 && (
                  <OptionToggle
                    checked={useCredit}
                    onChange={setUseCredit}
                    icon={Wallet}
                    title={`Utiliser mon avoir (${formatMoney(creditUsable, store.currency)})`}
                    hint={
                      useCredit && totals
                        ? totals.storeCreditAmount > 0
                          ? `${formatMoney(totals.storeCreditAmount, store.currency)} déduits de cette commande.`
                          : "Rien à déduire : vos cartes cadeaux couvrent déjà le montant. Votre avoir est conservé."
                        : "Déduit du montant à payer, après les cartes cadeaux."
                    }
                  />
                )}
              </div>
            </fieldset>
          )}

          {giftField && foreignDisplay && (
            <p className="mt-5 flex gap-2 text-sm text-ink-muted" id="gift-cards" tabIndex={-1}>
              <Gift className="mt-0.5 size-4 shrink-0" aria-hidden />
              Les cartes cadeaux s&apos;utilisent uniquement dans la devise de la boutique ({store.currency === "XOF" || store.currency === "XAF" ? "FCFA" : store.currency}). Changez la devise d&apos;affichage pour en utiliser une.
            </p>
          )}
          {giftField && !foreignDisplay && (
            <div className="mt-5" id="gift-cards" tabIndex={-1}>
              <GiftCardInput
                codes={giftCodes}
                onCodesChange={(next) => {
                  setGiftError(null);
                  setGiftCodes(next);
                  writeCartGiftCards(store.slug, next);
                }}
                applied={appliedCards}
                error={giftError}
                currency={store.currency}
                pending={previewing}
              />
            </div>
          )}

          {showPayment &&
            (nothingToPay ? (
              <p className="mt-5 flex items-start gap-3 rounded-[14px] bg-[var(--store-primary-soft)] px-4 py-3.5 text-sm text-ink" role="status">
                <Check className="mt-0.5 size-4 shrink-0 text-[var(--store-primary)]" aria-hidden />
                Rien à payer : votre commande est entièrement réglée par carte cadeau ou avoir.
              </p>
            ) : paymentMethods.length === 0 ? (
              <p className="mt-4 text-sm text-ink-muted">
                {codHidden ? (kinds.hasDigital ? "Les produits numériques se règlent avant la remise du fichier : le commerçant vous indique comment payer à la confirmation." : "Les cartes cadeaux se règlent avant leur envoi : le commerçant vous indique comment payer à la confirmation.") : "Le paiement sera convenu avec le commerçant à la confirmation de votre commande."}
              </p>
            ) : (
              <fieldset className="mt-5">
                <legend className="sr-only">Moyen de paiement</legend>
                {tendered > 0 && (
                  <p className="mb-2.5 text-sm text-ink">
                    Reste à payer : <strong className="tabular">{formatMoney(amountDue, store.currency)}</strong>
                  </p>
                )}
                <div className="grid gap-2.5" id="paymentMethodId" tabIndex={-1}>
                  {paymentMethods.map((pm) => {
                    const active = paymentMethodId === pm.id;
                    return (
                      <div key={pm.id} className={cn("overflow-hidden rounded-[16px] ring-1 ring-inset transition-[box-shadow,background-color] duration-200", active ? "bg-[var(--store-primary-soft)] ring-2 ring-[var(--store-primary)]" : "ring-line-strong")}>
                        <label className="flex min-h-14 cursor-pointer items-center gap-3 px-4 py-3">
                          <input type="radio" name="paymentMethodId" value={pm.id} checked={active} onChange={() => setPaymentMethodId(setField("paymentMethodId", pm.id))} className="size-5 accent-[var(--store-primary)]" />
                          <span className="text-[15px] font-medium text-ink">{pm.label}</span>
                          <span className="ml-auto rounded-full bg-surface px-2.5 py-0.5 text-xs text-ink-muted ring-1 ring-inset ring-line">{kindLabel(pm.kind)}</span>
                        </label>
                        {active && (
                          <div className="sf-pop border-t border-line/70 px-4 py-3.5 text-sm">
                            {pm.kind === "GATEWAY" && (
                              <div className="space-y-3">
                                {(pm.channels?.length ?? 0) > 0 && (
                                  <ul className="flex flex-wrap gap-1.5" aria-label="Portefeuilles acceptés">
                                    {pm.channels!.map((c) => (
                                      <li key={c} className="rounded-full bg-surface px-2.5 py-1 text-xs font-medium text-ink ring-1 ring-inset ring-line">
                                        {channelLabel(c)}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                                {pm.instructions && <p className="whitespace-pre-line text-ink">{pm.instructions}</p>}
                                {pm.provider && PUSH_PROVIDERS.has(pm.provider) && (pm.channels?.some((c) => c !== "card") ?? false) && (
                                  <div className="grid gap-3 sm:grid-cols-2">
                                    <Field id="paymentChannel" label="Portefeuille (facultatif)">
                                      {(p) => (
                                        <Select {...p} name="paymentChannel" value={walletChannel} onChange={(e) => setWalletChannel(e.target.value)}>
                                          <option value="">Je choisis sur la page de paiement</option>
                                          {pm.channels!.filter((c) => c !== "card").map((c) => (
                                            <option key={c} value={c}>
                                              {channelLabel(c)}
                                            </option>
                                          ))}
                                        </Select>
                                      )}
                                    </Field>
                                    {walletChannel && (
                                      <Field id="payerPhone" label="Numéro du portefeuille" hint="Laissez vide pour utiliser votre numéro de téléphone." error={errors.payerPhone}>
                                        {(p) => <Input {...p} name="payerPhone" type="tel" inputMode="tel" autoComplete="tel-national" placeholder={phone || phonePlaceholder(store.dialCode)} value={payerPhone} onChange={(e) => setPayerPhone(e.target.value)} />}
                                      </Field>
                                    )}
                                  </div>
                                )}
                                <p className="text-ink-muted">
                                  {walletChannel && pm.provider && PUSH_PROVIDERS.has(pm.provider)
                                    ? "Après confirmation, validez le paiement sur votre téléphone (notification ou code USSD)."
                                    : "Vous serez redirigé vers une page de paiement sécurisée après confirmation."}
                                </p>
                              </div>
                            )}
                            {pm.kind === "CASH_ON_DELIVERY" && <p className="text-ink-muted">Vous réglez en espèces à la remise de la commande.</p>}
                            {(pm.kind === "MOBILE_MONEY_MANUAL" || pm.kind === "BANK_TRANSFER_MANUAL") && (
                              <div className="space-y-3">
                                {pm.instructions && <p className="whitespace-pre-line text-ink">{pm.instructions}</p>}
                                {(pm.accountNumber || pm.accountName) && (
                                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-[12px] bg-surface px-3.5 py-2.5 ring-1 ring-inset ring-line">
                                    {pm.accountNumber && (
                                      <>
                                        <dt className="text-ink-muted">Numéro</dt>
                                        <dd className="font-mono font-semibold text-ink">{pm.accountNumber}</dd>
                                      </>
                                    )}
                                    {pm.accountName && (
                                      <>
                                        <dt className="text-ink-muted">Nom</dt>
                                        <dd className="font-semibold text-ink">{pm.accountName}</dd>
                                      </>
                                    )}
                                  </dl>
                                )}
                                {/* Mobile Money et virement manuels : jamais convertis, montant exact en devise boutique. */}
                                {pres && (
                                  <p className="text-ink">
                                    Montant à envoyer : <strong className="tabular">{formatMoney(amountDue, store.currency)}</strong>
                                  </p>
                                )}
                                <p className="text-xs text-ink-muted">Le commerçant vérifie votre paiement avant de confirmer la commande.</p>
                                <Field id="paymentReference" label="Référence de transaction (facultatif)">
                                  {(p) => <Input {...p} name="paymentReference" autoComplete="off" value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} />}
                                </Field>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {errors.paymentMethodId && (
                  <p role="alert" className="mt-1.5 text-[13px] font-medium text-danger">
                    {errors.paymentMethodId}
                  </p>
                )}
                {codHidden && <p className="mt-2 text-xs text-ink-muted">{kinds.hasDigital ? "Le paiement à la livraison n'est pas proposé pour une commande contenant un produit numérique." : "Le paiement à la livraison n'est pas proposé pour une commande avec carte cadeau."}</p>}
              </fieldset>
            ))}

          {!digitalOnly && (
            <div className="mt-6">
              <Field id="couponCode" label="Code promo" error={errors.couponCode}>
                {(p) => (
                  <div className="flex gap-2">
                    <Input {...p} name="couponCode" autoComplete="off" autoCapitalize="characters" value={couponInput} onChange={(e) => setCouponInput(setField("couponCode", e.target.value))} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), applyCoupon())} className="uppercase" />
                    <button type="button" onClick={applyCoupon} disabled={previewing || !couponInput.trim()} className="h-12 shrink-0 rounded-full px-5 text-sm font-semibold text-ink ring-1 ring-inset ring-line-strong transition-colors hover:bg-surface-2 disabled:opacity-50">
                      Appliquer
                    </button>
                  </div>
                )}
              </Field>
              {coupon && totals && (totals.couponApplied || totals.couponSuperseded) && (
                <p className={cn("mt-2 flex flex-wrap items-center gap-x-2 text-sm", totals.couponApplied ? SAVE_TONE : "text-ink-muted")} role="status">
                  {totals.couponApplied ? <Check className="size-4" aria-hidden /> : <Info className="size-4" aria-hidden />}
                  {totals.couponApplied ? (
                    <span>
                      Code <strong>{coupon}</strong> appliqué.
                    </span>
                  ) : (
                    <span>
                      Code <strong>{coupon}</strong> non cumulable : la meilleure offre est appliquée.
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setCoupon(null);
                      setCouponInput("");
                    }}
                    className="min-h-11 px-1 text-ink-muted underline underline-offset-2"
                  >
                    Retirer
                  </button>
                </p>
              )}
            </div>
          )}
          {store.companyInvoice && (
            <div className="mt-5 border-t border-line pt-5">
              <Checkbox name="asCompany" checked={asCompany} onChange={(e) => setAsCompany(e.target.checked)} label="Facture au nom d'une entreprise" description="La facture portera la raison sociale et le numéro fiscal indiqués." />
              {asCompany && (
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field id="buyerCompany" label="Raison sociale" required error={errors.buyerCompany}>
                    {(p) => <Input {...p} name="buyerCompany" autoComplete="organization" maxLength={120} value={buyerCompany} onChange={(e) => setBuyerCompany(setField("buyerCompany", e.target.value))} />}
                  </Field>
                  <Field id="buyerTaxId" label="Numéro fiscal (IFU, NIF…)" hint="Facultatif.">
                    {(p) => <Input {...p} name="buyerTaxId" autoComplete="off" maxLength={40} value={buyerTaxId} onChange={(e) => setBuyerTaxId(e.target.value)} />}
                  </Field>
                </div>
              )}
            </div>
          )}
          <div className="mt-5 border-t border-line pt-5">
            <Checkbox name="marketingConsent" checked={consent} onChange={(e) => setConsent(e.target.checked)} label={`Recevoir les offres de ${store.name} sur WhatsApp`} description="Facultatif. Désabonnement possible à tout moment." />
          </div>

          <button
            type="submit"
            disabled={submitting || previewing || belowMin || modes.length === 0 || !idempotencyKey || previewBlocking}
            aria-describedby="submit-hint"
            className={cn(
              "mt-7 inline-flex h-14 w-full items-center justify-center gap-2 rounded-full px-6 text-base font-semibold shadow-[0_14px_30px_-16px_rgb(0_0_0/0.55)] transition-[transform,opacity] duration-150 ease-out active:scale-[0.98] disabled:opacity-50",
              mode === "WHATSAPP" ? "bg-whatsapp-deep text-white" : "bg-[var(--store-primary)] text-[var(--store-primary-contrast)]",
            )}
          >
            {submitting ? <Loader2 className="size-5 animate-spin" aria-hidden /> : mode === "WHATSAPP" ? <MessageCircle className="size-5" aria-hidden /> : <Lock className="size-4" aria-hidden />}
            {submitting ? "Envoi en cours…" : `${submitLabel} · ${formatMoney(shown.amountDue, dc)}`}
          </button>
          <p id="submit-hint" className="mt-3 text-center text-xs leading-relaxed text-ink-muted">
            Le total définitif est calculé par la boutique. Aucun paiement n&apos;est prélevé sans votre action.
          </p>
        </section>
      </div>

      {/* Récapitulatif collant (desktop) */}
      <aside className="hidden lg:sticky lg:top-24 lg:block" aria-labelledby="recap-title">
        <div className="bezel">
          <div className="bezel-core p-6">
            <h2 id="recap-title" className="mb-5 text-base font-semibold text-ink">
              Récapitulatif
            </h2>
            {summary}
          </div>
        </div>
      </aside>
    </form>
  );
}

function StepTitle({ n, id, children, done }: { n: number; id: string; children: React.ReactNode; done?: boolean }) {
  return (
    <h2 id={id} className="flex items-center gap-3 text-lg font-semibold tracking-[-0.02em] text-ink">
      <span className={cn("inline-flex size-8 items-center justify-center rounded-full text-sm font-semibold tabular transition-colors duration-300", done ? "bg-[#0f6b3f] text-white" : "bg-[var(--store-primary)] text-[var(--store-primary-contrast)]")} aria-hidden>
        {done ? <Check className="sf-pop size-4" /> : n}
      </span>
      <span>
        <span className="sr-only">Étape {n} : </span>
        {children}
      </span>
    </h2>
  );
}

/** Case à cocher en carte (cible ≥ 56 px), état lisible sans la couleur (coche). */
function OptionToggle({ checked, onChange, icon: Icon, title, hint }: { checked: boolean; onChange: (v: boolean) => void; icon: typeof Store; title: string; hint?: string }) {
  return (
    <label className={cn("relative flex min-h-14 cursor-pointer items-center gap-3.5 rounded-[16px] px-4 py-3 ring-1 ring-inset transition-[box-shadow,background-color] duration-200", checked ? "bg-[var(--store-primary-soft)] ring-2 ring-[var(--store-primary)]" : "ring-line-strong hover:bg-surface-2")}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span className={cn("inline-flex size-10 shrink-0 items-center justify-center rounded-full", checked ? "bg-[var(--store-primary)] text-[var(--store-primary-contrast)]" : "bg-surface-2 text-ink")}>
        <Icon className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold text-ink">{title}</span>
        {hint && <span className="block text-sm text-ink-muted">{hint}</span>}
      </span>
      <span className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded-[7px] ring-1 ring-inset", checked ? "bg-[var(--store-primary)] text-[var(--store-primary-contrast)] ring-transparent" : "ring-line-strong")} aria-hidden>
        {checked && <Check className="sf-pop size-3.5" />}
      </span>
      <span className="pointer-events-none absolute inset-0 rounded-[16px] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--store-primary)]" aria-hidden />
    </label>
  );
}

function Row({ label, amount, currency, tone, free }: { label: string; amount: number; currency: string; tone?: string; free?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="min-w-0 text-ink-muted">{label}</dt>
      <dd className={cn("shrink-0 tabular", tone ?? "text-ink")}>
        {free ? (
          "Offerte"
        ) : amount < 0 ? (
          <>
            −<Money amount={-amount} currency={currency} />
          </>
        ) : (
          <Money amount={amount} currency={currency} />
        )}
      </dd>
    </div>
  );
}

function CheckoutSkeletonInline() {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-10" aria-busy="true" aria-label="Chargement du panier">
      <div className="space-y-5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-56 animate-pulse-soft rounded-[var(--store-card-radius)] bg-surface ring-1 ring-line" />
        ))}
      </div>
      <div className="hidden h-80 animate-pulse-soft rounded-[var(--radius-xl)] bg-surface ring-1 ring-line lg:block" />
    </div>
  );
}

function kindLabel(kind: CheckoutStore["paymentMethods"][number]["kind"]) {
  return { CASH_ON_DELIVERY: "À la livraison", MOBILE_MONEY_MANUAL: "Mobile Money", BANK_TRANSFER_MANUAL: "Virement", GATEWAY: "En ligne" }[kind];
}

/** UUID v4 ; repli sur getRandomValues pour les WebViews sans randomUUID (contexte non sécurisé). */
function makeIdempotencyKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
