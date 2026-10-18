/**
 * Suppression du plan Gratuit (décision du 18/10/2026) : migration des abonnements Gratuits existants.
 *
 *   pnpm billing:migrate-free --dry-run   # inventaire, aucune écriture
 *   pnpm billing:migrate-free             # applique
 *
 * Boutique secondaire d'un compte ayant une autre boutique avec un abonnement ouvrant droit : rattachée à celui-ci.
 * Sinon, chaque abonnement ACTIVE + FREE reçoit un NOUVEL ESSAI Business de
 * 14 jours à compter de l'exécution (mise en production), avec une notification in-app ; les rappels J-3 / J-1
 * puis la mise en pause suivent par le cycle de facturation (cron /api/jobs/run). Rien n'est supprimé.
 *
 * IDEMPOTENT : verrou optimiste (ACTIVE + FREE) et marqueur d'audit `subscription.free_plan_migrated` par
 * abonnement ; une seconde exécution ne trouve plus rien à migrer et n'accorde jamais un second essai.
 * Le cycle de facturation exécute aussi cette étape (filet de sécurité si le script n'a pas été lancé).
 */
export {};
type LoadEnvFile = (path?: string) => void;
const loadEnv = (process as unknown as { loadEnvFile?: LoadEnvFile }).loadEnvFile;
if (typeof loadEnv === "function") {
  try {
    loadEnv(".env");
  } catch {
    // pas de .env : on s'appuie sur l'environnement du shell
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL manquante.");
    process.exit(1);
  }
  const dryRun = process.argv.includes("--dry-run");
  const { db } = await import("../src/lib/db");
  const pending = await db.subscription.count({ where: { planId: "FREE", status: "ACTIVE", coveredBySubscriptionId: null } });
  console.log(`[migrate-free] ${pending} abonnement(s) Gratuit(s) à migrer.`);
  if (dryRun && pending > 0) {
    // Inventaire : rattachement à la boutique principale du compte ou nouvel essai, sans écriture.
    const { planLegacyFreeMigration } = await import("../src/lib/billing/pause");
    const subs = await db.subscription.findMany({ where: { planId: "FREE", status: "ACTIVE", coveredBySubscriptionId: null }, select: { id: true, storeId: true } });
    let trials = 0;
    let covered = 0;
    for (const s of subs) {
      const plan = await planLegacyFreeMigration(s);
      if (plan.kind === "covered") covered++;
      else trials++;
      console.log(`  ${s.storeId} : ${plan.kind === "covered" ? `rattachée à l'abonnement ${plan.parentId}` : "nouvel essai de 14 jours"}`);
    }
    console.log(`[migrate-free] prévu : ${trials} essai(s), ${covered} rattachement(s).`);
  }
  if (dryRun || pending === 0) {
    await db.$disconnect();
    return;
  }
  const { migrateLegacyFreeSubscriptions } = await import("../src/lib/billing/pause");
  let total = 0;
  for (;;) {
    const r = await migrateLegacyFreeSubscriptions(new Date(), 200);
    total += r.migrated;
    console.log(`[migrate-free] lot : ${r.trials} essai(s), ${r.covered} rattachement(s).`);
    if (r.scanned === 0 || r.migrated === 0) break;
  }
  console.log(`[migrate-free] ${total} abonnement(s) migré(s).`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
