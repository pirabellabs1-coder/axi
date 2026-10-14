import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, rename, stat, writeFile, unlink } from "node:fs/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { LocalConfig, S3Config } from "./config";
import { isValidMediaKey, MEDIA_ROUTE_PREFIX } from "./keys";
import { isValidFileKey } from "./file-keys";
import { s3PublicUrl } from "./public-url";
import { EMPTY_SHA256, signV4 } from "./sigv4";

/** Flux d'un objet lu, relayé par le serveur (le bucket n'est jamais exposé au navigateur). */
export type StoredStream = { body: ReadableStream<Uint8Array>; size: number | null };

/**
 * Contrat commun des pilotes. Les clés reçues sont TOUJOURS validées avant usage : média (`MEDIA_KEY_RE`)
 * ou fichier vendu (`FILE_KEY_RE`, vague 2). Un fichier vendu n'a jamais d'URL publique (`publicUrl` le refuse).
 */
export interface StorageDriver {
  readonly name: "local" | "s3";
  exists(key: string): Promise<boolean>;
  put(key: string, body: Uint8Array, contentType: string, sha256: string): Promise<void>;
  publicUrl(key: string): string;
  /** Inventaire (commande media:orphans). */
  list(prefix: string): AsyncGenerator<StoredObject>;
  /** Suppression (purge des photos de retour orphelines). Idempotente : true si l'objet existait. */
  remove(key: string): Promise<boolean>;
  /** Vague 2 : lecture en flux (téléchargement d'un fichier vendu). null = objet absent. */
  getStream(key: string): Promise<StoredStream | null>;
}

export type StoredObject = { key: string; size: number; lastModified: Date | null };

export const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

function assertKey(key: string) {
  if (!isValidMediaKey(key) && !isValidFileKey(key)) throw new Error("Clé de média invalide");
}

/** URL publique : réservée aux MÉDIAS. Un fichier vendu ne doit jamais obtenir de lien permanent. */
function assertPublicKey(key: string) {
  if (!isValidMediaKey(key)) throw new Error("Un fichier vendu n'a pas d'URL publique");
}

/* ───────────────────────── Pilote local ───────────────────────── */

/** Chemin disque d'une clé, garanti à l'intérieur du dossier racine (défense en profondeur). */
export function localPathFor(root: string, key: string): string {
  assertKey(key);
  const base = path.resolve(root);
  const full = path.resolve(base, ...key.split("/"));
  if (!full.startsWith(base + path.sep)) throw new Error("Chemin hors du dossier de stockage");
  return full;
}

export class LocalDriver implements StorageDriver {
  readonly name = "local" as const;
  constructor(private readonly cfg: Pick<LocalConfig, "dir">) {}

  async exists(key: string) {
    try {
      return (await stat(localPathFor(this.cfg.dir, key))).isFile();
    } catch {
      return false;
    }
  }

  async put(key: string, body: Uint8Array) {
    const file = localPathFor(this.cfg.dir, key);
    await mkdir(path.dirname(file), { recursive: true });
    // Écriture atomique : fichier temporaire puis renommage (jamais de fichier tronqué servi).
    const tmp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
    try {
      await writeFile(tmp, body, { flag: "wx" });
      await rename(tmp, file);
    } catch (e) {
      await unlink(tmp).catch(() => {});
      throw e;
    }
  }

  async remove(key: string): Promise<boolean> {
    try {
      await unlink(localPathFor(this.cfg.dir, key));
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw e;
    }
  }

  async read(key: string): Promise<Buffer | null> {
    try {
      return await readFile(localPathFor(this.cfg.dir, key));
    } catch {
      return null;
    }
  }

  publicUrl(key: string) {
    assertPublicKey(key);
    return `${MEDIA_ROUTE_PREFIX}${key}`;
  }

  /** Lecture en flux (fichier vendu) : chemin résolu dans le dossier de stockage, taille lue avant ouverture. */
  async getStream(key: string): Promise<StoredStream | null> {
    const file = localPathFor(this.cfg.dir, key);
    let size: number;
    try {
      const st = await stat(file);
      if (!st.isFile()) return null;
      size = st.size;
    } catch {
      return null;
    }
    const stream = Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>;
    return { body: stream, size };
  }

  async *list(prefix: string) {
    const root = path.resolve(this.cfg.dir);
    async function* walk(dir: string): AsyncGenerator<StoredObject> {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) yield* walk(full);
        else if (e.isFile()) {
          const key = path.relative(root, full).split(path.sep).join("/");
          if (key.startsWith(prefix) && isValidMediaKey(key)) {
            const st = await stat(full);
            yield { key, size: st.size, lastModified: st.mtime };
          }
        }
      }
    }
    yield* walk(root);
  }
}

/* ───────────────────────── Pilote S3 compatible ───────────────────────── */

const TIMEOUT_MS = 15_000;

export class S3Driver implements StorageDriver {
  readonly name = "s3" as const;
  constructor(
    private readonly cfg: S3Config,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** Hôte + chemin de l'objet (style chemin ou hôte virtuel ; le chemin de l'endpoint est conservé, ex. Supabase). */
  target(key = ""): { host: string; path: string; url: string } {
    const e = this.cfg.endpoint;
    const basePath = e.pathname.replace(/\/+$/, "");
    const host = this.cfg.forcePathStyle ? e.host : `${this.cfg.bucket}.${e.host}`;
    const rawPath = this.cfg.forcePathStyle ? `${basePath}/${this.cfg.bucket}/${key}` : `${basePath}/${key}`;
    // Les clés sont limitées à [a-z0-9/.] : l'encodage AWS les laisse intactes, l'URL est donc identique.
    return { host, path: rawPath, url: `${e.protocol}//${host}${rawPath}` };
  }

  private async send(
    method: string,
    key: string,
    init: { body?: Uint8Array; headers?: Record<string, string>; payloadHash: string; query?: Record<string, string>; stream?: boolean },
  ): Promise<Response> {
    const t = this.target(key);
    const signed = signV4({
      method,
      host: t.host,
      path: t.path,
      query: init.query,
      headers: { ...init.headers, "x-amz-content-sha256": init.payloadHash },
      payloadHash: init.payloadHash,
      region: this.cfg.region,
      service: "s3",
      accessKeyId: this.cfg.accessKeyId,
      secretAccessKey: this.cfg.secretAccessKey,
    });
    const qs = init.query ? `?${new URLSearchParams(init.query).toString()}` : "";
    return this.fetchImpl(t.url + qs, {
      method,
      headers: signed.headers,
      body: init.body ? new Uint8Array(init.body) : undefined,
      // Lecture en flux d'un fichier vendu (jusqu'à 50 Mo) : pas de minuterie globale, elle couperait le corps.
      ...(init.stream ? {} : { signal: AbortSignal.timeout(TIMEOUT_MS) }),
      cache: "no-store",
    });
  }

  async exists(key: string) {
    assertKey(key);
    const res = await this.send("HEAD", key, { payloadHash: EMPTY_SHA256 });
    if (res.ok) return true;
    if (res.status === 404) return false;
    if (res.status === 401 || res.status === 403) {
      // Erreur de configuration, jamais « objet absent » : sinon chaque envoi réécrirait l'objet et serait recompté.
      throw new Error(`Stockage S3 : accès refusé (HEAD ${res.status}). Vérifiez STORAGE_ACCESS_KEY_ID / STORAGE_SECRET_ACCESS_KEY (droits lecture + écriture d'objets sur le bucket), STORAGE_BUCKET et STORAGE_REGION.`);
    }
    throw new Error(`Stockage S3 : HEAD ${res.status}`);
  }

  async put(key: string, body: Uint8Array, contentType: string, sha256: string) {
    assertKey(key);
    // Objet adressé par son contenu : un PUT rejoué est sans effet de bord → 2 nouvelles tentatives bornées.
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 300 * 2 ** attempt + Math.random() * 200));
      try {
        const res = await this.send("PUT", key, { body, payloadHash: sha256, headers: { "content-type": contentType, "cache-control": IMMUTABLE_CACHE } });
        if (res.ok) return;
        const detail = (await res.text().catch(() => "")).match(/<Code>([^<]{1,80})<\/Code>/)?.[1];
        lastError = new Error(`Stockage S3 : PUT ${res.status}${detail ? ` (${detail})` : ""}`);
        if (res.status < 500 && res.status !== 429) break; // erreur de configuration : inutile d'insister
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Stockage S3 : envoi impossible");
  }

  publicUrl(key: string) {
    assertPublicKey(key);
    return s3PublicUrl(this.cfg.publicUrl, key);
  }

  /**
   * Lecture en flux (fichier vendu) : GET signé côté serveur, corps relayé tel quel au navigateur.
   * Aucune URL de bucket n'est transmise au client (le bucket est public en lecture pour les MÉDIAS,
   * mais les clés `files/` sont imprévisibles et ne sont jamais publiées — voir file-keys.ts).
   */
  async getStream(key: string): Promise<StoredStream | null> {
    assertKey(key);
    const res = await this.send("GET", key, { payloadHash: EMPTY_SHA256, stream: true });
    if (res.status === 404) return null;
    if (!res.ok || !res.body) {
      await res.body?.cancel().catch(() => {});
      if (res.status === 401 || res.status === 403) throw new Error("Stockage S3 : accès refusé (GET). Vérifiez les droits de lecture du bucket.");
      return null;
    }
    const len = Number(res.headers.get("content-length") ?? "");
    return { body: res.body as ReadableStream<Uint8Array>, size: Number.isFinite(len) && len >= 0 ? len : null };
  }

  async remove(key: string): Promise<boolean> {
    assertKey(key);
    const existed = await this.exists(key);
    if (!existed) return false;
    const res = await this.send("DELETE", key, { payloadHash: EMPTY_SHA256 });
    if (!res.ok && res.status !== 404) throw new Error(`Stockage S3 : DELETE ${res.status}`);
    return true;
  }

  async *list(prefix: string) {
    let token: string | undefined;
    for (let page = 0; page < 10_000; page++) {
      const query: Record<string, string> = { "list-type": "2", prefix, "max-keys": "1000", ...(token ? { "continuation-token": token } : {}) };
      const res = await this.send("GET", "", { payloadHash: EMPTY_SHA256, query });
      if (!res.ok) throw new Error(`Stockage S3 : liste ${res.status}`);
      const xml = await res.text();
      for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const key = decodeXml(m[1].match(/<Key>([\s\S]*?)<\/Key>/)?.[1] ?? "");
        const size = Number(m[1].match(/<Size>(\d+)<\/Size>/)?.[1] ?? 0);
        const modified = m[1].match(/<LastModified>([^<]+)<\/LastModified>/)?.[1];
        if (isValidMediaKey(key)) yield { key, size, lastModified: modified ? new Date(modified) : null };
      }
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? decodeXml(xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)?.[1] ?? "") : undefined;
      if (!token) return;
    }
  }
}

function decodeXml(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}
