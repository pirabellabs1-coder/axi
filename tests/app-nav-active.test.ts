import { describe, expect, it } from "vitest";
import { activeNavHref } from "@/components/app/nav-active";

const base = "/app/s1";
const items = [
  { href: base, exact: true },
  { href: `${base}/produits` },
  { href: `${base}/produits/stock` },
  { href: `${base}/parametres/taxes` },
  { href: `${base}/devises` },
  { href: `${base}/parametres` },
];

describe("menu de l'espace marchand : un seul élément actif", () => {
  it("Taxes et factures seul, pas Paramètres en plus", () => {
    expect(activeNavHref(`${base}/parametres/taxes`, items)).toBe(`${base}/parametres/taxes`);
  });
  it("sous-page de Paramètres sans entrée propre : Paramètres", () => {
    expect(activeNavHref(`${base}/parametres/champs`, items)).toBe(`${base}/parametres`);
    expect(activeNavHref(`${base}/parametres`, items)).toBe(`${base}/parametres`);
  });
  it("Inventaire seul, pas Produits en plus ; fiche produit : Produits", () => {
    expect(activeNavHref(`${base}/produits/stock`, items)).toBe(`${base}/produits/stock`);
    expect(activeNavHref(`${base}/produits/abc`, items)).toBe(`${base}/produits`);
  });
  it("tableau de bord exact ; préfixe partiel non retenu", () => {
    expect(activeNavHref(base, items)).toBe(base);
    expect(activeNavHref(`${base}/devises-old`, items)).toBeNull();
  });
});
