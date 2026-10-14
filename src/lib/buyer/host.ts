/**
 * Règle d'hôte pure (sans dépendance), utilisée par src/proxy.ts (lot 1, audit m5) et testée.
 * `/s/<x>/…` où x n'est pas la boutique de l'hôte courant (sous-domaine ou domaine personnalisé).
 */
export function foreignStorePath(pathname: string, slug: string): boolean {
  const seg = pathname.split("/")[2] ?? "";
  let decoded: string;
  try {
    decoded = decodeURIComponent(seg);
  } catch {
    return true;
  }
  return decoded.toLowerCase() !== slug.toLowerCase();
}
