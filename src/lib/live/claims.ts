import "server-only";
import { Prisma, type LiveClaimStatus, type SocialPlatform } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { effectivePlanId } from "@/lib/billing/rules";
import { decryptSecret } from "@/lib/crypto";
import { formatMoney } from "@/lib/money";
import { rateLimit } from "@/lib/rate-limit";
import { randomToken } from "@/lib/utils";
import { unitPricing } from "@/lib/commerce/checkout-lines";
import { pickOrderVariant } from "@/lib/storefront/variants";
import { kindTracksStock, productKindOf } from "@/lib/digital/kinds";
import { applyLevelDeltaTx, recordStockChangeTx } from "@/lib/inventory/levels";
import { isTokenError, sendFollowUp, sendPrivateReply, sendPublicReply } from "@/lib/meta-social/graph";
import { matchesSocialObject, type SocialComment } from "@/lib/meta-social/webhook-payload";
import { parseClaimComment } from "./claim-parser";
import { DEFAULT_PUBLIC_REPLY, followUpMessage, renderClaimMessage, soldOutMessage } from "./claim-message";
import { liveStatus } from "./stream";

/**
 * « Commenter pour acheter » (docs/LIVE-COMMERCE.md) : du commentaire Facebook / Instagram à la commande payée.
 *
 * 1. `processSocialComment` (webhook signé, boutique déjà routée, commentaire dédoublonné par ProviderEvent) :
 *    direct en cours + mot-clé → RÉSERVATION transactionnelle (`reserveClaimTx`) : verrou du produit (comme le
 *    checkout), plafond par auteur (verrou consultatif par auteur et direct), prix normatif `unitPricing` (indicatif),
 *    stock retiré sous condition (DENY : stock suffisant ; CONTINUE : sans condition), niveau du dépôt par défaut et
 *    mouvement d'inventaire (ADJUSTMENT « Réservation live ») dans la même transaction. Unicité `(platform, commentId)`.
 * 2. `deliverClaimMessage` : réponse privée UNIQUE (verrou `replyLockedAt` + `messageId`), hors transaction.
 * 3. Lien court `/l/{token}` → `openClaimCheckout` : le stock retenu est rendu et un panier serveur est créé DANS LA
 *    MÊME transaction ; le checkout normal (createOrder) reprend alors stock et prix (aucune règle contournée).
 * 4. `sweepLiveClaims` : PAID quand la commande issue du panier est payée ; EXPIRED (stock rendu) à échéance.
 *
 * Isolation : toute lecture / écriture est filtrée par `storeId` ; la boutique vient du routage du webhook
 * (`SocialAccount` unique par Page / compte), jamais du contenu du commentaire.
 */

export const ACTIVE_CLAIM: LiveClaimStatus[] = ["RESERVED", "MESSAGED"];
const COUNTED_CLAIM: LiveClaimStatus[] = ["RESERVED", "MESSAGED", "PAID"];
const LOCK_STALE_MS = 2 * 60_000;

/** Bornes anti-blocage du stock (audit M1) : appliquées aussi aux réglages anciens hors bornes. */
export const MAX_HOLD_MINUTES = 60;
export const MAX_PER_AUTHOR = 5;
/** Au-delà de 7 jours après l'échéance, le lien court ne mène plus au panier (audit F2). */
export const LINK_GRACE_MS = 7 * 86_400_000;

export const clampHold = (m: number) => Math.min(Math.max(Math.trunc(m) || 30, 5), MAX_HOLD_MINUTES);
export const clampPerAuthor = (n: number) => Math.min(Math.max(Math.trunc(n) || 2, 1), MAX_PER_AUTHOR);

/**
 * Plafond global d'unités réservées non payées pour un article sur un direct : nombre fixe s'il est réglé, sinon
 * pourcentage du stock disponible (stock courant + unités déjà retenues), au moins 1. Stock non suivi : seul le
 * nombre fixe s'applique. Fonction pure (testée).
 */
export function activeCap(p: { units: number | null; percent: number; tracked: boolean; stock: number; held: number }): number | null {
  if (p.units != null && p.units > 0) return p.units;
  if (!p.tracked) return null;
  const pct = Math.min(Math.max(p.percent, 1), 100);
  return Math.max(1, Math.ceil(((Math.max(p.stock, 0) + p.held) * pct) / 100));
}

/** Taux d'expiration anormal (bandeau d'alerte) : au moins 5 expirées et >= 50 % des réservations closes. */
export function expiryAlert(t: { expired: number; paid: number; ordered: number }): boolean {
  const closed = t.expired + t.paid + t.ordered;
  return t.expired >= 5 && t.expired / closed >= 0.5;
}

function baseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");
}

export function claimLink(token: string): string {
  return `${baseUrl()}/l/${token}`;
}

export const CLAIM_TOKEN_RE = /^[a-f0-9]{24}$/;

export class ClaimRejected extends Error {
  constructor(public reason: "out_of_stock" | "unavailable" | "author_cap" | "active_cap") {
    super(reason);
  }
}

/* ───────────── Stock ───────────── */

async function defaultLocationId(tx: Tx, storeId: string): Promise<string | null> {
  const loc = await tx.location.findFirst({ where: { storeId, isDefault: true }, select: { id: true } });
  return loc?.id ?? null;
}

/** Retire `quantity` du stock (agrégat conditionnel + dépôt par défaut + mouvement). false = stock insuffisant. */
async function holdStockTx(tx: Tx, p: { storeId: string; productId: string; variantId: string | null; quantity: number; claimId: string }): Promise<boolean> {
  const sellable = { OR: [{ stock: { gte: p.quantity } }, { inventoryPolicy: "CONTINUE" as const }] };
  const r = p.variantId
    ? await tx.variant.updateMany({ where: { id: p.variantId, productId: p.productId, ...sellable }, data: { stock: { decrement: p.quantity } } })
    : await tx.product.updateMany({ where: { id: p.productId, storeId: p.storeId, ...sellable }, data: { stock: { decrement: p.quantity } } });
  if (r.count === 0) return false;
  const locationId = await defaultLocationId(tx, p.storeId);
  if (locationId) await applyLevelDeltaTx(tx, { storeId: p.storeId, locationId, productId: p.productId, variantId: p.variantId, delta: -p.quantity });
  await tx.inventoryMovement.create({
    data: { storeId: p.storeId, productId: p.productId, variantId: p.variantId, locationId, delta: -p.quantity, reason: "ADJUSTMENT", note: `Réservation live ${p.claimId}` },
  });
  return true;
}

/**
 * Rend le stock retenu par une réservation (idempotent : `heldQuantity` remis à 0 sous condition, une seule fois).
 * Variante supprimée depuis : rien à rendre (on ne gonfle jamais le stock du produit).
 */
export async function releaseHoldTx(tx: Tx, claimId: string, note: string): Promise<number> {
  const c = await tx.liveClaim.findUnique({ where: { id: claimId }, select: { id: true, storeId: true, productId: true, variantId: true, variantName: true, heldQuantity: true } });
  if (!c || c.heldQuantity <= 0) return 0;
  const r = await tx.liveClaim.updateMany({ where: { id: c.id, heldQuantity: c.heldQuantity }, data: { heldQuantity: 0 } });
  if (r.count === 0) return 0;
  if (c.variantName && !c.variantId) return 0;
  const locationId = await defaultLocationId(tx, c.storeId);
  await recordStockChangeTx(tx, { storeId: c.storeId, locationId, productId: c.productId, variantId: c.variantId, delta: c.heldQuantity, reason: "ADJUSTMENT", note: `${note} ${c.id}` });
  return c.heldQuantity;
}

/* ───────────── Réservation ───────────── */

export type ClaimingLive = {
  id: string;
  storeId: string;
  claimHoldMinutes: number;
  claimMaxPerAuthor: number;
  claimActiveCapUnits: number | null;
  claimActiveCapPercent: number;
  socialObjectIds: string[];
};

/** Direct de la boutique qui accepte les réservations pour ce commentaire (en cours, objet relié ou tous). */
export async function findClaimingLive(storeId: string, objectId: string | null, now = new Date()): Promise<ClaimingLive | null> {
  const events = await db.liveEvent.findMany({
    where: { storeId, claimsEnabled: true, OR: [{ status: "LIVE" }, { status: "SCHEDULED", startsAt: { lte: now } }] },
    orderBy: { startsAt: "desc" },
    take: 10,
    select: { id: true, storeId: true, startsAt: true, endsAt: true, status: true, claimHoldMinutes: true, claimMaxPerAuthor: true, claimActiveCapUnits: true, claimActiveCapPercent: true, socialObjectIds: true },
  });
  const e = events.find((x) => liveStatus(x, now) === "live" && matchesSocialObject(objectId, x.socialObjectIds));
  return e
    ? {
        id: e.id,
        storeId: e.storeId,
        claimHoldMinutes: clampHold(e.claimHoldMinutes),
        claimMaxPerAuthor: clampPerAuthor(e.claimMaxPerAuthor),
        claimActiveCapUnits: e.claimActiveCapUnits,
        claimActiveCapPercent: e.claimActiveCapPercent,
        socialObjectIds: e.socialObjectIds,
      }
    : null;
}

export type ReserveInput = {
  live: ClaimingLive;
  currency: string;
  socialAccountId: string | null;
  comment: Pick<SocialComment, "platform" | "commentId" | "objectId" | "authorId" | "authorName" | "text">;
  code: string;
  productId: string;
  variantId: string | null;
  quantity: number;
};

/** Réservation atomique. Lève ClaimRejected (rupture, indisponible, plafond) ou P2002 (commentaire déjà traité). */
export async function reserveClaim(input: ReserveInput, now = new Date()) {
  const { live, comment } = input;
  const storeId = live.storeId;
  return db.$transaction(
    async (tx) => {
      // Plafond par auteur : sérialise les commentaires simultanés d'un même auteur sur ce direct.
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${`live-claim:${live.id}:${comment.platform}:${comment.authorId}`}))`;
      // Même verrou que le checkout : réservations et commandes du produit sont sérialisées.
      await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${input.productId} AND "storeId" = ${storeId} FOR UPDATE`;

      const product = await tx.product.findFirst({
        where: { id: input.productId, storeId, status: "ACTIVE" },
        select: {
          id: true,
          name: true,
          price: true,
          promoPrice: true,
          promoStart: true,
          promoEnd: true,
          trackStock: true,
          minQty: true,
          maxQty: true,
          isGiftCard: true,
          kind: true,
          variants: { select: { id: true, name: true, price: true, available: true } },
          optionGroups: { where: { required: true }, select: { id: true } },
        },
      });
      // Carte cadeau (destinataire à saisir) et options obligatoires : non réservables par commentaire.
      if (!product || product.isGiftCard || product.optionGroups.length > 0) throw new ClaimRejected("unavailable");
      const picked = pickOrderVariant(product, input.variantId);
      if (!picked.ok) throw new ClaimRejected("unavailable");
      const variant = picked.variant;

      let quantity = Math.max(product.minQty, input.quantity);
      if (product.maxQty != null && quantity > product.maxQty) quantity = product.maxQty;
      if (quantity < 1) throw new ClaimRejected("unavailable");

      const agg = await tx.liveClaim.aggregate({
        _sum: { quantity: true },
        where: { storeId, liveEventId: live.id, platform: comment.platform, authorId: comment.authorId, status: { in: COUNTED_CLAIM } },
      });
      if ((agg._sum.quantity ?? 0) + quantity > clampPerAuthor(live.claimMaxPerAuthor)) throw new ClaimRejected("author_cap");

      const { unitPrice } = unitPricing(product, variant, [], now);
      const tracks = product.trackStock && kindTracksStock(productKindOf(product));

      // Plafond global (anti-blocage par faux comptes) : unités retenues non payées pour cet article sur ce direct.
      const heldAgg = await tx.liveClaim.aggregate({
        _sum: { heldQuantity: true },
        where: { storeId, liveEventId: live.id, productId: product.id, variantId: variant?.id ?? null, status: { in: ACTIVE_CLAIM }, orderId: null },
      });
      const held = heldAgg._sum.heldQuantity ?? 0;
      const stockNow = variant
        ? ((await tx.variant.findUnique({ where: { id: variant.id }, select: { stock: true } }))?.stock ?? 0)
        : ((await tx.product.findUnique({ where: { id: product.id }, select: { stock: true } }))?.stock ?? 0);
      const cap = activeCap({ units: live.claimActiveCapUnits, percent: live.claimActiveCapPercent, tracked: tracks, stock: stockNow, held });
      // Stock épuisé : la rupture prime (message « plus disponible ») ; sinon le plafond global s'applique.
      if (cap !== null && held + quantity > cap && !(tracks && stockNow < quantity)) throw new ClaimRejected("active_cap");
      const claim = await tx.liveClaim.create({
        data: {
          storeId,
          liveEventId: live.id,
          socialAccountId: input.socialAccountId,
          platform: comment.platform,
          commentId: comment.commentId,
          objectId: comment.objectId,
          authorId: comment.authorId,
          authorName: comment.authorName,
          commentText: comment.text.slice(0, 500),
          code: input.code,
          productId: product.id,
          variantId: variant?.id ?? null,
          productName: product.name.slice(0, 160),
          variantName: variant?.name.slice(0, 120) ?? null,
          quantity,
          unitPrice,
          currency: input.currency,
          heldQuantity: tracks ? quantity : 0,
          token: randomToken(12),
          expiresAt: new Date(now.getTime() + clampHold(live.claimHoldMinutes) * 60_000),
        },
      });
      if (tracks && !(await holdStockTx(tx, { storeId, productId: product.id, variantId: variant?.id ?? null, quantity, claimId: claim.id }))) {
        throw new ClaimRejected("out_of_stock");
      }
      return claim;
    },
    { timeout: 15_000 },
  );
}

/* ───────────── Messages ───────────── */

type DeliverResult = { ok: true } | { ok: false; error: string };

function accountToken(enc: string): string | null {
  try {
    return decryptSecret(enc);
  } catch {
    return null;
  }
}

async function markAccountError(accountId: string, message: string) {
  await db.socialAccount.updateMany({ where: { id: accountId }, data: { status: "error", lastError: message.slice(0, 300) } }).catch(() => {});
}

/**
 * Envoie LA réponse privée d'une réservation (un seul message par commentaire, imposé par Meta et par le verrou
 * ci-dessous). Ne lève jamais : l'échec est consigné sur la réservation (relançable depuis le tableau de bord).
 */
export async function deliverClaimMessage(claimId: string, fetchImpl: typeof fetch = fetch, now = new Date()): Promise<DeliverResult> {
  const lock = await db.liveClaim.updateMany({
    where: { id: claimId, messageId: null, status: "RESERVED", OR: [{ replyLockedAt: null }, { replyLockedAt: { lt: new Date(now.getTime() - LOCK_STALE_MS) } }] },
    data: { replyLockedAt: now },
  });
  if (lock.count === 0) return { ok: false, error: "Message déjà envoyé ou en cours d'envoi." };

  const claim = await db.liveClaim.findUnique({
    where: { id: claimId },
    include: {
      socialAccount: { select: { id: true, externalId: true, tokenEncrypted: true, status: true } },
      liveEvent: { select: { claimHoldMinutes: true, claimMessage: true, claimPublicReply: true, claimPublicText: true } },
      store: { select: { name: true } },
    },
  });
  if (!claim) return { ok: false, error: "Réservation introuvable." };
  const fail = async (error: string): Promise<DeliverResult> => {
    await db.liveClaim.updateMany({ where: { id: claim.id }, data: { lastError: error.slice(0, 300), replyLockedAt: null } });
    return { ok: false, error };
  };
  const account = claim.socialAccount;
  const token = account && account.status === "active" ? accountToken(account.tokenEncrypted) : null;
  if (!account || !token) return fail("Compte Facebook / Instagram déconnecté : reconnectez-le, puis relancez.");

  const label = claim.variantName ? `${claim.productName} (${claim.variantName})` : claim.productName;
  const text = renderClaimMessage(claim.liveEvent.claimMessage, {
    name: claim.authorName,
    product: label,
    quantity: claim.quantity,
    total: formatMoney(claim.unitPrice * claim.quantity, claim.currency),
    link: claimLink(claim.token),
    holdMinutes: clampHold(claim.liveEvent.claimHoldMinutes),
    store: claim.store.name,
  });
  try {
    const sent = await sendPrivateReply(account.externalId, token, claim.commentId, text, fetchImpl);
    await db.liveClaim.updateMany({
      where: { id: claim.id, status: "RESERVED" },
      data: { status: "MESSAGED", messageId: sent.messageId ?? `sent:${now.getTime()}`, recipientId: sent.recipientId, messagedAt: now, lastError: null },
    });
  } catch (e) {
    const msg = (e as Error).message || "Envoi impossible.";
    if (isTokenError(e)) await markAccountError(account.id, msg);
    return fail(msg);
  }

  if (claim.liveEvent.claimPublicReply && !claim.publicRepliedAt) {
    try {
      await sendPublicReply(claim.platform, claim.commentId, token, (claim.liveEvent.claimPublicText || DEFAULT_PUBLIC_REPLY).slice(0, 200), fetchImpl);
      await db.liveClaim.updateMany({ where: { id: claim.id }, data: { publicRepliedAt: new Date() } });
    } catch (e) {
      console.error("[live] réponse publique", (e as Error).message);
    }
  }
  return { ok: true };
}

/* ───────────── Traitement d'un commentaire ───────────── */

export type CommentOutcome = { status: "ignored" | "reserved" | "duplicate" | "sold_out" | "limited"; reason?: string; claimId?: string };

export type RoutedAccount = { id: string; platform: SocialPlatform; externalId: string; tokenEncrypted: string; status: string };

/**
 * Traite un commentaire déjà authentifié (signature), routé (boutique propriétaire du compte) et dédoublonné.
 * Réserve, puis envoie la réponse privée. Ne lève que sur une erreur inattendue (base) : le webhook laisse alors
 * Meta renvoyer l'événement, sans risque de doublon (unicité du commentaire + verrou d'envoi).
 */
export async function processSocialComment(
  p: { storeId: string; account: RoutedAccount; comment: SocialComment },
  opts: { now?: Date; fetchImpl?: typeof fetch; /** false : l'appelant envoie lui-même la réponse privée (`deliverClaimMessage`). */ deliver?: boolean } = {},
): Promise<CommentOutcome> {
  const now = opts.now ?? new Date();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const { comment, account } = p;

  const store = await db.store.findUnique({ where: { id: p.storeId }, select: { id: true, name: true, currency: true, status: true, subscription: true } });
  if (!store || store.status !== "PUBLISHED") return { status: "ignored", reason: "Boutique non publiée" };
  if (!PLANS[effectivePlanId(store.subscription, now)].features.liveShopping) return { status: "ignored", reason: "Plan" };

  const live = await findClaimingLive(store.id, comment.objectId, now);
  if (!live) return { status: "ignored", reason: "Aucun direct en cours" };

  const keywords = await db.liveKeyword.findMany({ where: { storeId: store.id, liveEventId: live.id }, select: { code: true, productId: true, variantId: true } });
  const parsed = parseClaimComment(comment.text, keywords.map((k) => k.code));
  if (!parsed) return { status: "ignored", reason: "Aucun mot-clé" };
  const kw = keywords.find((k) => k.code === parsed.code);
  if (!kw) return { status: "ignored", reason: "Aucun mot-clé" };

  // Anti-spam : 6 tentatives de réservation par auteur et par minute sur un direct.
  const rl = await rateLimit(`live-claim:${live.id}:${comment.platform}:${comment.authorId}`, 6, 60);
  if (!rl.ok) return { status: "limited", reason: "Trop de commentaires" };

  let claimId: string;
  try {
    const claim = await reserveClaim(
      { live, currency: store.currency, socialAccountId: account.id, comment, code: kw.code, productId: kw.productId, variantId: kw.variantId, quantity: parsed.quantity },
      now,
    );
    claimId = claim.id;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { status: "duplicate" };
    if (e instanceof ClaimRejected) {
      if (e.reason === "author_cap") return { status: "limited", reason: "Plafond par client atteint" };
      if (e.reason === "active_cap") return { status: "limited", reason: "Plafond de réservations en attente atteint" };
      await sendSoldOut(account, comment, kw.productId, store, fetchImpl);
      return { status: "sold_out", reason: e.reason };
    }
    throw e;
  }
  if (opts.deliver !== false) await deliverClaimMessage(claimId, fetchImpl, now);
  return { status: "reserved", claimId };
}

/** Réponse privée « plus disponible » (au mieux : jamais bloquante, un seul message par commentaire). */
async function sendSoldOut(account: RoutedAccount, comment: SocialComment, productId: string, store: { id: string; name: string }, fetchImpl: typeof fetch) {
  if (account.status !== "active") return;
  const token = accountToken(account.tokenEncrypted);
  if (!token) return;
  const product = await db.product.findFirst({ where: { id: productId, storeId: store.id }, select: { name: true } });
  try {
    await sendPrivateReply(account.externalId, token, comment.commentId, soldOutMessage(product?.name ?? "Cet article", store.name), fetchImpl);
  } catch (e) {
    if (isTokenError(e)) await markAccountError(account.id, (e as Error).message);
  }
}

/* ───────────── Lien court : passage au panier ───────────── */

export type ClaimView = {
  storeName: string;
  timezone: string;
  productLabel: string;
  quantity: number;
  total: number;
  currency: string;
  expiresAt: Date;
  state: "open" | "in_cart" | "paid" | "ordered" | "expired" | "cancelled";
};

/** Résumé public d'une réservation (page /l/{token}) : aucune donnée de l'auteur n'est exposée. */
export async function claimView(token: string, now = new Date()): Promise<ClaimView | null> {
  if (!CLAIM_TOKEN_RE.test(token)) return null;
  const c = await db.liveClaim.findUnique({ where: { token }, select: { productName: true, variantName: true, quantity: true, unitPrice: true, currency: true, expiresAt: true, status: true, cartId: true, orderId: true, store: { select: { name: true, timezone: true } } } });
  if (!c) return null;
  const state: ClaimView["state"] =
    c.status === "PAID"
      ? "paid"
      : c.status === "CANCELLED"
        ? "cancelled"
        : c.orderId
          ? "ordered"
          : c.status === "EXPIRED" || c.expiresAt <= now
            ? c.cartId
              ? "in_cart"
              : "expired"
            : c.cartId
              ? "in_cart"
              : "open";
  return {
    storeName: c.store.name,
    timezone: c.store.timezone,
    productLabel: c.variantName ? `${c.productName} (${c.variantName})` : c.productName,
    quantity: c.quantity,
    total: c.unitPrice * c.quantity,
    currency: c.currency,
    expiresAt: c.expiresAt,
    state,
  };
}

/**
 * Passage au paiement (action POST de la page /l/{token}, jamais sur un simple GET : les aperçus de liens de
 * Messenger / Instagram ne doivent pas consommer la réservation). Dans UNE transaction : panier serveur créé avec
 * l'article réservé, stock retenu rendu ; le checkout le reprend ensuite selon ses propres règles.
 */
export type CheckoutRefusal = "invalid" | "closed" | "ordered" | "cancelled" | "expired" | "inactive";

export const CHECKOUT_REFUSAL_MESSAGES: Record<CheckoutRefusal, string> = {
  invalid: "Lien invalide.",
  closed: "Cette boutique ne prend pas de commande pour le moment.",
  ordered: "Cette réservation a déjà été commandée.",
  cancelled: "Cette réservation a été annulée par la boutique.",
  expired: "Le délai de cette réservation est dépassé : l'article a été remis en vente.",
  inactive: "Cette réservation n'est plus active.",
};

export async function openClaimCheckout(token: string, now = new Date()): Promise<{ ok: true; url: string } | { ok: false; code: CheckoutRefusal; error: string }> {
  const refuse = (code: CheckoutRefusal) => ({ ok: false as const, code, error: CHECKOUT_REFUSAL_MESSAGES[code] });
  if (!CLAIM_TOKEN_RE.test(token)) return refuse("invalid");
  const head = await db.liveClaim.findUnique({ where: { token }, select: { id: true, storeId: true, status: true, expiresAt: true, cartId: true, orderId: true, store: { select: { slug: true, status: true } } } });
  if (!head) return refuse("invalid");
  if (head.store.status !== "PUBLISHED") return refuse("closed");
  if (head.status === "PAID" || head.orderId) return refuse("ordered");
  if (head.status === "CANCELLED") return refuse("cancelled");

  // F2 : au-delà de 7 jours après l'échéance, le lien est mort, même si un panier existe.
  if (now.getTime() > head.expiresAt.getTime() + LINK_GRACE_MS) return refuse("expired");

  const cartUrl = (cartToken: string) => `${baseUrl()}/s/${head.store.slug}?panier=${cartToken}`;
  if (head.cartId) {
    const cart = await db.cart.findFirst({ where: { id: head.cartId, storeId: head.storeId }, select: { token: true, convertedOrderId: true } });
    if (cart && !cart.convertedOrderId) return { ok: true, url: cartUrl(cart.token) };
    return refuse("ordered");
  }
  if (head.status === "EXPIRED" || head.expiresAt <= now) {
    await expireClaim(head.id, now);
    return refuse("expired");
  }

  const cartToken = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "LiveClaim" WHERE id = ${head.id} FOR UPDATE`;
    const c = await tx.liveClaim.findUnique({ where: { id: head.id }, select: { id: true, storeId: true, liveEventId: true, platform: true, status: true, cartId: true, productId: true, variantId: true, quantity: true, expiresAt: true } });
    if (!c || !ACTIVE_CLAIM.includes(c.status)) return null;
    // F3 : échéance revérifiée sous le verrou (un balayage concurrent ou un délai dépassé ne doit rien ouvrir).
    if (!c.cartId && c.expiresAt <= now) return null;
    if (c.cartId) return (await tx.cart.findFirst({ where: { id: c.cartId, storeId: c.storeId }, select: { token: true } }))?.token ?? null;
    const cart = await tx.cart.create({
      data: {
        storeId: c.storeId,
        token: randomToken(16),
        attribution: { source: "live_claim", claimId: c.id, liveEventId: c.liveEventId, platform: c.platform.toLowerCase() } as Prisma.InputJsonValue,
        items: { create: [{ productId: c.productId, variantId: c.variantId, quantity: c.quantity }] },
      },
      select: { id: true, token: true },
    });
    await tx.liveClaim.update({ where: { id: c.id }, data: { cartId: cart.id } });
    await releaseHoldTx(tx, c.id, "Réservation live passée au panier");
    return cart.token;
  });
  if (!cartToken) return refuse("inactive");
  return { ok: true, url: cartUrl(cartToken) };
}

/* ───────────── Expiration, annulation, conversion ───────────── */

async function expireClaim(claimId: string, now: Date): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const moved = await tx.liveClaim.updateMany({ where: { id: claimId, status: { in: ACTIVE_CLAIM }, orderId: null }, data: { status: "EXPIRED", closedAt: now } });
    if (moved.count === 0) return false;
    await releaseHoldTx(tx, claimId, "Réservation live expirée");
    return true;
  });
}

/** Annulation par le marchand (stock rendu). Une réservation déjà commandée ne s'annule pas ici. */
export async function cancelClaim(storeId: string, claimId: string, now = new Date()): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const moved = await tx.liveClaim.updateMany({ where: { id: claimId, storeId, status: { in: ACTIVE_CLAIM }, orderId: null }, data: { status: "CANCELLED", closedAt: now } });
    if (moved.count === 0) return false;
    await releaseHoldTx(tx, claimId, "Réservation live annulée");
    return true;
  });
}

/** Libère toutes les réservations actives d'un direct (avant sa suppression). */
export async function releaseLiveHolds(storeId: string, liveEventId: string, now = new Date()): Promise<number> {
  const active = await db.liveClaim.findMany({ where: { storeId, liveEventId, status: { in: ACTIVE_CLAIM }, orderId: null }, select: { id: true } });
  let n = 0;
  for (const c of active) if (await cancelClaim(storeId, c.id, now)) n++;
  return n;
}

/**
 * Balayage : conversions (panier commandé → orderId ; commande payée → PAID) puis expirations (stock rendu).
 * Appelé par le webhook (boutique concernée), l'écran du direct, la page /l/{token} et la route cron
 * /api/webhooks/meta/sweep. Idempotent et borné.
 */
export async function sweepLiveClaims(opts: { storeId?: string; now?: Date; limit?: number } = {}): Promise<{ paid: number; ordered: number; expired: number }> {
  const now = opts.now ?? new Date();
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);
  const scope = opts.storeId ? { storeId: opts.storeId } : {};
  let paid = 0;
  let ordered = 0;
  let expired = 0;

  const withCart = await db.liveClaim.findMany({
    where: { ...scope, cartId: { not: null }, OR: [{ status: { in: ACTIVE_CLAIM } }, { status: "EXPIRED", closedAt: { gte: new Date(now.getTime() - 7 * 86_400_000) } }] },
    select: { id: true, storeId: true, cartId: true, orderId: true },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  if (withCart.length) {
    const carts = await db.cart.findMany({ where: { id: { in: withCart.map((c) => c.cartId!) }, convertedOrderId: { not: null } }, select: { id: true, storeId: true, convertedOrderId: true } });
    const orders = carts.length ? await db.order.findMany({ where: { id: { in: carts.map((c) => c.convertedOrderId!) } }, select: { id: true, storeId: true, paymentStatus: true } }) : [];
    for (const c of withCart) {
      const cart = carts.find((x) => x.id === c.cartId && x.storeId === c.storeId);
      const order = cart ? orders.find((o) => o.id === cart.convertedOrderId && o.storeId === c.storeId) : undefined;
      if (!order) continue;
      if (order.paymentStatus === "PAID") {
        const r = await db.liveClaim.updateMany({ where: { id: c.id, storeId: c.storeId, status: { notIn: ["PAID", "CANCELLED"] } }, data: { status: "PAID", paidAt: now, orderId: order.id, closedAt: now } });
        paid += r.count;
      } else if (!c.orderId) {
        const r = await db.liveClaim.updateMany({ where: { id: c.id, storeId: c.storeId, orderId: null }, data: { orderId: order.id } });
        ordered += r.count;
      }
    }
  }

  const due = await db.liveClaim.findMany({ where: { ...scope, status: { in: ACTIVE_CLAIM }, orderId: null, expiresAt: { lte: now } }, select: { id: true }, orderBy: { expiresAt: "asc" }, take: limit });
  for (const c of due) if (await expireClaim(c.id, now)) expired++;
  return { paid, ordered, expired };
}

/* ───────────── Relance ───────────── */

/**
 * Relance par le marchand : si la réponse privée n'est jamais partie, on la renvoie (toujours UN seul message
 * accepté par Meta) ; sinon message de suivi au destinataire (accepté par Meta uniquement si le client a répondu,
 * dans les 24 h). Le délai de paiement est prolongé d'une durée de réservation.
 */
export async function remindClaim(storeId: string, claimId: string, fetchImpl: typeof fetch = fetch, now = new Date()): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const claim = await db.liveClaim.findFirst({
    where: { id: claimId, storeId },
    include: { socialAccount: { select: { id: true, externalId: true, tokenEncrypted: true, status: true } }, liveEvent: { select: { claimHoldMinutes: true } } },
  });
  if (!claim) return { ok: false, error: "Réservation introuvable." };
  if (!ACTIVE_CLAIM.includes(claim.status) || claim.orderId) return { ok: false, error: "Seule une réservation en attente de paiement peut être relancée." };
  const rl = await rateLimit(`live-remind:${claim.id}`, 1, 600);
  if (!rl.ok) return { ok: false, error: "Déjà relancée il y a moins de 10 minutes." };

  const extend = async () => {
    const until = new Date(Math.max(claim.expiresAt.getTime(), now.getTime() + clampHold(claim.liveEvent.claimHoldMinutes) * 60_000));
    await db.liveClaim.updateMany({ where: { id: claim.id, storeId, status: { in: ACTIVE_CLAIM } }, data: { expiresAt: until, remindedAt: now } });
  };

  if (!claim.messageId) {
    const r = await deliverClaimMessage(claim.id, fetchImpl, now);
    if (!r.ok) return r;
    await extend();
    return { ok: true, message: "Message privé envoyé." };
  }
  const account = claim.socialAccount;
  const token = account && account.status === "active" ? accountToken(account.tokenEncrypted) : null;
  if (!account || !token || !claim.recipientId) return { ok: false, error: "Compte social déconnecté : reconnectez-le pour relancer." };
  const label = claim.variantName ? `${claim.productName} (${claim.variantName})` : claim.productName;
  try {
    await sendFollowUp(account.externalId, token, claim.recipientId, followUpMessage(label, claimLink(claim.token)), fetchImpl);
  } catch (e) {
    if (isTokenError(e)) await markAccountError(account.id, (e as Error).message);
    return { ok: false, error: "Meta n'autorise un second message que si le client a répondu à votre message (dans les 24 h). Copiez le lien et envoyez-le autrement." };
  }
  await extend();
  return { ok: true, message: "Relance envoyée, délai prolongé." };
}

/* ───────────── Tableau de bord ───────────── */

export type ClaimRow = {
  id: string;
  createdAt: Date;
  platform: SocialPlatform;
  authorName: string | null;
  commentText: string;
  code: string;
  productLabel: string;
  quantity: number;
  amount: number;
  currency: string;
  status: LiveClaimStatus;
  ordered: boolean;
  expiresAt: Date;
  lastError: string | null;
  link: string;
  orderId: string | null;
};

export async function listLiveClaims(storeId: string, liveEventId: string, take = 500): Promise<ClaimRow[]> {
  const rows = await db.liveClaim.findMany({
    where: { storeId, liveEventId },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, createdAt: true, platform: true, authorName: true, commentText: true, code: true, productName: true, variantName: true, quantity: true, unitPrice: true, currency: true, status: true, orderId: true, expiresAt: true, lastError: true, token: true },
  });
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    platform: r.platform,
    authorName: r.authorName,
    commentText: r.commentText,
    code: r.code,
    productLabel: r.variantName ? `${r.productName} (${r.variantName})` : r.productName,
    quantity: r.quantity,
    amount: r.unitPrice * r.quantity,
    currency: r.currency,
    status: r.status,
    ordered: !!r.orderId,
    expiresAt: r.expiresAt,
    lastError: r.lastError,
    link: claimLink(r.token),
    orderId: r.orderId,
  }));
}

export type ClaimTotals = { reserved: number; paid: number; closed: number; pendingAmount: number; paidAmount: number };

export function claimTotals(rows: readonly Pick<ClaimRow, "status" | "amount">[]): ClaimTotals {
  const t: ClaimTotals = { reserved: 0, paid: 0, closed: 0, pendingAmount: 0, paidAmount: 0 };
  for (const r of rows) {
    if (r.status === "PAID") {
      t.paid++;
      t.paidAmount += r.amount;
    } else if (r.status === "RESERVED" || r.status === "MESSAGED") {
      t.reserved++;
      t.pendingAmount += r.amount;
    } else t.closed++;
  }
  return t;
}
