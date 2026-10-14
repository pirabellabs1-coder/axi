/**
 * Validation de lien de la vitrine — module pur sans dépendance, partagé par le document de thème (theme-doc.ts)
 * et le Markdown des descriptions produit (src/lib/products/markdown.ts).
 *
 * Lien accepté : https://…, chemin interne « /… » (pas « // »), ancre « #… », tel: ou mailto:.
 * Refusés notamment : http://, //hôte, javascript:, data:.
 */
export function safeLink(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s || s.length > 500) return null;
  if (/^https:\/\/[^\s<>"']+$/i.test(s)) return s;
  if (/^\/(?!\/)[^\s<>"'\\]*$/.test(s)) return s;
  if (/^#[\w-]{0,80}$/.test(s)) return s;
  if (/^(tel:\+?[0-9 ]{3,20}|mailto:[^\s<>"']{3,120})$/i.test(s)) return s;
  return null;
}
