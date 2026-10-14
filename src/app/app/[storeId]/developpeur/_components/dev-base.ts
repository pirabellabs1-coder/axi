/** Base des URL du portail développeur, intégré à l'admin de la boutique (hérite de la barre latérale). */
export function devBase(storeId: string): string {
  return `/app/${storeId}/developpeur`;
}
