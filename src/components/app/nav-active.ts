/**
 * Élément actif du menu de l'espace marchand (module pur, testé : tests/app-nav-active.test.ts).
 * Un seul élément en surbrillance : celui dont l'adresse correspond le plus précisément à la page courante.
 * Ex. `/parametres/taxes` active « Taxes et factures » et non aussi « Paramètres » ; `/parametres/champs` (sans
 * entrée propre) active « Paramètres ».
 */
export type NavMatchItem = { href: string; exact?: boolean };

export function navItemMatches(pathname: string, i: NavMatchItem): boolean {
  return i.exact ? pathname === i.href : pathname === i.href || pathname.startsWith(i.href + "/");
}

export function activeNavHref(pathname: string, items: readonly NavMatchItem[]): string | null {
  let best: string | null = null;
  for (const i of items) {
    if (navItemMatches(pathname, i) && (best === null || i.href.length > best.length)) best = i.href;
  }
  return best;
}
