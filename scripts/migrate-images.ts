/**
 * Migration des images data-URL (base64 en base) vers le stockage des médias.
 *
 *   pnpm media:migrate --dry-run            # inventaire, aucune écriture
 *   pnpm media:migrate                      # envoi + remplacement par les URL
 *   pnpm media:migrate --store <storeId>    # une seule boutique
 *
 * Champs traités : Product.images et Product.options (images des valeurs d'option), Variant.imageUrl,
 * Category.imageUrl, Store.logoUrl / bannerUrl / themeDoc / themeDocDraft / themeConfig / themeDraft,
 * ThemeVersion.document. Les documents JSON sont parcourus en profondeur.
 *
 * Idempotent : seules les chaînes `data:image/…;base64,` sont remplacées ; une seconde exécution ne trouve
 * plus rien. Les objets sont adressés par leur contenu (pas de doublon dans le bucket). Ordre : envoi de
 * toutes les images d'une ligne PUIS mise à jour de la ligne — une interruption ne laisse jamais d'URL
 * pointant vers un objet absent. Les formats non raster (SVG), illisibles ou trop grands sont laissés tels quels.
 *
 * Concurrence : chaque écriture est CONDITIONNELLE (updatedAt identique pour Product et Store, ancienne valeur
 * identique pour Variant, Category et ThemeVersion). Si un marchand a modifié la ligne entre la lecture et
 * l'écriture, rien n'est écrasé : la ligne est relue et le calcul recommencé (5 essais). Lancez quand même la
 * migration dans un créneau creux (nuit, heure locale de vos marchands) : elle relit et réécrit des documents
 * volumineux. L'usage de stockage (UsageCounter `media_kb`) est incrémenté à chaque objet effectivement créé.
 *
 * Utilise le pilote configuré par l'environnement (.env) : en production, lancez-le avec les variables
 * STORAGE_* de production. Tourne avec la condition `react-server` (modules `server-only`).
 */
import { PrismaClient, Prisma } from "@prisma/client";

type LoadEnvFile = (path?: string) => void;
const loadEnv = (process as unknown as { loadEnvFile?: LoadEnvFile }).loadEnvFile;
try {
  loadEnv?.(".env");
} catch {
  // pas de .env : environnement du shell
}

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const ONLY_STORE = args.includes("--store") ? args[args.indexOf("--store") + 1] : undefined;
const VERBOSE = args.includes("--verbose");
const MAX_TRIES = 5;

const db = new PrismaClient({ log: ["error"] });

async function main() {
  const { collectDataUrls, decodeDataImageUrl, replaceDataUrls } = await import("../src/lib/storage/data-url");
  const { imageSizeIssue, readImageSize, sniffImageType } = await import("../src/lib/storage/image-type");
  const { buildMediaKey } = await import("../src/lib/storage/keys");
  const { sha256Hex } = await import("../src/lib/storage/sigv4");
  const { bytesToKb, formatBytes, MEDIA_USAGE_METRIC, MEDIA_USAGE_PERIOD } = await import("../src/lib/storage/quota");
  const { writeConditionally } = await import("../src/lib/storage/conditional-write");
  const storage = DRY ? null : await import("../src/lib/storage");
  const driver = storage?.getStorage() ?? null;

  const stats = { rows: 0, rowsUpdated: 0, conflicts: 0, abandoned: 0, images: 0, uploaded: 0, deduplicated: 0, skipped: 0, imageBytes: 0, dbBytesBefore: 0, dbBytesAfter: 0 };
  const skippedSamples: string[] = [];
  const counted = new Set<string>();
  console.log(`\nMigration des images ${DRY ? "(simulation : --dry-run, aucune écriture)" : `→ pilote « ${driver!.name} »`}\n`);

  const addUsage = async (storeId: string, kb: number) => {
    await db.usageCounter.upsert({
      where: { storeId_metric_period: { storeId, metric: MEDIA_USAGE_METRIC, period: MEDIA_USAGE_PERIOD } },
      create: { storeId, metric: MEDIA_USAGE_METRIC, period: MEDIA_USAGE_PERIOD, value: kb },
      update: { value: { increment: kb } },
    });
  };

  const stores = await db.store.findMany({ where: ONLY_STORE ? { id: ONLY_STORE } : {}, select: { id: true, slug: true }, orderBy: { createdAt: "asc" } });

  for (const store of stores) {
    /** data-URL → URL de stockage, pour cette boutique (les clés incluent le storeId). */
    const resolved = new Map<string, string>();
    let storeImages = 0;

    const resolveAll = async (value: unknown, where: string): Promise<Map<string, string>> => {
      for (const dataUrl of collectDataUrls(value)) {
        if (resolved.has(dataUrl)) continue;
        const decoded = decodeDataImageUrl(dataUrl);
        const type = decoded ? sniffImageType(decoded.bytes) : null;
        const issue = decoded && type ? imageSizeIssue(readImageSize(decoded.bytes, type)) : "format non raster ou illisible";
        if (!decoded || !type || issue) {
          stats.skipped++;
          if (skippedSamples.length < 20) skippedSamples.push(`${store.slug} · ${where} · ${issue ?? ""} · ${dataUrl.slice(0, 40)}…`);
          resolved.set(dataUrl, dataUrl); // laissée telle quelle
          continue;
        }
        stats.images++;
        storeImages++;
        stats.imageBytes += decoded.bytes.byteLength;
        if (DRY) {
          resolved.set(dataUrl, `/media/${buildMediaKey(store.id, sha256Hex(decoded.bytes), type.ext)}`);
          continue;
        }
        const out = await storage!.storeImage(store.id, decoded.bytes, { driver: driver! });
        if (out.created && !counted.has(out.key)) {
          counted.add(out.key);
          stats.uploaded++;
          await addUsage(store.id, bytesToKb(out.bytes)); // objet par objet : un arrêt en cours ne fausse pas le compteur
        } else stats.deduplicated++;
        resolved.set(dataUrl, out.url);
        if (VERBOSE) console.log(`  ${store.slug} · ${where} → ${out.url}`);
      }
      return resolved;
    };

    /** Remplace dans une valeur ; `bytes` = taille JSON avant / après (statistiques). */
    const migrate = async <T>(value: T, where: string): Promise<{ changed: boolean; value: T; before: number; after: number }> => {
      if (value == null) return { changed: false, value, before: 0, after: 0 };
      const map = await resolveAll(value, where);
      const r = replaceDataUrls(value, map);
      return { ...r, before: r.changed ? JSON.stringify(value).length : 0, after: r.changed ? JSON.stringify(r.value).length : 0 };
    };
    const asJson = (v: unknown) => (v == null ? Prisma.DbNull : (v as Prisma.InputJsonValue));

    /**
     * Lit la ligne, calcule le remplacement, écrit SOUS CONDITION (`write` renvoie le nombre de lignes modifiées).
     * 0 ligne : la ligne a changé entre-temps → on relit et on recommence, sans rien écraser.
     */
    const conditional = async <R>(label: string, read: () => Promise<R | null>, step: (row: R) => Promise<{ before: number; after: number; write: (() => Promise<number>) | null }>) => {
      let seen = false;
      const r = await writeConditionally({
        read: async () => {
          const row = await read();
          if (row && !seen) {
            seen = true;
            stats.rows++;
          }
          return row;
        },
        step,
        maxTries: MAX_TRIES,
        onConflict: (attempt) => {
          stats.conflicts++;
          if (VERBOSE) console.log(`  ${store.slug} · ${label} modifié pendant la migration : nouvel essai (${attempt}/${MAX_TRIES})`);
        },
      });
      if (r.outcome === "written" && r.result) {
        stats.rowsUpdated++;
        stats.dbBytesBefore += r.result.before;
        stats.dbBytesAfter += r.result.after;
      } else if (r.outcome === "abandoned") {
        stats.abandoned++;
        console.warn(`  ${store.slug} · ${label} : modifié en continu, laissé tel quel (relancez la migration plus tard).`);
      }
    };
    const sum = (...xs: { before: number; after: number; changed: boolean }[]) => ({
      before: xs.reduce((n, x) => n + x.before, 0),
      after: xs.reduce((n, x) => n + x.after, 0),
      changed: xs.some((x) => x.changed),
    });
    const dryStats = (r: { before: number; after: number; changed: boolean }) => {
      if (DRY && r.changed) {
        stats.dbBytesBefore += r.before;
        stats.dbBytesAfter += r.after;
      }
    };

    // Produits (condition : updatedAt inchangé)
    const productIds = await db.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Product" WHERE "storeId" = ${store.id} AND (images::text LIKE '%data:image/%' OR options::text LIKE '%data:image/%')`;
    for (const { id } of productIds) {
      await conditional(
        `produit ${id}`,
        () => db.product.findFirst({ where: { id, storeId: store.id }, select: { images: true, options: true, updatedAt: true } }),
        async (p) => {
          const images = await migrate(p.images, `produit ${id} (photos)`);
          const options = await migrate(p.options, `produit ${id} (options)`);
          const t = sum(images, options);
          dryStats(t);
          return {
            ...t,
            write:
              t.changed && !DRY
                ? async () =>
                    (
                      await db.product.updateMany({
                        where: { id, updatedAt: p.updatedAt },
                        data: { ...(images.changed ? { images: asJson(images.value) } : {}), ...(options.changed ? { options: asJson(options.value) } : {}) },
                      })
                    ).count
                : null,
          };
        },
      );
    }

    // Variantes (condition : ancienne valeur identique)
    const variants = await db.$queryRaw<{ id: string }[]>`
      SELECT v.id FROM "Variant" v JOIN "Product" p ON p.id = v."productId"
      WHERE p."storeId" = ${store.id} AND v."imageUrl" LIKE 'data:image/%'`;
    for (const { id } of variants) {
      await conditional(
        `variante ${id}`,
        () => db.variant.findUnique({ where: { id }, select: { imageUrl: true } }),
        async (v) => {
          const r = await migrate(v.imageUrl, `variante ${id}`);
          dryStats(r);
          return { ...r, write: r.changed && !DRY ? async () => (await db.variant.updateMany({ where: { id, imageUrl: v.imageUrl }, data: { imageUrl: r.value } })).count : null };
        },
      );
    }

    // Collections (condition : ancienne valeur identique)
    const categories = await db.category.findMany({ where: { storeId: store.id, imageUrl: { startsWith: "data:image/" } }, select: { id: true } });
    for (const { id } of categories) {
      await conditional(
        `collection ${id}`,
        () => db.category.findFirst({ where: { id, storeId: store.id }, select: { imageUrl: true } }),
        async (c) => {
          const r = await migrate(c.imageUrl, `collection ${id}`);
          dryStats(r);
          return { ...r, write: r.changed && !DRY ? async () => (await db.category.updateMany({ where: { id, imageUrl: c.imageUrl }, data: { imageUrl: r.value } })).count : null };
        },
      );
    }

    // Boutique : logo, bannière, documents de thème (condition : updatedAt inchangé)
    const hasStoreData = await db.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM "Store" WHERE id = ${store.id} AND (
        "logoUrl" LIKE 'data:image/%' OR "bannerUrl" LIKE 'data:image/%' OR "themeDoc"::text LIKE '%data:image/%'
        OR "themeDocDraft"::text LIKE '%data:image/%' OR "themeConfig"::text LIKE '%data:image/%' OR "themeDraft"::text LIKE '%data:image/%')`;
    if (Number(hasStoreData[0]?.n ?? 0) > 0) {
      await conditional(
        "boutique (logo, bannière, thème)",
        () => db.store.findUnique({ where: { id: store.id }, select: { logoUrl: true, bannerUrl: true, themeDoc: true, themeDocDraft: true, themeConfig: true, themeDraft: true, updatedAt: true } }),
        async (s) => {
          const data: Prisma.StoreUpdateManyMutationInput = {};
          const logo = await migrate(s.logoUrl, "logo");
          if (logo.changed) data.logoUrl = logo.value;
          const banner = await migrate(s.bannerUrl, "bannière");
          if (banner.changed) data.bannerUrl = banner.value;
          const parts = [logo, banner];
          for (const field of ["themeDoc", "themeDocDraft", "themeConfig", "themeDraft"] as const) {
            const r = await migrate(s[field], field);
            parts.push(r as typeof logo);
            if (r.changed) data[field] = asJson(r.value);
          }
          const t = sum(...parts);
          dryStats(t);
          return { ...t, write: t.changed && !DRY ? async () => (await db.store.updateMany({ where: { id: store.id, updatedAt: s.updatedAt }, data })).count : null };
        },
      );
    }

    // Historique des versions du thème (condition : document identique)
    const versions = await db.$queryRaw<{ id: string }[]>`
      SELECT id FROM "ThemeVersion" WHERE "storeId" = ${store.id} AND document::text LIKE '%data:image/%'`;
    for (const { id } of versions) {
      await conditional(
        `version de thème ${id}`,
        () => db.themeVersion.findFirst({ where: { id, storeId: store.id }, select: { document: true } }),
        async (tv) => {
          const r = await migrate(tv.document, `version de thème ${id}`);
          dryStats(r);
          return {
            ...r,
            write:
              r.changed && !DRY
                ? async () => (await db.themeVersion.updateMany({ where: { id, document: { equals: tv.document as Prisma.InputJsonValue } }, data: { document: r.value as Prisma.InputJsonValue } })).count
                : null,
          };
        },
      );
    }

    if (storeImages) console.log(`  ${store.slug.padEnd(28)} ${storeImages} image(s)`);
  }

  const saved = stats.dbBytesBefore - stats.dbBytesAfter;
  const lines: [string, string][] = [
    ["Boutiques parcourues", String(stores.length)],
    ["Lignes concernées", `${stats.rows}${DRY ? "" : ` (mises à jour : ${stats.rowsUpdated}, conflits rejoués : ${stats.conflicts}, abandonnées : ${stats.abandoned})`}`],
    ["Images data-URL trouvées", `${stats.images} (${formatBytes(stats.imageBytes)} d'images)`],
    ...(DRY ? [] : ([["Envoyées", `${stats.uploaded} (déjà présentes, dédoublonnées : ${stats.deduplicated})`]] as [string, string][])),
    ["Laissées telles quelles", `${stats.skipped}${stats.skipped ? " (SVG, illisibles ou trop grandes)" : ""}`],
    [DRY ? "Gain possible en base" : "Gain en base", `${formatBytes(Math.max(0, saved))} (${saved.toLocaleString("fr-FR")} caractères JSON retirés)`],
  ];
  console.log(`\n${lines.map(([k, v]) => `${k.padEnd(26)}: ${v}`).join("\n")}\n`);
  if (skippedSamples.length) console.log(`Exemples non migrés :\n  ${skippedSamples.join("\n  ")}\n`);
  if (DRY && stats.images) console.log("Relancez sans --dry-run pour appliquer (de préférence dans un créneau creux).\n");
}

main()
  .catch((e) => {
    console.error("\nÉchec de la migration :", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
