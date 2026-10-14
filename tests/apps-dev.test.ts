import { describe, it, expect, vi } from "vitest";

// tokens.ts (importé par dev-logic pour isAllowedRedirectUri) est `server-only`.
vi.mock("server-only", () => ({}));

import { createAppSchema, updateAppSchema, isAppOwner, canEditApp, canSubmitApp, APP_SLUG_RE } from "@/lib/apps/dev-logic";
import { reviewOutcome } from "@/lib/apps/admin-logic";

const validCreate = {
  slug: "mon-app",
  name: "Mon application",
  category: "ia",
  requestedScopes: ["catalog:read"],
  pricingType: "FREE",
  redirectUris: "https://exemple.com/oauth/callback",
};

describe("createAppSchema — slug", () => {
  it("accepte un slug en minuscules, chiffres et tirets", () => {
    expect(APP_SLUG_RE.test("mon-app-2")).toBe(true);
    const r = createAppSchema.safeParse(validCreate);
    expect(r.success).toBe(true);
  });

  it("refuse un slug avec majuscules, espaces ou tiret en bord", () => {
    for (const slug of ["mon app", "mon_app", "-mon", "mon-", "ab", "mon--app"]) {
      expect(createAppSchema.safeParse({ ...validCreate, slug }).success).toBe(false);
    }
  });

  it("normalise le slug en minuscules", () => {
    const r = createAppSchema.safeParse({ ...validCreate, slug: "MON-APP" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.slug).toBe("mon-app");
  });
});

describe("createAppSchema — scopes", () => {
  it("refuse une liste de scopes vide", () => {
    expect(createAppSchema.safeParse({ ...validCreate, requestedScopes: [] }).success).toBe(false);
  });

  it("refuse un scope inconnu", () => {
    expect(createAppSchema.safeParse({ ...validCreate, requestedScopes: ["catalog:read", "nimportequoi"] }).success).toBe(false);
  });

  it("accepte plusieurs scopes connus (case unique → tableau)", () => {
    const r = createAppSchema.safeParse({ ...validCreate, requestedScopes: ["catalog:read", "orders:read"] });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.requestedScopes).toEqual(["catalog:read", "orders:read"]);
  });
});

describe("createAppSchema — URI de redirection et tarif", () => {
  it("refuse une adresse de redirection non https/localhost", () => {
    expect(createAppSchema.safeParse({ ...validCreate, redirectUris: "http://exemple.com/cb" }).success).toBe(false);
  });

  it("accepte plusieurs URI (une par ligne)", () => {
    const r = createAppSchema.safeParse({ ...validCreate, redirectUris: "https://a.com/cb\nhttp://localhost:3000/cb" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.redirectUris).toHaveLength(2);
  });

  it("exige une période pour un abonnement et un montant > 0 pour une app payante", () => {
    expect(createAppSchema.safeParse({ ...validCreate, pricingType: "SUBSCRIPTION", priceAmount: 5000 }).success).toBe(false); // sans intervalle
    expect(createAppSchema.safeParse({ ...validCreate, pricingType: "ONE_TIME", priceAmount: 0 }).success).toBe(false); // montant nul
    expect(createAppSchema.safeParse({ ...validCreate, pricingType: "SUBSCRIPTION", priceAmount: 5000, priceInterval: "month" }).success).toBe(true);
  });
});

describe("updateAppSchema", () => {
  it("valide sans slug et re-valide les scopes", () => {
    const { slug: _slug, ...noSlug } = validCreate;
    void _slug;
    expect(updateAppSchema.safeParse(noSlug).success).toBe(true);
    expect(updateAppSchema.safeParse({ ...noSlug, requestedScopes: [] }).success).toBe(false);
  });
});

describe("isolation par développeur", () => {
  it("un développeur n'est propriétaire que de ses propres apps", () => {
    expect(isAppOwner({ developerUserId: "u1" }, "u1")).toBe(true);
    expect(isAppOwner({ developerUserId: "u1" }, "u2")).toBe(false);
    // App first-party (developerUserId null) : jamais possédée par un développeur.
    expect(isAppOwner({ developerUserId: null }, "u1")).toBe(false);
  });
});

describe("transitions de statut — développeur", () => {
  it("modification autorisée en brouillon et publiée, pas en revue ni suspendue", () => {
    expect(canEditApp("DRAFT")).toBe(true);
    expect(canEditApp("PUBLISHED")).toBe(true);
    expect(canEditApp("IN_REVIEW")).toBe(false);
    expect(canEditApp("SUSPENDED")).toBe(false);
  });

  it("soumission à la revue seulement depuis un brouillon", () => {
    expect(canSubmitApp("DRAFT")).toBe(true);
    expect(canSubmitApp("IN_REVIEW")).toBe(false);
    expect(canSubmitApp("PUBLISHED")).toBe(false);
  });
});

describe("transitions de statut — revue admin", () => {
  it("publish : IN_REVIEW → PUBLISHED + listée", () => {
    expect(reviewOutcome("publish", "IN_REVIEW")).toEqual({ status: "PUBLISHED", listed: true });
    expect(reviewOutcome("publish", "DRAFT")).toBeNull();
  });

  it("reject : IN_REVIEW → DRAFT, non listée", () => {
    expect(reviewOutcome("reject", "IN_REVIEW")).toEqual({ status: "DRAFT", listed: false });
    expect(reviewOutcome("reject", "PUBLISHED")).toBeNull();
  });

  it("suspend : PUBLISHED ou IN_REVIEW → SUSPENDED, délistée", () => {
    expect(reviewOutcome("suspend", "PUBLISHED")).toEqual({ status: "SUSPENDED", listed: false });
    expect(reviewOutcome("suspend", "IN_REVIEW")).toEqual({ status: "SUSPENDED", listed: false });
    expect(reviewOutcome("suspend", "DRAFT")).toBeNull();
  });
});
