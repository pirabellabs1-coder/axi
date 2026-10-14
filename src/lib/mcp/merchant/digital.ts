import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { formatFileSize, grantState } from "@/lib/digital/rules";
import { defineTool, type McpTool } from "../protocol";
import type { MerchantContext } from "../auth";
import { pageOf, zCursor, zId, zLimit } from "./common";

type Ctx = MerchantContext;

/**
 * Vague 2 (produits numériques) : suivi des téléchargements, en LECTURE SEULE.
 * Aucun jeton ni lien n'est jamais renvoyé par le MCP (un lien suffirait à télécharger les fichiers) ;
 * seuls les compteurs, limites et dates le sont. Toutes les lectures sont filtrées par `storeId`.
 */
export const listDigitalDownloads = defineTool({
  name: "list_digital_downloads",
  title: "List digital downloads",
  description:
    "Download accesses granted for digital products, with the number of downloads used, the limit, the expiry date and the last download. Use it to answer 'did the customer get the files?' or 'which links expired?'. Read-only: no download link or token is ever returned.",
  scopes: ["orders:read"],
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  input: z.object({
    order_id: zId.optional().describe("Only the accesses of this order."),
    product_id: zId.optional().describe("Only the accesses of this product."),
    state: z.enum(["ANY", "ACTIVE", "EXPIRED", "EXHAUSTED", "NEVER_DOWNLOADED"]).default("ANY").describe("Filter on the access state."),
    limit: zLimit(20, 100),
    cursor: zCursor,
  }),
  handler: async (ctx: Ctx, a) => {
    const now = new Date();
    const rows = await db.downloadGrant.findMany({
      where: {
        storeId: ctx.store.id,
        ...(a.order_id ? { orderId: a.order_id } : {}),
        ...(a.product_id ? { orderItem: { productId: a.product_id } } : {}),
        ...(a.state === "NEVER_DOWNLOADED" ? { downloadCount: 0 } : {}),
        ...(a.state === "EXPIRED" ? { expiresAt: { lte: now } } : {}),
      },
      select: {
        id: true, downloadCount: true, downloadLimit: true, expiresAt: true, lastDownloadAt: true, notifiedAt: true, createdAt: true,
        order: { select: { id: true, reference: true, status: true, customerName: true } },
        orderItem: { select: { name: true, variantName: true, productId: true, variantId: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: a.limit + 1,
      ...(a.cursor ? { cursor: { id: a.cursor }, skip: 1 } : {}),
    });
    const withState = rows.map((r) => ({ r, s: grantState(r, now) }));
    const kept = withState.filter(({ s }) => (a.state === "ACTIVE" ? s.usable : a.state === "EXHAUSTED" ? s.exhausted : true));
    const page = pageOf(
      kept.map(({ r }) => r),
      a.limit,
    );
    const items = page.items.map((r) => {
      const s = grantState(r, now);
      return {
        grant_id: r.id,
        order_id: r.order.id,
        order_reference: r.order.reference,
        product_id: r.orderItem.productId,
        item_name: r.orderItem.variantName ? `${r.orderItem.name} (${r.orderItem.variantName})` : r.orderItem.name,
        downloads: r.downloadCount,
        download_limit: r.downloadLimit,
        downloads_remaining: s.remaining,
        expires_at: r.expiresAt ? r.expiresAt.toISOString() : null,
        last_download_at: r.lastDownloadAt ? r.lastDownloadAt.toISOString() : null,
        emailed_at: r.notifiedAt ? r.notifiedAt.toISOString() : null,
        state: s.expired ? "expired" : s.exhausted ? "exhausted" : "active",
        created_at: r.createdAt.toISOString(),
      };
    });
    const text = items.length
      ? [
          `${items.length} download access(es)${page.has_more ? " (more available: pass next_cursor)" : ""}:`,
          ...items.map(
            (i) =>
              `- ${i.item_name} (order ${i.order_reference}): ${i.downloads}${i.download_limit != null ? `/${i.download_limit}` : ""} download(s), ${i.state}${i.last_download_at ? `, last ${i.last_download_at.slice(0, 10)}` : ", never downloaded"}`,
          ),
        ].join("\n")
      : "No download access matches these criteria.";
    return { text, data: { downloads: items, next_cursor: page.next_cursor, has_more: page.has_more } };
  },
});

/** Fichiers vendus d'un produit numérique (noms, tailles, versions ; jamais de clé de stockage ni de lien). */
export const listProductFiles = defineTool({
  name: "list_product_files",
  title: "List the files of a digital product",
  description: "Files attached to a digital product (name, size, type, version). Read-only: storage keys and download links are never returned.",
  scopes: ["catalog:read"],
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  input: z.object({ product_id: zId }),
  handler: async (ctx: Ctx, a) => {
    const rows = await db.digitalAsset.findMany({
      where: { storeId: ctx.store.id, productId: a.product_id },
      select: { id: true, name: true, variantId: true, bytes: true, mime: true, version: true, updatedAt: true },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      take: 50,
    });
    const files = rows.map((r) => ({ file_id: r.id, name: r.name, variant_id: r.variantId, bytes: r.bytes, size: formatFileSize(r.bytes), mime: r.mime, version: r.version, updated_at: r.updatedAt.toISOString() }));
    const text = files.length ? [`${files.length} file(s):`, ...files.map((f) => `- ${f.name} (${f.size}, ${f.mime}, v${f.version})${f.variant_id ? " [variant only]" : ""}`)].join("\n") : "This product has no file yet. Files are uploaded from the Axi product page.";
    return { text, data: { files } };
  },
});

export const DIGITAL_TOOLS: McpTool<Ctx>[] = [listDigitalDownloads, listProductFiles];
