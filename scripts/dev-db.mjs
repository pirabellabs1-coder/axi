/**
 * Base PostgreSQL locale embarquée pour le développement (aucune installation système).
 *   pnpm db:local        → démarre Postgres sur le port 5433 (données dans .local/pg)
 * DATABASE_URL correspondante : postgresql://axi:axi@localhost:5433/axi
 * En production, utilisez un PostgreSQL managé (Supabase, Neon, Railway…) — voir docs/DEPLOIEMENT.md.
 */
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";

const PORT = Number(process.env.LOCAL_PG_PORT ?? 5433);
const dir = path.resolve(".local/pg");
const fresh = !existsSync(path.join(dir, "PG_VERSION"));
await mkdir(dir, { recursive: true });

const pg = new EmbeddedPostgres({
  databaseDir: dir,
  user: "axi",
  password: "axi",
  port: PORT,
  persistent: true,
  // Encodage UTF-8 explicite (sur Windows, initdb prend sinon l'encodage de la locale système).
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  onLog: () => {},
  onError: (e) => console.error(String(e)),
});

if (fresh) {
  console.log("Initialisation du cluster PostgreSQL local…");
  await pg.initialise();
}
await pg.start();
if (fresh) await pg.createDatabase("axi");
console.log(`\n✔ PostgreSQL local prêt : postgresql://axi:axi@localhost:${PORT}/axi\n  (Ctrl+C pour arrêter)\n`);

const stop = async () => {
  console.log("\nArrêt de PostgreSQL local…");
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);
