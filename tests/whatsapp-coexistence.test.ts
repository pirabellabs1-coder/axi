import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

import { runEmbeddedSignup, requestCoexistenceSyncs } from "@/lib/whatsapp/embedded-signup";
import { buildLoginExtras, parseEsignupMessage } from "@/lib/whatsapp/embedded-signup-prefill";

const PHONE = "123456789";
const WABA = "987654321";

type Call = { url: string; method: string; body: string | null; auth: string | null };
type Handler = { match: (url: string, method: string) => boolean; status?: number; body: unknown };

function mockFetch(handlers: Handler[]) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: typeof init?.body === "string" ? init.body : null, auth: new Headers(init?.headers).get("authorization") });
    const h = handlers.find((x) => x.match(url, method));
    if (!h) throw new Error(`Appel Graph inattendu : ${method} ${url}`);
    return new Response(JSON.stringify(h.body), { status: h.status ?? 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const coexHandlers = (): Handler[] => [
  { match: (u) => u.includes("/oauth/access_token"), body: { access_token: "EAAcoex" } },
  { match: (u) => u.includes(`/${WABA}/phone_numbers`), body: { data: [{ id: PHONE }] } },
  { match: (u) => u.includes(`/${PHONE}?fields=display_phone_number`), body: { display_phone_number: "+229 01 67 00 00 00", verified_name: "Maison Kairos" } },
  { match: (u) => u.includes(`/${PHONE}?fields=is_on_biz_app`), body: { is_on_biz_app: true, platform_type: "CLOUD_API" } },
  { match: (u) => u.includes(`/${WABA}/subscribed_apps`), body: { success: true } },
];

beforeEach(() => {
  process.env.NEXT_PUBLIC_META_APP_ID = "111222333";
  process.env.NEXT_PUBLIC_META_ESIGNUP_CONFIG_ID = "444555666";
  process.env.WHATSAPP_APP_SECRET = "super-secret-app-value-xyz";
});
afterEach(() => {
  delete process.env.NEXT_PUBLIC_META_APP_ID;
  delete process.env.NEXT_PUBLIC_META_ESIGNUP_CONFIG_ID;
  delete process.env.WHATSAPP_APP_SECRET;
  vi.restoreAllMocks();
});

describe("runEmbeddedSignup — coexistence", () => {
  it("n'appelle PAS /register, ne génère pas de PIN et lit is_on_biz_app / platform_type", async () => {
    const { fetchImpl, calls } = mockFetch(coexHandlers());
    const res = await runEmbeddedSignup({ code: "c", phoneNumberId: PHONE, wabaId: WABA, mode: "coexistence" }, fetchImpl);
    expect(calls.some((c) => c.url.includes("/register"))).toBe(false);
    expect(res.pin).toBeNull();
    expect(res.mode).toBe("coexistence");
    expect(res.bizApp).toEqual({ isOnBizApp: true, platformType: "CLOUD_API" });
    expect(calls.some((c) => c.url.includes(`/${WABA}/subscribed_apps`) && c.method === "POST")).toBe(true);
  });

  it("FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING sans phone_number_id : le serveur résout le numéro de la WABA", async () => {
    const session = parseEsignupMessage({ type: "WA_EMBEDDED_SIGNUP", event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING", data: { waba_id: WABA } });
    expect(session).toEqual({ phoneNumberId: undefined, wabaId: WABA });
    const { fetchImpl, calls } = mockFetch(coexHandlers());
    const res = await runEmbeddedSignup({ code: "c", phoneNumberId: session!.phoneNumberId ?? "", wabaId: session!.wabaId!, mode: "coexistence" }, fetchImpl);
    expect(res.phoneNumberId).toBe(PHONE);
    expect(calls.some((c) => c.url.includes(`/${WABA}/phone_numbers`))).toBe(true);
  });

  it("une lecture is_on_biz_app en échec ne bloque pas la connexion", async () => {
    const h = coexHandlers();
    h[3] = { match: (u) => u.includes("fields=is_on_biz_app"), status: 400, body: { error: { message: "Unknown field" } } };
    const res = await runEmbeddedSignup({ code: "c", phoneNumberId: PHONE, wabaId: WABA, mode: "coexistence" }, mockFetch(h).fetchImpl);
    expect(res.bizApp).toBeNull();
    expect(res.token).toBe("EAAcoex");
  });

  it("le flux standard appelle toujours /register avec un PIN", async () => {
    const h = [...coexHandlers(), { match: (u: string) => u.includes(`/${PHONE}/register`), body: { success: true } }];
    const { fetchImpl, calls } = mockFetch(h);
    const res = await runEmbeddedSignup({ code: "c", phoneNumberId: PHONE, wabaId: WABA }, fetchImpl);
    expect(res.mode).toBe("standard");
    expect(res.pin).toMatch(/^\d{6}$/);
    expect(calls.some((c) => c.url.includes("/register"))).toBe(true);
    expect(calls.some((c) => c.url.includes("is_on_biz_app"))).toBe(false);
  });
});

describe("requestCoexistenceSyncs", () => {
  const smb: Handler = { match: (u, m) => u.includes(`/${PHONE}/smb_app_data`) && m === "POST", body: { success: true } };

  it("demande les contacts PUIS l'historique, avec les bons corps et le jeton en Bearer", async () => {
    const { fetchImpl, calls } = mockFetch([smb]);
    const res = await requestCoexistenceSyncs(PHONE, "EAAcoex", null, fetchImpl);
    expect(res.contactsSync).toBe("requested");
    expect(res.historySync).toBe("requested");
    expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[0].body!)).toEqual({ messaging_product: "whatsapp", sync_type: "smb_app_state_sync" });
    expect(JSON.parse(calls[1].body!)).toEqual({ messaging_product: "whatsapp", sync_type: "history" });
    expect(calls.every((c) => c.auth === "Bearer EAAcoex")).toBe(true);
  });

  it("un échec de synchro est non bloquant et tracé", async () => {
    const { fetchImpl } = mockFetch([
      { match: (u) => u.includes("smb_app_data"), status: 400, body: { error: { message: "Sync window expired" } } },
    ]);
    const res = await requestCoexistenceSyncs(PHONE, "EAAcoex", null, fetchImpl);
    expect(res.contactsSync).toMatch(/^failed:.*Sync window expired/);
    expect(res.historySync).toMatch(/^failed:/);
    expect(typeof res.at).toBe("string");
  });

  it("ne redemande pas une synchro déjà demandée (une seule fois par type)", async () => {
    const { fetchImpl, calls } = mockFetch([smb]);
    const res = await requestCoexistenceSyncs(PHONE, "t", { contactsSync: "requested", historySync: "failed:x" }, fetchImpl);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0].body!).sync_type).toBe("history");
    expect(res).toMatchObject({ contactsSync: "requested", historySync: "requested" });
  });
});

describe("options FB.login", () => {
  it("coexistence : featureType whatsapp_business_app_onboarding, setup conservé", () => {
    const setup = { business: { name: "Kairos" } } as never;
    expect(buildLoginExtras(setup, "coexistence")).toEqual({ setup, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3", version: "v4" });
    expect(buildLoginExtras(setup, "standard").featureType).toBe("");
  });

  it("parseEsignupMessage ignore les messages étrangers et gère annulation / erreur", () => {
    expect(parseEsignupMessage({ type: "OTHER" })).toBeNull();
    expect(parseEsignupMessage("pas du json")).toBeNull();
    expect(parseEsignupMessage(JSON.stringify({ type: "WA_EMBEDDED_SIGNUP", event: "FINISH", data: { phone_number_id: PHONE, waba_id: WABA } }))).toEqual({ phoneNumberId: PHONE, wabaId: WABA });
    expect(parseEsignupMessage({ type: "WA_EMBEDDED_SIGNUP", event: "CANCEL", data: { current_step: "PHONE_NUMBER_SETUP" } })).toEqual({ step: "PHONE_NUMBER_SETUP" });
    expect(parseEsignupMessage({ type: "WA_EMBEDDED_SIGNUP", event: "ERROR", data: { error_message: "boom" } })).toEqual({ error: "boom" });
  });
});
