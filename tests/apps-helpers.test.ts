import { describe, expect, it } from "vitest";
import {
  APP_CATEGORIES,
  effectiveGrantedScopes,
  formatAppPrice,
  isAppCategory,
  precheckInstall,
  validateRequestedScopes,
} from "@/lib/apps/types";
import { planScopes } from "@/lib/mcp/scopes";

const NN = " "; // espace fine insécable : séparateur de milliers (XOF)
const NB = " "; // espace insécable avant l'unité FCFA

describe("formatAppPrice", () => {
  it("affiche « Gratuit » pour FREE ou un montant nul", () => {
    expect(formatAppPrice("FREE", 0)).toBe("Gratuit");
    expect(formatAppPrice("SUBSCRIPTION", 0, "month")).toBe("Gratuit");
  });

  it("formate un abonnement mensuel / annuel", () => {
    expect(formatAppPrice("SUBSCRIPTION", 5000, "month")).toBe(`5${NN}000${NB}FCFA / mois`);
    expect(formatAppPrice("SUBSCRIPTION", 60000, "year")).toBe(`60${NN}000${NB}FCFA / an`);
  });

  it("ajoute la période d'essai en suffixe", () => {
    expect(formatAppPrice("SUBSCRIPTION", 5000, "month", 7)).toBe(`5${NN}000${NB}FCFA / mois · 7 j d'essai`);
  });

  it("formate un achat unique", () => {
    expect(formatAppPrice("ONE_TIME", 2000)).toBe(`2${NN}000${NB}FCFA`);
  });
});

describe("validateRequestedScopes", () => {
  it("accepte un sous-ensemble de SCOPES non vide", () => {
    expect(validateRequestedScopes(["catalog:read", "orders:read"])).toBe(true);
  });

  it("refuse une liste vide ou un scope inconnu", () => {
    expect(validateRequestedScopes([])).toBe(false);
    expect(validateRequestedScopes(["catalog:read", "nimportequoi"])).toBe(false);
  });
});

describe("effectiveGrantedScopes = intersection bornée par le plan", () => {
  it("retient uniquement les scopes demandés ET autorisés par le plan", () => {
    const requested = ["catalog:read", "webhooks:write", "orders:read"];
    // Plan Gratuit : lecture seule → webhooks:write est retiré.
    const free = effectiveGrantedScopes(requested, planScopes("FREE"));
    expect(free).toEqual(["catalog:read", "orders:read"]);
    expect(free).not.toContain("webhooks:write");

    // Plan Business : tout autorisé → les trois sont accordés.
    const business = effectiveGrantedScopes(requested, planScopes("BUSINESS"));
    expect(business).toContain("webhooks:write");
    expect(business).toEqual(["catalog:read", "orders:read", "webhooks:write"]);
  });

  it("résultat ordonné canoniquement et sans scope inconnu", () => {
    expect(effectiveGrantedScopes(["inconnu", "orders:read"], planScopes("BUSINESS"))).toEqual(["orders:read"]);
  });
});

describe("precheckInstall", () => {
  it("refuse une seconde installation ACTIVE", () => {
    const pre = precheckInstall("ACTIVE", ["catalog:read"], planScopes("BUSINESS"));
    expect(pre.ok).toBe(false);
    if (!pre.ok) expect(pre.reason).toBe("already_installed");
  });

  it("autorise l'installation (grantedScopes = intersection) si aucune install ACTIVE", () => {
    const pre = precheckInstall(null, ["catalog:read", "webhooks:write"], planScopes("FREE"));
    expect(pre.ok).toBe(true);
    if (pre.ok) expect(pre.grantedScopes).toEqual(["catalog:read"]);
  });

  it("réinstallation après désinstallation (statut UNINSTALLED) autorisée", () => {
    const pre = precheckInstall("UNINSTALLED", ["orders:read"], planScopes("STARTER"));
    expect(pre.ok).toBe(true);
    if (pre.ok) expect(pre.grantedScopes).toEqual(["orders:read"]);
  });
});

describe("catégories", () => {
  it("expose 9 catégories avec libellés et un garde de type", () => {
    expect(APP_CATEGORIES).toHaveLength(9);
    expect(isAppCategory("ia")).toBe(true);
    expect(isAppCategory("inexistante")).toBe(false);
  });
});
