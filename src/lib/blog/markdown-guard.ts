import { isSafeMarkdown } from "@/lib/theme-engine/validate";
import { IMAGE_LINE_RE, isBlogImageUrl } from "./markdown";

/**
 * Validation du corps d'article (écriture, côté serveur ; aussi utilisée par l'éditeur pour signaler l'erreur tôt).
 * Règles du Markdown limité de la plateforme (`isSafeMarkdown` : aucun HTML brut, liens https ou internes),
 * plus : images uniquement seules sur leur ligne, en https ou média téléversé (jamais data:, jamais http).
 */
export function blogMarkdownProblem(body: string): string | null {
  if (!isSafeMarkdown(body)) return "Le texte contient du HTML ou un lien non autorisé (liens https ou internes uniquement).";
  if (/\bdata:/i.test(body) && /!\[[^\]]*\]\(\s*data:/i.test(body)) return "Image non autorisée : téléversez-la avec le bouton « Image ».";
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line.includes("![")) continue;
    const m = IMAGE_LINE_RE.exec(line);
    if (!m) return "Une image doit être seule sur sa ligne : ![description](adresse).";
    if (!isBlogImageUrl(m[2]!)) return "Image non autorisée : téléversez-la avec le bouton « Image » ou utilisez une adresse https.";
  }
  return null;
}

export function isSafeBlogMarkdown(body: string): boolean {
  return blogMarkdownProblem(body) === null;
}
