import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { hmacSha256, safeEqual } from "@/lib/crypto";
import { metaAppSecret, metaSocialVerifyToken } from "@/lib/meta-social/config";
import { extractSocialComments, type SocialComment } from "@/lib/meta-social/webhook-payload";
import { deliverClaimMessage, processSocialComment, sweepLiveClaims, type RoutedAccount } from "@/lib/live/claims";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BODY = 1_000_000; // 1 Mo
const PROVIDER = "meta_social";

/**
 * Webhook Meta « commenter pour acheter » (Page Facebook `feed`, Instagram `comments` / `live_comments`).
 *  - GET  : vérification de l'abonnement (hub.challenge) avec META_SOCIAL_VERIFY_TOKEN (distinct de WhatsApp).
 *  - POST : notifications signées : x-hub-signature-256 = HMAC-SHA256 du corps BRUT avec le secret de l'app Meta
 *           (META_APP_SECRET, à défaut WHATSAPP_APP_SECRET : même application). Signature absente / invalide : 401.
 * Routage STRICT : la boutique est celle qui a connecté la Page / le compte (`SocialAccount` unique par
 * plateforme + id, statut actif) ; un compte inconnu est ignoré. Idempotence : ProviderEvent(meta_social,
 * "{plateforme}:{commentId}") + unicité du commentaire sur LiveClaim. Les commentaires d'un lot sont traités dans
 * l'ordre (premier arrivé, premier servi) ; une erreur inattendue libère l'événement et répond 500 à la fin du lot
 * (Meta renvoie, les commentaires déjà traités sont ignorés).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token") ?? "";
  const challenge = url.searchParams.get("hub.challenge") ?? "";
  const expected = metaSocialVerifyToken();
  if (mode === "subscribe" && expected && safeEqual(token, expected) && /^[\w-]{1,128}$/.test(challenge)) {
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  return new Response("Forbidden", { status: 403 });
}

async function claimEvent(c: SocialComment): Promise<boolean> {
  try {
    await db.providerEvent.create({
      data: {
        provider: PROVIDER,
        eventId: `${c.platform}:${c.commentId}`.slice(0, 190),
        type: `comment.${c.field}`,
        // Aucune donnée personnelle superflue : pas de texte ni de nom d'auteur dans le journal brut.
        payload: { accountId: c.accountId, objectId: c.objectId } as Prisma.InputJsonValue,
        signatureValid: true,
        processedAt: new Date(),
      },
    });
    return true;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return false;
    throw e;
  }
}

async function releaseEvent(c: SocialComment) {
  await db.providerEvent.deleteMany({ where: { provider: PROVIDER, eventId: `${c.platform}:${c.commentId}`.slice(0, 190) } }).catch(() => {});
}

/** Balayage (expirations, paiements) au plus toutes les 30 s par boutique, déclenché par l'activité du direct. */
const lastSweep = new Map<string, number>();
function sweepSoon(storeId: string) {
  const t = Date.now();
  if (t - (lastSweep.get(storeId) ?? 0) < 30_000) return;
  lastSweep.set(storeId, t);
  if (lastSweep.size > 5000) lastSweep.clear();
  void sweepLiveClaims({ storeId, limit: 100 }).catch((e) => console.error("[meta webhook] balayage", (e as Error).message));
}

export async function POST(req: Request) {
  const secret = metaAppSecret();
  if (!secret) return new Response("Webhook non configuré", { status: 503 });

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY) return new Response("Payload Too Large", { status: 413 });
  const bytes = Buffer.from(await req.arrayBuffer());
  if (bytes.length > MAX_BODY) return new Response("Payload Too Large", { status: 413 });

  const signature = req.headers.get("x-hub-signature-256") ?? "";
  if (!signature || !safeEqual(signature, `sha256=${hmacSha256(secret, bytes)}`)) return new Response("Invalid signature", { status: 401 });

  let body: unknown;
  try {
    body = JSON.parse(bytes.toString("utf8"));
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const comments = extractSocialComments(body);
  if (!comments.length) return new Response("ok 0", { status: 200 });

  // Comptes connectés concernés par le lot (une requête).
  const keys = [...new Set(comments.map((c) => `${c.platform}:${c.accountId}`))];
  const accounts = await db.socialAccount.findMany({
    where: { OR: keys.map((k) => ({ platform: k.split(":")[0] as "FACEBOOK" | "INSTAGRAM", externalId: k.split(":")[1] })) },
    select: { id: true, storeId: true, platform: true, externalId: true, tokenEncrypted: true, status: true },
  });
  const byKey = new Map(accounts.map((a) => [`${a.platform}:${a.externalId}`, a]));

  let processed = 0;
  let failed = false;
  const touched = new Set<string>();
  const toDeliver: string[] = [];
  // Réservations dans l'ordre d'arrivée (premier commentaire, premier servi)…
  for (const c of comments) {
    const account = byKey.get(`${c.platform}:${c.accountId}`);
    // Compte inconnu ou en erreur (jeton révoqué) : rien n'est fait pour aucune boutique.
    if (!account || account.status !== "active") continue;
    if (!(await claimEvent(c))) continue;
    try {
      const routed: RoutedAccount = { id: account.id, platform: account.platform, externalId: account.externalId, tokenEncrypted: account.tokenEncrypted, status: account.status };
      const outcome = await processSocialComment({ storeId: account.storeId, account: routed, comment: c }, { deliver: false });
      if (outcome.claimId) toDeliver.push(outcome.claimId);
      // Commentaire sans effet (aucun direct, aucun mot-clé) : l'événement n'est pas conservé (la table ne grossit
      // pas avec chaque commentaire des Pages). Un renvoi éventuel est sans risque : la réservation reste unique
      // par commentaire (contrainte sur LiveClaim).
      if (outcome.status === "ignored") await releaseEvent(c);
      processed++;
      touched.add(account.storeId);
    } catch (e) {
      console.error("[meta webhook] commentaire", (e as Error).message);
      await releaseEvent(c);
      failed = true;
    }
  }
  // … puis réponses privées en parallèle (5 à la fois) : le webhook répond vite, même sur un lot chargé.
  // deliverClaimMessage consigne ses échecs sur la réservation (relançable) et ne renvoie jamais deux messages.
  for (let i = 0; i < toDeliver.length; i += 5) {
    await Promise.all(toDeliver.slice(i, i + 5).map((id) => deliverClaimMessage(id).catch((e) => console.error("[meta webhook] réponse privée", (e as Error).message))));
  }
  for (const storeId of touched) sweepSoon(storeId);
  if (failed) return new Response("retry", { status: 500 });
  return new Response(`ok ${processed}`, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
