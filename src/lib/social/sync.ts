import "server-only";
import { db } from "@/lib/db";
import { enqueue } from "@/lib/jobs";
import { decryptSecret } from "@/lib/crypto";
import { PLANS } from "@/config/plans";
import { effectivePlanId } from "@/lib/billing/rules";
import { buildCatalogItems, readSettings } from "./feed-items";
import { loadCatalogSource } from "./catalog-data";
import {
  SYNC_INTERVAL_MS, SYNC_LEASE_MS, SYNC_STALE_MS, backoffDelayMs, buildBatchRequests, desiredFromItems, diffCatalog, failedBatch, mapBatchResponse, sanitizeError,
  type DesiredItem, type ItemOutcome,
} from "./meta-batch";
import { dryRunCatalogApi, graphCatalogApi, isConfigurationError, isDryRun, type CatalogApi } from "./graph-client";

/**
 * Synchronisation API du catalogue WhatsApp Business / Meta Commerce (SocialCatalogSync channel « whatsapp »).
 *  - planification : `scheduleDueCatalogSyncs()` (balayage de /api/jobs/run) met en file `social.sync` { syncId } ;
 *  - exécution : `runCatalogSync()` (job), verrou « syncing », diff incrémental, lots items_batch, état par article ;
 *  - échecs : backoff exponentiel sur la ligne (5 min → 24 h), jamais de jeton dans `lastError` ni dans les journaux.
 */

/** Origine publique de l'application (liens des fiches et des flux). */
export function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");
}

export const SYNC_CHANNEL = "whatsapp";
export const FEED_CHANNELS = ["meta", "google", "tiktok"] as const;
export type FeedChannel = (typeof FEED_CHANNELS)[number];

type Graph = { token: string; phoneNumberId: string | null };

async function whatsappGraph(storeId: string): Promise<Graph | { error: string }> {
  const i = await db.integration.findUnique({ where: { storeId_kind: { storeId, kind: "whatsapp_cloud" } }, select: { status: true, phoneNumberId: true, secretsEncrypted: true } });
  if (!i || !i.secretsEncrypted) return { error: "Connectez d'abord l'API WhatsApp officielle (page WhatsApp)." };
  if (i.status !== "active") return { error: "La connexion WhatsApp Cloud n'est pas encore validée par la plateforme." };
  try {
    const { token } = JSON.parse(decryptSecret(i.secretsEncrypted)) as { token?: unknown };
    if (typeof token !== "string" || !token) return { error: "Jeton WhatsApp Cloud absent : enregistrez-le de nouveau." };
    return { token, phoneNumberId: i.phoneNumberId };
  } catch {
    return { error: "Jeton WhatsApp Cloud illisible : enregistrez-le de nouveau." };
  }
}

export type SyncRunResult =
  | { ok: true; upserted: number; deleted: number; unchanged: number; blocked: number; failed: number; skipped: number }
  | { ok: false; reason: string };

/** Échec avant tout appel : la synchronisation est suspendue jusqu'à une correction (nextSyncAt null). */
async function suspend(syncId: string, storeId: string, reason: string) {
  await db.socialCatalogSync.updateMany({ where: { id: syncId, storeId }, data: { status: "error", lastError: reason, nextSyncAt: null } });
  return { ok: false as const, reason };
}

/** Exécute une synchronisation (gestionnaire du job `social.sync`). Ne lève que sur erreur inattendue de la base. */
export async function runCatalogSync(syncId: string, opts: { force?: boolean; jobStoreId?: string | null; api?: CatalogApi; now?: Date } = {}): Promise<SyncRunResult> {
  const now = opts.now ?? new Date();
  const sync = await db.socialCatalogSync.findUnique({ where: { id: syncId } });
  if (!sync || sync.channel !== SYNC_CHANNEL) return { ok: false, reason: "Synchronisation introuvable" };
  // Défense en profondeur : un job ne peut viser que la boutique qui l'a mis en file.
  if (opts.jobStoreId && opts.jobStoreId !== sync.storeId) return { ok: false, reason: "Boutique du job incohérente" };
  if (!sync.enabled) return { ok: false, reason: "Synchronisation désactivée" };

  // Verrou : une seule exécution à la fois par ligne (un verrou plus vieux que 15 min est repris).
  const claimed = await db.socialCatalogSync.updateMany({
    where: { id: sync.id, storeId: sync.storeId, enabled: true, OR: [{ status: { not: "syncing" } }, { updatedAt: { lt: new Date(now.getTime() - SYNC_STALE_MS) } }] },
    data: { status: "syncing" },
  });
  if (claimed.count !== 1) return { ok: false, reason: "Synchronisation déjà en cours" };

  const store = await db.store.findUnique({ where: { id: sync.storeId }, select: { id: true, slug: true, name: true, currency: true, status: true, subscription: true } });
  if (!store) return suspend(sync.id, sync.storeId, "Boutique introuvable");
  if (!PLANS[effectivePlanId(store.subscription, now)].features.catalogSync) {
    return suspend(sync.id, store.id, "La synchronisation du catalogue WhatsApp n'est pas incluse dans le plan actuel.");
  }
  if (store.status !== "PUBLISHED" && store.status !== "CLOSED_TEMPORARILY") {
    // Boutique non publiée, suspendue ou archivée : rien n'est supprimé chez Meta, la synchronisation attend.
    return suspend(sync.id, store.id, "Boutique non publiée : synchronisation en pause.");
  }
  if (!sync.externalCatalogId) return suspend(sync.id, store.id, "Renseignez l'identifiant du catalogue Meta.");

  let api = opts.api;
  let token: string | null = null;
  if (!api) {
    if (isDryRun()) api = dryRunCatalogApi;
    else {
      const graph = await whatsappGraph(store.id);
      if ("error" in graph) return suspend(sync.id, store.id, graph.error);
      token = graph.token;
      api = graphCatalogApi(graph.token);
    }
  }

  try {
    const source = await loadCatalogSource(store.id);
    const built = buildCatalogItems({ store, products: source.products, categories: source.categories, settings: readSettings(sync.settings), baseUrl: appBaseUrl(), now });
    const desired = desiredFromItems(built.items);
    const existing = await db.socialCatalogItem.findMany({
      where: { syncId: sync.id, storeId: store.id },
      select: { id: true, retailerId: true, productId: true, variantId: true, contentHash: true, status: true },
    });
    const diff = diffCatalog(desired, existing, { force: opts.force });
    const batches = buildBatchRequests(diff);

    const outcomes: ItemOutcome[] = [];
    let fatal: unknown = null;
    for (const requests of batches) {
      if (fatal) {
        outcomes.push(...failedBatch(requests, "Lot non envoyé après une erreur précédente"));
        continue;
      }
      try {
        outcomes.push(...mapBatchResponse(requests, await api.itemsBatch(sync.externalCatalogId, requests)));
      } catch (e) {
        fatal = e;
        outcomes.push(...failedBatch(requests, sanitizeError((e as Error).message, 300, [token])));
      }
    }

    await applyOutcomes(sync.id, store.id, outcomes, new Map(diff.upserts.map((d) => [d.retailerId, d])), existing, now);
    const failed = outcomes.filter((o) => !o.ok).length;
    // Refus encore actifs : ceux de ce passage et ceux, inchangés, d'un passage précédent (non renvoyés).
    const refused = failed + diff.blocked;

    if (fatal) {
      const failures = sync.consecutiveFailures + 1;
      const message = sanitizeError((fatal as Error).message, 500, [token]);
      await db.socialCatalogSync.updateMany({
        where: { id: sync.id, storeId: store.id },
        data: {
          status: "error",
          lastError: isConfigurationError(fatal) ? `${message} (vérifiez le jeton, sa permission catalog_management et l'identifiant du catalogue)` : message,
          lastSyncAt: now,
          consecutiveFailures: failures,
          nextSyncAt: new Date(now.getTime() + backoffDelayMs(failures)),
          itemCount: desired.length,
        },
      });
      console.error(`[social.sync] ${sync.id} échec (${failures}) : ${message}`);
      return { ok: false, reason: message };
    }

    await db.socialCatalogSync.updateMany({
      where: { id: sync.id, storeId: store.id },
      data: {
        status: refused > 0 ? "error" : "ok",
        lastError: refused > 0 ? `${refused} article${refused > 1 ? "s" : ""} refusé${refused > 1 ? "s" : ""} par Meta (détail par article ci-dessous).` : null,
        lastSyncAt: now,
        lastSuccessAt: now,
        consecutiveFailures: 0,
        nextSyncAt: new Date(now.getTime() + SYNC_INTERVAL_MS),
        itemCount: desired.length,
      },
    });
    return {
      ok: true,
      upserted: outcomes.filter((o) => o.ok && o.method === "UPDATE").length,
      deleted: outcomes.filter((o) => o.ok && o.method === "DELETE").length,
      unchanged: diff.unchanged,
      blocked: diff.blocked,
      failed,
      skipped: built.skipped.length,
    };
  } catch (e) {
    // Erreur inattendue (base) : la ligne repasse en erreur avec backoff, puis le job échoue (journal du worker).
    const failures = sync.consecutiveFailures + 1;
    await db.socialCatalogSync
      .updateMany({ where: { id: sync.id, storeId: sync.storeId }, data: { status: "error", lastError: "Erreur interne pendant la synchronisation", consecutiveFailures: failures, nextSyncAt: new Date(now.getTime() + backoffDelayMs(failures)) } })
      .catch(() => {});
    throw new Error(sanitizeError((e as Error).message, 500, [token]));
  }
}

/** Écrit l'état par article : synchronisé, refusé (message Meta), ou supprimé (ligne retirée). */
async function applyOutcomes(syncId: string, storeId: string, outcomes: ItemOutcome[], upserts: Map<string, DesiredItem>, existing: { id: string; retailerId: string }[], now: Date) {
  const existingIds = new Map(existing.map((e) => [e.retailerId, e.id]));
  for (const o of outcomes) {
    if (o.method === "DELETE") {
      const id = existingIds.get(o.retailerId);
      if (!id) continue;
      if (o.ok) await db.socialCatalogItem.deleteMany({ where: { id, syncId, storeId } });
      else await db.socialCatalogItem.updateMany({ where: { id, syncId, storeId }, data: { status: "error", lastError: o.error } });
      continue;
    }
    const d = upserts.get(o.retailerId);
    if (!d) continue;
    const data = { productId: d.productId, variantId: d.variantId, contentHash: d.hash, status: o.ok ? "synced" : "error", lastError: o.ok ? null : o.error, ...(o.ok ? { syncedAt: now } : {}) };
    await db.socialCatalogItem.upsert({
      where: { syncId_retailerId: { syncId, retailerId: o.retailerId } },
      create: { storeId, syncId, retailerId: o.retailerId, ...data },
      update: data,
    });
  }
}

/** Planificateur (balayage du worker) : met en file les synchronisations échues, avec un bail anti-doublon. */
export async function scheduleDueCatalogSyncs(now = new Date()): Promise<{ enqueued: number }> {
  const due = await db.socialCatalogSync.findMany({
    where: { channel: SYNC_CHANNEL, enabled: true, nextSyncAt: { lte: now }, status: { not: "syncing" } },
    select: { id: true, storeId: true, nextSyncAt: true },
    orderBy: { nextSyncAt: "asc" },
    take: 50,
  });
  let enqueued = 0;
  for (const s of due) {
    const ok = await db.$transaction(async (tx) => {
      const claimed = await tx.socialCatalogSync.updateMany({ where: { id: s.id, nextSyncAt: s.nextSyncAt }, data: { nextSyncAt: new Date(now.getTime() + SYNC_LEASE_MS) } });
      if (claimed.count !== 1) return false;
      await enqueue("social.sync", { syncId: s.id }, { storeId: s.storeId }, tx);
      return true;
    });
    if (ok) enqueued++;
  }
  return { enqueued };
}

export type RequestSyncResult = { ok: true; syncId: string } | { ok: false; error: string };

/**
 * « Synchroniser maintenant » (écran marchand et outil MCP) : synchronisation forcée (les articles refusés sont
 * renvoyés), mise en file dans une transaction. Les contrôles d'accès et de plan sont faits par l'appelant.
 */
export async function requestCatalogSync(storeId: string, now = new Date()): Promise<RequestSyncResult> {
  const sync = await db.socialCatalogSync.findUnique({ where: { storeId_channel: { storeId, channel: SYNC_CHANNEL } } });
  if (!sync || !sync.enabled) return { ok: false, error: "Activez d'abord la synchronisation du catalogue." };
  if (!sync.externalCatalogId) return { ok: false, error: "Renseignez l'identifiant du catalogue Meta." };
  if (sync.status === "syncing" && sync.updatedAt.getTime() > now.getTime() - SYNC_STALE_MS) return { ok: false, error: "Une synchronisation est déjà en cours." };
  const pending = await db.job.count({ where: { storeId, type: "social.sync", status: { in: ["PENDING", "RUNNING"] }, runAt: { lte: new Date(now.getTime() + 60_000) } } });
  if (pending > 0) return { ok: false, error: "Une synchronisation est déjà prévue dans la minute." };
  await db.$transaction(async (tx) => {
    await tx.socialCatalogSync.updateMany({ where: { id: sync.id, storeId }, data: { nextSyncAt: new Date(now.getTime() + SYNC_LEASE_MS) } });
    await enqueue("social.sync", { syncId: sync.id, force: true }, { storeId }, tx);
  });
  return { ok: true, syncId: sync.id };
}

export type CatalogStatus = {
  feeds: { channel: FeedChannel; enabled: boolean; url: string }[];
  sync: {
    configured: boolean;
    enabled: boolean;
    status: string;
    externalCatalogId: string | null;
    itemCount: number;
    lastSyncAt: Date | null;
    lastSuccessAt: Date | null;
    nextSyncAt: Date | null;
    consecutiveFailures: number;
    lastError: string | null;
  };
  items: { synced: number; error: number; pending: number };
  errors: { retailerId: string; productId: string; variantId: string | null; error: string | null; updatedAt: Date }[];
  settings: { includeOutOfStock: boolean; brand: string | null };
};

export function feedUrl(slug: string, channel: FeedChannel): string {
  return `${appBaseUrl()}/s/${slug}/feeds/${channel === "tiktok" ? "tiktok.csv" : `${channel}.xml`}`;
}

/** État complet (écran marchand, outil MCP get_catalog_sync_status), filtré par boutique. */
export async function getCatalogStatus(store: { id: string; slug: string }, errorLimit = 50): Promise<CatalogStatus> {
  const rows = await db.socialCatalogSync.findMany({ where: { storeId: store.id } });
  const sync = rows.find((r) => r.channel === SYNC_CHANNEL) ?? null;
  const [synced, error, pending, errors] = sync
    ? await Promise.all([
        db.socialCatalogItem.count({ where: { storeId: store.id, syncId: sync.id, status: "synced" } }),
        db.socialCatalogItem.count({ where: { storeId: store.id, syncId: sync.id, status: "error" } }),
        db.socialCatalogItem.count({ where: { storeId: store.id, syncId: sync.id, status: "pending" } }),
        db.socialCatalogItem.findMany({
          where: { storeId: store.id, syncId: sync.id, status: "error" },
          select: { retailerId: true, productId: true, variantId: true, lastError: true, updatedAt: true },
          orderBy: { updatedAt: "desc" },
          take: errorLimit,
        }),
      ])
    : [0, 0, 0, []];
  const settingsRow = sync ?? rows[0] ?? null;
  return {
    feeds: FEED_CHANNELS.map((channel) => ({ channel, enabled: rows.some((r) => r.channel === channel && r.enabled), url: feedUrl(store.slug, channel) })),
    sync: {
      configured: !!sync,
      enabled: !!sync?.enabled,
      status: sync?.status ?? "idle",
      externalCatalogId: sync?.externalCatalogId ?? null,
      itemCount: sync?.itemCount ?? 0,
      lastSyncAt: sync?.lastSyncAt ?? null,
      lastSuccessAt: sync?.lastSuccessAt ?? null,
      nextSyncAt: sync?.nextSyncAt ?? null,
      consecutiveFailures: sync?.consecutiveFailures ?? 0,
      lastError: sync?.lastError ?? null,
    },
    items: { synced, error, pending },
    errors: errors.map((e) => ({ retailerId: e.retailerId, productId: e.productId, variantId: e.variantId, error: e.lastError, updatedAt: e.updatedAt })),
    settings: readSettings(settingsRow?.settings),
  };
}
