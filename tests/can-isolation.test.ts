import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb } from "./helpers/fake-db";

/**
 * Lot 4D (équipe CAN) : isolation entre boutiques, contrôle de plan et règles de consentement des actions
 * du direct (§18), des notifications push (§19) et de la boutique installable (§14).
 */

const state = vi.hoisted(() => ({
  fake: null as null | ReturnType<typeof import("./helpers/fake-db").createFakeDb>,
  member: "store_AAAAAAAA" as string,
  planId: "SCALE" as string,
  caps: new Set<string>(["theme.manage"]),
  buyer: null as null | { customerId: string },
  jobs: [] as { type: string; payload: Record<string, unknown>; storeId?: string | null }[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers({ "user-agent": "test" })), cookies: vi.fn(async () => ({ get: () => undefined })) }));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.fake!.db;
  },
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => ({})) }));
vi.mock("@/lib/rate-limit", () => ({
  clientIp: vi.fn(async () => "203.0.113.1"),
  rateLimit: vi.fn(async () => ({ ok: true, retryAfter: 0 })),
  rateLimitAll: vi.fn(async () => ({ ok: true, retryAfter: 0 })),
  rateLimitMessage: () => "Trop de tentatives.",
}));
vi.mock("@/lib/jobs", () => ({
  enqueue: vi.fn(async (type: string, payload: Record<string, unknown>, opts: { storeId?: string | null } = {}) => {
    state.jobs.push({ type, payload, storeId: opts.storeId });
    return { id: `job_${state.jobs.length}` };
  }),
}));
vi.mock("@/lib/buyer/session", () => ({ getBuyer: vi.fn(async () => state.buyer) }));
vi.mock("@/lib/push/send", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/push/send")>();
  return { ...actual, deliver: vi.fn(async () => ({ sent: 1, revoked: 0, failed: 0, retryable: 0 })) };
});
vi.mock("@/lib/auth/permissions", () => {
  class AuthError extends Error {}
  return {
    AuthError,
    requireStore: vi.fn(async (storeId: string, cap: string) => {
      if (storeId !== state.member) throw new AuthError("Boutique introuvable ou accès refusé");
      if (!state.caps.has(cap)) throw new AuthError("Votre rôle ne permet pas cette action");
      const store = state.fake!.tables.store.find((s) => s.id === storeId)!;
      return { user: { id: "user_A" }, store, role: "OWNER", planId: state.planId, can: () => true };
    }),
  };
});

import { deleteLiveEvent, pinLiveProduct, requestLiveReminder, saveLiveEvent, setLiveEventStatus } from "@/lib/live/actions";
import { sendPushCampaign, subscribeToPush, unsubscribeFromPush } from "@/lib/push/actions";
import { audience, planPushState } from "@/lib/push/service";
import { savePwaSettings } from "@/lib/pwa/actions";

const A = "store_AAAAAAAA";
const B = "store_BBBBBBBB";
const paid = (planId: string) => ({ planId, status: "ACTIVE", trialEndsAt: null, currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000), zone: "AFRICA" });

/** Clés d'abonnement valides (vecteur de la RFC 8291). */
const KEYS = { p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4", auth: "BTBZMqHH6r4Tts7J_aSIgg" };

function fd(o: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
}

const eventForm = (o: Record<string, string> = {}) =>
  fd({ storeId: A, title: "Nouveautés de la rentrée", startsAt: "2026-11-01T18:00", streamUrl: "https://www.youtube.com/watch?v=abc", ...o });

beforeEach(() => {
  state.member = A;
  state.planId = "SCALE";
  state.caps = new Set(["theme.manage"]);
  state.buyer = null;
  state.jobs = [];
  state.fake = createFakeDb({
    store: [
      { id: A, slug: "boutique-a", name: "Boutique A", status: "PUBLISHED", country: "BJ", currency: "XOF", timezone: "Africa/Porto-Novo", pwaConfig: null },
      { id: B, slug: "boutique-b", name: "Boutique B", status: "PUBLISHED", country: "BJ", currency: "XOF", timezone: "Africa/Porto-Novo", pwaConfig: null },
    ],
    subscription: [
      { id: "sub_store_A", storeId: A, ...paid("SCALE") },
      { id: "sub_store_B", storeId: B, ...paid("SCALE") },
    ],
    product: [
      { id: "prod_A1", storeId: A, name: "Pagne wax", slug: "pagne-wax", status: "ACTIVE", price: 12000, images: [], trackStock: false, stock: 0 },
      { id: "prod_B1", storeId: B, name: "Produit de B", slug: "produit-b", status: "ACTIVE", price: 9000, images: [], trackStock: false, stock: 0 },
    ],
    liveEvent: [
      { id: "live_BBBB1", storeId: B, title: "Direct de B", startsAt: new Date("2026-11-02T18:00:00Z"), endsAt: null, streamUrl: "https://youtu.be/b", productIds: ["prod_B1"], pinnedId: "prod_B1", status: "SCHEDULED" },
    ],
    pushSubscription: [
      { id: "sub_A1", storeId: A, customerId: "cust_A1", endpoint: "https://push.example.net/a1", p256dh: KEYS.p256dh, auth: KEYS.auth, topics: ["orders", "marketing"], revokedAt: null, failures: 0, createdAt: new Date() },
      { id: "sub_A2", storeId: A, customerId: null, endpoint: "https://push.example.net/a2", p256dh: KEYS.p256dh, auth: KEYS.auth, topics: ["orders"], revokedAt: null, failures: 0, createdAt: new Date() },
      { id: "sub_A3", storeId: A, customerId: "cust_A2", endpoint: "https://push.example.net/a3", p256dh: KEYS.p256dh, auth: KEYS.auth, topics: ["orders", "marketing"], revokedAt: new Date(), failures: 0, createdAt: new Date() },
      { id: "sub_B1", storeId: B, customerId: "cust_B1", endpoint: "https://push.example.net/b1", p256dh: KEYS.p256dh, auth: KEYS.auth, topics: ["orders", "marketing"], revokedAt: null, failures: 0, createdAt: new Date() },
    ],
    customer: [
      { id: "cust_A1", storeId: A, name: "Awa", phone: "22997000001", tags: [], ordersCount: 1, loyaltyPoints: 0, createdAt: new Date() },
      { id: "cust_A2", storeId: A, name: "Blaise", phone: "22997000002", tags: [], ordersCount: 0, loyaltyPoints: 0, createdAt: new Date() },
      { id: "cust_B1", storeId: B, name: "Client B", phone: "22997000003", tags: [], ordersCount: 0, loyaltyPoints: 0, createdAt: new Date() },
    ],
    consent: [
      { id: "cons_A1", customerId: "cust_A1", channel: "PUSH", purpose: "MARKETING", granted: true, source: "storefront", createdAt: new Date("2026-10-01") },
      { id: "cons_B1", customerId: "cust_B1", channel: "PUSH", purpose: "MARKETING", granted: true, source: "storefront", createdAt: new Date("2026-10-01") },
    ],
    notification: [],
    campaign: [],
  });
});

describe("direct : isolation entre boutiques", () => {
  it("modifier, lancer, épingler ou supprimer le direct d'une autre boutique : refusé", async () => {
    expect((await saveLiveEvent(undefined, eventForm({ eventId: "live_BBBB1", title: "Piraté" }))).ok).toBe(false);
    expect((await setLiveEventStatus(A, "live_BBBB1", "LIVE")).ok).toBe(false);
    expect((await pinLiveProduct(A, "live_BBBB1", "prod_B1")).ok).toBe(false);
    expect((await deleteLiveEvent(A, "live_BBBB1")).ok).toBe(false);
    const row = state.fake!.tables.liveEvent.find((e) => e.id === "live_BBBB1")!;
    expect(row.title).toBe("Direct de B");
    expect(row.status).toBe("SCHEDULED");
  });

  it("agir sur la boutique B sans en être membre : refusé", async () => {
    expect((await saveLiveEvent(undefined, eventForm({ storeId: B }))).ok).toBe(false);
    expect((await setLiveEventStatus(B, "live_BBBB1", "ENDED")).ok).toBe(false);
  });

  it("un produit d'une autre boutique n'entre pas dans le direct", async () => {
    const form = eventForm();
    form.append("productIds[]", "prod_A1");
    form.append("productIds[]", "prod_B1");
    const r = await saveLiveEvent(undefined, form);
    expect(r.ok).toBe(true);
    const created = state.fake!.tables.liveEvent.find((e) => e.storeId === A)!;
    expect(created.productIds).toEqual(["prod_A1"]);
    expect(created.pinnedId).toBe("prod_A1");
  });
});

describe("direct : validation et plan", () => {
  it("lien de diffusion hors liste blanche : refusé", async () => {
    const r = await saveLiveEvent(undefined, eventForm({ streamUrl: "https://evil.example.com/live" }));
    expect(r.ok).toBe(false);
    expect(state.fake!.tables.liveEvent.filter((e) => e.storeId === A)).toHaveLength(0);
  });

  it("fin antérieure au début : refusée", async () => {
    const r = await saveLiveEvent(undefined, eventForm({ endsAt: "2026-11-01T17:00" }));
    expect(r.ok).toBe(false);
  });

  it("plan Business : le live shopping est refusé côté serveur", async () => {
    state.planId = "BUSINESS";
    const r = await saveLiveEvent(undefined, eventForm());
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/Scale/);
  });

  it("capacité manquante : refusé", async () => {
    state.caps = new Set(["store.view"]);
    expect((await saveLiveEvent(undefined, eventForm())).ok).toBe(false);
  });

  it("épingler un produit absent du direct : refusé", async () => {
    const form = eventForm();
    form.append("productIds[]", "prod_A1");
    await saveLiveEvent(undefined, form);
    const id = state.fake!.tables.liveEvent.find((e) => e.storeId === A)!.id as string;
    expect((await pinLiveProduct(A, id, "prod_B1")).ok).toBe(false);
    expect((await pinLiveProduct(A, id, null)).ok).toBe(true);
  });
});

describe("rappel WhatsApp du direct (§18)", () => {
  const remind = (o: Record<string, string> = {}) => fd({ slug: "boutique-a", eventId: "live_AAAA1", phone: "97000005", consent: "on", name: "Awa", ...o });

  beforeEach(() => {
    state.fake!.tables.liveEvent.push({ id: "live_AAAA1", storeId: A, title: "Direct de A", startsAt: new Date("2026-11-01T18:00:00Z"), endsAt: null, streamUrl: "https://youtu.be/a", productIds: [], pinnedId: null, status: "SCHEDULED" });
  });

  it("sans consentement coché : refusé, rien n'est écrit", async () => {
    const r = await requestLiveReminder(undefined, remind({ consent: "" }));
    expect(r.ok).toBe(false);
    expect(state.fake!.tables.campaign).toHaveLength(0);
  });

  it("crée le client, son consentement et une seule campagne programmée à l'heure du direct", async () => {
    expect((await requestLiveReminder(undefined, remind())).ok).toBe(true);
    expect((await requestLiveReminder(undefined, remind({ phone: "97000006", name: "Blaise" }))).ok).toBe(true);
    const campaigns = state.fake!.tables.campaign;
    expect(campaigns).toHaveLength(1);
    expect(campaigns[0].channel).toBe("whatsapp");
    expect(campaigns[0].status).toBe("SCHEDULED");
    expect((campaigns[0].scheduledAt as Date).toISOString()).toBe("2026-11-01T18:00:00.000Z");
    const consents = state.fake!.tables.consent.filter((c) => c.source === "live_reminder");
    expect(consents).toHaveLength(2);
    expect(consents.every((c) => c.channel === "WHATSAPP" && c.purpose === "MARKETING" && c.granted === true)).toBe(true);
    // Les inscrits portent l'étiquette du direct (segment de la campagne).
    const tag = campaigns[0].segment as { kind: string; tag: string };
    expect(tag.kind).toBe("tag");
    expect(state.fake!.tables.customer.filter((c) => (c.tags as string[]).includes(tag.tag))).toHaveLength(2);
  });

  it("numéro invalide : refusé", async () => {
    expect((await requestLiveReminder(undefined, remind({ phone: "12" }))).ok).toBe(false);
  });

  it("direct d'une autre boutique : refusé", async () => {
    expect((await requestLiveReminder(undefined, remind({ eventId: "live_BBBB1" }))).ok).toBe(false);
  });
});

describe("notifications push : audience et consentement (§19)", () => {
  it("le sujet transactionnel ne voit que les abonnements actifs de la boutique", async () => {
    const rows = await audience(A, { topic: "orders" });
    expect(rows.map((r) => r.id).sort()).toEqual(["sub_A1", "sub_A2"]); // sub_A3 révoqué, sub_B1 d'une autre boutique
  });

  it("le sujet marketing exige un client au consentement PUSH accordé", async () => {
    const rows = await audience(A, { topic: "marketing" });
    expect(rows.map((r) => r.id)).toEqual(["sub_A1"]);
  });

  it("un retrait de consentement postérieur l'emporte", async () => {
    state.fake!.tables.consent.push({ id: "cons_A2", customerId: "cust_A1", channel: "PUSH", purpose: "MARKETING", granted: false, source: "storefront", createdAt: new Date("2026-10-10") });
    expect(await audience(A, { topic: "marketing" })).toHaveLength(0);
  });
});

describe("notifications push : campagnes (§19)", () => {
  const campaign = (o: Record<string, string> = {}) => fd({ storeId: A, title: "Nouveautés", body: "3 modèles viennent d'arriver.", topic: "marketing", ...o });

  it("crée une campagne push sans crédit WhatsApp et met l'envoi en file", async () => {
    const r = await sendPushCampaign(undefined, campaign());
    expect(r.ok).toBe(true);
    const row = state.fake!.tables.campaign[0];
    expect(row.channel).toBe("push");
    expect(row.creditsUsed).toBe(0);
    expect(row.recipients).toBe(1);
    expect(state.jobs).toHaveLength(1);
    expect(state.jobs[0].type).toBe("push.send");
    expect(state.jobs[0].storeId).toBe(A);
    expect(state.jobs[0].payload.subscriptionIds).toEqual(["sub_A1"]);
  });

  it("plan sans push : refusé, aucune campagne", async () => {
    state.planId = "STARTER";
    const r = await sendPushCampaign(undefined, campaign());
    expect(r.ok).toBe(false);
    expect(state.fake!.tables.campaign).toHaveLength(0);
    expect(state.jobs).toHaveLength(0);
  });

  it("plafond mensuel atteint : refusé", async () => {
    // Plan Scale : 20 000 par mois. Un envoi déjà journalisé épuise le quota.
    state.fake!.tables.notification.push({ id: "notif_1", storeId: A, channel: "push", status: "SENT", recipient: "push:marketing", template: "push.marketing", createdAt: new Date(), payload: { sent: 20_000 } });
    const before = await planPushState(A);
    expect(before.used).toBe(20_000);
    expect(before.remaining).toBe(0);
    const r = await sendPushCampaign(undefined, campaign());
    expect(r.ok).toBe(false);
    expect(state.jobs).toHaveLength(0);
  });

  it("agir sur une autre boutique : refusé", async () => {
    expect((await sendPushCampaign(undefined, campaign({ storeId: B }))).ok).toBe(false);
  });

  it("les envois d'une boutique ne comptent pas dans le quota d'une autre", async () => {
    state.fake!.tables.notification.push({ id: "notif_2", storeId: B, channel: "push", status: "SENT", recipient: "push:marketing", template: "push.marketing", createdAt: new Date(), payload: { sent: 500 } });
    expect((await planPushState(A)).used).toBe(0);
  });
});

describe("abonnement depuis la boutique (§19)", () => {
  // Mineur n° 10 : le point de terminaison doit appartenir à un service de push de navigateur
  // (liste blanche `isAllowedPushEndpoint`), sinon le worker d'envoi deviendrait une SSRF aveugle.
  const sub = (o: Record<string, unknown> = {}) => ({ slug: "boutique-a", endpoint: "https://fcm.googleapis.com/fcm/send/new", ...KEYS, topics: ["orders", "marketing"] as ("orders" | "marketing")[], ...o });

  it("visiteur sans compte : le sujet marketing est retiré (consentement impossible)", async () => {
    const r = await subscribeToPush(sub());
    expect(r.ok).toBe(true);
    expect(r.ok && r.data?.topics).toEqual(["orders"]);
    const row = state.fake!.tables.pushSubscription.find((s) => s.endpoint === "https://fcm.googleapis.com/fcm/send/new")!;
    expect(row.topics).toEqual(["orders"]);
    expect(row.storeId).toBe(A);
  });

  it("client connecté : marketing accepté et consentement PUSH journalisé", async () => {
    state.buyer = { customerId: "cust_A2" };
    const r = await subscribeToPush(sub({ endpoint: "https://fcm.googleapis.com/fcm/send/new2" }));
    expect(r.ok).toBe(true);
    expect(r.ok && r.data?.topics).toEqual(["orders", "marketing"]);
    expect(state.fake!.tables.consent.some((c) => c.customerId === "cust_A2" && c.channel === "PUSH" && c.granted === true)).toBe(true);
  });

  it("clés d'abonnement invalides : refusé", async () => {
    expect((await subscribeToPush(sub({ p256dh: "AAAA" }))).ok).toBe(false);
    expect((await subscribeToPush(sub({ auth: "AAAA" }))).ok).toBe(false);
    expect((await subscribeToPush(sub({ endpoint: "http://push.example.net/x" }))).ok).toBe(false);
  });

  it("boutique inconnue ou plan sans push : refusé", async () => {
    expect((await subscribeToPush(sub({ slug: "inconnue" }))).ok).toBe(false);
    const sub0 = state.fake!.tables.subscription.find((s) => s.storeId === A)!;
    sub0.planId = "STARTER";
    expect((await subscribeToPush(sub())).ok).toBe(false);
  });

  it("désabonnement : la ligne est révoquée et le consentement retiré", async () => {
    const r = await unsubscribeFromPush({ slug: "boutique-a", endpoint: "https://push.example.net/a1" });
    expect(r.ok).toBe(true);
    const row = state.fake!.tables.pushSubscription.find((s) => s.id === "sub_A1")!;
    expect(row.revokedAt).toBeInstanceOf(Date);
    expect(row.topics).toEqual([]);
    expect(state.fake!.tables.consent.some((c) => c.customerId === "cust_A1" && c.channel === "PUSH" && c.granted === false)).toBe(true);
  });

  it("l'abonnement d'une autre boutique n'est pas touché", async () => {
    const r = await unsubscribeFromPush({ slug: "boutique-a", endpoint: "https://push.example.net/b1" });
    expect(r.ok).toBe(true); // réponse indistincte
    expect(state.fake!.tables.pushSubscription.find((s) => s.id === "sub_B1")!.revokedAt).toBeNull();
  });
});

describe("boutique installable : réglages (§14)", () => {
  const settings = (o: Record<string, string> = {}) => fd({ storeId: A, enabled: "on", prompt: "on", icon192: "/media/i192.png", icon512: "/media/i512.png", ...o });

  it("enregistre les réglages contrôlés", async () => {
    const r = await savePwaSettings(undefined, settings({ shortName: "Boutique A" }));
    expect(r.ok).toBe(true);
    const cfg = state.fake!.tables.store.find((s) => s.id === A)!.pwaConfig as Record<string, unknown>;
    expect(cfg.enabled).toBe(true);
    expect(cfg.icon192).toBe("/media/i192.png");
    expect(cfg.shortName).toBe("Boutique A");
  });

  it("nom court trop long : message en français", async () => {
    const r = await savePwaSettings(undefined, settings({ shortName: "Boutique A trop longue" }));
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.fieldErrors?.shortName?.[0]).toBe("12 caractères maximum");
  });

  it("activation sans icône : refusée (la boutique ne serait pas installable)", async () => {
    const r = await savePwaSettings(undefined, settings({ icon192: "", icon512: "" }));
    expect(r.ok).toBe(false);
    expect(state.fake!.tables.store.find((s) => s.id === A)!.pwaConfig).toBeNull();
  });

  it("icône en data-URL : rejetée par la liste blanche", async () => {
    const r = await savePwaSettings(undefined, settings({ icon192: "data:image/png;base64,AAAA" }));
    expect(r.ok).toBe(false);
  });

  it("plan Gratuit : refusé ; autre boutique : refusé", async () => {
    state.planId = "FREE";
    expect((await savePwaSettings(undefined, settings())).ok).toBe(false);
    state.planId = "SCALE";
    expect((await savePwaSettings(undefined, settings({ storeId: B }))).ok).toBe(false);
  });
});
