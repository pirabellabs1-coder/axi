import "server-only";
import { Prisma } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { enqueue } from "@/lib/jobs";
import { audit } from "@/lib/audit";
import { sendMail } from "@/lib/email";
import { waLink } from "@/lib/whatsapp";
import { SITE } from "@/config/site";
import { formatDate } from "@/lib/utils";
import { productKindOf } from "./kinds";
import { assetsForLine, downloadsLabel, formatFileSize, grantState, resolveDownloadExpiry, resolveDownloadLimit, type GrantLike } from "./rules";
import { generateDownloadToken, hashDownloadToken, isDownloadTokenShape, sameDownloadHash } from "./token";

/**
 * Produits numériques (vague 2) — services serveur.
 *
 * Contrat avec les autres équipes :
 *  1. `enqueueDigitalDeliveryTx(tx, storeId, orderId)` : à appeler DANS la transaction qui confirme le paiement
 *     (aujourd'hui : le gestionnaire du job `payment.succeeded`, qui est déjà mis en file dans cette transaction
 *     sur les trois chemins de passage à PAID) ;
 *  2. le job `digital.deliver` appelle `issueDigitalDeliveriesForOrder(orderId)` : idempotent
 *     (`@@unique([orderItemId])`), jamais avant `paymentStatus = PAID`, jamais pour une commande annulée
 *     ou remboursée (revérifié sous verrou), puis notifie l'acheteur et clôt une commande 100 % numérique ;
 *  3. lecture publique par jeton : `loadGrantByToken(token)` puis `serveDownload(...)` (compteur atomique).
 *
 * Les fichiers ne sont JAMAIS exposés par une URL publique : seule la route
 * `/telechargement/{jeton}/fichier/{assetId}` les relaie, après contrôle du jeton, de l'expiration,
 * de la limite et du débit.
 */

/* ───────────────────────── Fichiers du catalogue ───────────────────────── */

export type ProductAsset = {
  id: string;
  name: string;
  variantId: string | null;
  bytes: number;
  mime: string;
  version: number;
  position: number;
  updatedAt: Date;
};

const ASSET_SELECT = { id: true, name: true, variantId: true, bytes: true, mime: true, version: true, position: true, updatedAt: true } satisfies Prisma.DigitalAssetSelect;

/** Fichiers d'un produit (toujours filtrés par boutique). */
export async function listProductAssets(storeId: string, productId: string, client: Tx | typeof db = db): Promise<ProductAsset[]> {
  return client.digitalAsset.findMany({
    where: { storeId, productId },
    select: ASSET_SELECT,
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
}

/** Nombre de fichiers par produit (liste du catalogue : un seul appel groupé). */
export async function countAssetsByProduct(storeId: string, productIds: string[]): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map();
  const rows = await db.digitalAsset.groupBy({ by: ["productId"], where: { storeId, productId: { in: productIds } }, _count: { _all: true } });
  return new Map(rows.map((r) => [r.productId, r._count._all]));
}

/* ───────────────────────── Émission des accès ───────────────────────── */

/** À appeler dans la transaction qui confirme le paiement (cf. contrat ci-dessus). */
export async function enqueueDigitalDeliveryTx(tx: Tx | typeof db, storeId: string, orderId: string) {
  return enqueue("digital.deliver", { orderId }, { storeId }, tx);
}

/** Vrai si la commande contient au moins une ligne numérique (instantané `OrderItem.kind`). */
export async function orderHasDigitalLines(client: Tx | typeof db, orderId: string): Promise<boolean> {
  const n = await client.orderItem.count({ where: { orderId, kind: "DIGITAL" } });
  return n > 0;
}

export type IssueResult = { issued: number; skipped: number; reason?: string };

/**
 * Crée les accès de téléchargement d'une commande payée (une ligne d'accès par ligne de commande numérique)
 * puis notifie l'acheteur. Idempotent : `@@unique([orderItemId])` + revérification avant insertion.
 */
export async function issueDigitalDeliveriesForOrder(orderId: string, opts: { now?: Date } = {}): Promise<IssueResult> {
  const now = opts.now ?? new Date();
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true, storeId: true, customerId: true, status: true, paymentStatus: true, reference: true, currency: true,
      customerName: true, customerEmail: true, customerPhone: true,
      items: { select: { id: true, productId: true, variantId: true, name: true, variantName: true, quantity: true, kind: true } },
    },
  });
  if (!order) return { issued: 0, skipped: 0, reason: "not_found" };
  if (order.paymentStatus !== "PAID") return { issued: 0, skipped: 0, reason: "unpaid" };
  if (order.status === "CANCELLED" || order.status === "REFUNDED") return { issued: 0, skipped: 0, reason: "cancelled" };
  const lines = order.items.filter((i) => i.kind === "DIGITAL");
  if (lines.length === 0) return { issued: 0, skipped: 0, reason: "no_digital" };

  const productIds = [...new Set(lines.map((l) => l.productId).filter((v): v is string => !!v))];
  const products = productIds.length
    ? await db.product.findMany({ where: { id: { in: productIds }, storeId: order.storeId }, select: { id: true, downloadLimit: true, downloadValidityDays: true } })
    : [];

  let issued = 0;
  let skipped = 0;
  for (const line of lines) {
    const existing = await db.downloadGrant.findUnique({ where: { orderItemId: line.id }, select: { id: true } });
    if (existing) {
      skipped++;
      continue;
    }
    const product = products.find((p) => p.id === line.productId);
    const token = generateDownloadToken();
    try {
      const created = await db.$transaction(async (tx) => {
        // Revérification sous verrou : une annulation ou un remboursement concurrent empêche l'émission.
        await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${order.id} FOR UPDATE`;
        const fresh = await tx.order.findUnique({ where: { id: order.id }, select: { status: true, paymentStatus: true } });
        if (!fresh || fresh.paymentStatus !== "PAID" || fresh.status === "CANCELLED" || fresh.status === "REFUNDED") return null;
        const grant = await tx.downloadGrant.create({
          data: {
            storeId: order.storeId,
            orderId: order.id,
            orderItemId: line.id,
            customerId: order.customerId,
            tokenHash: hashDownloadToken(token),
            downloadCount: 0,
            downloadLimit: resolveDownloadLimit(product?.downloadLimit ?? null),
            expiresAt: resolveDownloadExpiry(product?.downloadValidityDays ?? null, now),
          },
          select: { id: true, downloadLimit: true, expiresAt: true },
        });
        await audit({ storeId: order.storeId, actorId: null, action: "digital.grant_issued", target: grant.id, metadata: { orderId: order.id, orderItemId: line.id } }, tx);
        const { emitDomainEvent } = await import("@/lib/webhooks/emit");
        // Jamais le jeton dans un webhook : seuls les identifiants et les limites sont transmis.
        await emitDomainEvent(tx, order.storeId, "digital.delivered", {
          order_id: order.id,
          order_item_id: line.id,
          grant_id: grant.id,
          product_id: line.productId,
          download_limit: grant.downloadLimit,
          expires_at: grant.expiresAt ? grant.expiresAt.toISOString() : null,
        });
        return grant;
      });
      if (!created) return { issued, skipped, reason: "cancelled" };
      issued++;
      // Notification hors transaction : un échec d'envoi ne doit pas annuler l'accès (le job est retenté).
      await notifyGrant(created.id, token).catch((e) => console.error("[digital] notification", e));
    } catch (e) {
      // Course entre deux workers : l'accès existe désormais (unicité par ligne de commande).
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        skipped++;
        continue;
      }
      throw e;
    }
  }

  // Commande 100 % numérique (ou service / carte cadeau) : rien à expédier, elle est clôturée.
  await completeIntangibleOrder(order.id).catch((e) => console.error("[digital] clôture", e));
  return { issued, skipped };
}

/**
 * Commande sans ligne physique et payée : passage direct à « Livrée / remise » (machine d'états étendue
 * de façon rétrocompatible, `canTransition(from, to, { intangible: true })`). Idempotent.
 */
export async function completeIntangibleOrder(orderId: string): Promise<boolean> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { id: true, storeId: true, status: true, paymentStatus: true, items: { select: { kind: true, isGiftCard: true } } },
  });
  if (!order || order.paymentStatus !== "PAID") return false;
  const { summarizeCartKinds } = await import("./kinds");
  if (!summarizeCartKinds(order.items).digitalOnly) return false;
  if (order.status === "DELIVERED" || order.status === "CANCELLED" || order.status === "REFUNDED") return false;
  const { transitionOrder } = await import("@/lib/commerce/orders");
  await transitionOrder({
    orderId: order.id,
    storeId: order.storeId,
    to: "DELIVERED",
    actorId: null,
    actorLabel: "Système",
    reason: "Commande sans expédition : remise immédiate après paiement",
    intangible: true,
  });
  return true;
}

/* ───────────────────────── Notification de l'acheteur ───────────────────────── */

export function downloadPageUrl(token: string): string {
  return `${SITE.url.replace(/\/+$/, "")}/telechargement/${token}`;
}

/** Texte remis à l'acheteur (contient le lien : à ne produire que pour un ayant droit). */
export function downloadMessageText(p: {
  storeName: string;
  reference: string;
  customerName?: string | null;
  itemName: string;
  files: { name: string; bytes: number }[];
  url: string;
  grant: GrantLike;
  instructions?: string | null;
  now: Date;
}): string {
  const lines: string[] = [];
  lines.push(`Bonjour${p.customerName ? ` ${p.customerName}` : ""},`);
  lines.push("");
  lines.push(`Votre commande ${p.reference} chez ${p.storeName} est prête : « ${p.itemName} ».`);
  if (p.files.length) {
    lines.push("");
    for (const f of p.files) lines.push(`▪ ${f.name} (${formatFileSize(f.bytes)})`);
  }
  lines.push("");
  lines.push(`Télécharger : ${p.url}`);
  lines.push(downloadsLabel(p.grant, p.now) + (p.grant.expiresAt ? `, lien valable jusqu'au ${formatDate(p.grant.expiresAt, { day: "numeric", month: "long", year: "numeric" })}` : ""));
  if (p.instructions) {
    lines.push("");
    lines.push(p.instructions);
  }
  lines.push("");
  lines.push("Gardez ce lien pour vous : toute personne qui l'a peut télécharger les fichiers.");
  return lines.join("\n");
}

type NotifyPayload = {
  storeName: string;
  storePhone: string | null;
  reference: string;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  itemName: string;
  files: { name: string; bytes: number }[];
  instructions: string | null;
  grant: GrantLike;
};

async function loadNotifyPayload(grantId: string): Promise<NotifyPayload | null> {
  const grant = await db.downloadGrant.findUnique({
    where: { id: grantId },
    select: {
      id: true, storeId: true, downloadCount: true, downloadLimit: true, expiresAt: true,
      order: { select: { reference: true, customerName: true, customerEmail: true, customerPhone: true } },
      orderItem: { select: { name: true, variantName: true, productId: true, variantId: true } },
      store: { select: { name: true, whatsappNumber: true } },
    },
  });
  if (!grant) return null;
  const product = grant.orderItem.productId
    ? await db.product.findFirst({ where: { id: grant.orderItem.productId, storeId: grant.storeId }, select: { postPurchaseInstructions: true } })
    : null;
  const assets = grant.orderItem.productId ? await listProductAssets(grant.storeId, grant.orderItem.productId) : [];
  return {
    storeName: grant.store.name,
    storePhone: grant.store.whatsappNumber,
    reference: grant.order.reference,
    customerName: grant.order.customerName,
    customerEmail: grant.order.customerEmail,
    customerPhone: grant.order.customerPhone,
    itemName: grant.orderItem.variantName ? `${grant.orderItem.name} (${grant.orderItem.variantName})` : grant.orderItem.name,
    files: assetsForLine(assets, grant.orderItem.variantId).map((a) => ({ name: a.name, bytes: a.bytes })),
    instructions: product?.postPurchaseInstructions ?? null,
    grant: { downloadCount: grant.downloadCount, downloadLimit: grant.downloadLimit, expiresAt: grant.expiresAt },
  };
}

/**
 * Envoi du lien à l'acheteur : e-mail si la commande en porte un (le lien ne passe jamais par la table
 * Notification) ; sans e-mail, rien n'est envoyé — le lien `wa.me` est proposé au commerçant et à l'acheteur
 * sur la page de confirmation, comme pour les cartes cadeaux. `notifiedAt` n'est posé qu'après un envoi réel.
 */
export async function notifyGrant(grantId: string, token: string, opts: { now?: Date } = {}): Promise<{ channel: "email" | "link" | "none" }> {
  const p = await loadNotifyPayload(grantId);
  if (!p) return { channel: "none" };
  if (!p.customerEmail) return { channel: p.customerPhone ? "link" : "none" };
  const text = downloadMessageText({
    storeName: p.storeName,
    reference: p.reference,
    customerName: p.customerName,
    itemName: p.itemName,
    files: p.files,
    url: downloadPageUrl(token),
    grant: p.grant,
    instructions: p.instructions,
    now: opts.now ?? new Date(),
  });
  const res = await sendMail({ to: p.customerEmail, subject: `Vos fichiers — commande ${p.reference} (${p.storeName})`, text });
  if (!res.ok) throw new Error(`Envoi du lien de téléchargement impossible : ${res.error ?? "erreur inconnue"}`);
  await db.downloadGrant.update({ where: { id: grantId }, data: { notifiedAt: new Date() } });
  return { channel: "email" };
}

/**
 * Lien `wa.me` prérempli vers l'acheteur, SANS le jeton (il n'existe plus en clair après l'émission) :
 * il invite l'acheteur à retrouver ses fichiers depuis la page de confirmation ou son espace client.
 */
export function downloadWhatsappLink(p: { phone: string; storeName: string; reference: string; trackingToken: string }): string {
  const url = `${SITE.url.replace(/\/+$/, "")}/suivi/${p.trackingToken}`;
  return waLink(
    p.phone,
    [`Bonjour, vos fichiers de la commande ${p.reference} chez ${p.storeName} sont prêts.`, "", `Suivi et téléchargement : ${url}`].join("\n"),
  );
}

/* ───────────────────────── Lecture par jeton (acheteur) ───────────────────────── */

export type DownloadFile = { id: string; name: string; bytes: number; mime: string; version: number };

export type DownloadView = {
  grantId: string;
  storeId: string;
  storeName: string;
  storeSlug: string;
  storeLogoUrl: string | null;
  storeStatus: string;
  storeThemeId: string;
  storeThemeConfig: unknown;
  storeSector: string;
  reference: string;
  trackingToken: string;
  itemName: string;
  instructions: string | null;
  files: DownloadFile[];
  downloadCount: number;
  downloadLimit: number | null;
  expiresAt: Date | null;
  lastDownloadAt: Date | null;
};

/**
 * Charge un accès depuis un jeton en clair : forme du jeton vérifiée AVANT toute requête, recherche par
 * empreinte HMAC (index unique), puis comparaison de l'empreinte en temps constant.
 */
export async function loadGrantByToken(token: unknown): Promise<DownloadView | null> {
  if (!isDownloadTokenShape(token)) return null;
  const hash = hashDownloadToken(token);
  const grant = await db.downloadGrant.findUnique({
    where: { tokenHash: hash },
    select: {
      id: true, storeId: true, tokenHash: true, downloadCount: true, downloadLimit: true, expiresAt: true, lastDownloadAt: true,
      order: { select: { reference: true, trackingToken: true, status: true, paymentStatus: true } },
      orderItem: { select: { name: true, variantName: true, productId: true, variantId: true } },
      store: { select: { name: true, slug: true, logoUrl: true, status: true, themeId: true, themeConfig: true, sector: true } },
    },
  });
  if (!grant || !sameDownloadHash(grant.tokenHash, hash)) return null;
  // Commande annulée ou remboursée : l'accès ne vaut plus rien (il n'est pas supprimé, pour l'historique).
  if (grant.order.status === "CANCELLED" || grant.order.status === "REFUNDED") return null;

  const product = grant.orderItem.productId
    ? await db.product.findFirst({ where: { id: grant.orderItem.productId, storeId: grant.storeId }, select: { postPurchaseInstructions: true } })
    : null;
  const assets = grant.orderItem.productId ? await listProductAssets(grant.storeId, grant.orderItem.productId) : [];
  return {
    grantId: grant.id,
    storeId: grant.storeId,
    storeName: grant.store.name,
    storeSlug: grant.store.slug,
    storeLogoUrl: grant.store.logoUrl,
    storeStatus: grant.store.status,
    storeThemeId: grant.store.themeId,
    storeThemeConfig: grant.store.themeConfig,
    storeSector: grant.store.sector,
    reference: grant.order.reference,
    trackingToken: grant.order.trackingToken,
    itemName: grant.orderItem.variantName ? `${grant.orderItem.name} (${grant.orderItem.variantName})` : grant.orderItem.name,
    instructions: product?.postPurchaseInstructions ?? null,
    files: assetsForLine(assets, grant.orderItem.variantId).map((a) => ({ id: a.id, name: a.name, bytes: a.bytes, mime: a.mime, version: a.version })),
    downloadCount: grant.downloadCount,
    downloadLimit: grant.downloadLimit,
    expiresAt: grant.expiresAt,
    lastDownloadAt: grant.lastDownloadAt,
  };
}

export type ServeDecision =
  | { ok: true; storeId: string; storageKey: string; name: string; mime: string; bytes: number; remaining: number | null }
  | { ok: false; status: 404 | 403 | 410 | 429; message: string };

/**
 * Autorise (ou non) le service d'un fichier et consomme UNE unité du compteur, de façon ATOMIQUE :
 * `UPDATE … WHERE id = ? AND (downloadLimit IS NULL OR downloadCount < downloadLimit) AND (expiresAt IS NULL OR expiresAt > now)`.
 * Deux requêtes simultanées ne peuvent donc pas dépasser la limite (la seconde reçoit 0 ligne modifiée).
 */
export async function serveDownload(p: { token: unknown; assetId: string; ip: string | null; now?: Date }): Promise<ServeDecision> {
  const now = p.now ?? new Date();
  const NOT_FOUND = { ok: false as const, status: 404 as const, message: "Lien de téléchargement introuvable." };
  if (!isDownloadTokenShape(p.token)) return NOT_FOUND;
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(p.assetId)) return NOT_FOUND;
  const hash = hashDownloadToken(p.token);
  const grant = await db.downloadGrant.findUnique({
    where: { tokenHash: hash },
    select: {
      id: true, storeId: true, tokenHash: true, downloadCount: true, downloadLimit: true, expiresAt: true,
      order: { select: { status: true, paymentStatus: true } },
      orderItem: { select: { productId: true, variantId: true } },
    },
  });
  if (!grant || !sameDownloadHash(grant.tokenHash, hash)) return NOT_FOUND;
  if (grant.order.paymentStatus !== "PAID" || grant.order.status === "CANCELLED" || grant.order.status === "REFUNDED") return NOT_FOUND;

  const state = grantState(grant, now);
  if (state.expired) return { ok: false, status: 410, message: "Ce lien de téléchargement a expiré." };
  if (state.exhausted) return { ok: false, status: 403, message: "Nombre de téléchargements autorisés atteint." };

  // Le fichier doit appartenir au produit acheté, à la boutique de l'accès, et à la variante achetée.
  const asset = await db.digitalAsset.findFirst({
    where: { id: p.assetId, storeId: grant.storeId, productId: grant.orderItem.productId ?? "", OR: [{ variantId: null }, { variantId: grant.orderItem.variantId }] },
    select: { id: true, name: true, storageKey: true, mime: true, bytes: true },
  });
  if (!asset) return NOT_FOUND;

  // Débit par accès (anti-partage du lien).
  const { rateLimit, rateLimitMessage } = await import("@/lib/rate-limit");
  const { DOWNLOAD_RATE } = await import("./rules");
  const rl = await rateLimit(`download:grant:${grant.id}`, DOWNLOAD_RATE.limit, DOWNLOAD_RATE.windowSec);
  if (!rl.ok) return { ok: false, status: 429, message: rateLimitMessage(rl.retryAfter) };

  // Incrément CONDITIONNEL et atomique (limite et expiration revérifiées dans le même UPDATE).
  const consumed = await db.$executeRaw`
    UPDATE "DownloadGrant"
       SET "downloadCount" = "downloadCount" + 1, "lastDownloadAt" = ${now}, "lastIp" = ${p.ip ?? null}
     WHERE "id" = ${grant.id}
       AND ("downloadLimit" IS NULL OR "downloadCount" < "downloadLimit")
       AND ("expiresAt" IS NULL OR "expiresAt" > ${now})`;
  if (consumed !== 1) return { ok: false, status: 403, message: "Nombre de téléchargements autorisés atteint." };
  const remaining = grant.downloadLimit == null ? null : Math.max(0, grant.downloadLimit - grant.downloadCount - 1);
  return { ok: true, storeId: grant.storeId, storageKey: asset.storageKey, name: asset.name, mime: asset.mime, bytes: asset.bytes, remaining };
}

/* ───────────────────────── Vues marchand et acheteur connecté ───────────────────────── */

export type OrderDownloadRow = {
  grantId: string;
  orderItemId: string;
  itemName: string;
  files: number;
  downloadCount: number;
  downloadLimit: number | null;
  expiresAt: Date | null;
  lastDownloadAt: Date | null;
  notifiedAt: Date | null;
  state: ReturnType<typeof grantState>;
};

/** Suivi des téléchargements d'une commande (espace marchand). Jamais de jeton, jamais de lien. */
export async function listOrderDownloads(storeId: string, orderId: string, now = new Date()): Promise<OrderDownloadRow[]> {
  const grants = await db.downloadGrant.findMany({
    where: { storeId, orderId },
    select: {
      id: true, orderItemId: true, downloadCount: true, downloadLimit: true, expiresAt: true, lastDownloadAt: true, notifiedAt: true,
      orderItem: { select: { name: true, variantName: true, productId: true, variantId: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const productIds = [...new Set(grants.map((g) => g.orderItem.productId).filter((v): v is string => !!v))];
  const assets = productIds.length
    ? await db.digitalAsset.findMany({ where: { storeId, productId: { in: productIds } }, select: { productId: true, variantId: true, name: true, position: true } })
    : [];
  return grants.map((g) => ({
    grantId: g.id,
    orderItemId: g.orderItemId,
    itemName: g.orderItem.variantName ? `${g.orderItem.name} (${g.orderItem.variantName})` : g.orderItem.name,
    files: assetsForLine(assets.filter((a) => a.productId === g.orderItem.productId), g.orderItem.variantId).length,
    downloadCount: g.downloadCount,
    downloadLimit: g.downloadLimit,
    expiresAt: g.expiresAt,
    lastDownloadAt: g.lastDownloadAt,
    notifiedAt: g.notifiedAt,
    state: grantState(g, now),
  }));
}

export type CustomerDownloadRow = {
  grantId: string;
  reference: string;
  itemName: string;
  files: number;
  downloadCount: number;
  downloadLimit: number | null;
  expiresAt: Date | null;
  state: ReturnType<typeof grantState>;
  /** Chemin interne de la page de téléchargement (jeton signé par l'accès : il n'est pas réaffiché). */
  trackingToken: string;
  createdAt: Date;
};

/**
 * Téléchargements d'un acheteur CONNECTÉ (session acheteur : `customerId` + `storeId` vérifiés par l'appelant).
 * Le jeton n'est pas réaffiché : l'acheteur ouvre sa commande (page de suivi), d'où partent les liens.
 */
export async function listCustomerDownloads(storeId: string, customerId: string, now = new Date()): Promise<CustomerDownloadRow[]> {
  const grants = await db.downloadGrant.findMany({
    where: { storeId, customerId },
    select: {
      id: true, downloadCount: true, downloadLimit: true, expiresAt: true, createdAt: true,
      order: { select: { reference: true, trackingToken: true, status: true } },
      orderItem: { select: { name: true, variantName: true, productId: true, variantId: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const visible = grants.filter((g) => g.order.status !== "CANCELLED" && g.order.status !== "REFUNDED");
  const productIds = [...new Set(visible.map((g) => g.orderItem.productId).filter((v): v is string => !!v))];
  const assets = productIds.length
    ? await db.digitalAsset.findMany({ where: { storeId, productId: { in: productIds } }, select: { productId: true, variantId: true, name: true, position: true } })
    : [];
  return visible.map((g) => ({
    grantId: g.id,
    reference: g.order.reference,
    trackingToken: g.order.trackingToken,
    itemName: g.orderItem.variantName ? `${g.orderItem.name} (${g.orderItem.variantName})` : g.orderItem.name,
    files: assetsForLine(assets.filter((a) => a.productId === g.orderItem.productId), g.orderItem.variantId).length,
    downloadCount: g.downloadCount,
    downloadLimit: g.downloadLimit,
    expiresAt: g.expiresAt,
    state: grantState(g, now),
    createdAt: g.createdAt,
  }));
}

/**
 * Accès d'une commande vus par l'ACHETEUR qui possède le jeton de suivi (page de confirmation et page de suivi) :
 * un nouveau jeton de téléchargement est émis à la demande (rotation), car l'ancien n'existe plus en clair.
 */
export async function downloadLinksForOrder(storeId: string, orderId: string): Promise<{ grantId: string; itemName: string; files: number; label: string; url: string }[]> {
  const now = new Date();
  const rows = await listOrderDownloads(storeId, orderId, now);
  const out: { grantId: string; itemName: string; files: number; label: string; url: string }[] = [];
  for (const r of rows) {
    const token = await rotateGrantToken(storeId, r.grantId);
    if (!token) continue;
    out.push({
      grantId: r.grantId,
      itemName: r.itemName,
      files: r.files,
      label: downloadsLabel({ downloadCount: r.downloadCount, downloadLimit: r.downloadLimit, expiresAt: r.expiresAt }, now),
      url: `/telechargement/${token}`,
    });
  }
  return out;
}

/**
 * Remplace le jeton d'un accès et renvoie le nouveau jeton en clair (une seule fois).
 * Appelé quand un ayant droit prouve son droit autrement (jeton de suivi de la commande, session acheteur,
 * commerçant qui renvoie le lien) : l'ancien lien cesse immédiatement de fonctionner.
 */
export async function rotateGrantToken(storeId: string, grantId: string): Promise<string | null> {
  const token = generateDownloadToken();
  const done = await db.downloadGrant.updateMany({ where: { id: grantId, storeId }, data: { tokenHash: hashDownloadToken(token) } });
  return done.count === 1 ? token : null;
}

/** Nature d'un produit, lue en base (pratique pour les écrans et les gardes serveur). */
export async function productKind(storeId: string, productId: string): Promise<string> {
  const p = await db.product.findFirst({ where: { id: productId, storeId }, select: { kind: true, isGiftCard: true } });
  return productKindOf(p);
}
