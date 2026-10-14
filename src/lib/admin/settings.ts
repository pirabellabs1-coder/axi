import "server-only";
import { db } from "@/lib/db";

/**
 * Paramètres plateforme (PlatformSetting clé / valeur JSON), lus côté serveur.
 * Points d'intégration hors console :
 *  - marketplace : `getMarketplaceMaintenance()` à lire par /marketplace pour afficher le bandeau
 *    de maintenance et masquer la liste ;
 *  - paiement manuel : `getManualPaymentDetails()` remplace la lecture directe de
 *    PLATFORM_MOMO_NUMBER / PLATFORM_BANK_DETAILS (src/lib/billing/platform-billing.ts).
 */
export const SETTING_KEYS = {
  maintenance: "marketplace.maintenance",
  manualPayment: "billing.manual_payment",
} as const;

export type MarketplaceMaintenance = { enabled: boolean; message: string };
export type ManualPaymentDetails = { momoNumber: string; momoName: string; bankDetails: string; instructions: string };

async function read<T>(key: string): Promise<Partial<T> | null> {
  const row = await db.platformSetting.findUnique({ where: { key } });
  return row?.value && typeof row.value === "object" && !Array.isArray(row.value) ? (row.value as Partial<T>) : null;
}

export async function getMarketplaceMaintenance(): Promise<MarketplaceMaintenance> {
  const v = await read<MarketplaceMaintenance>(SETTING_KEYS.maintenance);
  return { enabled: v?.enabled === true, message: typeof v?.message === "string" ? v.message : "" };
}

export async function getManualPaymentDetails(): Promise<ManualPaymentDetails & { source: "console" | "environment" }> {
  const v = await read<ManualPaymentDetails>(SETTING_KEYS.manualPayment);
  if (v) {
    return { momoNumber: v.momoNumber ?? "", momoName: v.momoName ?? "", bankDetails: v.bankDetails ?? "", instructions: v.instructions ?? "", source: "console" };
  }
  return { momoNumber: process.env.PLATFORM_MOMO_NUMBER ?? "", momoName: "", bankDetails: process.env.PLATFORM_BANK_DETAILS ?? "", instructions: "", source: "environment" };
}

/** État des intégrations lu depuis l'environnement : uniquement « configuré » ou non, jamais la valeur. */
export type IntegrationStatus = { key: string; label: string; detail: string; configured: boolean; mode?: string; vars: string[] };

const has = (name: string) => !!process.env[name]?.trim();

export function integrationStatuses(): { group: string; items: IntegrationStatus[] }[] {
  const emailProvider = (process.env.EMAIL_PROVIDER ?? "").trim().toLowerCase() || "console";
  const providerAfrica = (process.env.PLATFORM_BILLING_PROVIDER_AFRICA ?? process.env.PLATFORM_BILLING_PROVIDER ?? "manual").trim().toLowerCase() || "manual";
  const providerWorld = (process.env.PLATFORM_BILLING_PROVIDER_WORLD ?? process.env.PLATFORM_BILLING_PROVIDER ?? "manual").trim().toLowerCase() || "manual";
  const africa = ["manual", "fedapay", "kkiapay"].includes(providerAfrica) ? providerAfrica : "manual";
  const world = ["manual", "stripe"].includes(providerWorld) ? providerWorld : "manual";
  const keysFor = (p: string) => (p === "fedapay" ? ["FEDAPAY_SECRET_KEY", "FEDAPAY_WEBHOOK_SECRET"] : p === "kkiapay" ? ["KKIAPAY_PUBLIC_KEY", "KKIAPAY_PRIVATE_KEY", "KKIAPAY_SECRET"] : p === "stripe" ? ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"] : []);
  const label = (p: string) => ({ manual: "Paiement manuel", fedapay: "FedaPay", kkiapay: "KkiaPay", stripe: "Stripe" })[p] ?? p;
  return [
    {
      group: "E-mail transactionnel",
      items: [
        {
          key: "email",
          label: emailProvider === "resend" ? "Resend" : emailProvider === "console" ? "Console (développement)" : `Fournisseur inconnu : ${emailProvider}`,
          detail: emailProvider === "console" ? "Les e-mails sont écrits dans les journaux du serveur : interdit en production." : "Codes de vérification, factures, notifications.",
          configured: emailProvider === "resend" && has("RESEND_API_KEY") && has("EMAIL_FROM"),
          mode: emailProvider,
          vars: ["EMAIL_PROVIDER", "RESEND_API_KEY", "EMAIL_FROM"],
        },
      ],
    },
    {
      group: "Facturation des abonnements",
      items: [
        { key: "billing-africa", label: `Zone Afrique : ${label(africa)}`, detail: "Mobile Money (FCFA). Le mode manuel passe par « J'ai payé » puis validation.", configured: africa === "manual" ? true : keysFor(africa).every(has), mode: africa === "manual" ? "manuel" : (process.env[africa === "fedapay" ? "FEDAPAY_MODE" : "KKIAPAY_MODE"] ?? "sandbox"), vars: ["PLATFORM_BILLING_PROVIDER_AFRICA", ...keysFor(africa)] },
        { key: "billing-world", label: `Zone Monde : ${label(world)}`, detail: "Carte bancaire (EUR) via Stripe Checkout, ou virement manuel.", configured: world === "manual" ? true : keysFor(world).every(has), mode: world === "manual" ? "manuel" : process.env.STRIPE_SECRET_KEY?.startsWith("sk_live") ? "live" : "test", vars: ["PLATFORM_BILLING_PROVIDER_WORLD", ...keysFor(world)] },
      ],
    },
    {
      group: "Passerelles des boutiques",
      items: [
        { key: "gw-fedapay", label: "FedaPay", detail: "Clés saisies par chaque marchand, chiffrées en base. Webhooks vérifiés par signature.", configured: true, mode: "par boutique", vars: [] },
        { key: "gw-kkiapay", label: "KkiaPay", detail: "Clés par boutique. Rapprochement manuel disponible dans Paiements.", configured: true, mode: "par boutique", vars: [] },
      ],
    },
    {
      group: "WhatsApp et IA",
      items: [
        { key: "whatsapp", label: "WhatsApp Cloud API", detail: "Webhook Meta : jeton de vérification et secret d'application.", configured: has("WHATSAPP_VERIFY_TOKEN") && has("WHATSAPP_APP_SECRET"), vars: ["WHATSAPP_VERIFY_TOKEN", "WHATSAPP_APP_SECRET"] },
        { key: "ai", label: "Assistant IA", detail: "Rédaction produit, résumés, réponses suggérées.", configured: has("ANTHROPIC_API_KEY"), vars: ["ANTHROPIC_API_KEY"] },
        { key: "jobs", label: "Tâches planifiées", detail: "Clé du point d'entrée cron /api/jobs/run.", configured: has("JOBS_RUN_KEY") || has("CRON_SECRET"), vars: ["JOBS_RUN_KEY", "CRON_SECRET"] },
      ],
    },
  ];
}
