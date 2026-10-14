import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { nextBillingTransition } from "./billing";

/**
 * Cycle de vie de la facturation des apps (phase D), à exécuter régulièrement.
 * Unique transition automatique sans provider de paiement : fin d'essai (trialing → active).
 *
 * BRANCHEMENT : appelée en fin de `runBillingLifecycle()` (src/lib/billing/lifecycle.ts), donc sur la
 * même cadence de cron que la facturation plateforme — pas de nouveau JobType ni de worker dédié.
 * Idempotent (verrou optimiste par updateMany sur billingStatus = "trialing").
 */
export async function runAppBillingLifecycle(now = new Date()): Promise<{ transitioned: number }> {
  const candidates = await db.appInstallation.findMany({
    where: { status: "ACTIVE", billingStatus: "trialing", trialEndsAt: { lte: now } },
    select: { id: true, storeId: true, appId: true, billingStatus: true, trialEndsAt: true },
    take: 500,
  });
  let transitioned = 0;
  for (const inst of candidates) {
    const next = nextBillingTransition(inst, now);
    if (!next) continue;
    // Revérifié dans la transition : une annulation / désinstallation entre-temps n'est jamais écrasée.
    const r = await db.appInstallation.updateMany({
      where: { id: inst.id, status: "ACTIVE", billingStatus: "trialing" },
      data: { billingStatus: next },
    });
    if (r.count === 0) continue;
    transitioned++;
    await audit({ storeId: inst.storeId, action: "app.billing.trial_ended", target: inst.appId, metadata: { installationId: inst.id, to: next } });
  }
  return { transitioned };
}
