import { cookies, headers } from "next/headers";
import { db } from "@/lib/db";
import { clientIp, rateLimit, rateLimitAll } from "@/lib/rate-limit";
import { isBotUserAgent } from "@/lib/theme-engine/audience";
import { VISITOR_COOKIE } from "@/lib/experiments/assign";
import { readSignedVisitorId } from "@/lib/experiments/vid-signature";
import { recordBeaconEvent } from "@/lib/experiments/service";
import { localDay } from "@/lib/theme-schedules/rules";

export const dynamic = "force-dynamic";

/**
 * POST /api/s/{slug}/events — balise d'événement des tests A/B (lot 4 §13).
 *
 * Corps JSON (≤ 1 Ko), envoyé par `navigator.sendBeacon` :
 *   { "events": [{ "t": "exposure" | "add_to_cart" | "checkout_start", "e": "<experimentId>" }, …] }
 *
 * Règles (§23) :
 *  - l'affectation à une variante est RECALCULÉE côté serveur depuis le cookie `axi_vid` : le client ne peut pas
 *    choisir sa variante ni gonfler celle d'un autre ;
 *  - cookie `axi_vid` SIGNÉ (HMAC APP_SECRET, mineur n° 11) : une valeur forgée est refusée. Sans cela, un script
 *    pouvait pousser des milliers d'identifiants distincts et fabriquer la « victoire » d'une variante, donc
 *    fausser une décision commerciale ;
 *  - robots ignorés (anti-pollution et anti-cloaking) ;
 *  - dédoublonnage par visiteur, par jour et par métrique ; débit limité par IP ; plafond par boutique et par jour ;
 *  - requêtes intersites refusées : `Sec-Fetch-Site` est désormais EXIGÉ (`same-origin`). Il était seulement
 *    vérifié « s'il est présent », donc contournable par un client qui ne l'envoie pas (mineur n° 11) ;
 *  - aucune action payante déclenchée, aucune donnée personnelle enregistrée (seul un identifiant opaque sert au
 *    dédoublonnage) ;
 *  - réponse toujours 204 (aucune information sur l'existence d'un test).
 */

const MAX_BODY = 1024;
const MAX_EVENTS = 5;
const METRICS = new Set(["exposure", "add_to_cart", "checkout_start"]);
/** Plafond par boutique et par jour (garde-fou : un pic de trafic ne remplit pas la table de statistiques). */
const STORE_DAILY_CAP = 200_000;

const noContent = () => new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // `Sec-Fetch-Site` EXIGÉ : `sendBeacon` et `fetch` l'envoient toujours (tous les navigateurs visés par
  // la boutique l'implémentent). Un client qui l'omet n'est pas un navigateur de visiteur.
  if (req.headers.get("sec-fetch-site") !== "same-origin") return noContent();
  if (!/^[a-z0-9-]{1,64}$/.test(slug)) return noContent();

  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_BODY) return noContent();

  const h = await headers();
  if (isBotUserAgent(h.get("user-agent"))) return noContent();

  const jar = await cookies();
  // Signature obligatoire : un `axi_vid` non signé par ce serveur ne compte pour rien.
  const visitorId = readSignedVisitorId(jar.get(VISITOR_COOKIE)?.value);
  if (!visitorId) return noContent();

  let raw: string;
  try {
    raw = (await req.text()).slice(0, MAX_BODY + 1);
  } catch {
    return noContent();
  }
  if (raw.length > MAX_BODY) return noContent();

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return noContent();
  }
  const list = Array.isArray((body as { events?: unknown })?.events) ? ((body as { events: unknown[] }).events as unknown[]) : [];
  if (list.length === 0) return noContent();

  const ip = await clientIp();
  // Plafond par IP ABAISSÉ (mineur n° 11) : une visite normale émet au plus une exposition et deux
  // conversions par test et par jour. 120 appels / 10 min laissaient largement de quoi gonfler des
  // statistiques derrière une seule adresse ; 30 couvre la navigation la plus intense.
  const burst = await rateLimitAll([
    { key: `sfevents:ip:${ip}`, limit: 30, windowSec: 600 },
    { key: `sfevents:vid:${visitorId}`, limit: 240, windowSec: 3600 },
  ]);
  if (!burst.ok) return noContent();

  const store = await db.store.findUnique({ where: { slug }, select: { id: true, status: true, timezone: true } });
  if (!store || (store.status !== "PUBLISHED" && store.status !== "CLOSED_TEMPORARILY")) return noContent();

  const now = new Date();
  const cap = await rateLimit(`sfevents:store:${store.id}:${localDay(now, store.timezone)}`, STORE_DAILY_CAP, 86_400);
  if (!cap.ok) return noContent();

  for (const item of list.slice(0, MAX_EVENTS)) {
    if (!item || typeof item !== "object") continue;
    const o = item as { t?: unknown; e?: unknown };
    if (typeof o.t !== "string" || !METRICS.has(o.t)) continue;
    if (typeof o.e !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(o.e)) continue;
    try {
      await recordBeaconEvent({
        store: { id: store.id, timezone: store.timezone },
        experimentId: o.e,
        metric: o.t as "exposure" | "add_to_cart" | "checkout_start",
        visitorId,
        now,
      });
    } catch {
      // un événement perdu n'est jamais une erreur visible par le visiteur
    }
  }

  return noContent();
}
