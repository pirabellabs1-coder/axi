import { describe, expect, it } from "vitest";
import { normalizeCode, parseClaimComment, MAX_QTY_PER_COMMENT } from "@/lib/live/claim-parser";
import { holdLabel, renderClaimMessage, validateClaimTemplate, DEFAULT_CLAIM_MESSAGE } from "@/lib/live/claim-message";

const CODES = ["12", "14", "2", "robe1", "robe2", "a3"];
const p = (t: string) => parseClaimComment(t, CODES);

describe("parseClaimComment : intentions FR / EN", () => {
  it.each([
    ["JE PRENDS 12", "12", 1],
    ["je prends le 12", "12", 1],
    ["Je prend 12 svp", "12", 1],
    ["JP 12", "12", 1],
    ["jp12", "12", 1],
    ["J'prends 12", "12", 1],
    ["je veux le 14", "14", 1],
    ["Moi 14 !!", "14", 1],
    ["pour moi le 12", "12", 1],
    ["I take 12", "12", 1],
    ["I'll take 12 x2", "12", 2],
    ["sold 14", "14", 1],
    ["mine 12", "12", 1],
    ["je réserve le 12", "12", 1],
    ["Je prennnds 12", "12", 1],
    ["je prendd 12", "12", 1],
    ["jp robe 1", "robe1", 1],
    ["JP ROBE1 x3", "robe1", 3],
    ["je prends #12", "12", 1],
    ["je prends le n°12", "12", 1],
  ])("« %s » → %s × %i", (text, code, qty) => {
    expect(p(text)).toEqual({ code, quantity: qty });
  });
});

describe("parseClaimComment : quantités", () => {
  it.each([
    ["12 x2", 2],
    ["12 x 2", 2],
    ["12x2", 2],
    ["12 * 3", 3],
    ["12 × 4", 4],
    ["2x 12", 2],
    ["jp 12 3 pièces", 3],
  ])("« %s » → 12 × %i", (text, qty) => {
    expect(p(text)).toEqual({ code: "12", quantity: qty });
  });

  it("« 2 x 12 » quand 2 et 12 sont des codes : quantité 2 du code 12", () => {
    expect(p("2 x 12")).toEqual({ code: "12", quantity: 2 });
  });

  it("quantité au-delà du plafond par commentaire : rien n'est réservé", () => {
    expect(p(`jp 12 x${MAX_QTY_PER_COMMENT + 1}`)).toBeNull();
  });
});

describe("parseClaimComment : sans intention, le commentaire doit se réduire au code", () => {
  it.each(["12", "#12", "12 svp", "12 x2 merci"])("« %s » réserve", (text) => {
    expect(p(text)?.code).toBe("12");
  });

  it.each(["J'ai 12 ans", "le 12 est dispo ?", "c'est combien le 12", "trop beau", "", "jp 99", "je prends", "robe 3"])("« %s » ne réserve rien", (text) => {
    expect(p(text)).toBeNull();
  });

  it("aucune tolérance aux fautes sur les codes (robe1 ≠ robe2)", () => {
    expect(p("jp robe3")).toBeNull();
    expect(p("jp robe2")).toEqual({ code: "robe2", quantity: 1 });
  });

  it("sans code configuré : jamais de réservation", () => {
    expect(parseClaimComment("je prends 12", [])).toBeNull();
  });

  it("normalise les codes saisis par le marchand", () => {
    expect(normalizeCode(" #Robé-1 ")).toBe("robe1");
  });
});

describe("messages", () => {
  it("message par défaut avec lien, prénom, délai", () => {
    const m = renderClaimMessage(null, { name: "Awa Kossou", product: "Robe wax (M)", quantity: 2, total: "10 000 F CFA", link: "https://axi.africa/l/abc", holdMinutes: 30, store: "Chez Awa" });
    expect(m).toContain("Bonjour Awa !");
    expect(m).toContain("2 × Robe wax (M)");
    expect(m).toContain("30 minutes");
    expect(m.endsWith("https://axi.africa/l/abc")).toBe(true);
  });

  it("modèle sans {lien} refusé (repli sur le texte par défaut)", () => {
    expect(validateClaimTemplate("Merci {nom}")).not.toBeNull();
    const m = renderClaimMessage("Merci {nom}", { name: "@kofi", product: "X", quantity: 1, total: "1", link: "https://x/l/1", holdMinutes: 90, store: "S" });
    expect(m).toContain("https://x/l/1");
    expect(DEFAULT_CLAIM_MESSAGE).toContain("{lien}");
  });

  it("durées lisibles", () => {
    expect(holdLabel(1)).toBe("1 minute");
    expect(holdLabel(90)).toBe("1 h 30");
    expect(holdLabel(1440)).toBe("24 heures");
  });
});
