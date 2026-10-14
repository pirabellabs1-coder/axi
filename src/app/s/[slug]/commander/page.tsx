import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StoreChrome } from "@/components/storefront/storefront-view";
import { ChevronLeft, Lock } from "lucide-react";
import { getStorefront } from "@/lib/storefront/data";
import { storefrontPreset } from "@/lib/storefront/theme";
import { getUsage } from "@/lib/commerce/quotas";
import { effectivePlanId } from "@/lib/auth/permissions";
import { PLANS } from "@/config/plans";
import { getCountry } from "@/config/site";
import { Alert } from "@/components/ui/misc";
import { storePath } from "@/components/storefront/format";
import { db } from "@/lib/db";
import { getBuyer } from "@/lib/buyer/session";
import { getBuyerKillSwitch } from "@/lib/buyer/settings";
import { getGiftCardsKillSwitch } from "@/lib/giftcards/kill-switch";
import { getCurrencyPickerData } from "@/lib/currency/display";
import { CurrencyPicker } from "@/components/storefront/currency-picker";
import { CheckoutForm, type CheckoutAccount, type CheckoutStore } from "./checkout-form";

export const metadata: Metadata = { title: "Commander", robots: { index: false } };

export default async function CheckoutPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const store = (await getStorefront(slug))?.store;
  if (!store) notFound();
  const country = getCountry(store.country);
  const preset = storefrontPreset(store.sector, store.themeId);

  // V4 §13 : plan Gratuit au-delà du quota mensuel → on ne bloque pas, on met la commande WhatsApp en avant.
  const planId = effectivePlanId(store.subscription);
  const limit = PLANS[planId].limits.ordersPerMonth;
  const quotaReached = planId === "FREE" && limit != null ? (await getUsage(store.id, "orders")) >= limit : false;

  // Lot 1 : acheteur connecté par code (coordonnées, adresses, points et avoir), cartes cadeaux, offres.
  const features = PLANS[planId].features;
  const [buyer, buyerKill, giftKill, activeCards, currencyPicker, methodCurrencies] = await Promise.all([
    store.accountsEnabled ? getBuyer(store).catch(() => null) : Promise.resolve(null),
    getBuyerKillSwitch().catch(() => ({ enabled: false, message: "" })),
    getGiftCardsKillSwitch().catch(() => ({ enabled: false, message: "" })),
    features.giftCards ? Promise.resolve(1) : db.giftCard.count({ where: { storeId: store.id, status: "ACTIVE", balance: { gt: 0 } } }),
    // Lot 2 : devise d'affichage (sélecteur) et devises encaissables par moyen de paiement.
    getCurrencyPickerData(store).catch(() => null),
    db.paymentMethod.findMany({ where: { storeId: store.id, active: true }, select: { id: true, currencies: true, channels: true } }),
  ]);
  const currenciesById = new Map(methodCurrencies.map((m) => [m.id, m.currencies]));
  // Lot 1 bis : portefeuilles proposés par les moyens en ligne (pastilles et choix pour la demande poussée).
  const channelsById = new Map(methodCurrencies.map((m) => [m.id, m.channels]));
  let account: CheckoutAccount | null = null;
  if (buyer) {
    const addresses = await db.customerAddress.findMany({
      where: { storeId: store.id, customerId: buyer.customerId },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
      take: 10,
      select: { id: true, label: true, address: true, landmark: true, city: true, deliveryZoneId: true, isDefault: true },
    });
    const c = buyer.customer;
    const national = c.phone.startsWith(country.dialCode) ? c.phone.slice(country.dialCode.length) : c.phone;
    account = {
      // Nouveau compte : le nom par défaut est le numéro formaté, on laisse l'acheteur saisir son nom.
      name: /^[+\d\s().-]+$/.test(c.name) ? "" : c.name,
      phone: national,
      phoneLocked: !!c.phoneVerifiedAt,
      email: c.email ?? "",
      addresses: addresses.map((a) => ({ id: a.id, label: a.label, text: [a.address, a.landmark, a.city].filter(Boolean).join(", ").slice(0, 300), zoneId: a.deliveryZoneId, isDefault: a.isDefault })),
    };
  }

  const data: CheckoutStore = {
    slug: store.slug,
    name: store.name,
    currency: store.currency,
    dialCode: country.dialCode,
    countryName: country.name,
    minOrderAmount: store.minOrderAmount,
    orderNotes: store.orderNotes,
    pickupEnabled: store.pickupEnabled,
    deliveryEnabled: store.deliveryEnabled && store.deliveryZones.length > 0,
    whatsappOrdering: store.whatsappOrdering && !!store.whatsappNumber,
    deliveryZones: store.deliveryZones.map((z) => ({ id: z.id, name: z.name, fee: z.fee, freeAbove: z.freeAbove, etaLabel: z.etaLabel })),
    pickupSlots: store.pickupSlots.map((s) => ({ id: s.id, dayOfWeek: s.dayOfWeek, startTime: s.startTime, endTime: s.endTime })),
    // Jamais de clés de passerelle ici : seuls les champs publics sont sélectionnés dans getPublicStore.
    paymentMethods: store.paymentMethods.map((p) => ({ id: p.id, kind: p.kind, provider: p.provider, label: p.label, instructions: p.instructions, accountNumber: p.accountNumber, accountName: p.accountName, currencies: currenciesById.get(p.id) ?? [], channels: p.kind === "GATEWAY" ? (channelsById.get(p.id) ?? []) : [] })),
    booking: preset.booking,
    copy: { pickupTitle: preset.copy.pickupTitle, pickupHint: preset.copy.pickupHint, slotLabel: preset.copy.slotLabel, confirmLabel: preset.copy.confirmLabel },
    preferWhatsapp: quotaReached,
    accountsEnabled: store.accountsEnabled && !buyerKill.enabled,
    giftCardsEnabled: !giftKill.enabled && activeCards > 0,
    cartOffersEnabled: features.cartOffers,
    // Lot 2 : facture au nom d'une entreprise proposée quand la boutique applique les taxes (plan compris).
    companyInvoice: !!store.taxesEnabled && features.taxes,
    displayCurrency: currencyPicker?.current ?? store.currency,
  };

  return (
    <StoreChrome slug={store.slug}>
    <div className="sf-container max-w-[1120px] pb-16 pt-4 sm:pt-8">
      <Link href={storePath(store.slug)} className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-full px-2 text-sm text-ink-muted hover:text-ink">
        <ChevronLeft className="size-4" aria-hidden /> Continuer mes achats
      </Link>
      <div className="mb-6 mt-2 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-[clamp(1.75rem,4vw,2.4rem)] font-semibold leading-[1.05] tracking-[-0.035em] text-ink">{preset.copy.checkoutTitle}</h1>
        <div className="flex flex-wrap items-center gap-3">
          <p className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
            <Lock className="size-3.5" aria-hidden /> {account ? `Connecté${account.name ? ` : ${account.name}` : ""}. Vos données restent chez ${store.name}.` : `Sans compte. Vos données restent chez ${store.name}.`}
          </p>
          {currencyPicker && <CurrencyPicker {...currencyPicker} compact className="text-ink" />}
        </div>
      </div>
      {store.status === "CLOSED_TEMPORARILY" ? (
        <Alert tone="warning" title="Boutique temporairement fermée">
          Les commandes sont suspendues pour le moment. Votre panier est conservé sur cet appareil.{" "}
          <Link href={storePath(store.slug)} className="font-semibold underline underline-offset-2">
            Retour à la boutique
          </Link>
        </Alert>
      ) : (
        <CheckoutForm store={data} account={account} />
      )}
    </div>
    </StoreChrome>
  );
}
