/**
 * Lecture des notifications webhook Meta (Page Facebook `feed`, Instagram `comments` / `live_comments`) en
 * commentaires normalisés. Fonction PURE (tests/meta-social-webhook.test.ts) : aucune donnée inattendue ne lève.
 *
 * Facebook (object = "page") :
 *   entry[].id = Page ID ; changes[].field = "feed" ; value = { item: "comment", verb: "add", comment_id, post_id,
 *   parent_id?, from: { id, name }, message, created_time }. Les commentaires d'un direct Facebook arrivent aussi
 *   par `feed` (post_id = publication de la vidéo).
 * Instagram (object = "instagram", API Instagram avec Facebook Login) :
 *   entry[].id = id du compte pro ; changes[].field = "comments" | "live_comments" ;
 *   value = { id | comment_id, from: { id, username }, text, media: { id, media_product_type }, parent_id? }.
 *
 * Les commentaires écrits par la Page / le compte lui-même (dont nos réponses publiques) sont ignorés : pas de boucle.
 */

export type SocialPlatformValue = "FACEBOOK" | "INSTAGRAM";

export type SocialComment = {
  platform: SocialPlatformValue;
  /** Page ID ou id du compte Instagram pro destinataire (routage vers la boutique). */
  accountId: string;
  commentId: string;
  /** Publication / vidéo / média commenté. */
  objectId: string | null;
  authorId: string;
  authorName: string | null;
  text: string;
  /** Champ webhook d'origine (feed, comments, live_comments). */
  field: string;
};

const ID = /^[\w.:-]{1,128}$/;
const NUMERIC = /^\d{5,32}$/;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, max = 128): string | null => (typeof v === "string" && v.length > 0 ? v.slice(0, max) : typeof v === "number" ? String(v) : null);

export function extractSocialComments(body: unknown): SocialComment[] {
  if (!body || typeof body !== "object") return [];
  const object = (body as { object?: unknown }).object;
  if (object !== "page" && object !== "instagram") return [];
  const platform: SocialPlatformValue = object === "page" ? "FACEBOOK" : "INSTAGRAM";
  const out: SocialComment[] = [];

  for (const e of arr((body as { entry?: unknown }).entry).slice(0, 1000)) {
    const entry = e as { id?: unknown; changes?: unknown };
    const accountId = str(entry?.id, 32);
    if (!accountId || !NUMERIC.test(accountId)) continue;
    for (const c of arr(entry.changes)) {
      const change = c as { field?: unknown; value?: unknown };
      const field = typeof change?.field === "string" ? change.field : "";
      const v = (change?.value && typeof change.value === "object" ? change.value : null) as Record<string, unknown> | null;
      if (!v) continue;

      if (platform === "FACEBOOK") {
        if (field !== "feed" || v.item !== "comment" || v.verb !== "add") continue;
        const from = (v.from && typeof v.from === "object" ? v.from : {}) as { id?: unknown; name?: unknown };
        const commentId = str(v.comment_id);
        const authorId = str(from.id, 64);
        const text = typeof v.message === "string" ? v.message : "";
        if (!commentId || !ID.test(commentId) || !authorId || authorId === accountId || !text) continue;
        const postId = str(v.post_id);
        out.push({ platform, accountId, commentId, objectId: postId && ID.test(postId) ? postId : null, authorId, authorName: str(from.name, 80), text: text.slice(0, 2000), field });
      } else {
        if (field !== "comments" && field !== "live_comments") continue;
        const from = (v.from && typeof v.from === "object" ? v.from : {}) as { id?: unknown; username?: unknown };
        const commentId = str(v.id) ?? str(v.comment_id);
        const authorId = str(from.id, 64);
        const text = typeof v.text === "string" ? v.text : "";
        if (!commentId || !ID.test(commentId) || !authorId || authorId === accountId || !text) continue;
        const media = (v.media && typeof v.media === "object" ? v.media : {}) as { id?: unknown };
        const mediaId = str(media.id);
        const username = str(from.username, 60);
        out.push({ platform, accountId, commentId, objectId: mediaId && ID.test(mediaId) ? mediaId : null, authorId, authorName: username ? `@${username}` : null, text: text.slice(0, 2000), field });
      }
    }
  }
  return out;
}

/**
 * Le commentaire porte-t-il sur un des objets reliés au direct ? Liste vide = toutes les publications.
 * Facebook : `post_id` vaut « {page-id}_{id} » ; on compare l'identifiant complet et sa partie après « _ ».
 */
export function matchesSocialObject(objectId: string | null, linked: readonly string[]): boolean {
  if (linked.length === 0) return true;
  if (!objectId) return false;
  const tail = objectId.includes("_") ? objectId.slice(objectId.indexOf("_") + 1) : objectId;
  return linked.some((id) => id === objectId || id === tail || (id.includes("_") && id.slice(id.indexOf("_") + 1) === tail));
}
