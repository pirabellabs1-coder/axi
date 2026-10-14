import { describe, it, expect } from "vitest";
import {
  allocateGiftCardTenders,
  canTransitionGiftCard,
  displayGiftCardStatus,
  endOfLocalDay,
  giftCardExpiry,
  giftCardOrderLimitError,
  giftCardUsabilityProblem,
  giftCardValidityDays,
  prorata,
  readGiftCardRecipient,
  sortGiftCardsForTender,
} from "@/lib/giftcards/state";

const now = new Date("2026-10-11T12:00:00Z");
const past = new Date("2026-10-01T00:00:00Z");
const future = new Date("2027-01-01T00:00:00Z");

describe("machine d'états des cartes cadeaux", () => {
  it("ACTIVE → DISABLED toujours permis", () => {
    expect(canTransitionGiftCard("ACTIVE", "DISABLED", { expiresAt: null, now })).toBe(true);
  });
  it("DISABLED → ACTIVE seulement si non expirée", () => {
    expect(canTransitionGiftCard("DISABLED", "ACTIVE", { expiresAt: null, now })).toBe(true);
    expect(canTransitionGiftCard("DISABLED", "ACTIVE", { expiresAt: future, now })).toBe(true);
    expect(canTransitionGiftCard("DISABLED", "ACTIVE", { expiresAt: past, now })).toBe(false);
  });
  it("ACTIVE → EXPIRED seulement si expiresAt ≤ now", () => {
    expect(canTransitionGiftCard("ACTIVE", "EXPIRED", { expiresAt: past, now })).toBe(true);
    expect(canTransitionGiftCard("ACTIVE", "EXPIRED", { expiresAt: future, now })).toBe(false);
    expect(canTransitionGiftCard("ACTIVE", "EXPIRED", { expiresAt: null, now })).toBe(false);
  });
  it("EXPIRED → ACTIVE seulement avec une nouvelle date future", () => {
    expect(canTransitionGiftCard("EXPIRED", "ACTIVE", { expiresAt: past, newExpiresAt: future, now })).toBe(true);
    expect(canTransitionGiftCard("EXPIRED", "ACTIVE", { expiresAt: past, newExpiresAt: past, now })).toBe(false);
    expect(canTransitionGiftCard("EXPIRED", "ACTIVE", { expiresAt: past, now })).toBe(false);
  });
  it("transitions non prévues refusées", () => {
    expect(canTransitionGiftCard("DISABLED", "EXPIRED", { expiresAt: past, now })).toBe(false);
    expect(canTransitionGiftCard("EXPIRED", "DISABLED", { expiresAt: past, now })).toBe(false);
    expect(canTransitionGiftCard("ACTIVE", "ACTIVE", { expiresAt: null, now })).toBe(false);
  });
  it("affichage : épuisée = ACTIVE à 0 ; date passée = expirée avant le job", () => {
    expect(displayGiftCardStatus({ status: "ACTIVE", balance: 0, expiresAt: future }, now)).toBe("EXHAUSTED");
    expect(displayGiftCardStatus({ status: "ACTIVE", balance: 10, expiresAt: past }, now)).toBe("EXPIRED");
    expect(displayGiftCardStatus({ status: "DISABLED", balance: 10, expiresAt: past }, now)).toBe("DISABLED");
    expect(displayGiftCardStatus({ status: "ACTIVE", balance: 10, expiresAt: null }, now)).toBe("ACTIVE");
  });
});

describe("éligibilité au checkout", () => {
  const card = { status: "ACTIVE" as const, balance: 5000, expiresAt: future, currency: "XOF" };
  it("contrôles statut, expiration, devise, solde", () => {
    expect(giftCardUsabilityProblem(card, { currency: "XOF", now })).toBeNull();
    expect(giftCardUsabilityProblem({ ...card, status: "DISABLED" }, { currency: "XOF", now })).toBe("status");
    expect(giftCardUsabilityProblem({ ...card, expiresAt: past }, { currency: "XOF", now })).toBe("expired");
    expect(giftCardUsabilityProblem(card, { currency: "EUR", now })).toBe("currency");
    expect(giftCardUsabilityProblem({ ...card, balance: 0 }, { currency: "XOF", now })).toBe("empty");
  });
});

describe("ordre d'utilisation et répartition", () => {
  const a = { id: "a", balance: 5000, expiresAt: future };
  const b = { id: "b", balance: 3000, expiresAt: new Date("2026-12-01T00:00:00Z") };
  const c = { id: "c", balance: 1000, expiresAt: null };
  const d = { id: "d", balance: 2000, expiresAt: future };
  it("expiration la plus proche, puis plus petit solde, sans date en dernier", () => {
    expect(sortGiftCardsForTender([a, b, c, d]).map((x) => x.id)).toEqual(["b", "d", "a", "c"]);
  });
  it("répartit jusqu'à l'assiette, jamais au-delà du solde", () => {
    const r = allocateGiftCardTenders([a, b, c], 6000);
    expect(r.map((x) => [x.card.id, x.amount, x.remainingAfter])).toEqual([
      ["b", 3000, 0],
      ["a", 3000, 2000],
      ["c", 0, 1000],
    ]);
    expect(allocateGiftCardTenders([a], -5).map((x) => x.amount)).toEqual([0]);
    expect(allocateGiftCardTenders([a, b], 1_000_000).reduce((s, x) => s + x.amount, 0)).toBe(8000);
  });
  it("prorata au plus fort reste : Σ = montant", () => {
    expect(prorata(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(prorata(1, [5, 5])).toEqual([1, 0]);
    expect(prorata(0, [5, 5])).toEqual([0, 0]);
    expect(prorata(7, [0, 0])).toEqual([0, 0]);
    expect(prorata(9999, [3000, 7000, 1]).reduce((s, v) => s + v, 0)).toBe(9999);
  });
});

describe("validité, plafonds, destinataire", () => {
  it("validité : 365 par défaut, minimum 180", () => {
    expect(giftCardValidityDays(null)).toBe(365);
    expect(giftCardValidityDays(30)).toBe(180);
    expect(giftCardValidityDays(400)).toBe(400);
    expect(giftCardExpiry(now, null).getTime() - now.getTime()).toBe(365 * 86_400_000);
  });
  it("plafonds par commande : 5 cartes, 1 000 000 FCFA, valeur 1 000 à 500 000", () => {
    expect(giftCardOrderLimitError([{ unitPrice: 10_000, quantity: 5 }], "XOF")).toBeNull();
    expect(giftCardOrderLimitError([{ unitPrice: 10_000, quantity: 6 }], "XOF")).toMatch(/5 cartes/);
    expect(giftCardOrderLimitError([{ unitPrice: 500_000, quantity: 2 }, { unitPrice: 1_000, quantity: 1 }], "XOF")).toMatch(/trop élevé/);
    expect(giftCardOrderLimitError([{ unitPrice: 999, quantity: 1 }], "XOF")).toMatch(/limites/);
    expect(giftCardOrderLimitError([{ unitPrice: 600_000, quantity: 1 }], "XOF")).toMatch(/limites/);
  });
  it("lecture du destinataire depuis OrderItem.options (objet ou tableau), bornée", () => {
    expect(readGiftCardRecipient({ giftCard: { recipientName: " Awa ", recipientPhone: "+229 01 97 00 00 00", recipientEmail: "A@X.BJ", message: "x".repeat(400) } })).toEqual({
      recipientName: "Awa",
      recipientPhone: "2290197000000",
      recipientEmail: "a@x.bj",
      message: "x".repeat(300),
      sendAt: null,
    });
    expect(readGiftCardRecipient([{ group: "Taille" }, { giftCard: { recipientName: "Koffi" } }]).recipientName).toBe("Koffi");
    expect(readGiftCardRecipient(null)).toEqual({});
  });
  it("fin de journée dans le fuseau de la boutique", () => {
    expect(endOfLocalDay("2026-12-31", "Africa/Porto-Novo")?.toISOString()).toBe("2026-12-31T22:59:59.000Z");
    expect(endOfLocalDay("2026-12-31", "UTC")?.toISOString()).toBe("2026-12-31T23:59:59.000Z");
    expect(endOfLocalDay("31/12/2026", "UTC")).toBeNull();
  });
});
