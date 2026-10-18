"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireStore } from "@/lib/auth/permissions";
import { guard, parseForm, fail, success, type ActionResult } from "@/lib/action";
import { PLANS } from "@/config/plans";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { GRAPH_VERSION } from "./graph-client";
import { IG_ID, INSTAGRAM_KIND, InstagramApiError, MAX_TAGGED_POSTS_PER_DAY, MAX_TAGS_PER_POST, buildUpdatedTags, instagramApi, instagramTaggingEnabled, isTaggableMedia, matchCatalogProduct } from "./instagram-tagging";
import { SYNC_CHANNEL, whatsappGraph } from "./sync";

/**
 * Écran « Identifier des produits sur Instagram » (/app/{storeId}/integrations/instagram-produits), derrière le
 * drapeau SOCIAL_IG_PRODUCT_TAGGING=1. Capacité integrations.manage ; plan : `catalogSync` (le catalogue Meta doit
 * être alimenté). Configuration rangée dans Integration (kind « instagram_shopping », config { igUserId, eligible,
 * catalogId, checkedAt }) : aucun secret propre, le jeton est celui de l'intégration whatsapp_cloud.
 */

const page = (storeId: string) => `/app/${storeId}/integrations/instagram-produits`;

type Ctx = Awaited<ReturnType<typeof requireStore>>;

async function prerequisites(storeId: string): Promise<{ ctx: Ctx; token: string } | { error: ActionResult<never> }> {
  if (!instagramTaggingEnabled()) return { error: fail("Fonction non activée sur cette plateforme.") };
  const ctx = await requireStore(storeId, "integrations.manage");
  if (!PLANS[ctx.planId].features.catalogSync) return { error: fail(`L'identification de produits Instagram est incluse avec la synchronisation du catalogue (plan actuel : ${PLANS[ctx.planId].name}).`) };
  const graph = await whatsappGraph(ctx.store.id);
  if ("error" in graph) return { error: fail(graph.error) };
  return { ctx, token: graph.token };
}

function apiError(e: unknown): ActionResult<never> {
  if (e instanceof InstagramApiError) {
    const hint = e.code === 10 || e.code === 200 || e.code === 190 ? " Vérifiez que le jeton possède instagram_basic, instagram_shopping_tag_products et catalog_management." : "";
    return fail(`${e.message}${hint}`);
  }
  throw e;
}

const accountSchema = z.object({
  storeId: z.string().min(8).max(64),
  igUserId: z.string().trim().regex(IG_ID, "Identifiant de compte Instagram invalide (chiffres uniquement)"),
});

/** Enregistre le compte Instagram professionnel et vérifie son éligibilité (Boutique Instagram approuvée). */
export async function saveInstagramAccount(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(accountSchema, formData);
    if ("error" in parsed) return parsed.error;
    const pre = await prerequisites(parsed.data.storeId);
    if ("error" in pre) return pre.error;
    const { ctx, token } = pre;
    const api = instagramApi(token, GRAPH_VERSION);
    let eligible = false;
    let catalogId: string | null = null;
    try {
      eligible = await api.eligibility(parsed.data.igUserId);
      if (eligible) {
        const catalogs = await api.catalogs(parsed.data.igUserId);
        const sync = await db.socialCatalogSync.findUnique({ where: { storeId_channel: { storeId: ctx.store.id, channel: SYNC_CHANNEL } }, select: { externalCatalogId: true } });
        catalogId = catalogs.find((c) => c.id === sync?.externalCatalogId)?.id ?? catalogs[0]?.id ?? null;
      }
    } catch (e) {
      return apiError(e);
    }
    const config = { igUserId: parsed.data.igUserId, eligible, catalogId, checkedAt: new Date().toISOString() } as Prisma.InputJsonValue;
    await db.integration.upsert({
      where: { storeId_kind: { storeId: ctx.store.id, kind: INSTAGRAM_KIND } },
      create: { storeId: ctx.store.id, kind: INSTAGRAM_KIND, status: eligible ? "active" : "error", config, lastError: eligible ? null : "Boutique Instagram non approuvée" },
      update: { status: eligible ? "active" : "error", config, lastError: eligible ? null : "Boutique Instagram non approuvée" },
    });
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "instagram.tagging_configured", metadata: { eligible, catalog: !!catalogId } });
    revalidatePath(page(ctx.store.id));
    if (!eligible) return fail("Ce compte n'est pas éligible : Meta exige une Boutique Instagram approuvée (Commerce Manager) reliée à ce compte professionnel.");
    if (!catalogId) return fail("Compte éligible, mais aucun catalogue disponible pour ce compte Instagram.");
    return success(undefined, "Compte Instagram vérifié : vous pouvez identifier vos produits.");
  });
}

const tagSchema = z.object({
  storeId: z.string().min(8).max(64),
  mediaId: z.string().regex(IG_ID),
  productIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{8,64}$/)).min(1, "Choisissez au moins un produit").max(MAX_TAGS_PER_POST, `${MAX_TAGS_PER_POST} produits au plus`),
});

/** Identifie des produits Axi (retrouvés dans le catalogue Meta par leur retailer_id) sur une publication existante. */
export async function tagInstagramMedia(storeId: string, mediaId: string, productIds: string[]): Promise<ActionResult<{ tagged: number; notApproved: number }>> {
  return guard(async () => {
    const parsed = tagSchema.safeParse({ storeId, mediaId, productIds });
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Requête invalide");
    const pre = await prerequisites(parsed.data.storeId);
    if ("error" in pre) return pre.error;
    const { ctx, token } = pre;
    const integration = await db.integration.findUnique({ where: { storeId_kind: { storeId: ctx.store.id, kind: INSTAGRAM_KIND } }, select: { status: true, config: true } });
    const config = (integration?.config ?? {}) as { igUserId?: string; catalogId?: string | null };
    if (integration?.status !== "active" || !config.igUserId || !config.catalogId) return fail("Vérifiez d'abord votre compte Instagram ci-dessus.");
    const rl = await rateLimit(`ig-tag:${ctx.store.id}`, MAX_TAGGED_POSTS_PER_DAY, 24 * 3600);
    if (!rl.ok) return fail("Limite de Meta atteinte : 25 publications identifiées par 24 h.");

    // Produits de CETTE boutique uniquement ; retailer_id = id de variante (produit à variantes) ou id du produit.
    const products = await db.product.findMany({
      where: { storeId: ctx.store.id, id: { in: parsed.data.productIds }, status: "ACTIVE" },
      select: { id: true, name: true, variants: { select: { id: true }, orderBy: { position: "asc" }, take: 10 } },
    });
    if (!products.length) return fail("Produits introuvables.");

    const api = instagramApi(token, GRAPH_VERSION);
    try {
      const media = (await api.recentMedia(config.igUserId, 25)).find((m) => m.id === parsed.data.mediaId);
      if (!media) return fail("Publication introuvable parmi les 25 plus récentes du compte.");
      if (!isTaggableMedia(media)) return fail("Les Stories et les directs ne peuvent pas être identifiés (limite Meta).");
      const ids: string[] = [];
      let notApproved = 0;
      const missing: string[] = [];
      for (const p of products) {
        const retailerIds = p.variants.length ? p.variants.map((v) => v.id) : [p.id];
        const results = await api.searchProducts(config.igUserId, config.catalogId, retailerIds[0]);
        const hit = matchCatalogProduct(results, retailerIds);
        if (!hit) {
          missing.push(p.name);
          continue;
        }
        if (hit.reviewStatus !== "approved") notApproved++;
        ids.push(hit.productId);
      }
      if (!ids.length) return fail(`Produit(s) absent(s) du catalogue Meta : ${missing.join(", ").slice(0, 200)}. Synchronisez le catalogue puis réessayez.`);
      const ok = await api.tagMedia(parsed.data.mediaId, buildUpdatedTags(ids, media.mediaType));
      if (!ok) return fail("Meta a refusé l'identification.");
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "instagram.media_tagged", target: parsed.data.mediaId, metadata: { products: ids.length, notApproved } });
      const note = notApproved ? ` ${notApproved} produit(s) en attente de validation par Meta : l'identification apparaîtra après approbation.` : "";
      const miss = missing.length ? ` Absents du catalogue : ${missing.join(", ").slice(0, 120)}.` : "";
      return success({ tagged: ids.length, notApproved }, `Publication identifiée avec ${ids.length} produit(s).${note}${miss}`);
    } catch (e) {
      return apiError(e);
    }
  });
}
