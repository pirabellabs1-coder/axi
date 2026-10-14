import { NextResponse, type NextRequest } from "next/server";
import { isPlaceholderSecret, safeEqual } from "@/lib/crypto";
import { runJobs } from "@/lib/jobs";
import { purgeProviderEvents, reconcilePendingAttempts } from "@/lib/payments/service";
import { runBillingLifecycle } from "@/lib/billing/lifecycle";
import { runDueCampaigns } from "@/lib/campaigns/service";
import { grantMonthlyCredits } from "@/lib/credits";
import { db } from "@/lib/db";
import { claimSweep, runTimeTriggers } from "@/lib/automations/sweep";
import { runNotificationSweep } from "@/lib/notifications/sweep";
import { runDailyReports } from "@/lib/reports/daily";
import { purgeMcpData } from "@/lib/mcp/runtime";
import { purgeBuyerAuthData } from "@/lib/buyer/purge";
import { scheduleDailyGiftCardSweeps } from "@/lib/giftcards/schedule";
import { purgeOrphanReturnPhotos } from "@/lib/returns/photo-purge";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Worker de tâches déclenché par un cron (Vercel Cron, GitHub Actions, crontab…).
 * Auth (m15) : en-tête `x-jobs-key` égal à JOBS_RUN_KEY (jamais dans l'URL : elle finirait dans les
 * journaux d'accès), comparaison en temps constant.
 * Vercel Cron envoie `Authorization: Bearer <CRON_SECRET>` : accepté aussi si CRON_SECRET est défini.
 * m16 : en production, une clé contenant « change-me » est considérée comme non configurée.
 */
function configuredSecret(value: string | undefined): string | null {
  if (!value) return null;
  if (process.env.NODE_ENV === "production" && isPlaceholderSecret(value)) return null;
  return value;
}

function isAuthorized(req: NextRequest): boolean {
  const expected = configuredSecret(process.env.JOBS_RUN_KEY);
  const provided = req.headers.get("x-jobs-key");
  if (expected && provided && safeEqual(provided, expected)) return true;
  const cronSecret = configuredSecret(process.env.CRON_SECRET);
  const auth = req.headers.get("authorization");
  if (cronSecret && auth && safeEqual(auth, `Bearer ${cronSecret}`)) return true;
  return false;
}

async function handle(req: NextRequest) {
  if (!configuredSecret(process.env.JOBS_RUN_KEY) && !configuredSecret(process.env.CRON_SECRET)) {
    if (process.env.JOBS_RUN_KEY || process.env.CRON_SECRET) console.error("[jobs/run] JOBS_RUN_KEY / CRON_SECRET contient « change-me » : refusé en production.");
    return NextResponse.json({ ok: false, error: "JOBS_RUN_KEY non configurée" }, { status: 503 });
  }
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Non autorisé" }, { status: 401 });
  }
  const startedAt = Date.now();
  try {
    // Cartes cadeaux : balayages quotidiens (expiration, impayés avec tenders), un enqueue idempotent par jour.
    try {
      await scheduleDailyGiftCardSweeps();
    } catch (e) {
      console.error("[jobs/run] giftcards schedule", e);
    }
    // Lot 2 : taux de change (BCE + parités fixes) une fois par jour UTC ; purge quotidienne des clés d'idempotence REST.
    try {
      await (await import("@/lib/currency/rates")).scheduleDailyFxRefresh();
    } catch (e) {
      console.error("[jobs/run] fx", e);
    }
    try {
      await (await import("@/lib/api/idempotency")).scheduleIdempotencyPurge();
    } catch (e) {
      console.error("[jobs/run] idempotency purge", e);
    }
    // Lot 3 : réconciliation du stock par dépôt et relève des transporteurs sans webhook, une fois par jour UTC.
    try {
      await (await import("@/lib/inventory/schedule")).scheduleDailyOperationsJobs();
    } catch (e) {
      console.error("[jobs/run] operations schedule", e);
    }
    const jobs = await runJobs(50);
    let reconciliation: { checked: number; updated: number } | { error: string };
    try {
      reconciliation = await reconcilePendingAttempts();
    } catch (e) {
      reconciliation = { error: String((e as Error).message).slice(0, 300) };
    }
    let billing: { subscriptions: number; stores: number } | { error: string };
    try {
      billing = await runBillingLifecycle();
    } catch (e) {
      billing = { error: String((e as Error).message).slice(0, 300) };
    }
    // Campagnes planifiées arrivées à échéance
    let campaigns: unknown;
    try {
      campaigns = await runDueCampaigns();
    } catch (e) {
      campaigns = { error: String((e as Error).message).slice(0, 300) };
    }
    // Crédits inclus du mois (idempotent : une attribution par mois et par type).
    // Droit vérifié par grantMonthlyCredits : essai en cours, ou facture PAYÉE couvrant la période.
    let credits = 0;
    try {
      const subs = await db.subscription.findMany({ where: { planId: { not: "FREE" }, status: { in: ["TRIALING", "ACTIVE", "PAST_DUE"] } }, select: { storeId: true } });
      for (const s of subs) {
        try {
          const g = await grantMonthlyCredits(s.storeId);
          if (Object.keys(g).length) credits++;
        } catch (e) {
          console.error("[jobs/run] credits", s.storeId, e);
        }
      }
    } catch (e) {
      console.error("[jobs/run] credits", e);
    }
    // Balayage périodique (au plus toutes les 9 minutes, verrou global) : déclencheurs temporels des
    // automatisations, flux de notifications, récapitulatifs quotidiens. Chaque étape est isolée.
    let sweep: unknown = { skipped: true };
    try {
      const claim = await claimSweep();
      if (claim) {
        const since = claim.previous ?? new Date(Date.now() - 60 * 60_000);
        const step = async <T,>(fn: () => Promise<T>) => {
          try {
            return await fn();
          } catch (e) {
            console.error("[jobs/run] sweep", e);
            return { error: String((e as Error).message).slice(0, 300) };
          }
        };
        sweep = {
          automations: await step(() => runTimeTriggers()),
          notifications: await step(() => runNotificationSweep(since)),
          dailyReports: await step(() => runDailyReports()),
          // Connecteurs IA : journal > 30 jours, codes et jetons OAuth expirés
          mcpPurge: await step(() => purgeMcpData()),
          // Comptes acheteurs (job otp.purge) : IP des codes à 30 jours, codes et sessions périmés
          buyerAuthPurge: await step(() => purgeBuyerAuthData()),
          // Retours : photos acheteur non rattachées à une demande après 24 h (objet supprimé, quota rendu)
          returnPhotosPurge: await step(() => purgeOrphanReturnPhotos()),
          // m3 : journal technique des webhooks de paiement (projection sans corps brut) au-delà de 90 jours
          providerEventsPurge: await step(() => purgeProviderEvents()),
          // Lot 3 : jetons de la page livreur des expéditions clôturées depuis plus de 24 h
          courierTokensPurge: await step(async () => (await import("@/lib/shipping/token-purge")).purgeFinishedCourierTokens()),
          catalogSync: await step(async () => (await import("@/lib/social/sync")).scheduleDueCatalogSyncs()), // lot 1 bis (P2) : catalogue WhatsApp
        };
      }
    } catch (e) {
      sweep = { error: String((e as Error).message).slice(0, 300) };
    }
    return NextResponse.json({ ok: true, jobs, reconciliation, billing, campaigns, credits, sweep, durationMs: Date.now() - startedAt, at: new Date().toISOString() });
  } catch (e) {
    console.error("[jobs/run]", e);
    return NextResponse.json({ ok: false, error: "Échec du worker", durationMs: Date.now() - startedAt }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
