import "server-only";
import { getManualPaymentDetails } from "@/lib/admin/settings";
import type { Invoice } from "@prisma/client";
import { SITE } from "@/config/site";
import type { PricingZone } from "@/config/plans";
import { GATEWAYS } from "@/lib/payments/gateways";
import type { GatewayCredentials, WebhookVerification } from "@/lib/payments/provider";

/**
 * ┌────────────────────────────────────────────────────────────────────────────────┐
 * │  POINT D'INTÉGRATION LAISSÉ AU PORTEUR : encaissement des abonnements Axi      │
 * │  La plateforme encaisse uniquement ses abonnements et options (jamais les      │
 * │  ventes des boutiques, 0 % de commission).                                    │
 * └────────────────────────────────────────────────────────────────────────────────┘
 *
 * Choix du fournisseur par zone tarifaire (src/config/plans.ts) :
 *  - Zone AFRICA (FCFA) : Mobile Money via FedaPay ou KkiaPay.
 *      PLATFORM_BILLING_PROVIDER_AFRICA = manual (défaut) | fedapay | kkiapay
 *      Pas de prélèvement automatique en Mobile Money : un lien de paiement est envoyé
 *      RENEWAL_LINK_DAYS_BEFORE (3) jours avant l'échéance (voir lifecycle.ts).
 *  - Zone WORLD (EUR) : carte via Stripe Checkout (mode=payment, une session par facture).
 *      PLATFORM_BILLING_PROVIDER_WORLD = manual (défaut) | stripe
 *  - PLATFORM_BILLING_PROVIDER (ancienne variable unique) sert de repli si compatible avec la zone.
 *
 * Clés (variables d'environnement, jamais en base ni dans le code) :
 *  - FedaPay : FEDAPAY_SECRET_KEY, FEDAPAY_WEBHOOK_SECRET, FEDAPAY_MODE (live | sandbox)
 *  - KkiaPay : KKIAPAY_PUBLIC_KEY, KKIAPAY_PRIVATE_KEY, KKIAPAY_SECRET, KKIAPAY_MODE (live | sandbox)
 *  - Stripe  : STRIPE_SECRET_KEY (sk_test_… en développement), STRIPE_WEBHOOK_SECRET (whsec_…)
 *
 * Les appels HTTP réutilisent les adaptateurs de src/lib/payments/gateways.ts (même contrat,
 * même vérification de signature) avec les clés de la PLATEFORME. Webhook à déclarer chez le
 * fournisseur : {APP_URL}/api/webhooks/billing/{fedapay|kkiapay|stripe}.
 * Règle d'or : une facture n'est « payée » que sur webhook signé (ou action admin), jamais sur
 * la simple redirection navigateur.
 *
 * Mode `manual` (défaut, fonctionnel sans clé) : le marchand paie hors ligne (Mobile Money sur
 * PLATFORM_MOMO_NUMBER en zone Afrique, virement sur PLATFORM_BANK_DETAILS en zone Monde) puis
 * clique « J'ai payé » : un ticket support est créé, l'admin marque la facture payée.
 */

export type PlatformBillingProvider = "manual" | "fedapay" | "kkiapay" | "stripe";

const AFRICA_PROVIDERS: PlatformBillingProvider[] = ["manual", "fedapay", "kkiapay"];
const WORLD_PROVIDERS: PlatformBillingProvider[] = ["manual", "stripe"];

function readProvider(v: string | undefined): PlatformBillingProvider | null {
  const p = (v ?? "").trim().toLowerCase();
  return (["manual", "fedapay", "kkiapay", "stripe"] as const).includes(p as PlatformBillingProvider) ? (p as PlatformBillingProvider) : null;
}

/** Fournisseur de facturation pour une zone tarifaire. */
export function platformProviderFor(zone: PricingZone): PlatformBillingProvider {
  const allowed = zone === "AFRICA" ? AFRICA_PROVIDERS : WORLD_PROVIDERS;
  const specific = readProvider(zone === "AFRICA" ? process.env.PLATFORM_BILLING_PROVIDER_AFRICA : process.env.PLATFORM_BILLING_PROVIDER_WORLD);
  if (specific && allowed.includes(specific)) return specific;
  const legacy = readProvider(process.env.PLATFORM_BILLING_PROVIDER);
  if (legacy && allowed.includes(legacy)) return legacy;
  return "manual";
}

/** Compatibilité : fournisseur par défaut (zone Afrique, marché principal). */
export function platformBillingProvider(zone: PricingZone = "AFRICA"): PlatformBillingProvider {
  return platformProviderFor(zone);
}

export const PROVIDER_LABEL: Record<PlatformBillingProvider, string> = {
  manual: "Paiement manuel",
  fedapay: "FedaPay (Mobile Money)",
  kkiapay: "KkiaPay (Mobile Money)",
  stripe: "Stripe (carte bancaire)",
};

/** Numéro Mobile Money de la plateforme (mode manuel, zone Afrique). */
export async function platformMomoNumber(): Promise<string> {
  const manual = await getManualPaymentDetails();
  return manual.momoNumber.trim() || SITE.supportWhatsapp;
}

/** Coordonnées bancaires de la plateforme (mode manuel, zone Monde). */
export async function platformBankDetails(): Promise<string | null> {
  const manual = await getManualPaymentDetails();
  return manual.bankDetails.trim() || null;
}

/** Clés de la plateforme pour un fournisseur (lues dans l'environnement). */
export function platformCredentials(provider: PlatformBillingProvider): GatewayCredentials {
  switch (provider) {
    case "fedapay":
      return { secretKey: process.env.FEDAPAY_SECRET_KEY ?? "", webhookSecret: process.env.FEDAPAY_WEBHOOK_SECRET ?? "", mode: process.env.FEDAPAY_MODE ?? "sandbox" };
    case "kkiapay":
      return { publicKey: process.env.KKIAPAY_PUBLIC_KEY ?? "", privateKey: process.env.KKIAPAY_PRIVATE_KEY ?? "", secret: process.env.KKIAPAY_SECRET ?? "", mode: process.env.KKIAPAY_MODE ?? "sandbox" };
    case "stripe":
      return { secretKey: process.env.STRIPE_SECRET_KEY ?? "", webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "" };
    default:
      return {};
  }
}

/** Le fournisseur en ligne est-il configuré (clés présentes) ? */
export function providerReady(provider: PlatformBillingProvider): boolean {
  const c = platformCredentials(provider);
  if (provider === "fedapay" || provider === "stripe") return !!c.secretKey;
  if (provider === "kkiapay") return !!c.publicKey && !!c.privateKey;
  return false;
}

export type CheckoutResult = { ok: true; redirectUrl: string; providerRef: string } | { ok: false; error: string };

/**
 * Crée une session de paiement chez le fournisseur et renvoie l'URL de redirection.
 * POINT D'INTÉGRATION : vérifiez en mode test (clés sandbox / sk_test_) avant la mise en production.
 */
export async function createPlatformCheckout(
  invoice: Invoice,
  ctx: { zone: PricingZone; storeName: string; email?: string | null; phone?: string | null; label: string },
  opts: { returnUrl: string; cancelUrl: string },
): Promise<CheckoutResult> {
  const provider = platformProviderFor(ctx.zone);
  if (provider === "manual") return { ok: false, error: "Le paiement en ligne n'est pas encore activé. Utilisez le paiement manuel ci-dessous." };
  if (!providerReady(provider)) return { ok: false, error: `${PROVIDER_LABEL[provider]} : clés non configurées sur la plateforme.` };
  if (provider === "kkiapay") {
    // KkiaPay fonctionne par widget côté client (clé publique KKIAPAY_PUBLIC_KEY) : à intégrer sur la page facture,
    // puis vérifier la transaction côté serveur (GATEWAYS.kkiapay.fetchStatus) avant confirmInvoicePayment().
    return { ok: false, error: "KkiaPay : widget de paiement à intégrer (point d'intégration). Utilisez le paiement manuel en attendant." };
  }
  const gateway = GATEWAYS[provider];
  const r = await gateway.initiate(
    {
      attemptId: invoice.id, // repris dans metadata / client_reference_id : le webhook retrouve la facture
      orderReference: invoice.number,
      amount: invoice.amount, // EUR en centimes, XOF entier : unités natives des fournisseurs
      currency: invoice.currency,
      customer: { name: ctx.storeName, phone: ctx.phone ?? "", email: ctx.email ?? null },
      returnUrl: opts.returnUrl,
      cancelUrl: opts.cancelUrl,
      callbackUrl: `${SITE.url}/api/webhooks/billing/${provider}`,
      description: `${SITE.name} : ${ctx.label} (facture ${invoice.number})`,
    },
    platformCredentials(provider),
  );
  return r;
}

/** Statut d'une session / transaction plateforme chez le fournisseur (UNKNOWN si non vérifiable). */
export async function fetchPlatformStatus(provider: PlatformBillingProvider, providerRef: string): Promise<"CONFIRMED" | "FAILED" | "PENDING" | "EXPIRED" | "UNKNOWN"> {
  if (provider === "manual" || !providerReady(provider)) return "UNKNOWN";
  try {
    return await GATEWAYS[provider].fetchStatus(providerRef, platformCredentials(provider));
  } catch {
    return "UNKNOWN";
  }
}

/** Vérifie la signature d'un webhook de facturation plateforme. */
export async function verifyPlatformWebhook(provider: PlatformBillingProvider, rawBody: string, headers: Headers): Promise<WebhookVerification> {
  if (provider === "manual") return { ok: false, error: "Fournisseur manuel : aucun webhook." };
  return GATEWAYS[provider].verifyWebhook(rawBody, headers, platformCredentials(provider));
}
