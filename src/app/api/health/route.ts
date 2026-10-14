import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import pkg from "../../../../package.json";

export const dynamic = "force-dynamic";

/** Au-delà de ce retard, le plus ancien job dû non traité signale un worker en panne. */
const QUEUE_STALE_MINUTES = 15;

/**
 * Sonde de santé : base joignable (SELECT 1), version applicative, uptime du processus, et état de la file
 * de jobs (outbox). Un worker arrêté ne casse pas la base mais bloque e-mails, factures et livraisons
 * numériques : la sonde passe alors en « degraded » pour qu'un moniteur externe le détecte.
 * Aucune donnée de boutique n'est exposée (compteurs agrégés uniquement).
 */
export async function GET() {
  const startedAt = Date.now();
  let database: "ok" | "error" = "ok";
  try {
    await db.$queryRaw`SELECT 1`;
  } catch (e) {
    // m15 : le détail (hôte, utilisateur, erreur réseau) reste dans les journaux serveur.
    database = "error";
    console.error("[health] base injoignable", e);
  }

  let jobs: { pending: number; dead: number; oldestDueMinutes: number | null; status: "ok" | "stale" } | null = null;
  if (database === "ok") {
    try {
      const now = new Date();
      const [pending, dead, oldest] = await Promise.all([
        db.job.count({ where: { status: "PENDING" } }),
        db.job.count({ where: { status: "DEAD" } }),
        db.job.findFirst({ where: { status: "PENDING", runAt: { lte: now } }, orderBy: { runAt: "asc" }, select: { runAt: true } }),
      ]);
      const oldestDueMinutes = oldest ? Math.floor((now.getTime() - oldest.runAt.getTime()) / 60_000) : null;
      jobs = { pending, dead, oldestDueMinutes, status: oldestDueMinutes != null && oldestDueMinutes > QUEUE_STALE_MINUTES ? "stale" : "ok" };
    } catch (e) {
      console.error("[health] file de jobs illisible", e);
    }
  }

  const healthy = database === "ok" && jobs?.status !== "stale";
  const body = {
    status: healthy ? "ok" : "degraded",
    version: pkg.version,
    uptimeSeconds: Math.round(process.uptime()),
    database,
    jobs,
    latencyMs: Date.now() - startedAt,
    timestamp: new Date().toISOString(),
  };
  // 503 seulement si la base est injoignable : une file en retard reste servie (200) mais « degraded ».
  return NextResponse.json(body, { status: database === "ok" ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
