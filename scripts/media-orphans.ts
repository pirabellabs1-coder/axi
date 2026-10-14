/**
 * Liste les médias stockés qui ne sont plus référencés nulle part en base (lecture seule, rien n'est supprimé).
 *
 *   pnpm media:orphans                       # orphelins de plus de 24 h
 *   pnpm media:orphans --min-age-hours 72    # délai de grâce différent
 *   pnpm media:orphans --store <storeId>
 *
 * Références recherchées dans TOUTES les colonnes texte / JSON du schéma public (produits, variantes, thèmes,
 * versions, pages, etc.) : un média cité n'importe où n'est jamais signalé. Le délai de grâce évite de lister
 * une image envoyée mais pas encore enregistrée (formulaire en cours d'édition).
 * Suppression : manuelle en v1 (console du fournisseur, ou `rm` sur le disque local) après vérification.
 */
import { PrismaClient } from "@prisma/client";

type LoadEnvFile = (path?: string) => void;
const loadEnv = (process as unknown as { loadEnvFile?: LoadEnvFile }).loadEnvFile;
try {
  loadEnv?.(".env");
} catch {
  // pas de .env : environnement du shell
}

const args = process.argv.slice(2);
const argValue = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const MIN_AGE_HOURS = Number(argValue("--min-age-hours") ?? 24);
const ONLY_STORE = argValue("--store");

const db = new PrismaClient({ log: ["error"] });
const KEY_IN_TEXT = /stores\/[a-z0-9]{8,40}\/\d{4}\/(?:0[1-9]|1[0-2])\/[a-f0-9]{64}\.(?:jpg|png|webp|avif|gif)/g;

async function referencedKeys(): Promise<Set<string>> {
  const keys = new Set<string>();
  const cols = await db.$queryRaw<{ t: string; c: string }[]>`
    SELECT table_name AS t, column_name AS c FROM information_schema.columns
    WHERE table_schema = 'public' AND data_type IN ('text', 'character varying', 'json', 'jsonb')`;
  for (const { t, c } of cols) {
    // Identifiants issus du catalogue système (pas d'entrée utilisateur) ; guillemets doublés par sécurité.
    const tq = `"${t.replace(/"/g, '""')}"`;
    const cq = `"${c.replace(/"/g, '""')}"`;
    const rows = await db.$queryRawUnsafe<{ v: string }[]>(`SELECT ${cq}::text AS v FROM ${tq} WHERE ${cq}::text LIKE '%stores/%'`);
    for (const { v } of rows) for (const m of v.matchAll(KEY_IN_TEXT)) keys.add(m[0]);
  }
  return keys;
}

async function main() {
  const { getStorage } = await import("../src/lib/storage");
  const { formatBytes } = await import("../src/lib/storage/quota");
  const driver = getStorage();
  const referenced = await referencedKeys();
  const cutoff = Date.now() - MIN_AGE_HOURS * 3600_000;

  let total = 0;
  let totalBytes = 0;
  const orphans: { key: string; size: number; lastModified: Date | null }[] = [];
  let recent = 0;
  for await (const obj of driver.list(ONLY_STORE ? `stores/${ONLY_STORE}/` : "stores/")) {
    total++;
    totalBytes += obj.size;
    if (referenced.has(obj.key)) continue;
    if (obj.lastModified && obj.lastModified.getTime() > cutoff) {
      recent++;
      continue;
    }
    orphans.push(obj);
  }

  const orphanBytes = orphans.reduce((n, o) => n + o.size, 0);
  console.log(`\nMédias orphelins (pilote « ${driver.name} », lecture seule)\n`);
  for (const o of orphans) console.log(`  ${o.key}  ${formatBytes(o.size)}  ${o.lastModified?.toISOString().slice(0, 10) ?? ""}`);
  const lines: [string, string][] = [
    ["Objets stockés", `${total} (${formatBytes(totalBytes)})`],
    ["Références en base", String(referenced.size)],
    [`Orphelins (> ${MIN_AGE_HOURS} h)`, `${orphans.length} (${formatBytes(orphanBytes)})`],
    ["Non référencés récents", `${recent} (ignorés : édition peut-être en cours)`],
  ];
  console.log(`\n${lines.map(([k, v]) => `${k.padEnd(24)}: ${v}`).join("\n")}\n\nAucune suppression automatique en v1 : vérifiez, puis supprimez manuellement si nécessaire.\n`);
  if (orphans.length) {
    console.warn(
      "ATTENTION : avant toute suppression (irréversible), vérifiez que ces fichiers ne servent plus hors de la base :\n" +
        "  e-mails déjà envoyés, liens partagés sur WhatsApp, aperçus en cache (Open Graph), sauvegardes plus anciennes de la base.\n" +
        "  Lancez la commande avec les variables STORAGE_* de l'environnement visé (sinon c'est un autre stockage qui est listé).\n" +
        "  Un fichier supprimé par erreur ne se récupère que si le versioning du bucket est activé.\n",
    );
  }
}

main()
  .catch((e) => {
    console.error("\nÉchec :", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
