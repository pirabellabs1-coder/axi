import { describe, it, expect } from "vitest";
import { waLink, buildOrderMessage, buildCartMessage } from "@/lib/whatsapp";

/** Intl utilise des espaces insécables (U+202F / U+00A0) : on les normalise pour comparer. */
const norm = (s: string) => s.replace(/[  ]/g, " ");

describe("waLink", () => {
  it("construit un lien wa.me avec le texte encodé", () => {
    const link = waLink("22997000001", "Bonjour & merci ?");
    expect(link.startsWith("https://wa.me/22997000001?text=")).toBe(true);
    expect(link).toContain(encodeURIComponent("Bonjour & merci ?"));
    expect(link).not.toContain("&merci");
  });
  it("nettoie le numéro (+, espaces)", () => {
    expect(waLink("+229 97 00 00 01", "x")).toBe("https://wa.me/22997000001?text=x");
  });
  it("encode les sauts de ligne et les caractères spéciaux", () => {
    const link = waLink("22997000001", "ligne 1\nligne 2 — total");
    expect(link).toContain("%0A");
    expect(link).not.toContain("\n");
  });
});

describe("buildOrderMessage", () => {
  const base = {
    storeName: "Dantokpa Mode",
    reference: "AX-7K3P9Q",
    customerName: "Grâce",
    items: [
      { name: "Robe wax", variantName: "M / Bleu", quantity: 1, lineTotal: 18000 },
      { name: "Foulard", quantity: 2, lineTotal: 9000 },
    ],
    currency: "XOF",
    subtotal: 27000,
    discount: 1500,
    deliveryFee: 1000,
    total: 26500,
    fulfillment: "DELIVERY" as const,
    address: "Haie Vive, rue 12.345",
    trackingUrl: "https://axi.africa/suivi/abc",
  };

  it("contient la référence, le nom de la boutique et le total", () => {
    const msg = buildOrderMessage(base);
    expect(msg).toContain("AX-7K3P9Q");
    expect(msg).toContain("Dantokpa Mode");
    expect(norm(msg)).toContain("Total : 26 500 FCFA");
  });
  it("liste les articles avec variante et quantité", () => {
    const msg = buildOrderMessage(base);
    expect(msg).toContain("1 × Robe wax (M / Bleu)");
    expect(msg).toContain("2 × Foulard :");
  });
  it("affiche remise, livraison, adresse, nom et lien de suivi", () => {
    const msg = buildOrderMessage(base);
    expect(norm(msg)).toContain("Remise : −1 500 FCFA");
    expect(norm(msg)).toContain("Livraison : 1 000 FCFA");
    expect(msg).toContain("Adresse : Haie Vive");
    expect(msg).toContain("Nom : Grâce");
    expect(msg).toContain("https://axi.africa/suivi/abc");
  });
  it("livraison offerte et retrait en boutique", () => {
    expect(buildOrderMessage({ ...base, deliveryFee: 0 })).toContain("Livraison : offerte");
    const pickup = buildOrderMessage({ ...base, fulfillment: "PICKUP", discount: 0 });
    expect(pickup).toContain("retrait en boutique");
    expect(pickup).not.toContain("Remise");
    expect(pickup).not.toContain("Adresse");
  });
});

describe("buildCartMessage", () => {
  it("résume le panier avec total estimé", () => {
    const msg = buildCartMessage({ storeName: "Tech Hub", items: [{ name: "Clé USB", quantity: 3, lineTotal: 10500 }], currency: "XOF", total: 10500, cartUrl: "https://x/panier" });
    expect(msg).toContain("Tech Hub");
    expect(msg).toContain("3 × Clé USB");
    expect(norm(msg)).toContain("Total estimé : 10 500 FCFA");
    expect(msg).toContain("https://x/panier");
  });
});
