/**
 * « Commenter pour acheter » de bout en bout sur la base PostgreSQL locale (ignoré si la base est injoignable) :
 * webhook signé → réservation transactionnelle (stock retenu) → réponse privée UNIQUE (Graph simulé) → lien court
 * (panier, stock rendu) → PAID ; expiration (stock rendu, idempotente) ; plafond par auteur ; rupture ; isolation
 * entre boutiques ; annulation.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

try {
  process.loadEnvFile(".env");
} catch {
  // pas de .env : tests ignorés
}

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));

const SECRET = "meta-secret-live-claims-tests";
process.env.META_APP_SECRET = SECRET;

const { db } = await import("@/lib/db");
const reachable = !!process.env.DATABASE_URL && (await db.$queryRaw`SELECT 1`.then(() => true).catch(() => false));

type GraphCall = { url: string; body: unknown };
const graph: { calls: GraphCall[]; failFollowUp: boolean } = { calls: [], failFollowUp: false };

function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const body = typeof init?.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : init?.body;
  graph.calls.push({ url, body });
  if (url.includes("/messages")) {
    const b = body as { recipient?: { comment_id?: string; id?: string } };
    if (b.recipient?.id && graph.failFollowUp) {
      return Promise.resolve(new Response(JSON.stringify({ error: { message: "This message is sent outside of allowed window.", code: 10, error_subcode: 2018278 } }), { status: 400 }));
    }
    return Promise.resolve(new Response(JSON.stringify({ recipient_id: "psid_1", message_id: `m_${graph.calls.length}` }), { status: 200 }));
  }
  return Promise.resolve(new Response(JSON.stringify({ id: "reply_1", success: true }), { status: 200 }));
}

const privateReplies = (commentId?: string) =>
  graph.calls.filter((c) => c.url.includes("/messages") && (c.body as { recipient?: { comment_id?: string } })?.recipient?.comment_id && (!commentId || (c.body as { recipient: { comment_id: string } }).recipient.comment_id === commentId));

describe("bornes anti-blocage (fonctions pures)", async () => {
  const c = await import("@/lib/live/claims");
  it("plafond global : nombre fixe prioritaire, sinon % du stock disponible (au moins 1), rien si stock non suivi", () => {
    expect(c.activeCap({ units: 4, percent: 30, tracked: true, stock: 100, held: 0 })).toBe(4);
    expect(c.activeCap({ units: null, percent: 30, tracked: true, stock: 7, held: 3 })).toBe(3);
    expect(c.activeCap({ units: null, percent: 30, tracked: true, stock: 1, held: 0 })).toBe(1);
    expect(c.activeCap({ units: null, percent: 30, tracked: false, stock: 0, held: 0 })).toBeNull();
  });
  it("délai plafonné à 60 min, plafond par auteur à 5", () => {
    expect(c.clampHold(1440)).toBe(60);
    expect(c.clampHold(1)).toBe(5);
    expect(c.clampPerAuthor(50)).toBe(5);
    expect(c.clampPerAuthor(0)).toBe(2);
  });
  it("alerte d'expiration anormale", () => {
    expect(c.expiryAlert({ expired: 5, paid: 5, ordered: 0 })).toBe(true);
    expect(c.expiryAlert({ expired: 4, paid: 0, ordered: 0 })).toBe(false);
    expect(c.expiryAlert({ expired: 5, paid: 6, ordered: 0 })).toBe(false);
  });
});

describe.skipIf(!reachable)("commenter pour acheter (base locale, Graph simulé)", async () => {
  const route = await import("@/app/api/webhooks/meta/route");
  const claims = await import("@/lib/live/claims");
  const { encryptSecret } = await import("@/lib/crypto");

  const tag = `t${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const PAGE_A = `90${Date.now()}`.slice(0, 15);
  const IG_B = `178${Date.now()}`.slice(0, 17);
  const storeIds: string[] = [];
  let storeA = "";
  let storeB = "";
  let productA = "";
  let productB = "";
  let eventA = "";
  let seq = 0;

  const mkStore = async (slug: string) => {
    const s = await db.store.create({
      data: {
        name: `Live ${slug}`,
        slug,
        status: "PUBLISHED",
        subscription: { create: { planId: "SCALE", status: "ACTIVE", interval: "MONTHLY", currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 20 * 86_400_000) } },
      },
    });
    storeIds.push(s.id);
    return s.id;
  };

  const stockOf = async (id: string) => (await db.product.findUniqueOrThrow({ where: { id }, select: { stock: true } })).stock;

  function signed(body: unknown) {
    const raw = JSON.stringify(body);
    return new Request("http://localhost/api/webhooks/meta", { method: "POST", headers: { "x-hub-signature-256": `sha256=${createHmac("sha256", SECRET).update(raw).digest("hex")}` }, body: raw });
  }
  const fbComment = (text: string, author = "u1", commentId = `${PAGE_A}_1_${++seq}`) => ({
    commentId,
    body: { object: "page", entry: [{ id: PAGE_A, changes: [{ field: "feed", value: { item: "comment", verb: "add", comment_id: commentId, post_id: `${PAGE_A}_1`, from: { id: author, name: `Client ${author}` }, message: text } }] }] },
  });

  beforeAll(async () => {
    storeA = await mkStore(`live-a-${tag}`);
    storeB = await mkStore(`live-b-${tag}`);
    productA = (await db.product.create({ data: { storeId: storeA, name: "Robe wax", slug: `robe-${tag}`, price: 5000, trackStock: true, stock: 3 } })).id;
    productB = (await db.product.create({ data: { storeId: storeB, name: "Sac", slug: `sac-${tag}`, price: 9000, trackStock: true, stock: 5 } })).id;
    const evA = await db.liveEvent.create({ data: { storeId: storeA, title: "Direct A", startsAt: new Date(Date.now() - 60_000), streamUrl: "https://facebook.com/x", status: "LIVE", claimsEnabled: true, claimHoldMinutes: 30, claimMaxPerAuthor: 3, claimActiveCapPercent: 100 } });
    eventA = evA.id;
    const evB = await db.liveEvent.create({ data: { storeId: storeB, title: "Direct B", startsAt: new Date(Date.now() - 60_000), streamUrl: "https://instagram.com/x", status: "LIVE", claimsEnabled: true, claimActiveCapPercent: 100 } });
    await db.liveKeyword.create({ data: { storeId: storeA, liveEventId: eventA, code: "12", productId: productA } });
    await db.liveKeyword.create({ data: { storeId: storeB, liveEventId: evB.id, code: "12", productId: productB } });
    const token = encryptSecret("page-token-test");
    await db.socialAccount.create({ data: { storeId: storeA, platform: "FACEBOOK", externalId: PAGE_A, pageId: PAGE_A, name: "Page A", tokenEncrypted: token } });
    await db.socialAccount.create({ data: { storeId: storeB, platform: "INSTAGRAM", externalId: IG_B, pageId: "4444444444", name: "@b", tokenEncrypted: token } });
  });

  beforeEach(() => {
    graph.calls = [];
    graph.failFollowUp = false;
    vi.stubGlobal("fetch", vi.fn(fakeFetch));
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    if (!storeIds.length) return;
    await db.providerEvent.deleteMany({ where: { provider: "meta_social", eventId: { contains: PAGE_A } } });
    await db.rateLimit.deleteMany({ where: { key: { startsWith: "live-" } } }).catch(() => {});
    await db.store.deleteMany({ where: { id: { in: storeIds } } });
  });

  it("commentaire « JP 12 » : réservation, stock retenu, UNE réponse privée avec lien court", async () => {
    const c = fbComment("JP 12");
    const res = await route.POST(signed(c.body));
    expect(res.status).toBe(200);
    const claim = await db.liveClaim.findFirstOrThrow({ where: { commentId: c.commentId } });
    expect(claim).toMatchObject({ storeId: storeA, liveEventId: eventA, status: "MESSAGED", quantity: 1, heldQuantity: 1, unitPrice: 5000, platform: "FACEBOOK" });
    expect(await stockOf(productA)).toBe(2);
    const replies = privateReplies(c.commentId);
    expect(replies).toHaveLength(1);
    expect(replies[0].url).toContain(`/${PAGE_A}/messages`);
    expect(JSON.stringify(replies[0].body)).toContain(`/l/${claim.token}`);
    const move = await db.inventoryMovement.findFirst({ where: { storeId: storeA, productId: productA, note: { contains: claim.id } } });
    expect(move?.delta).toBe(-1);
  });

  it("idempotence : même commentaire renvoyé → aucun second claim, aucune seconde réponse privée", async () => {
    const c = fbComment("JP 12", "u2");
    await route.POST(signed(c.body));
    await route.POST(signed(c.body));
    expect(await db.liveClaim.count({ where: { commentId: c.commentId } })).toBe(1);
    expect(privateReplies(c.commentId)).toHaveLength(1);
    // Envoi forcé une seconde fois : le verrou refuse (déjà envoyé).
    const claim = await db.liveClaim.findFirstOrThrow({ where: { commentId: c.commentId } });
    expect((await claims.deliverClaimMessage(claim.id)).ok).toBe(false);
    expect(privateReplies(c.commentId)).toHaveLength(1);
    expect(await stockOf(productA)).toBe(1);
  });

  it("plafond par auteur et rupture de stock", async () => {
    // u1 a déjà 1 ; « 12 x3 » dépasserait le plafond de 3 → refus silencieux.
    const capped = fbComment("12 x3", "u1");
    await route.POST(signed(capped.body));
    expect(await db.liveClaim.count({ where: { commentId: capped.commentId } })).toBe(0);
    expect(privateReplies(capped.commentId)).toHaveLength(0);

    const last = fbComment("je prends le 12", "u3");
    await route.POST(signed(last.body));
    expect(await stockOf(productA)).toBe(0);

    // Plus de stock : pas de claim, réponse privée « plus disponible » (unique).
    const late = fbComment("JP 12", "u4");
    await route.POST(signed(late.body));
    expect(await db.liveClaim.count({ where: { commentId: late.commentId } })).toBe(0);
    const r = privateReplies(late.commentId);
    expect(r).toHaveLength(1);
    expect(JSON.stringify(r[0].body)).toContain("plus disponible");
    expect(await stockOf(productA)).toBe(0);
  });

  it("isolation : le commentaire d'une Page n'atteint que sa boutique ; annulation inter-boutiques refusée", async () => {
    expect(await db.liveClaim.count({ where: { storeId: storeB } })).toBe(0);
    expect(await stockOf(productB)).toBe(5);
    const any = await db.liveClaim.findFirstOrThrow({ where: { storeId: storeA, status: "MESSAGED" } });
    expect(await claims.cancelClaim(storeB, any.id)).toBe(false);
    expect((await db.liveClaim.findUniqueOrThrow({ where: { id: any.id } })).status).toBe("MESSAGED");
    // Instagram de la boutique B : réserve chez B uniquement.
    const ig = { object: "instagram", entry: [{ id: IG_B, changes: [{ field: "live_comments", value: { id: `ig_${tag}_1`, from: { id: "77", username: "kofi" }, text: "12", media: { id: "1790001" } } }] }] };
    await route.POST(signed(ig));
    const igClaim = await db.liveClaim.findFirstOrThrow({ where: { commentId: `ig_${tag}_1` } });
    expect(igClaim.storeId).toBe(storeB);
    expect(await stockOf(productB)).toBe(4);
    expect(await stockOf(productA)).toBe(0);
  });

  it("expiration : stock rendu une seule fois, statut EXPIRED", async () => {
    const claim = await db.liveClaim.findFirstOrThrow({ where: { storeId: storeA, authorId: "u3" } });
    await db.liveClaim.update({ where: { id: claim.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const before = await stockOf(productA);
    const r1 = await claims.sweepLiveClaims({ storeId: storeA });
    expect(r1.expired).toBe(1);
    const r2 = await claims.sweepLiveClaims({ storeId: storeA });
    expect(r2.expired).toBe(0);
    expect(await stockOf(productA)).toBe(before + 1);
    expect(await db.liveClaim.findUniqueOrThrow({ where: { id: claim.id } })).toMatchObject({ status: "EXPIRED", heldQuantity: 0 });
    expect((await claims.openClaimCheckout(claim.token)).ok).toBe(false);
  });

  it("lien court : panier créé avec l'article, stock rendu au checkout, même panier si rouvert ; puis PAID", async () => {
    const claim = await db.liveClaim.findFirstOrThrow({ where: { storeId: storeA, authorId: "u1", status: "MESSAGED" } });
    const before = await stockOf(productA);
    const r = await claims.openClaimCheckout(claim.token);
    expect(r.ok).toBe(true);
    const again = await claims.openClaimCheckout(claim.token);
    expect(again).toEqual(r);
    const fresh = await db.liveClaim.findUniqueOrThrow({ where: { id: claim.id } });
    expect(fresh.heldQuantity).toBe(0);
    expect(await stockOf(productA)).toBe(before + 1);
    const cart = await db.cart.findUniqueOrThrow({ where: { id: fresh.cartId! }, include: { items: true } });
    expect(cart.storeId).toBe(storeA);
    expect(cart.items).toMatchObject([{ productId: productA, quantity: 1 }]);
    if (r.ok) expect(r.url).toContain(`?panier=${cart.token}`);

    // Commande payée issue de ce panier → PAID au balayage.
    const order = await db.order.create({
      data: { storeId: storeA, reference: `AX-${tag}`.slice(0, 20), trackingToken: `trk${tag}`, trackingExpiresAt: new Date(Date.now() + 86_400_000), fulfillmentType: "PICKUP", customerName: "Client", customerPhone: "22997000000", currency: "XOF", subtotal: 5000, total: 5000, paymentStatus: "PAID" },
    });
    await db.cart.update({ where: { id: cart.id }, data: { convertedOrderId: order.id } });
    const s = await claims.sweepLiveClaims({ storeId: storeA });
    expect(s.paid).toBe(1);
    expect(await db.liveClaim.findUniqueOrThrow({ where: { id: claim.id } })).toMatchObject({ status: "PAID", orderId: order.id });
  });

  it("annulation marchand : stock rendu ; relance hors fenêtre 24 h refusée proprement", async () => {
    const c = fbComment("12", "u9");
    await db.product.update({ where: { id: productA }, data: { stock: { increment: 2 } } });
    await route.POST(signed(c.body));
    const claim = await db.liveClaim.findFirstOrThrow({ where: { commentId: c.commentId } });
    expect(claim.status).toBe("MESSAGED");
    graph.failFollowUp = true;
    const remind = await claims.remindClaim(storeA, claim.id);
    expect(remind.ok).toBe(false);
    const before = await stockOf(productA);
    expect(await claims.cancelClaim(storeA, claim.id)).toBe(true);
    expect(await claims.cancelClaim(storeA, claim.id)).toBe(false);
    expect(await stockOf(productA)).toBe(before + 1);
  });

  it("M1 : plafond global de réservations en attente par article (nombre fixe) et bornes des réglages", async () => {
    await db.product.update({ where: { id: productA }, data: { stock: { increment: 10 } } });
    await db.liveClaim.updateMany({ where: { liveEventId: eventA, status: { in: ["RESERVED", "MESSAGED"] } }, data: { status: "CANCELLED", heldQuantity: 0 } });
    await db.liveEvent.update({ where: { id: eventA }, data: { claimActiveCapUnits: 1, claimHoldMinutes: 1440, claimMaxPerAuthor: 50 } });
    const a = fbComment("jp 12", "cap1");
    const b = fbComment("jp 12", "cap2");
    await route.POST(signed(a.body));
    await route.POST(signed(b.body));
    const ca = await db.liveClaim.findFirstOrThrow({ where: { commentId: a.commentId } });
    expect(await db.liveClaim.count({ where: { commentId: b.commentId } })).toBe(0);
    // Réglage ancien hors bornes (1440 min) : ramené à 60 min.
    expect(ca.expiresAt.getTime() - ca.createdAt.getTime()).toBeLessThanOrEqual(60 * 60_000 + 5_000);
    await db.liveEvent.update({ where: { id: eventA }, data: { claimActiveCapUnits: null, claimHoldMinutes: 30, claimMaxPerAuthor: 3 } });
  });

  it("F2 : lien refusé 7 jours après l'échéance, même si le panier existe", async () => {
    const c = fbComment("12", "f2");
    await route.POST(signed(c.body));
    const claim = await db.liveClaim.findFirstOrThrow({ where: { commentId: c.commentId } });
    expect((await claims.openClaimCheckout(claim.token)).ok).toBe(true);
    await db.liveClaim.update({ where: { id: claim.id }, data: { expiresAt: new Date(Date.now() - 8 * 86_400_000) } });
    const r = await claims.openClaimCheckout(claim.token);
    expect(r).toMatchObject({ ok: false, code: "expired" });
  });

  it("F3 : échéance revérifiée sous le verrou (lecture initiale périmée) : aucun panier, stock non rendu", async () => {
    const c = fbComment("12", "f3");
    await route.POST(signed(c.body));
    const claim = await db.liveClaim.findFirstOrThrow({ where: { commentId: c.commentId } });
    await db.liveClaim.update({ where: { id: claim.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    // La lecture hors transaction voit encore l'ancienne échéance (course avec le balayage).
    const real = db.liveClaim.findUnique.bind(db.liveClaim);
    const spy = vi.spyOn(db.liveClaim, "findUnique").mockImplementationOnce((async (args: Parameters<typeof real>[0]) => {
      const row = await real(args);
      return row ? { ...row, expiresAt: new Date(Date.now() + 600_000) } : row;
    }) as never);
    const r = await claims.openClaimCheckout(claim.token);
    spy.mockRestore();
    expect(r).toMatchObject({ ok: false, code: "inactive" });
    expect(await db.liveClaim.findUniqueOrThrow({ where: { id: claim.id } })).toMatchObject({ cartId: null, heldQuantity: 1 });
  });

  it("direct non en cours ou désactivé : aucun claim", async () => {
    await db.liveEvent.update({ where: { id: eventA }, data: { claimsEnabled: false } });
    const c = fbComment("JP 12", "u10");
    await route.POST(signed(c.body));
    expect(await db.liveClaim.count({ where: { commentId: c.commentId } })).toBe(0);
    await db.liveEvent.update({ where: { id: eventA }, data: { claimsEnabled: true } });
  });
});
