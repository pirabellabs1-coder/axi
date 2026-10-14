import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";

/* eslint-disable @typescript-eslint/no-explicit-any */

vi.mock("server-only", () => ({}));

// Base simulée minimale : uniquement ce qu'utilisent la route et le module coexistence.
const state = vi.hoisted(() => ({
  events: new Set<string>(),
  messages: [] as any[],
  conversations: [] as any[],
  customers: [] as any[],
  integration: { storeId: "store_1", kind: "whatsapp_cloud", status: "active", phoneNumberId: "123456789", config: { mode: "coexistence" } as any },
  recordInbound: vi.fn(),
}));

vi.mock("@/lib/db", async () => {
  const { Prisma } = await import("@prisma/client");
  let seq = 0;
  const tx: any = {
    providerEvent: {
      create: async ({ data }: any) => {
        const k = `${data.provider}:${data.eventId}`;
        if (state.events.has(k)) throw new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" });
        state.events.add(k);
        return data;
      },
      deleteMany: async ({ where }: any) => {
        state.events.delete(`${where.provider}:${where.eventId}`);
        return { count: 1 };
      },
    },
    integration: {
      findUnique: async ({ where }: any) => {
        if (where.phoneNumberId) return where.phoneNumberId === state.integration.phoneNumberId ? state.integration : null;
        return where.storeId_kind?.storeId === state.integration.storeId ? state.integration : null;
      },
      update: async ({ data }: any) => Object.assign(state.integration, data),
    },
    message: {
      findFirst: async ({ where }: any) => state.messages.find((m) => m.providerRef === where.providerRef) ?? null,
      create: async ({ data }: any) => {
        const m = { id: `m${++seq}`, ...data };
        state.messages.push(m);
        return m;
      },
    },
    customer: {
      findUnique: async ({ where }: any) => state.customers.find((c) => c.storeId === where.storeId_phone.storeId && c.phone === where.storeId_phone.phone) ?? null,
      create: async ({ data }: any) => {
        const c = { id: `c${++seq}`, ...data };
        state.customers.push(c);
        return c;
      },
      update: async ({ where, data }: any) => Object.assign(state.customers.find((c) => c.id === where.id), data),
    },
    conversation: {
      upsert: async ({ where, create, update }: any) => {
        const k = where.storeId_phone_channel;
        let c = state.conversations.find((x) => x.storeId === k.storeId && x.phone === k.phone);
        if (c) Object.assign(c, update);
        else {
          c = { id: `conv${++seq}`, unreadCount: 0, channel: "whatsapp", ...create };
          state.conversations.push(c);
        }
        return c;
      },
      update: async ({ where, data }: any) => Object.assign(state.conversations.find((c) => c.id === where.id), data),
      updateMany: async ({ where, data }: any) => {
        const hits = state.conversations.filter((c) => c.storeId === where.storeId && c.phone === where.phone && where.name.in.includes(c.name));
        hits.forEach((c) => Object.assign(c, data));
        return { count: hits.length };
      },
    },
  };
  return { db: { ...tx, $transaction: async (fn: any) => fn(tx) } };
});

vi.mock("@/lib/inbox/service", () => ({
  previewOf: (b: string) => b.slice(0, 120),
  recordInboundMessage: state.recordInbound,
  recordOutboundStatus: vi.fn(async () => ({ updated: true })),
}));
vi.mock("@/lib/social/whatsapp-order", () => ({ catalogOrderSummary: () => "[Commande]", handleCatalogOrderMessage: vi.fn() }));

const SECRET = "webhook-secret-for-tests";
process.env.WHATSAPP_APP_SECRET = SECRET;

import { POST } from "@/app/api/webhooks/whatsapp/route";

const CUSTOMER = "22997000000";
const BUSINESS = "22901670000";

function signed(field: string, value: Record<string, unknown>) {
  const raw = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: "987654321", changes: [{ field, value: { messaging_product: "whatsapp", metadata: { phone_number_id: "123456789", display_phone_number: BUSINESS }, ...value } }] }],
  });
  const sig = `sha256=${createHmac("sha256", SECRET).update(raw).digest("hex")}`;
  return new Request("http://localhost/api/webhooks/whatsapp", { method: "POST", body: raw, headers: { "x-hub-signature-256": sig, "content-type": "application/json" } });
}

beforeEach(() => {
  state.events.clear();
  state.messages.length = 0;
  state.conversations.length = 0;
  state.customers.length = 0;
  state.integration.config = { mode: "coexistence" };
  state.recordInbound.mockReset();
});

describe("webhook — smb_message_echoes", () => {
  const echo = { from: BUSINESS, to: CUSTOMER, id: "wamid.ECHO1", timestamp: "1760400000", type: "text", text: { body: "Bonjour, votre commande est prête" } };

  it("enregistre le message envoyé depuis le téléphone comme SORTANT, sans crédit ni renvoi", async () => {
    const res = await POST(signed("smb_message_echoes", { message_echoes: [echo] }));
    expect(res.status).toBe(200);
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({ direction: "OUTBOUND", status: "SENT", providerRef: "wamid.ECHO1", body: "Bonjour, votre commande est prête" });
    expect(state.messages[0].createdAt).toEqual(new Date(1760400000 * 1000));
    expect(state.conversations[0]).toMatchObject({ phone: CUSTOMER, unreadCount: 0 });
    // Pas de message entrant, pas de notification (aucune table notification simulée : un appel lèverait).
    expect(state.recordInbound).not.toHaveBeenCalled();
  });

  it("est idempotent (même id Meta renvoyé)", async () => {
    await POST(signed("smb_message_echoes", { message_echoes: [echo] }));
    const again = await POST(signed("smb_message_echoes", { message_echoes: [echo] }));
    expect(again.status).toBe(200);
    expect(state.messages).toHaveLength(1);
  });

  it("ignore un écho sans destinataire valide", async () => {
    const res = await POST(signed("smb_message_echoes", { message_echoes: [{ ...echo, to: "abc" }] }));
    expect(res.status).toBe(200);
    expect(state.messages).toHaveLength(0);
  });
});

describe("webhook — history", () => {
  it("importe l'historique (entrant/sortant) sans incrémenter les non-lus, idempotent, réponse 200", async () => {
    const payload = {
      history: [
        {
          metadata: { phase: 0, chunk_order: 1, progress: 100 },
          threads: [
            {
              id: CUSTOMER,
              messages: [
                { from: CUSTOMER, id: "wamid.H1", timestamp: "1750000000", type: "text", text: { body: "Vous avez la robe en M ?" } },
                { from: BUSINESS, to: CUSTOMER, id: "wamid.H2", timestamp: "1750000100", type: "text", text: { body: "Oui !" } },
              ],
            },
          ],
        },
      ],
    };
    expect((await POST(signed("history", payload))).status).toBe(200);
    expect((await POST(signed("history", payload))).status).toBe(200);
    expect(state.messages.map((m) => [m.providerRef, m.direction])).toEqual([
      ["wamid.H1", "INBOUND"],
      ["wamid.H2", "OUTBOUND"],
    ]);
    expect(state.conversations[0].unreadCount).toBe(0);
  });

  it("refus de partage de l'historique : 200 et échec tracé dans la config", async () => {
    const res = await POST(signed("history", { history: [{ errors: [{ code: 2593109, title: "History sync declined" }] }] }));
    expect(res.status).toBe(200);
    expect(state.integration.config.coexistence.historySync).toMatch(/^failed:History sync declined/);
  });

  it("charge utile inattendue : 200 sans erreur", async () => {
    expect((await POST(signed("history", { history: "n'importe quoi" as unknown as never }))).status).toBe(200);
  });
});

describe("webhook — audit M1/M2/F3/F4", () => {
  const lot = (ids: string[], thread = CUSTOMER) => ({ history: [{ threads: [{ id: thread, messages: ids.map((id) => ({ from: thread, id, timestamp: "1750000000", type: "text", text: { body: id } })) }] }] });

  it("M1 : deux traitements concurrents du même lot d'historique ⇒ un seul message", async () => {
    const [a, b] = await Promise.all([POST(signed("history", lot(["wamid.C1"]))), POST(signed("history", lot(["wamid.C1"])))]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(state.messages.filter((m) => m.providerRef === "wamid.C1")).toHaveLength(1);
    expect(state.events.has("whatsapp:hist:wamid.C1")).toBe(true);
  });

  it("M2 : au plus 500 messages traités par change, réponse 200", async () => {
    const ids = Array.from({ length: 520 }, (_, i) => `wamid.B${i}`);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const res = await POST(signed("history", lot(ids)));
    expect(res.status).toBe(200);
    expect(state.messages).toHaveLength(500);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("20 message(s) ignoré(s)"));
  });

  it("M2 : au plus 200 fils par lot", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const threads = Array.from({ length: 205 }, (_, i) => ({ id: `2299700${String(i).padStart(4, "0")}`, messages: [{ from: "x", id: `wamid.T${i}`, timestamp: "1750000000", type: "text", text: { body: "x" } }] }));
    expect((await POST(signed("history", { history: [{ threads }] }))).status).toBe(200);
    expect(state.messages).toHaveLength(200);
  });

  it("F3 : un horodatage dans le futur est borné à maintenant + 5 min", async () => {
    const future = String(Math.floor(Date.now() / 1000) + 365 * 86400);
    await POST(signed("smb_message_echoes", { message_echoes: [{ to: CUSTOMER, id: "wamid.F", timestamp: future, type: "text", text: { body: "x" } }] }));
    expect(state.messages[0].createdAt.getTime()).toBeLessThanOrEqual(Date.now() + 5 * 60_000);
  });

  it("F4 : champs non-chaîne / non-tableau ⇒ 200, jamais d'exception", async () => {
    const res1 = await POST(signed("messages", { messages: [{ id: 42, from: { x: 1 }, text: { body: 7 } }], contacts: "x", statuses: { id: 1 } }));
    expect(res1.status).toBe(200);
    expect(state.recordInbound).not.toHaveBeenCalled();
    const res2 = await POST(signed("smb_message_echoes", { message_echoes: [{ id: "wamid.G", to: CUSTOMER, type: 5, text: { body: 9 }, timestamp: { a: 1 } }] }));
    expect(res2.status).toBe(200);
    expect(state.messages[0]).toMatchObject({ providerRef: "wamid.G", body: "[Message non pris en charge]" });
    const res3 = await POST(signed("smb_app_state_sync", { state_sync: [{ type: "contact", action: "add", contact: { full_name: 3, phone_number: 229 } }] }));
    expect(res3.status).toBe(200);
  });
});

describe("webhook — smb_app_state_sync", () => {
  it("crée le client depuis le carnet de l'app et renomme la conversation provisoire", async () => {
    state.conversations.push({ id: "convX", storeId: "store_1", phone: CUSTOMER, name: `+${CUSTOMER}`, channel: "whatsapp", unreadCount: 0 });
    const res = await POST(
      signed("smb_app_state_sync", { state_sync: [{ type: "contact", action: "add", contact: { full_name: "Awa Dossou", first_name: "Awa", phone_number: CUSTOMER } }] }),
    );
    expect(res.status).toBe(200);
    expect(state.customers).toEqual([expect.objectContaining({ storeId: "store_1", phone: CUSTOMER, name: "Awa Dossou" })]);
    expect(state.conversations[0].name).toBe("Awa Dossou");
  });

  it("ne remplace pas un nom déjà saisi et ignore les suppressions", async () => {
    state.customers.push({ id: "c1", storeId: "store_1", phone: CUSTOMER, name: "Awa (cliente fidèle)" });
    const res = await POST(
      signed("smb_app_state_sync", {
        state_sync: [
          { type: "contact", action: "add", contact: { full_name: "Awa D.", phone_number: CUSTOMER } },
          { type: "contact", action: "remove", contact: { phone_number: CUSTOMER } },
        ],
      }),
    );
    expect(res.status).toBe(200);
    expect(state.customers).toHaveLength(1);
    expect(state.customers[0].name).toBe("Awa (cliente fidèle)");
  });
});

describe("webhook — sécurité", () => {
  it("refuse une signature invalide", async () => {
    const req = signed("smb_message_echoes", { message_echoes: [] });
    const bad = new Request(req.url, { method: "POST", body: await req.text(), headers: { "x-hub-signature-256": "sha256=00" } });
    expect((await POST(bad)).status).toBe(401);
  });
});
