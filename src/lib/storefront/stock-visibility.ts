import "server-only";
import { getThemeDocument } from "@/lib/theme-engine/resolve";

/** Champs de boutique nécessaires pour lire le thème publié. */
export const STOCK_VISIBILITY_SELECT = {
  sector: true, themeId: true, themeConfig: true, bannerUrl: true, logoUrl: true, name: true, tagline: true, description: true, whatsappNumber: true, themeDoc: true, themeDocDraft: true,
} as const;

/**
 * Le thème publié affiche-t-il la quantité exacte en stock (`settings.product.showStock`) ? Sinon, aucun message
 * destiné à l'acheteur ne doit la révéler (« Il ne reste que N » devient « Quantité demandée indisponible »).
 */
export function storeShowsStock(store: Parameters<typeof getThemeDocument>[0]): boolean {
  try {
    return getThemeDocument(store).settings.product.showStock === true;
  } catch {
    return false;
  }
}
