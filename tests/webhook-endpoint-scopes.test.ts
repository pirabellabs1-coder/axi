import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb } from "./helpers/fake-db";

/**
 * S1 : `include_personal_data` sur un point de webhook expose nom, téléphone, e-mail et adresse du client.
 * Un appel programmatique (jeton API, MCP) doit donc porter la portée `customers:read` EN PLUS de
 * `webhooks:write` — sinon un jeton « webhooks » contournerait le masquage appliqué partout ailleurs
 * dans l'API. Le tableau de bord (session) reste régi par le rôle du membre.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
const state = vi.hoisted(() => ({ fake: null as any }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.fake.db;
  },
}));
vi.mock("@/lib/jobs", () => ({ enqueue: vi.fn(async () => ({})), queueNotification: vi.fn(async () => ({})) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => ({})) }));
// Pas de résolution DNS dans les tests : la protection SSRF est testée par tests/webhook-ssrf.test.ts.
vi.mock("@/lib/webhooks/ssrf", () => ({
  checkWebhookUrl: () => ({ ok: true }),
  resolveWebhookTarget: async () => ({ ok: true, addresses: ["93.184.216.34"] }),
}));

process.env.APP_SECRET = "test-secret-0123456789-0123456789-abcdef";

import { createEndpoint, WebhookError, type WebhookActor } from "@/lib/webhooks/service";

const S = "store_wh1";

function seed() {
  state.fake = createFakeDb({
    store: [{ id: S, name: "Boutique", status: "PUBLISHED" }],
    subscription: [{ id: "sub_1", storeId: S, planId: "SCALE", status: "ACTIVE", trialEndsAt: null, currentPeriodEnd: new Date("2030-01-01") }],
    webhookEndpoint: [],
    membership: [],
    job: [],
  });
}

const actor = (over: Partial<WebhookActor> = {}): WebhookActor => ({
  storeId: S,
  planId: "SCALE",
  role: "OWNER",
  userId: "user_1",
  label: "Jeton API",
  via: "api",
  scopes: ["webhooks:write"],
  ...over,
});

const input = { url: "https://hooks.exemple.com/axi", events: ["order.created"], includePersonalData: true };

beforeEach(seed);

describe("création d'un point de webhook avec données personnelles", () => {
  it("jeton webhooks:write SANS customers:read : refusé (403), aucun point créé", async () => {
    await expect(createEndpoint(actor(), input)).rejects.toThrow(WebhookError);
    await expect(createEndpoint(actor(), input)).rejects.toMatchObject({ code: "forbidden" });
    expect(state.fake.tables.webhookEndpoint).toHaveLength(0);
  });

  it("jeton avec customers:read : accepté", async () => {
    const { endpoint, secret } = await createEndpoint(actor({ scopes: ["webhooks:write", "customers:read"] }), input);
    expect(endpoint.includePersonalData).toBe(true);
    expect(secret.startsWith("whsec_")).toBe(true);
    expect(state.fake.tables.webhookEndpoint).toHaveLength(1);
  });

  it("MCP sans portée : refusé ; sans données personnelles : accepté quelle que soit la portée", async () => {
    await expect(createEndpoint(actor({ via: "mcp", scopes: ["webhooks:write"] }), input)).rejects.toMatchObject({ code: "forbidden" });
    const ok = await createEndpoint(actor(), { ...input, includePersonalData: false });
    expect(ok.endpoint.includePersonalData).toBe(false);
  });

  it("tableau de bord (session) : régi par le rôle, pas par les portées", async () => {
    const ok = await createEndpoint(actor({ via: "dashboard", scopes: null }), input);
    expect(ok.endpoint.includePersonalData).toBe(true);
    // Rôle sans customers.view : refusé (règle antérieure, toujours en place).
    await expect(createEndpoint(actor({ via: "dashboard", scopes: null, role: "STAFF" }), input)).rejects.toMatchObject({ code: "forbidden" });
  });
});
