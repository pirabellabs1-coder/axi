/**
 * Utilitaire de recette des webhooks (suite `e2e/13-api-webhooks.spec.ts`), lancé en sous-processus par le test :
 *
 *   node --conditions=react-server --import tsx e2e/webhook-local-runner.ts create <storeId> <url>
 *   node --conditions=react-server --import tsx e2e/webhook-local-runner.ts deliver
 *   node --conditions=react-server --import tsx e2e/webhook-local-runner.ts replay <deliveryId>
 *
 * Pourquoi un sous-processus : `AXI_WEBHOOKS_ALLOW_LOCALHOST=1` n'est honoré que dans le processus qui crée le
 * point ET dans celui qui livre (`docs/vague2/W-api-webhooks.md` §5). Le serveur de développement déjà lancé ne
 * porte pas cette variable, et la recette ne redémarre aucun serveur : le test fait donc créer le point et livrer
 * les tâches par ce processus-ci, exactement comme `pnpm jobs` le ferait en local.
 *
 * Aucune logique applicative n'est réimplémentée : on appelle les fonctions du produit.
 */
type LoadEnvFile = (path?: string) => void;
const loadEnv = (process as unknown as { loadEnvFile?: LoadEnvFile }).loadEnvFile;
if (typeof loadEnv === "function") {
  try {
    loadEnv(".env");
  } catch {
    // pas de .env : variables fournies par le shell
  }
}
process.env.AXI_WEBHOOKS_ALLOW_LOCALHOST = "1";

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const { db } = await import("../src/lib/db");
  const service = await import("../src/lib/webhooks/service");

  if (command === "create") {
    const [storeId, url] = args;
    const store = await db.store.findUniqueOrThrow({ where: { id: storeId }, select: { id: true, subscription: { select: { planId: true } } } });
    const membership = await db.membership.findFirstOrThrow({ where: { storeId, role: "OWNER" }, select: { userId: true, role: true } });
    const { endpoint, secret } = await service.createEndpoint(
      { storeId: store.id, planId: (store.subscription?.planId ?? "BUSINESS") as never, role: membership.role, userId: membership.userId, label: "recette e2e", via: "dashboard" },
      { url, events: ["order.created", "app.ping"], description: "Point local de recette E2E" },
    );
    process.stdout.write(`${JSON.stringify({ id: endpoint.id, secret })}\n`);
  } else if (command === "deliver") {
    const { runJobs } = await import("../src/lib/jobs");
    const result = await runJobs(50);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else if (command === "replay") {
    const [deliveryId] = args;
    const delivery = await db.webhookDelivery.findUniqueOrThrow({ where: { id: deliveryId }, select: { storeId: true } });
    const storeId = delivery.storeId;
    const store = await db.store.findUniqueOrThrow({ where: { id: storeId }, select: { subscription: { select: { planId: true } } } });
    const membership = await db.membership.findFirstOrThrow({ where: { storeId, role: "OWNER" }, select: { userId: true, role: true } });
    await service.replayDelivery({ storeId, planId: (store.subscription?.planId ?? "BUSINESS") as never, role: membership.role, userId: membership.userId, label: "recette e2e", via: "dashboard" }, deliveryId);
    process.stdout.write(`${JSON.stringify({ replayed: deliveryId })}\n`);
  } else {
    throw new Error(`commande inconnue : ${command}`);
  }
  await db.$disconnect();
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});

// Fichier traité comme un module : évite la collision de noms globaux entre scripts.
export {};
