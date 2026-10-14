/**
 * Recette INT : livre un webhook de cycle de vie d'app (`deliverLifecycleWebhook`, la fonction du produit) dans un
 * sous-processus qui porte `AXI_WEBHOOKS_ALLOW_LOCALHOST=1` — le serveur de dev déjà lancé ne la porte pas et la
 * recette ne redémarre aucun serveur (même raison que e2e/webhook-local-runner.ts).
 *
 *   node --conditions=react-server --import tsx e2e/apps-int-lifecycle-runner.ts <app.installed|app.uninstalled> <appId> <storeId> <installationId>
 */
type LoadEnvFile = (path?: string) => void;
const loadEnv = (process as unknown as { loadEnvFile?: LoadEnvFile }).loadEnvFile;
if (typeof loadEnv === "function") {
  try {
    loadEnv(".env");
  } catch {
    // variables fournies par le shell
  }
}
process.env.AXI_WEBHOOKS_ALLOW_LOCALHOST = "1";

async function main() {
  const [event, appId, storeId, installationId] = process.argv.slice(2);
  if (event !== "app.installed" && event !== "app.uninstalled") throw new Error("événement inconnu");
  const { deliverLifecycleWebhook } = await import("../src/lib/apps/lifecycle-webhooks");
  const out = await deliverLifecycleWebhook({ event, appId, storeId, installationId });
  process.stdout.write(`${JSON.stringify({ outcome: out.outcome, status: "result" in out ? out.result.status : null, error: "result" in out ? out.result.error : null })}\n`);
  const { db } = await import("../src/lib/db");
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
