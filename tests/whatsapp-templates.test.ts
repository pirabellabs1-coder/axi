import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
// templates.ts importe @/lib/db (via loadWabaCreds) : on le neutralise, les tests n'utilisent que les fonctions Graph pures.
vi.mock("@/lib/db", () => ({ db: {} }));

import { listTemplates, createTemplate, deleteTemplate, phoneHealth, TemplateError, type WabaCreds } from "@/lib/whatsapp/templates";

const CREDS: WabaCreds = { token: "EAAtok-secret", wabaId: "987654321", phoneNumberId: "123456789" };

type Call = { url: string; init?: RequestInit };

/** fetch simulé : enregistre les appels et renvoie une réponse JSON fixée (par défaut 200). */
function mockFetch(body: unknown, status = 200): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: typeof input === "string" ? input : input.toString(), init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fetch: fn, calls };
}

describe("listTemplates", () => {
  it("normalise la liste des modèles", async () => {
    const { fetch, calls } = mockFetch({
      data: [
        { id: "1", name: "confirmation_commande", status: "APPROVED", category: "UTILITY", language: "fr" },
        { name: "promo_wax", status: "PENDING", category: "MARKETING", language: "fr" },
      ],
    });
    const res = await listTemplates(CREDS, fetch);
    expect(res).toHaveLength(2);
    expect(res[0]).toEqual({ id: "1", name: "confirmation_commande", status: "APPROVED", category: "UTILITY", language: "fr" });
    expect(res[1].id).toBeNull();
    expect(calls[0].url).toContain(`/${CREDS.wabaId}/message_templates`);
    expect(new Headers(calls[0].init?.headers).get("authorization")).toBe("Bearer EAAtok-secret");
  });
  it("renvoie une liste vide si Meta ne renvoie pas de data", async () => {
    const { fetch } = mockFetch({});
    expect(await listTemplates(CREDS, fetch)).toEqual([]);
  });
});

describe("createTemplate", () => {
  it("construit les composants en-tête/corps/pied et renvoie l'id + statut", async () => {
    const { fetch, calls } = mockFetch({ id: "55", status: "PENDING" });
    const res = await createTemplate(
      CREDS,
      { name: "confirmation_commande", category: "UTILITY", language: "fr", body: "Bonjour {{1}}", headerText: "Votre commande", footer: "Maison Kairos" },
      fetch,
    );
    expect(res).toEqual({ id: "55", status: "PENDING" });
    const sent = JSON.parse(String(calls[0].init?.body));
    expect(sent.name).toBe("confirmation_commande");
    expect(sent.category).toBe("UTILITY");
    expect(sent.language).toBe("fr");
    expect(sent.components).toEqual([
      { type: "HEADER", format: "TEXT", text: "Votre commande" },
      { type: "BODY", text: "Bonjour {{1}}" },
      { type: "FOOTER", text: "Maison Kairos" },
    ]);
  });
  it("n'inclut que le corps quand en-tête et pied sont absents", async () => {
    const { fetch, calls } = mockFetch({ id: "1", status: "PENDING" });
    await createTemplate(CREDS, { name: "suivi", category: "UTILITY", language: "fr", body: "Votre colis est en route" }, fetch);
    const sent = JSON.parse(String(calls[0].init?.body));
    expect(sent.components).toEqual([{ type: "BODY", text: "Votre colis est en route" }]);
  });
  it("rejette un nom invalide et un corps vide sans appeler Meta", async () => {
    const { fetch, calls } = mockFetch({ id: "1" });
    await expect(createTemplate(CREDS, { name: "Mauvais Nom", category: "UTILITY", language: "fr", body: "x" }, fetch)).rejects.toBeInstanceOf(TemplateError);
    await expect(createTemplate(CREDS, { name: "ok", category: "UTILITY", language: "fr", body: "   " }, fetch)).rejects.toBeInstanceOf(TemplateError);
    expect((fetch as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    void calls;
  });
  it("remonte l'erreur Meta sans divulguer le jeton", async () => {
    const { fetch } = mockFetch({ error: { message: "Template name already exists" } }, 400);
    const err = await createTemplate(CREDS, { name: "doublon", category: "UTILITY", language: "fr", body: "x" }, fetch).catch((e) => e);
    expect(err).toBeInstanceOf(TemplateError);
    expect(err.message).toContain("Template name already exists");
    expect(err.message).not.toContain(CREDS.token);
  });
});

describe("deleteTemplate", () => {
  it("appelle DELETE avec le nom en paramètre", async () => {
    const { fetch, calls } = mockFetch({ success: true });
    await deleteTemplate(CREDS, "promo_wax", fetch);
    expect(calls[0].init?.method).toBe("DELETE");
    expect(calls[0].url).toContain("name=promo_wax");
  });
  it("rejette un nom invalide", async () => {
    const { fetch } = mockFetch({ success: true });
    await expect(deleteTemplate(CREDS, "Nom Invalide", fetch)).rejects.toBeInstanceOf(TemplateError);
  });
});

describe("phoneHealth", () => {
  it("mappe les champs de santé du numéro", async () => {
    const { fetch, calls } = mockFetch({
      display_phone_number: "+229 01 67 00 00 00",
      verified_name: "Maison Kairos",
      quality_rating: "GREEN",
      name_status: "APPROVED",
      code_verification_status: "VERIFIED",
      platform_type: "CLOUD_API",
    });
    const h = await phoneHealth(CREDS, fetch);
    expect(h.displayPhoneNumber).toBe("+229 01 67 00 00 00");
    expect(h.verifiedName).toBe("Maison Kairos");
    expect(h.qualityRating).toBe("GREEN");
    expect(calls[0].url).toContain(`/${CREDS.phoneNumberId}?fields=`);
  });
  it("renvoie null pour les champs absents", async () => {
    const { fetch } = mockFetch({ display_phone_number: "+229 00" });
    const h = await phoneHealth(CREDS, fetch);
    expect(h.verifiedName).toBeNull();
    expect(h.qualityRating).toBeNull();
  });
});
