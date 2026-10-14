import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb } from "./helpers/fake-db";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Vague 2 — produits numériques : émission des accès APRÈS paiement seulement, idempotence, isolation entre
 * boutiques, service d'un fichier (jeton, expiration, limite, compteur atomique, variante achetée).
 * Base Prisma simulée (tests/helpers/fake-db.ts) + une implémentation de `$executeRaw` qui reproduit
 * l'incrément CONDITIONNEL du compteur (la vraie requête est un seul UPDATE … WHERE, donc atomique).
 */
const state = vi.hoisted(() => ({ db: null as any, fake: null as any, jobs: [] as any[], mails: [] as any[], events: [] as any[], transitions: [] as any[], rate: { ok: true } }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.db;
  },
}));
vi.mock("@/lib/audit", () => ({ audit: async () => {} }));
vi.mock("@/lib/jobs", () => ({
  enqueue: async (type: string, payload: unknown) => {
    state.jobs.push({ type, payload });
  },
}));
vi.mock("@/lib/email", () => ({
  sendMail: async (mail: any) => {
    state.mails.push(mail);
    return { ok: true };
  },
}));
vi.mock("@/lib/webhooks/emit", () => ({
  emitDomainEvent: async (_tx: unknown, storeId: string, event: string, data: unknown) => {
    state.events.push({ storeId, event, data });
  },
}));
vi.mock("@/lib/commerce/orders", () => ({
  transitionOrder: async (p: unknown) => {
    state.transitions.push(p);
  },
}));
vi.mock("@/lib/rate-limit", () => ({
  clientIp: async () => "1.2.3.4",
  rateLimit: async () => ({ ok: state.rate.ok, retryAfter: 60 }),
  rateLimitAll: async () => ({ ok: state.rate.ok, retryAfter: 60 }),
  rateLimitMessage: () => "Trop de tentatives",
}));

import { issueDigitalDeliveriesForOrder, loadGrantByToken, serveDownload, listOrderDownloads, listCustomerDownloads, rotateGrantToken } from "@/lib/digital/service";
import { hashDownloadToken } from "@/lib/digital/token";

const KEY_A = `stores/storeaaaa1111/files/2026/10/${"a".repeat(64)}.pdf`;
const KEY_B = `stores/storeaaaa1111/files/2026/10/${"b".repeat(64)}.zip`;
const KEY_OTHER = `stores/storebbbb2222/files/2026/10/${"c".repeat(64)}.pdf`;

/** `$executeRaw` du compteur : incrément conditionnel (limite et expiration), comme en SQL. */
function executeRaw(_sql: TemplateStringsArray | string, ...values: unknown[]) {
  const now = values[0] as Date;
  const ip = values[1] as string | null;
  const id = values[2] as string;
  const row = state.fake.tables.downloadGrant?.find((g: any) => g.id === id);
  if (!row) return Promise.resolve(0);
  if (row.downloadLimit != null && row.downloadCount >= row.downloadLimit) return Promise.resolve(0);
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return Promise.resolve(0);
  row.downloadCount += 1;
  row.lastDownloadAt = now;
  row.lastIp = ip;
  return Promise.resolve(1);
}

function seed(over: { paymentStatus?: string; status?: string; downloadLimit?: number | null; validity?: number | null } = {}) {
  state.jobs = [];
  state.mails = [];
  state.events = [];
  state.transitions = [];
  state.rate.ok = true;
  const fake = createFakeDb({
    store: [
      { id: "storeaaaa1111", slug: "boutique-a", name: "Boutique A", status: "PUBLISHED", currency: "XOF", logoUrl: null, themeId: "market", themeConfig: null, sector: "general", whatsappNumber: "22997000000" },
      { id: "storebbbb2222", slug: "boutique-b", name: "Boutique B", status: "PUBLISHED", currency: "XOF", logoUrl: null, themeId: "market", themeConfig: null, sector: "general", whatsappNumber: null },
    ],
    customer: [{ id: "cust_a", storeId: "storeaaaa1111", name: "Awa", phone: "22997000001", email: "awa@example.com" }],
    product: [
      { id: "prod_pdf", storeId: "storeaaaa1111", name: "Guide PDF", kind: "DIGITAL", isGiftCard: false, downloadLimit: over.downloadLimit === undefined ? 2 : over.downloadLimit, downloadValidityDays: over.validity === undefined ? 30 : over.validity, postPurchaseInstructions: "Ouvrez avec Acrobat." },
      { id: "prod_robe", storeId: "storeaaaa1111", name: "Robe", kind: "PHYSICAL", isGiftCard: false },
      { id: "prod_b", storeId: "storebbbb2222", name: "Autre guide", kind: "DIGITAL", isGiftCard: false },
    ],
    variant: [{ id: "var_v1", productId: "prod_pdf", name: "Version longue" }],
    digitalAsset: [
      { id: "asset_aaaa1111", storeId: "storeaaaa1111", productId: "prod_pdf", variantId: null, name: "Guide.pdf", storageKey: KEY_A, bytes: 1024, mime: "application/pdf", version: 1, position: 0 },
      { id: "asset_v1111111", storeId: "storeaaaa1111", productId: "prod_pdf", variantId: "var_v1", name: "Bonus.zip", storageKey: KEY_B, bytes: 2048, mime: "application/zip", version: 1, position: 1 },
      { id: "asset_other111", storeId: "storebbbb2222", productId: "prod_b", variantId: null, name: "Autre.pdf", storageKey: KEY_OTHER, bytes: 512, mime: "application/pdf", version: 1, position: 0 },
    ],
    order: [
      {
        id: "order_1", storeId: "storeaaaa1111", customerId: "cust_a", reference: "AX-0001", trackingToken: "f".repeat(48),
        status: over.status ?? "NEW", paymentStatus: over.paymentStatus ?? "PAID", currency: "XOF",
        customerName: "Awa", customerEmail: "awa@example.com", customerPhone: "22997000001",
      },
      {
        id: "order_b", storeId: "storebbbb2222", customerId: null, reference: "AX-9001", trackingToken: "e".repeat(48),
        status: "NEW", paymentStatus: "PAID", currency: "XOF", customerName: "Kofi", customerEmail: null, customerPhone: "22997000002",
      },
    ],
    orderItem: [
      { id: "item_pdf", orderId: "order_1", productId: "prod_pdf", variantId: null, name: "Guide PDF", variantName: null, quantity: 1, kind: "DIGITAL", isGiftCard: false },
      { id: "item_robe", orderId: "order_1", productId: "prod_robe", variantId: null, name: "Robe", variantName: null, quantity: 1, kind: "PHYSICAL", isGiftCard: false },
      { id: "item_b", orderId: "order_b", productId: "prod_b", variantId: null, name: "Autre guide", variantName: null, quantity: 1, kind: "DIGITAL", isGiftCard: false },
    ],
    downloadGrant: [],
  });
  state.fake = fake;
  state.db = new Proxy(fake.db, {
    get(target: any, prop: string) {
      if (prop === "$executeRaw") return executeRaw;
      return target[prop];
    },
  });
}

/** Émet les accès puis renvoie le jeton en clair (lu dans l'e-mail envoyé). */
async function issueAndToken(): Promise<string> {
  await issueDigitalDeliveriesForOrder("order_1");
  const mail = state.mails.at(-1);
  const m = /\/telechargement\/([A-Za-z0-9_-]{43})/.exec(mail?.text ?? "");
  if (!m) throw new Error("jeton introuvable dans l'e-mail");
  return m[1];
}

beforeEach(() => seed());

describe("émission des accès", () => {
  it("une ligne numérique → un accès, avec limite et expiration du produit", async () => {
    const res = await issueDigitalDeliveriesForOrder("order_1");
    expect(res).toMatchObject({ issued: 1, skipped: 0 });
    const grants = state.fake.tables.downloadGrant;
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({ storeId: "storeaaaa1111", orderId: "order_1", orderItemId: "item_pdf", customerId: "cust_a", downloadCount: 0, downloadLimit: 2 });
    expect(grants[0].expiresAt.getTime()).toBeGreaterThan(Date.now());
    // Le jeton n'est JAMAIS stocké en clair.
    expect(grants[0].tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.keys(grants[0])).not.toContain("token");
  });

  it("jamais avant paiement confirmé", async () => {
    seed({ paymentStatus: "UNPAID" });
    expect(await issueDigitalDeliveriesForOrder("order_1")).toMatchObject({ issued: 0, reason: "unpaid" });
    expect(state.fake.tables.downloadGrant).toHaveLength(0);
    seed({ paymentStatus: "PENDING" });
    expect(await issueDigitalDeliveriesForOrder("order_1")).toMatchObject({ issued: 0, reason: "unpaid" });
    expect(state.mails).toHaveLength(0);
  });

  it("jamais pour une commande annulée ou remboursée", async () => {
    for (const status of ["CANCELLED", "REFUNDED"]) {
      seed({ status });
      expect(await issueDigitalDeliveriesForOrder("order_1")).toMatchObject({ issued: 0, reason: "cancelled" });
      expect(state.fake.tables.downloadGrant).toHaveLength(0);
    }
  });

  it("idempotent : un second passage n'émet rien de plus", async () => {
    await issueDigitalDeliveriesForOrder("order_1");
    const res = await issueDigitalDeliveriesForOrder("order_1");
    expect(res).toMatchObject({ issued: 0, skipped: 1 });
    expect(state.fake.tables.downloadGrant).toHaveLength(1);
  });

  it("notifie l'acheteur par e-mail avec le lien, les fichiers et la limite", async () => {
    const token = await issueAndToken();
    const mail = state.mails[0];
    expect(mail.to).toBe("awa@example.com");
    expect(mail.subject).toContain("AX-0001");
    expect(mail.text).toContain("Guide.pdf");
    expect(mail.text).toContain("2 téléchargements restants sur 2");
    expect(mail.text).toContain("Ouvrez avec Acrobat.");
    expect(hashDownloadToken(token)).toBe(state.fake.tables.downloadGrant[0].tokenHash);
    expect(state.fake.tables.downloadGrant[0].notifiedAt).toBeTruthy();
  });

  it("émet le webhook digital.delivered, sans jeton ni lien", async () => {
    await issueDigitalDeliveriesForOrder("order_1");
    const ev = state.events.find((e: any) => e.event === "digital.delivered");
    expect(ev).toBeTruthy();
    expect(ev.storeId).toBe("storeaaaa1111");
    expect(ev.data).toMatchObject({ order_id: "order_1", order_item_id: "item_pdf", product_id: "prod_pdf", download_limit: 2 });
    expect(JSON.stringify(ev.data)).not.toMatch(/telechargement|token/i);
  });

  it("commande mixte : pas de clôture automatique (il reste un article à livrer)", async () => {
    await issueDigitalDeliveriesForOrder("order_1");
    expect(state.transitions).toHaveLength(0);
  });

  it("commande 100 % numérique : clôture automatique en « Livrée / remise »", async () => {
    seed();
    state.fake.tables.orderItem = state.fake.tables.orderItem.filter((i: any) => i.id !== "item_robe");
    await issueDigitalDeliveriesForOrder("order_1");
    expect(state.transitions).toHaveLength(1);
    expect(state.transitions[0]).toMatchObject({ orderId: "order_1", to: "DELIVERED", intangible: true, actorId: null });
  });

  it("sans e-mail sur la commande : aucun envoi, l'accès existe quand même", async () => {
    seed();
    state.fake.tables.order.find((o: any) => o.id === "order_1").customerEmail = null;
    expect(await issueDigitalDeliveriesForOrder("order_1")).toMatchObject({ issued: 1 });
    expect(state.mails).toHaveLength(0);
  });
});

describe("lecture par jeton", () => {
  it("jeton valide : fichiers de la ligne, compteurs, instructions", async () => {
    const token = await issueAndToken();
    const view = await loadGrantByToken(token);
    expect(view).toBeTruthy();
    expect(view!.reference).toBe("AX-0001");
    expect(view!.files.map((f) => f.id)).toEqual(["asset_aaaa1111"]);
    expect(view!.downloadLimit).toBe(2);
    expect(view!.instructions).toBe("Ouvrez avec Acrobat.");
    // Aucune clé de stockage n'est exposée à la page.
    expect(JSON.stringify(view)).not.toContain("stores/");
  });

  it("jeton de forme invalide ou inconnu : null, sans requête inutile", async () => {
    await issueAndToken();
    expect(await loadGrantByToken("trop-court")).toBeNull();
    expect(await loadGrantByToken(null)).toBeNull();
    expect(await loadGrantByToken("A".repeat(43))).toBeNull();
  });

  it("commande annulée après émission : le lien ne vaut plus rien", async () => {
    const token = await issueAndToken();
    state.fake.tables.order.find((o: any) => o.id === "order_1").status = "CANCELLED";
    expect(await loadGrantByToken(token)).toBeNull();
    expect(await serveDownload({ token, assetId: "asset_aaaa1111", ip: null })).toMatchObject({ ok: false, status: 404 });
  });

  it("rotation du jeton : l'ancien lien cesse de fonctionner", async () => {
    const token = await issueAndToken();
    const fresh = await rotateGrantToken("storeaaaa1111", state.fake.tables.downloadGrant[0].id);
    expect(fresh).toBeTruthy();
    expect(await loadGrantByToken(token)).toBeNull();
    expect(await loadGrantByToken(fresh!)).toBeTruthy();
  });

  it("rotation refusée depuis une autre boutique", async () => {
    await issueAndToken();
    expect(await rotateGrantToken("storebbbb2222", state.fake.tables.downloadGrant[0].id)).toBeNull();
  });
});

describe("service d'un fichier", () => {
  it("sert le fichier, incrémente le compteur, puis refuse au-delà de la limite", async () => {
    const token = await issueAndToken();
    const first = await serveDownload({ token, assetId: "asset_aaaa1111", ip: "10.0.0.1" });
    expect(first).toMatchObject({ ok: true, storageKey: KEY_A, name: "Guide.pdf", remaining: 1, storeId: "storeaaaa1111" });
    const second = await serveDownload({ token, assetId: "asset_aaaa1111", ip: "10.0.0.1" });
    expect(second).toMatchObject({ ok: true, remaining: 0 });
    const third = await serveDownload({ token, assetId: "asset_aaaa1111", ip: "10.0.0.1" });
    expect(third).toMatchObject({ ok: false, status: 403 });
    const grant = state.fake.tables.downloadGrant[0];
    expect(grant.downloadCount).toBe(2);
    expect(grant.lastIp).toBe("10.0.0.1");
    expect(grant.lastDownloadAt).toBeTruthy();
  });

  it("concurrence : deux téléchargements simultanés ne dépassent jamais la limite", async () => {
    seed({ downloadLimit: 3 });
    const token = await issueAndToken();
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => serveDownload({ token, assetId: "asset_aaaa1111", ip: null })));
    expect(results.filter((r) => r.ok)).toHaveLength(3);
    expect(results.filter((r) => !r.ok)).toHaveLength(2);
    expect(state.fake.tables.downloadGrant[0].downloadCount).toBe(3);
  });

  it("limite illimitée : aucun refus", async () => {
    seed({ downloadLimit: 0 });
    const token = await issueAndToken();
    for (let i = 0; i < 6; i++) expect((await serveDownload({ token, assetId: "asset_aaaa1111", ip: null })).ok).toBe(true);
    expect(state.fake.tables.downloadGrant[0].downloadCount).toBe(6);
    expect(state.fake.tables.downloadGrant[0].expiresAt ?? null).toBeTruthy();
  });

  it("accès expiré : 410 et compteur inchangé", async () => {
    const token = await issueAndToken();
    const grant = state.fake.tables.downloadGrant[0];
    grant.expiresAt = new Date(Date.now() - 1000);
    expect(await serveDownload({ token, assetId: "asset_aaaa1111", ip: null })).toMatchObject({ ok: false, status: 410 });
    expect(grant.downloadCount).toBe(0);
  });

  it("fichier d'une autre boutique ou d'un autre produit : introuvable", async () => {
    const token = await issueAndToken();
    expect(await serveDownload({ token, assetId: "asset_other111", ip: null })).toMatchObject({ ok: false, status: 404 });
    expect(await serveDownload({ token, assetId: "inconnu-12345", ip: null })).toMatchObject({ ok: false, status: 404 });
    expect(await serveDownload({ token, assetId: "../../etc/passwd", ip: null })).toMatchObject({ ok: false, status: 404 });
    expect(state.fake.tables.downloadGrant[0].downloadCount).toBe(0);
  });

  it("fichier réservé à une autre variante : refusé", async () => {
    const token = await issueAndToken();
    // La ligne a été achetée sans variante : le fichier « asset_v1 » ne lui est pas destiné.
    expect(await serveDownload({ token, assetId: "asset_v1111111", ip: null })).toMatchObject({ ok: false, status: 404 });
  });

  it("variante achetée : ses fichiers s'ajoutent aux fichiers communs", async () => {
    seed();
    state.fake.tables.orderItem.find((i: any) => i.id === "item_pdf").variantId = "var_v1";
    const token = await issueAndToken();
    const view = await loadGrantByToken(token);
    expect(view!.files.map((f) => f.id)).toEqual(["asset_aaaa1111", "asset_v1111111"]);
    expect((await serveDownload({ token, assetId: "asset_v1111111", ip: null })).ok).toBe(true);
  });

  it("débit dépassé : 429 sans consommer de téléchargement", async () => {
    const token = await issueAndToken();
    state.rate.ok = false;
    expect(await serveDownload({ token, assetId: "asset_aaaa1111", ip: null })).toMatchObject({ ok: false, status: 429 });
    expect(state.fake.tables.downloadGrant[0].downloadCount).toBe(0);
  });

  it("paiement retombé en impayé (remboursement) : plus de service", async () => {
    const token = await issueAndToken();
    state.fake.tables.order.find((o: any) => o.id === "order_1").paymentStatus = "REFUNDED";
    expect(await serveDownload({ token, assetId: "asset_aaaa1111", ip: null })).toMatchObject({ ok: false, status: 404 });
  });
});

describe("isolation entre boutiques", () => {
  it("les accès d'une boutique ne fuient jamais dans l'autre", async () => {
    await issueDigitalDeliveriesForOrder("order_1");
    await issueDigitalDeliveriesForOrder("order_b");
    expect(state.fake.tables.downloadGrant).toHaveLength(2);
    expect(await listOrderDownloads("storeaaaa1111", "order_1")).toHaveLength(1);
    expect(await listOrderDownloads("storebbbb2222", "order_1")).toHaveLength(0);
    expect(await listOrderDownloads("storeaaaa1111", "order_b")).toHaveLength(0);
  });

  it("espace client : seulement les accès du client ET de la boutique", async () => {
    await issueDigitalDeliveriesForOrder("order_1");
    expect(await listCustomerDownloads("storeaaaa1111", "cust_a")).toHaveLength(1);
    expect(await listCustomerDownloads("storebbbb2222", "cust_a")).toHaveLength(0);
    expect(await listCustomerDownloads("storeaaaa1111", "cust_inconnu")).toHaveLength(0);
  });

  it("espace client : une commande annulée disparaît de la liste", async () => {
    await issueDigitalDeliveriesForOrder("order_1");
    state.fake.tables.order.find((o: any) => o.id === "order_1").status = "CANCELLED";
    expect(await listCustomerDownloads("storeaaaa1111", "cust_a")).toHaveLength(0);
  });
});
