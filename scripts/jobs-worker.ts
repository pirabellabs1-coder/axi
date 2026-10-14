/**
 * Worker de tâches pour le développement local : exécute runJobs() toutes les 10 secondes.
 *
 *   pnpm jobs
 *
 * En production, préférer un cron qui appelle /api/jobs/run (voir docs/DEPLOIEMENT.md).
 * Les modules applicatifs sont marqués `server-only` : ce script tourne avec la condition
 * d'export `react-server` (voir le script `jobs` dans package.json) pour les charger hors Next.
 */
type LoadEnvFile = (path?: string) => void;
const loadEnv = (process as unknown as { loadEnvFile?: LoadEnvFile }).loadEnvFile;
if (typeof loadEnv === "function") {
  try {
    loadEnv(".env");
  } catch {
    // pas de .env : on s'appuie sur l'environnement du shell
  }
}

const INTERVAL_MS = Number(process.env.JOBS_INTERVAL_MS ?? 10_000);
const BATCH = Number(process.env.JOBS_BATCH ?? 25);

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL manquante : copiez .env.example vers .env");
    process.exit(1);
  }
  const { runJobs } = await import("../src/lib/jobs");
  const { reconcilePendingAttempts } = await import("../src/lib/payments/service");

  let stopping = false;
  const stop = () => {
    stopping = true;
    console.log("\n[jobs] arrêt demandé, fin du cycle en cours…");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  console.log(`[jobs] worker démarré — ${BATCH} tâches max toutes les ${INTERVAL_MS / 1000} s (Ctrl+C pour arrêter)`);
  let cycle = 0;
  while (!stopping) {
    cycle++;
    try {
      const r = await runJobs(BATCH);
      if (r.processed || r.failed) console.log(`[jobs] ${new Date().toISOString()} — ${r.processed} exécutée(s), ${r.failed} en échec`);
      if (cycle % 6 === 0) {
        const rec = await reconcilePendingAttempts();
        if (rec.checked) console.log(`[jobs] rapprochement — ${rec.checked} vérifiée(s), ${rec.updated} mise(s) à jour`);
      }
    } catch (e) {
      console.error("[jobs] erreur de cycle :", (e as Error).message);
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// Fichier traité comme un module : évite la collision de noms globaux entre scripts.
export {};
