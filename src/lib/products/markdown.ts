/**
 * Markdown limité des descriptions produit : **gras**, *italique*, listes (« - » / « 1. »), [liens](https://…), paragraphes.
 * Aucun HTML n'est stocké : `cleanMarkdown` retire toute balise ; `markdownToHtml` échappe tout puis
 * reconstruit uniquement les balises autorisées (sert à l'éditeur et aux aperçus).
 */

import { safeLink } from "@/lib/storefront/safe-link";

export function cleanMarkdown(md: string): string {
  return md
    .replace(/\r\n?/g, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inline(text: string): string {
  let s = esc(text);
  // Même validation que les liens de la vitrine : https, chemin interne (pas « // »), ancre, tel:, mailto:.
  // Lien refusé (http://, //hôte, javascript:…) : seul le libellé est conservé.
  s = s.replace(/\[([^\]]+)\]\(([^\s)]+)\)/g, (_m, label: string, href: string) => {
    const safe = safeLink(href);
    return safe ? `<a href="${safe}" rel="noopener noreferrer">${label}</a>` : label;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  return s;
}

export function markdownToHtml(md: string): string {
  const lines = cleanMarkdown(md).split("\n");
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join("<br>")}</p>`);
    para = [];
  };
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      flushPara();
      const kind = ul ? "ul" : "ol";
      if (list !== kind) {
        closeList();
        out.push(`<${kind}>`);
        list = kind;
      }
      out.push(`<li>${inline((ul ?? ol)![1])}</li>`);
    } else if (line.trim() === "") {
      flushPara();
      closeList();
    } else {
      closeList();
      para.push(line);
    }
  }
  flushPara();
  closeList();
  return out.join("");
}

/** Texte brut (aperçu SEO, extraits). */
export function markdownToText(md: string): string {
  return cleanMarkdown(md)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^\s*([-*•]|\d+[.)])\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}
