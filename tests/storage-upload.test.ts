import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { make, pad, SAMPLES } from "./helpers/images";

/**
 * Contrôle d'accès et règles du téléversement (POST /api/stores/{storeId}/media) et service des fichiers
 * (/media/[...key]) avec le pilote local réel dans un dossier temporaire.
 */
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {} }));

type Role = "OWNER" | "MANAGER" | "STAFF" | "SUPPORT";
const state = vi.hoisted(() => ({
  user: { id: "user_1", emailVerified: true } as { id: string; emailVerified: boolean } | null,
  role: "OWNER" as Role | null,
  storeStatus: "PUBLISHED",
  planId: "FREE",
  usedKb: 0,
  addOns: 0,
  rateOk: true,
  increments: [] as { storeId: string; kb: number }[],
  releases: [] as { storeId: string; kb: number }[],
  requireCalls: [] as { storeId: string; cap: string }[],
}));

vi.mock("@/lib/auth/permissions", () => {
  class AuthError extends Error {
    constructor(
      message = "Accès refusé",
      public code: "UNAUTHENTICATED" | "FORBIDDEN" = "FORBIDDEN",
    ) {
      super(message);
    }
  }
  const CAPS: Record<string, string[]> = {
    OWNER: ["products.manage", "theme.manage"],
    MANAGER: ["products.manage", "theme.manage"],
    STAFF: ["orders.manage"],
    SUPPORT: ["store.view"],
  };
  return {
    AuthError,
    requireStore: async (storeId: string, cap: string) => {
      state.requireCalls.push({ storeId, cap });
      if (!state.user) throw new AuthError("Connexion requise", "UNAUTHENTICATED");
      if (!state.role || storeId !== "storeaaaa0001") throw new AuthError("Boutique introuvable ou accès refusé");
      if (!CAPS[state.role].includes(cap)) throw new AuthError("Votre rôle ne permet pas cette action");
      if (state.storeStatus === "SUSPENDED") throw new AuthError("Boutique suspendue : contactez le support");
      return { user: state.user, store: { id: storeId, status: state.storeStatus }, role: state.role, planId: state.planId };
    },
  };
});
vi.mock("@/lib/addons/service", () => ({ activeAddOnQuantity: async () => state.addOns }));
// Réplique de l'UPDATE conditionnel de usage.ts (réservation atomique en Kio).
vi.mock("@/lib/storage/usage", () => ({
  reserveMediaQuota: async (storeId: string, kb: number, quotaBytes: number | null) => {
    if (quotaBytes != null && state.usedKb + kb > Math.floor(quotaBytes / 1024)) return false;
    state.usedKb += kb;
    state.increments.push({ storeId, kb });
    return true;
  },
  releaseMediaQuota: async (storeId: string, kb: number) => {
    state.usedKb = Math.max(0, state.usedKb - kb);
    state.releases.push({ storeId, kb });
  },
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimitAll: async () => (state.rateOk ? { ok: true, retryAfter: 0 } : { ok: false, retryAfter: 120 }),
  rateLimitMessage: () => "Trop de tentatives. Réessayez dans 2 minutes.",
}));

let dir = "";
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "axi-upload-"));
  vi.stubEnv("STORAGE_DRIVER", "local");
  vi.stubEnv("STORAGE_LOCAL_DIR", dir);
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});
beforeEach(() => {
  Object.assign(state, { user: { id: "user_1", emailVerified: true }, role: "OWNER", storeStatus: "PUBLISHED", planId: "FREE", usedKb: 0, addOns: 0, rateOk: true, increments: [], releases: [], requireCalls: [] });
});

const { uploadStoreImage, UploadError, PURPOSE_CAPABILITY } = await import("@/lib/storage/upload");
const { POST } = await import("@/app/api/stores/[storeId]/media/route");
const { GET } = await import("@/app/media/[...key]/route");

const STORE = "storeaaaa0001";
const upload = (over: Partial<{ storeId: string; purpose: unknown; body: Uint8Array }> = {}) => {
  const readBody = vi.fn(async () => over.body ?? SAMPLES.jpeg);
  return { readBody, run: uploadStoreImage({ storeId: over.storeId ?? STORE, purpose: over.purpose ?? "product", readBody }) };
};
const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof UploadError ? `${e.status}:${e.code}` : String(e);
  }
};

describe("téléversement : contrôle d'accès", () => {
  it("capacité exigée selon l'usage : produit/collection → products.manage, thème → theme.manage", async () => {
    expect(PURPOSE_CAPABILITY).toEqual({ product: "products.manage", collection: "products.manage", theme: "theme.manage" });
    await upload({ purpose: "theme" }).run;
    expect(state.requireCalls.at(-1)).toEqual({ storeId: STORE, cap: "theme.manage" });
  });

  it("anonyme → 401, sans jamais lire le corps", async () => {
    state.user = null;
    const u = upload();
    expect(await codeOf(u.run)).toBe("401:unauthenticated");
    expect(u.readBody).not.toHaveBeenCalled();
  });

  it("non-membre ou autre boutique → 403", async () => {
    state.role = null;
    expect(await codeOf(upload().run)).toBe("403:forbidden");
    state.role = "OWNER";
    expect(await codeOf(upload({ storeId: "storebbbb0002" }).run)).toBe("403:forbidden");
  });

  it("rôle sans la capacité (STAFF, SUPPORT) → 403 ; boutique suspendue → 403", async () => {
    for (const role of ["STAFF", "SUPPORT"] as const) {
      state.role = role;
      expect(await codeOf(upload().run)).toBe("403:forbidden");
    }
    state.role = "MANAGER";
    state.storeStatus = "SUSPENDED";
    expect(await codeOf(upload().run)).toBe("403:forbidden");
  });

  it("identifiant de boutique ou usage invalides → 400 avant toute vérification", async () => {
    expect(await codeOf(upload({ storeId: "../../etc" }).run)).toBe("400:invalid_request");
    expect(await codeOf(upload({ purpose: "avatar" }).run)).toBe("400:invalid_request");
    expect(state.requireCalls).toHaveLength(0);
  });

  it("débit dépassé → 429 avec délai", async () => {
    state.rateOk = false;
    const u = upload();
    const err = await u.run.catch((e) => e);
    expect(err).toMatchObject({ status: 429, code: "rate_limited", retryAfter: 120 });
    expect(u.readBody).not.toHaveBeenCalled();
  });
});

describe("téléversement : contenu, quota, dédoublonnage", () => {
  it("SVG / HTML refusés (415), fichier vide (400)", async () => {
    expect(await codeOf(upload({ body: pad('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 80) }).run)).toBe("415:unsupported_type");
    expect(await codeOf(upload({ body: pad("<html><body>x</body></html>", 40) }).run)).toBe("415:unsupported_type");
    expect(await codeOf(upload({ body: new Uint8Array(0) }).run)).toBe("400:empty");
  });

  it("au-delà de 5 Mo → 413", async () => {
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set(SAMPLES.jpeg);
    expect(await codeOf(upload({ body: big }).run)).toBe("413:too_large");
  });

  it("enregistre, renvoie l'URL /media et compte l'usage en Kio ; un doublon n'est ni réécrit ni recompté", async () => {
    const body = pad(SAMPLES.png, 3000);
    const first = await upload({ body }).run;
    expect(first.url).toMatch(/^\/media\/stores\/storeaaaa0001\/\d{4}\/\d{2}\/[a-f0-9]{64}\.png$/);
    expect(first).toMatchObject({ deduplicated: false, bytes: 3000, mime: "image/png" });
    expect(state.increments).toEqual([{ storeId: STORE, kb: 3 }]);

    const second = await upload({ body }).run;
    expect(second).toMatchObject({ url: first.url, deduplicated: true });
    expect(state.increments).toHaveLength(1);
  });

  it("quota du plan atteint → 413 avec message d'upsell ; l'option Stockage +10 Go le relève", async () => {
    state.usedKb = 100 * 1024; // 100 Mo = quota FREE
    const body = pad(SAMPLES.webp, 2048);
    const err = await upload({ body }).run.catch((e) => e);
    expect(err).toMatchObject({ status: 413, code: "quota_exceeded" });
    expect(err.message).toContain("/abonnement");
    state.addOns = 1;
    expect((await upload({ body }).run).deduplicated).toBe(false);
  });
});

const req = (url: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
  new Request(`http://localhost:3000${url}`, { ...init, headers: { host: "localhost:3000", origin: "http://localhost:3000", "sec-fetch-site": "same-origin", ...init.headers } });

describe("téléversement : dimensions et remboursement du quota", () => {
  it("dimensions excessives ou illisibles → 422, rien n'est réservé", async () => {
    expect(await codeOf(upload({ body: make.png(8001, 10) }).run)).toBe("422:invalid_dimensions");
    expect(await codeOf(upload({ body: make.jpeg(7000, 7000) }).run)).toBe("422:invalid_dimensions"); // 49 Mpx
    expect(await codeOf(upload({ body: make.png(0, 0) }).run)).toBe("422:invalid_dimensions");
    expect(state.increments).toHaveLength(0);
  });

  it("réservation remboursée si l'écriture échoue (503)", async () => {
    const { LocalDriver } = await import("@/lib/storage/drivers");
    const put = vi.spyOn(LocalDriver.prototype, "put").mockRejectedValueOnce(new Error("disque plein"));
    const body = pad(SAMPLES.avif, 4096);
    expect(await codeOf(upload({ body }).run)).toBe("503:storage_unavailable");
    expect(state.increments).toEqual([{ storeId: STORE, kb: 4 }]);
    expect(state.releases).toEqual([{ storeId: STORE, kb: 4 }]);
    expect(state.usedKb).toBe(0);
    put.mockRestore();
  });
});

describe("route POST /api/stores/{storeId}/media", () => {
  const params = Promise.resolve({ storeId: STORE });

  it("refuse les requêtes d'une autre origine (403) et les types non image / SVG (415)", async () => {
    const cross = await POST(req(`/api/stores/${STORE}/media?purpose=product`, { method: "POST", body: SAMPLES.jpeg, headers: { "content-type": "image/jpeg", origin: "https://evil.example", "sec-fetch-site": "cross-site" } }), { params });
    expect(cross.status).toBe(403);
    expect((await cross.json()).error.code).toBe("forbidden");
    const svg = await POST(req(`/api/stores/${STORE}/media?purpose=product`, { method: "POST", body: "<svg/>", headers: { "content-type": "image/svg+xml" } }), { params });
    expect(svg.status).toBe(415);
    const text = await POST(req(`/api/stores/${STORE}/media?purpose=product`, { method: "POST", body: "x", headers: { "content-type": "text/plain" } }), { params });
    expect(text.status).toBe(415);
    // L'en-tête Host (contrôlé par le client) n'est jamais la référence : seule compte l'hôte de NEXT_PUBLIC_APP_URL.
    const spoofed = await POST(req(`/api/stores/${STORE}/media?purpose=product`, { method: "POST", body: SAMPLES.jpeg, headers: { "content-type": "image/jpeg", host: "evil.example", origin: "https://evil.example", "sec-fetch-site": "same-origin" } }), { params });
    expect(spoofed.status).toBe(403);
  });

  it("201 puis le fichier est servi par /media avec les bons en-têtes", async () => {
    const body = pad(SAMPLES.gif, 512);
    const res = await POST(req(`/api/stores/${STORE}/media?purpose=collection`, { method: "POST", body, headers: { "content-type": "image/png" } }), { params });
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const json = (await res.json()) as { url: string };
    expect(json.url).toMatch(/\.gif$/); // format réel (octets), pas le type annoncé

    const segments = json.url.replace("/media/", "").split("/");
    const media = await GET(new Request(`http://localhost:3000${json.url}`), { params: Promise.resolve({ key: segments }) });
    expect(media.status).toBe(200);
    expect(media.headers.get("content-type")).toBe("image/gif");
    expect(media.headers.get("x-content-type-options")).toBe("nosniff");
    expect(media.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(media.headers.get("content-security-policy")).toContain("sandbox");
    expect(new Uint8Array(await media.arrayBuffer())).toEqual(body);

    const etag = media.headers.get("etag")!;
    const cached = await GET(new Request(`http://localhost:3000${json.url}`, { headers: { "if-none-match": etag } }), { params: Promise.resolve({ key: segments }) });
    expect(cached.status).toBe(304);
  });

  it("/media : traversée de chemin, clé inconnue ou extension non image → 404", async () => {
    for (const key of [["..", "..", ".env"], ["stores", "..", "..", "package.json"], ["stores", STORE, "2026", "10", `${"a".repeat(64)}.svg`], ["stores", STORE, "2026", "10", `${"a".repeat(64)}.png`]]) {
      const r = await GET(new Request("http://localhost:3000/media/x"), { params: Promise.resolve({ key }) });
      expect(r.status).toBe(404);
    }
  });
});
