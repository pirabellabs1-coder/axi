"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireStore } from "@/lib/auth/permissions";
import { audit } from "@/lib/audit";
import { badIds, fail, guard, success, type ActionResult } from "@/lib/action";
import { MAX_FILES_PER_PRODUCT } from "@/lib/storage/file-keys";
import { listProductAssets, notifyGrant, rotateGrantToken, downloadWhatsappLink, type ProductAsset } from "./service";

/**
 * Actions de l'espace marchand pour les fichiers vendus et les accès de téléchargement (vague 2).
 * Le TÉLÉVERSEMENT ne passe pas par une action serveur (octets bruts) : `POST /api/stores/{storeId}/files`.
 * Toutes les écritures sont filtrées par `storeId` et exigent la capacité correspondante.
 */

const nameSchema = z.string().trim().min(1, "Donnez un nom au fichier").max(120, "120 caractères maximum");

/** Fichiers d'un produit (rechargement de la liste après un téléversement). */
export async function listDigitalAssets(storeId: string, productId: string): Promise<ActionResult<{ assets: ProductAsset[]; max: number }>> {
  return guard(async () => {
    const bad = badIds(storeId, productId);
    if (bad) return bad;
    const ctx = await requireStore(storeId, "products.manage");
    const product = await db.product.findFirst({ where: { id: productId, storeId: ctx.store.id }, select: { id: true } });
    if (!product) return fail("Produit introuvable");
    return success({ assets: await listProductAssets(ctx.store.id, product.id), max: MAX_FILES_PER_PRODUCT });
  });
}

export async function renameDigitalAsset(storeId: string, assetId: string, name: string): Promise<ActionResult> {
  return guard(async () => {
    const bad = badIds(storeId, assetId);
    if (bad) return bad;
    const parsed = nameSchema.safeParse(name);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Nom invalide", { name: [parsed.error.issues[0]?.message ?? "Nom invalide"] });
    const ctx = await requireStore(storeId, "products.manage");
    const asset = await db.digitalAsset.findFirst({ where: { id: assetId, storeId: ctx.store.id }, select: { id: true, productId: true } });
    if (!asset) return fail("Fichier introuvable");
    await db.digitalAsset.updateMany({ where: { id: asset.id, storeId: ctx.store.id }, data: { name: parsed.data } });
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "digital.asset_renamed", target: asset.id, metadata: { name: parsed.data } });
    revalidatePath(`/app/${ctx.store.id}/produits/${asset.productId}`);
    return success(undefined, "Nom du fichier enregistré");
  });
}

/**
 * Retire un fichier du produit. L'objet stocké n'est PAS supprimé : les accès déjà émis pour d'autres
 * produits peuvent le partager (dédoublonnage par contenu) et l'historique reste lisible. L'inventaire
 * des objets non référencés se fait avec `pnpm media:orphans`.
 */
export async function deleteDigitalAsset(storeId: string, assetId: string): Promise<ActionResult> {
  return guard(async () => {
    const bad = badIds(storeId, assetId);
    if (bad) return bad;
    const ctx = await requireStore(storeId, "products.manage");
    const asset = await db.digitalAsset.findFirst({ where: { id: assetId, storeId: ctx.store.id }, select: { id: true, productId: true, name: true } });
    if (!asset) return fail("Fichier introuvable");
    await db.digitalAsset.deleteMany({ where: { id: asset.id, storeId: ctx.store.id } });
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "digital.asset_deleted", target: asset.id, metadata: { name: asset.name } });
    revalidatePath(`/app/${ctx.store.id}/produits/${asset.productId}`);
    return success(undefined, "Fichier retiré");
  });
}

/**
 * Renvoie le lien de téléchargement à l'acheteur : un NOUVEAU jeton est émis (l'ancien cesse de fonctionner),
 * puis l'e-mail est renvoyé. Sans e-mail sur la commande, un lien `wa.me` est proposé au commerçant
 * (il renvoie vers la page de suivi, d'où l'acheteur ouvre ses fichiers : le jeton n'est jamais partagé en clair).
 */
export async function resendDownloadLink(storeId: string, grantId: string): Promise<ActionResult<{ channel: string; waLink: string | null }>> {
  return guard(async () => {
    const bad = badIds(storeId, grantId);
    if (bad) return bad;
    const ctx = await requireStore(storeId, "orders.manage");
    const grant = await db.downloadGrant.findFirst({
      where: { id: grantId, storeId: ctx.store.id },
      select: { id: true, orderId: true, order: { select: { reference: true, customerEmail: true, customerPhone: true, trackingToken: true } } },
    });
    if (!grant) return fail("Accès de téléchargement introuvable");
    const token = await rotateGrantToken(ctx.store.id, grant.id);
    if (!token) return fail("Accès de téléchargement introuvable");
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "digital.link_resent", target: grant.id, metadata: { orderId: grant.orderId } });
    let channel = "none";
    try {
      channel = (await notifyGrant(grant.id, token)).channel;
    } catch (e) {
      return fail(`Envoi impossible : ${(e as Error).message}`);
    }
    revalidatePath(`/app/${ctx.store.id}/commandes/${grant.orderId}`);
    const link =
      channel !== "email" && grant.order.customerPhone
        ? downloadWhatsappLink({ phone: grant.order.customerPhone, storeName: ctx.store.name, reference: grant.order.reference, trackingToken: grant.order.trackingToken })
        : null;
    return success(
      { channel, waLink: link },
      channel === "email" ? "Nouveau lien envoyé par e-mail (l'ancien ne fonctionne plus)" : "Nouveau lien prêt : partagez-le par WhatsApp",
    );
  });
}

/* ───────────────────────── Acheteur (jeton de suivi) ───────────────────────── */

/**
 * Ouvre les fichiers d'une ligne de commande depuis la page de suivi (acheteur sans compte).
 *
 * Le JETON DE SUIVI de la commande sert d'autorisation (même modèle que `/suivi/{token}`) : format vérifié,
 * commande existante, lien non expiré, accès appartenant à cette commande. Un NOUVEAU jeton de téléchargement
 * est émis à chaque ouverture (l'ancien lien, par exemple celui de l'e-mail, cesse de fonctionner) : le jeton
 * n'existe en clair que dans la réponse. Débit : 20 ouvertures / 10 min par commande et par IP.
 */
export async function openOrderDownload(trackingToken: string, grantId: string): Promise<ActionResult<{ url: string }>> {
  return guard(async () => {
    if (typeof trackingToken !== "string" || !/^[0-9a-f]{16,128}$/.test(trackingToken)) return fail("Lien de suivi invalide.");
    const bad = badIds(grantId);
    if (bad) return bad;
    const { clientIp, rateLimitAll, rateLimitMessage } = await import("@/lib/rate-limit");
    const ip = await clientIp();
    const rl = await rateLimitAll([
      { key: `dl-open:order:${trackingToken.slice(0, 32)}`, limit: 20, windowSec: 600 },
      { key: `dl-open:ip:${ip}`, limit: 60, windowSec: 600 },
    ]);
    if (!rl.ok) return fail(rateLimitMessage(rl.retryAfter));
    const order = await db.order.findUnique({ where: { trackingToken }, select: { id: true, storeId: true, status: true, paymentStatus: true, trackingExpiresAt: true } });
    if (!order) return fail("Lien de suivi invalide.");
    if (order.trackingExpiresAt.getTime() < Date.now()) return fail("Ce lien de suivi a expiré. Contactez la boutique.");
    if (order.paymentStatus !== "PAID" || order.status === "CANCELLED" || order.status === "REFUNDED") return fail("Aucun fichier disponible pour cette commande.");
    const grant = await db.downloadGrant.findFirst({ where: { id: grantId, storeId: order.storeId, orderId: order.id }, select: { id: true } });
    if (!grant) return fail("Aucun fichier disponible pour cette commande.");
    const token = await rotateGrantToken(order.storeId, grant.id);
    if (!token) return fail("Aucun fichier disponible pour cette commande.");
    return success({ url: `/telechargement/${token}` });
  });
}
