import { describe, expect, it, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";

vi.mock("server-only", () => ({}));

const calls = vi.hoisted(() => ({ process: vi.fn(), findMany: vi.fn(), events: new Set<string>() }));

// Base simulée : seule la route est testée ici (signature, routage, idempotence) ; la réservation est simulée.
vi.mock("@/lib/db", async () => {
  const { Prisma } = await import("@prisma/client");
  return {
    db: {
      socialAccount: { findMany: calls.findMany },
      providerEvent: {
        create: async ({ data }: { data: { provider: string; eventId: string } }) => {
          const k = `${data.provider}:${data.eventId}`;
          if (calls.events.has(k)) throw new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" });
          calls.events.add(k);
          return data;
        },
        deleteMany: async ({ where }: { where: { provider: string; eventId: string } }) => {
          calls.events.delete(`${where.provider}:${where.eventId}`);
          return { count: 1 };
        },
      },
    },
  };
});
vi.mock("@/lib/live/claims", () => ({
  processSocialComment: calls.process,
  sweepLiveClaims: vi.fn(async () => ({ paid: 0, ordered: 0, expired: 0 })),
  deliverClaimMessage: vi.fn(async () => ({ ok: true })),
}));

const { extractSocialComments, matchesSocialObject } = await import("@/lib/meta-social/webhook-payload");
const route = await import("@/app/api/webhooks/meta/route");

const SECRET = "meta-app-secret-for-tests";
const PAGE = "1111111111";
const IG = "17841400000000000";

function fbComment(commentId: string, message: string, from = { id: "999001", name: "Awa K" }) {
  return { object: "page", entry: [{ id: PAGE, time: 1, changes: [{ field: "feed", value: { item: "comment", verb: "add", comment_id: commentId, post_id: `${PAGE}_555`, from, message, created_time: 1 } }] }] };
}

function signed(body: unknown, secret = SECRET) {
  const raw = JSON.stringify(body);
  return new Request("http://localhost/api/webhooks/meta", {
    method: "POST",
    headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}` },
    body: raw,
  });
}

beforeEach(() => {
  process.env.META_APP_SECRET = SECRET;
  process.env.META_SOCIAL_VERIFY_TOKEN = "verify-me-123";
  calls.events.clear();
  calls.process.mockReset().mockResolvedValue({ status: "reserved" });
  calls.findMany.mockReset().mockResolvedValue([
    { id: "acc_fb", storeId: "store_A", platform: "FACEBOOK", externalId: PAGE, tokenEncrypted: "x", status: "active" },
    { id: "acc_ig", storeId: "store_B", platform: "INSTAGRAM", externalId: IG, tokenEncrypted: "x", status: "active" },
  ]);
});

describe("extractSocialComments", () => {
  it("Facebook feed : commentaire ajouté retenu ; like, édition, commentaire de la Page ignorés", () => {
    const body = fbComment(`${PAGE}_555_1`, "JP 12");
    (body.entry[0].changes as unknown[]).push(
      { field: "feed", value: { item: "reaction", verb: "add", from: { id: "1" } } },
      { field: "feed", value: { item: "comment", verb: "edited", comment_id: "x_2", from: { id: "999002" }, message: "JP 12" } },
      { field: "feed", value: { item: "comment", verb: "add", comment_id: "x_3", from: { id: PAGE, name: "Ma Page" }, message: "Réservé !" } },
    );
    const out = extractSocialComments(body);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ platform: "FACEBOOK", accountId: PAGE, commentId: `${PAGE}_555_1`, objectId: `${PAGE}_555`, authorId: "999001", authorName: "Awa K", text: "JP 12" });
  });

  it("Instagram comments / live_comments (id ou comment_id) ; propre commentaire du compte ignoré", () => {
    const body = {
      object: "instagram",
      entry: [
        {
          id: IG,
          changes: [
            { field: "live_comments", value: { id: "180001", from: { id: "77", username: "kofi" }, text: "12 x2", media: { id: "1790000001" } } },
            { field: "comments", value: { comment_id: "180002", from: { id: "78", username: "ama" }, text: "jp 14", media: { id: "1790000002" } } },
            { field: "comments", value: { id: "180003", from: { id: IG, username: "boutique" }, text: "Réservé" } },
            { field: "mentions", value: { comment_id: "180004" } },
          ],
        },
      ],
    };
    const out = extractSocialComments(body);
    expect(out.map((c) => [c.commentId, c.authorName, c.objectId, c.field])).toEqual([
      ["180001", "@kofi", "1790000001", "live_comments"],
      ["180002", "@ama", "1790000002", "comments"],
    ]);
  });

  it("charges utiles inattendues : jamais d'exception", () => {
    for (const b of [null, 1, "x", {}, { object: "page" }, { object: "page", entry: "x" }, { object: "page", entry: [{ id: "abc", changes: [{}] }] }]) {
      expect(extractSocialComments(b)).toEqual([]);
    }
  });

  it("liaison aux vidéos : liste vide = tout ; post_id {page}_{id} comparé sur sa partie finale", () => {
    expect(matchesSocialObject("1_2", [])).toBe(true);
    expect(matchesSocialObject(`${PAGE}_555`, ["555"])).toBe(true);
    expect(matchesSocialObject(`${PAGE}_555`, [`${PAGE}_555`])).toBe(true);
    expect(matchesSocialObject(`${PAGE}_556`, ["555"])).toBe(false);
    expect(matchesSocialObject(null, ["555"])).toBe(false);
  });
});

describe("route /api/webhooks/meta", () => {
  it("GET : challenge renvoyé uniquement avec le bon jeton de vérification", async () => {
    const ok = await route.GET(new Request("http://x/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=verify-me-123&hub.challenge=4242"));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("4242");
    const bad = await route.GET(new Request("http://x/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=4242"));
    expect(bad.status).toBe(403);
  });

  it("POST sans signature ou signature invalide : 401, rien n'est traité", async () => {
    const raw = JSON.stringify(fbComment("c1", "JP 12"));
    const none = await route.POST(new Request("http://x", { method: "POST", body: raw }));
    expect(none.status).toBe(401);
    const forged = await route.POST(signed(fbComment("c1", "JP 12"), "autre-secret"));
    expect(forged.status).toBe(401);
    expect(calls.process).not.toHaveBeenCalled();
  });

  it("POST sans secret configuré : 503 (signature non vérifiable)", async () => {
    delete process.env.META_APP_SECRET;
    const prev = process.env.WHATSAPP_APP_SECRET;
    delete process.env.WHATSAPP_APP_SECRET;
    const res = await route.POST(signed(fbComment("c1", "JP 12")));
    expect(res.status).toBe(503);
    if (prev) process.env.WHATSAPP_APP_SECRET = prev;
  });

  it("routage strict vers la boutique propriétaire de la Page ; compte inconnu ignoré", async () => {
    const res = await route.POST(signed(fbComment(`${PAGE}_555_1`, "JP 12")));
    expect(res.status).toBe(200);
    expect(calls.process).toHaveBeenCalledTimes(1);
    expect(calls.process.mock.calls[0][0]).toMatchObject({ storeId: "store_A", account: { id: "acc_fb" }, comment: { commentId: `${PAGE}_555_1` } });

    const unknown = fbComment("c9", "JP 12");
    unknown.entry[0].id = "2222222222";
    await route.POST(signed(unknown));
    expect(calls.process).toHaveBeenCalledTimes(1);
  });

  it("idempotence : un même commentaire renvoyé par Meta n'est traité qu'une fois", async () => {
    await route.POST(signed(fbComment(`${PAGE}_555_7`, "JP 12")));
    await route.POST(signed(fbComment(`${PAGE}_555_7`, "JP 12")));
    expect(calls.process).toHaveBeenCalledTimes(1);
  });

  it("erreur inattendue : 500 et événement libéré (Meta renverra), sans bloquer les autres commentaires", async () => {
    calls.process.mockRejectedValueOnce(new Error("db down")).mockResolvedValue({ status: "reserved" });
    const body = fbComment(`${PAGE}_555_8`, "JP 12");
    (body.entry[0].changes as unknown[]).push({ field: "feed", value: { item: "comment", verb: "add", comment_id: `${PAGE}_555_9`, post_id: `${PAGE}_555`, from: { id: "3" }, message: "JP 14" } });
    const res = await route.POST(signed(body));
    expect(res.status).toBe(500);
    expect(calls.process).toHaveBeenCalledTimes(2);
    // Renvoi : seul le commentaire en échec est retraité.
    await route.POST(signed(body));
    expect(calls.process).toHaveBeenCalledTimes(3);
  });

  it("compte en erreur (jeton révoqué) : commentaire ignoré", async () => {
    calls.findMany.mockResolvedValue([{ id: "acc_fb", storeId: "store_A", platform: "FACEBOOK", externalId: PAGE, tokenEncrypted: "x", status: "error" }]);
    await route.POST(signed(fbComment(`${PAGE}_555_10`, "JP 12")));
    expect(calls.process).not.toHaveBeenCalled();
  });
});
