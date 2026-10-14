import path from "node:path";
import { normalizePublicUrl } from "./public-url";

/**
 * Lecture de la configuration du stockage (fonction pure : l'environnement est injecté, testable).
 *
 * STORAGE_DRIVER = local | s3
 *  - absent : `local` en développement ; en production, `local` seulement pour une recette sur localhost
 *    (même logique que ALLOW_CONSOLE_EMAIL), sinon erreur explicite ;
 *  - `local` explicite en production : accepté (VPS avec disque persistant et sauvegardé), avec un
 *    avertissement — JAMAIS sur Vercel/Netlify/Render sans disque : les fichiers disparaîtraient au déploiement.
 */
export type LocalConfig = { driver: "local"; dir: string; warning?: string };
export type S3Config = {
  driver: "s3";
  endpoint: URL;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicUrl: string;
  forcePathStyle: boolean;
};
export type StorageConfig = LocalConfig | S3Config;

type Env = Record<string, string | undefined>;

export class StorageConfigError extends Error {}

const LOCALHOST_APP = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/;

export function readStorageConfig(env: Env = process.env, cwd: string = process.cwd()): StorageConfig {
  const isProd = env.NODE_ENV === "production";
  const explicit = (env.STORAGE_DRIVER ?? "").trim().toLowerCase();
  const driver = explicit || (isProd ? "" : "local");

  if (driver === "local" || (!driver && isProd && LOCALHOST_APP.test(env.NEXT_PUBLIC_APP_URL ?? ""))) {
    const dir = path.resolve(cwd, env.STORAGE_LOCAL_DIR?.trim() || ".local/uploads");
    const warning =
      isProd && explicit === "local"
        ? "STORAGE_DRIVER=local en production : les médias sont écrits sur le disque du serveur. À réserver à un VPS avec disque persistant et sauvegardé (jamais Vercel/Render/Netlify)."
        : undefined;
    return { driver: "local", dir, warning };
  }

  if (driver === "s3") {
    const missing = ["STORAGE_ENDPOINT", "STORAGE_BUCKET", "STORAGE_ACCESS_KEY_ID", "STORAGE_SECRET_ACCESS_KEY", "STORAGE_PUBLIC_URL"].filter((k) => !env[k]?.trim());
    if (missing.length) throw new StorageConfigError(`Stockage S3 incomplet : renseignez ${missing.join(", ")} (voir docs/DEPLOIEMENT.md, « Stockage des médias »).`);
    let endpoint: URL;
    try {
      endpoint = new URL(env.STORAGE_ENDPOINT!.trim().replace(/\/+$/, ""));
    } catch {
      throw new StorageConfigError("STORAGE_ENDPOINT invalide : URL complète attendue, ex. https://<compte>.r2.cloudflarestorage.com");
    }
    if (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && !isProd)) {
      throw new StorageConfigError("STORAGE_ENDPOINT doit être en https en production.");
    }
    const publicUrl = normalizePublicUrl(env.STORAGE_PUBLIC_URL);
    if (!publicUrl) throw new StorageConfigError("STORAGE_PUBLIC_URL invalide : URL complète attendue, ex. https://media.axi.africa");
    if (isProd && !publicUrl.startsWith("https://")) throw new StorageConfigError("STORAGE_PUBLIC_URL doit être en https en production.");
    const bucket = env.STORAGE_BUCKET!.trim();
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) throw new StorageConfigError("STORAGE_BUCKET invalide (minuscules, chiffres, points et tirets).");
    const fps = (env.STORAGE_FORCE_PATH_STYLE ?? "").trim().toLowerCase();
    return {
      driver: "s3",
      endpoint,
      // R2 n'a pas de région : « auto ». Les autres fournisseurs exigent la région réelle du bucket.
      region: env.STORAGE_REGION?.trim() || "auto",
      bucket,
      accessKeyId: env.STORAGE_ACCESS_KEY_ID!.trim(),
      secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY!.trim(),
      publicUrl,
      // Par défaut : style chemin (R2, Supabase, MinIO, Backblaze) ; `0`/`false` pour l'hôte virtuel AWS.
      forcePathStyle: !(fps === "0" || fps === "false"),
    };
  }

  if (!driver) {
    throw new StorageConfigError("Stockage des médias non configuré : définissez STORAGE_DRIVER=s3 et ses variables (voir docs/DEPLOIEMENT.md).");
  }
  throw new StorageConfigError(`STORAGE_DRIVER inconnu : « ${driver} ». Valeurs acceptées : s3 (production) ou local.`);
}
