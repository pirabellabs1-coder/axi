import { describe, expect, it } from "vitest";
import { COMPARISON, PLANS, PLAN_ORDER, getAddOn } from "@/config/plans";
import { CAPABILITY_GROUPS, CHANNELS } from "@/lib/marketing/positioning";

/**
 * Non-régression de l'audit produit : les pages publiques ne doivent pas annoncer comme « Bientôt » une
 * fonctionnalité livrée, ni la placer dans un mauvais forfait par rapport au droit vérifié côté serveur.
 */
describe("cohérence marketing ↔ droits réels", () => {
  const caps = CAPABILITY_GROUPS.flatMap((g) => g.items);

  it("la caisse en magasin n'est plus « Bientôt » et suit le premier forfait qui l'autorise (posDevices > 0)", () => {
    const pos = caps.find((c) => c.title === "Caisse en magasin");
    expect(pos).toBeDefined();
    expect(pos!.soon).toBeFalsy();
    const firstAllowed = PLAN_ORDER.find((p) => PLANS[p].limits.posDevices !== 0);
    expect(pos!.plan).toBe(firstAllowed);
  });

  it("la grille tarifaire « Caisse en magasin » reflète limits.posDevices", () => {
    const row = COMPARISON.flatMap((g) => g.rows).find((r) => r.label === "Caisse en magasin");
    expect(row).toBeDefined();
    for (const p of PLAN_ORDER) {
      const v = PLANS[p].limits.posDevices;
      const cell = row!.values[p];
      if (v === 0) expect(cell).toBe(false);
      else if (v == null) expect(cell).toBe("Illimité");
      else expect(String(cell)).toContain(String(v));
    }
  });

  it("la boutique multilingue n'est plus « Bientôt » (au moins 2 langues dès son forfait)", () => {
    const ml = caps.find((c) => c.title === "Boutique multilingue");
    expect(ml?.soon).toBeFalsy();
    const langs = PLANS[ml!.plan].limits.languages;
    expect(langs == null || langs >= 2).toBe(true);
  });

  it("aucun canal n'annonce la caisse comme à venir", () => {
    expect(CHANNELS.some((c) => /bient[oô]t/i.test(c.text) && /caisse/i.test(c.text))).toBe(false);
  });

  it("le pack IA ne promet pas les réponses automatiques (fonctionnalité non livrée)", () => {
    expect(getAddOn("PACK_AI_1000")?.description ?? "").not.toMatch(/réponses automatiques/i);
  });
});
