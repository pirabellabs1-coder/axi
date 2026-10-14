import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

import { runEmbeddedSignup, partnerModeConfig, isPartnerModeConfigured, EmbeddedSignupError } from "@/lib/whatsapp/embedded-signup";

const PHONE = "123456789";
const WABA = "987654321";
const SECRET = "super-secret-app-value-xyz";

type Handler = { match: (url: string) => boolean; status?: number; body: unknown };

/** fetch simulé : route par sous-chaîne d'URL ; lève si aucun gestionnaire ne correspond (appel inattendu). */
function mockFetch(handlers: Handler[]): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    const h = handlers.find((x) => x.match(url));
    if (!h) throw new Error(`Appel Graph inattendu : ${url}`);
    return new Response(JSON.stringify(h.body), { status: h.status ?? 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

const okHandlers = (): Handler[] => [
  { match: (u) => u.includes("/oauth/access_token"), body: { access_token: "EAAtest-token", token_type: "bearer" } },
  { match: (u) => u.includes(`/${PHONE}?fields=`), body: { display_phone_number: "+229 01 67 00 00 00", verified_name: "Maison Kairos" } },
  { match: (u) => u.includes(`/${WABA}/subscribed_apps`), body: { success: true } },
  { match: (u) => u.includes(`/${PHONE}/register`), body: { success: true } },
];

beforeEach(() => {
  process.env.NEXT_PUBLIC_META_APP_ID = "111222333";
  process.env.NEXT_PUBLIC_META_ESIGNUP_CONFIG_ID = "444555666";
  process.env.WHATSAPP_APP_SECRET = SECRET;
  delete process.env.META_APP_SECRET;
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_META_APP_ID;
  delete process.env.NEXT_PUBLIC_META_ESIGNUP_CONFIG_ID;
  delete process.env.WHATSAPP_APP_SECRET;
  delete process.env.META_APP_SECRET;
  vi.restoreAllMocks();
});

describe("partnerModeConfig", () => {
  it("renvoie la config quand App ID et config Embedded Signup sont définis", () => {
    expect(partnerModeConfig()).toEqual({ appId: "111222333", configId: "444555666" });
    expect(isPartnerModeConfigured()).toBe(true);
  });
  it("renvoie null si une variable manque", () => {
    delete process.env.NEXT_PUBLIC_META_ESIGNUP_CONFIG_ID;
    expect(partnerModeConfig()).toBeNull();
    expect(isPartnerModeConfigured()).toBe(false);
  });
  it("renvoie null si un identifiant n'est pas numérique", () => {
    process.env.NEXT_PUBLIC_META_APP_ID = "pas-un-nombre";
    expect(partnerModeConfig()).toBeNull();
  });
});

describe("runEmbeddedSignup", () => {
  it("déroule le flux complet et renvoie jeton, PIN à 6 chiffres et infos du numéro", async () => {
    const fetchImpl = mockFetch(okHandlers());
    const res = await runEmbeddedSignup({ code: "auth-code-xyz", phoneNumberId: PHONE, wabaId: WABA }, fetchImpl);
    expect(res.token).toBe("EAAtest-token");
    expect(res.pin).toMatch(/^\d{6}$/);
    expect(res.phoneNumberId).toBe(PHONE);
    expect(res.wabaId).toBe(WABA);
    expect(res.displayPhoneNumber).toBe("+229 01 67 00 00 00");
    expect(res.verifiedName).toBe("Maison Kairos");
    // 4 appels Graph : échange, lecture numéro, abonnement, enregistrement.
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(4);
  });

  it("transmet le jeton business en Bearer sur les appels authentifiés", async () => {
    const seen: Record<string, string | null> = {};
    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const auth = new Headers(init?.headers).get("authorization");
      if (url.includes(`/${WABA}/subscribed_apps`)) seen.subscribe = auth;
      if (url.includes(`/${PHONE}/register`)) seen.register = auth;
      const h = okHandlers().find((x) => x.match(url))!;
      return new Response(JSON.stringify(h.body), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    await runEmbeddedSignup({ code: "c", phoneNumberId: PHONE, wabaId: WABA }, fetchImpl);
    expect(seen.subscribe).toBe("Bearer EAAtest-token");
    expect(seen.register).toBe("Bearer EAAtest-token");
  });

  it("rejette les identifiants invalides sans appeler Meta", async () => {
    const fetchImpl = mockFetch(okHandlers());
    await expect(runEmbeddedSignup({ code: "c", phoneNumberId: "abc", wabaId: WABA }, fetchImpl)).rejects.toBeInstanceOf(EmbeddedSignupError);
    await expect(runEmbeddedSignup({ code: "c", phoneNumberId: PHONE, wabaId: "xyz" }, fetchImpl)).rejects.toBeInstanceOf(EmbeddedSignupError);
    await expect(runEmbeddedSignup({ code: "   ", phoneNumberId: PHONE, wabaId: WABA }, fetchImpl)).rejects.toBeInstanceOf(EmbeddedSignupError);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("remonte l'erreur Meta de l'échange de code SANS divulguer le secret de l'application", async () => {
    const fetchImpl = mockFetch([
      { match: (u) => u.includes("/oauth/access_token"), status: 400, body: { error: { message: "Invalid verification code format" } } },
    ]);
    const err = await runEmbeddedSignup({ code: "mauvais", phoneNumberId: PHONE, wabaId: WABA }, fetchImpl).catch((e) => e);
    expect(err).toBeInstanceOf(EmbeddedSignupError);
    expect(err.message).toContain("Invalid verification code format");
    expect(err.message).not.toContain(SECRET);
  });

  it("échoue si l'abonnement de la WABA échoue", async () => {
    const fetchImpl = mockFetch([
      { match: (u) => u.includes("/oauth/access_token"), body: { access_token: "t" } },
      { match: (u) => u.includes(`/${PHONE}?fields=`), body: { display_phone_number: "x" } },
      { match: (u) => u.includes(`/${WABA}/subscribed_apps`), status: 403, body: { error: { message: "Application does not have permission" } } },
    ]);
    await expect(runEmbeddedSignup({ code: "c", phoneNumberId: PHONE, wabaId: WABA }, fetchImpl)).rejects.toThrow(/permission/);
  });

  it("tolère un numéro déjà enregistré", async () => {
    const h = okHandlers();
    h[3] = { match: (u) => u.includes(`/${PHONE}/register`), status: 400, body: { error: { message: "Phone number already registered", code: 133016 } } };
    const res = await runEmbeddedSignup({ code: "c", phoneNumberId: PHONE, wabaId: WABA }, mockFetch(h));
    expect(res.token).toBe("EAAtest-token");
  });

  it("échoue sur une autre erreur d'enregistrement", async () => {
    const h = okHandlers();
    h[3] = { match: (u) => u.includes(`/${PHONE}/register`), status: 400, body: { error: { message: "Two-step verification pin mismatch" } } };
    await expect(runEmbeddedSignup({ code: "c", phoneNumberId: PHONE, wabaId: WABA }, mockFetch(h))).rejects.toThrow(/pin mismatch/);
  });

  it("échoue si Meta ne renvoie pas de jeton", async () => {
    const fetchImpl = mockFetch([{ match: (u) => u.includes("/oauth/access_token"), body: { token_type: "bearer" } }]);
    await expect(runEmbeddedSignup({ code: "c", phoneNumberId: PHONE, wabaId: WABA }, fetchImpl)).rejects.toThrow(/jeton/);
  });

  it("échoue clairement si le mode partenaire n'est pas configuré", async () => {
    delete process.env.NEXT_PUBLIC_META_APP_ID;
    await expect(runEmbeddedSignup({ code: "c", phoneNumberId: PHONE, wabaId: WABA }, mockFetch(okHandlers()))).rejects.toThrow(/non configuré/);
  });
});

describe("runEmbeddedSignup — numéro non renvoyé par la fenêtre Meta", () => {
  const listHandler = (ids: string[]): Handler => ({ match: (u) => u.includes(`/${WABA}/phone_numbers`), body: { data: ids.map((id) => ({ id })) } });

  it("retrouve l'unique numéro du compte WABA", async () => {
    const res = await runEmbeddedSignup({ code: "c", phoneNumberId: "", wabaId: WABA }, mockFetch([listHandler([PHONE]), ...okHandlers()]));
    expect(res.phoneNumberId).toBe(PHONE);
  });

  it("échoue clairement si le compte n'a aucun numéro", async () => {
    await expect(runEmbeddedSignup({ code: "c", wabaId: WABA }, mockFetch([listHandler([]), ...okHandlers()]))).rejects.toThrow(/Aucun numéro/);
  });

  it("échoue clairement si le compte a plusieurs numéros", async () => {
    await expect(runEmbeddedSignup({ code: "c", phoneNumberId: null, wabaId: WABA }, mockFetch([listHandler([PHONE, "555666777"]), ...okHandlers()]))).rejects.toThrow(/plusieurs numéros/);
  });
});
