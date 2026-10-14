import { clientIp } from "@/lib/rate-limit";
import { serveDownload } from "@/lib/digital/service";
import { getStorage } from "@/lib/storage";
import { downloadFileName, fileKeyBelongsTo, mimeForFileKey } from "@/lib/storage/file-keys";

export const dynamic = "force-dynamic";

/**
 * GET /telechargement/{jeton}/fichier/{assetId} — remise d'un fichier vendu (vague 2).
 *
 * Contrôles, dans cet ordre (toute erreur renvoie un corps vide, jamais d'indice sur l'existence d'un accès) :
 *  1. forme du jeton (256 bits, base64url) vérifiée AVANT toute requête ;
 *  2. recherche par empreinte HMAC, comparaison en TEMPS CONSTANT, commande payée et non annulée ;
 *  3. expiration, limite de téléchargements, débit par accès ;
 *  4. incrément ATOMIQUE du compteur (`UPDATE … WHERE downloadCount < downloadLimit`) : deux requêtes
 *     simultanées ne peuvent pas dépasser la limite ;
 *  5. le fichier doit appartenir au produit acheté, à sa variante et à la boutique de l'accès ;
 *  6. le contenu est RELAYÉ depuis le stockage objet (flux serveur) : aucune URL de bucket, aucun lien
 *     public permanent, `Cache-Control: no-store`, `Content-Disposition: attachment`.
 */
const NO_STORE = { "Cache-Control": "no-store, max-age=0", "X-Robots-Tag": "noindex, nofollow" };

function deny(status: number, message: string) {
  return new Response(message, { status, headers: { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8" } });
}

export async function GET(_req: Request, { params }: { params: Promise<{ token: string; assetId: string }> }) {
  const { token, assetId } = await params;
  const ip = await clientIp().catch(() => null);
  const decision = await serveDownload({ token, assetId, ip });
  if (!decision.ok) return deny(decision.status, decision.message);

  // Défense en profondeur : la clé lue en base doit être une clé de fichier DE CETTE BOUTIQUE.
  if (!fileKeyBelongsTo(decision.storageKey, decision.storeId)) return deny(404, "Fichier introuvable.");

  let object;
  try {
    object = await getStorage().getStream(decision.storageKey);
  } catch (e) {
    console.error("[telechargement] stockage", e instanceof Error ? e.message : e);
    return deny(503, "Le téléchargement est momentanément indisponible. Réessayez dans un instant.");
  }
  if (!object) return deny(404, "Fichier introuvable.");

  const mime = mimeForFileKey(decision.storageKey) ?? "application/octet-stream";
  const filename = downloadFileName(decision.name, decision.storageKey);
  return new Response(object.body, {
    status: 200,
    headers: {
      ...NO_STORE,
      "Content-Type": mime,
      // Jamais rendu en ligne (défense en profondeur si un jour un format HTML était accepté).
      "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      ...(object.size != null ? { "Content-Length": String(object.size) } : {}),
      ...(decision.remaining != null ? { "X-Downloads-Remaining": String(decision.remaining) } : {}),
    },
  });
}
