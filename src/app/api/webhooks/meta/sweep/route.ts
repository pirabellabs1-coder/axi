import { NextResponse, type NextRequest } from "next/server";
import { isPlaceholderSecret, safeEqual } from "@/lib/crypto";
import { sweepLiveClaims } from "@/lib/live/claims";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Balayage des réservations « commenter pour acheter » (expiration → stock rendu ; commande payée → PAID).
 * À appeler chaque minute par un cron, avec la MÊME authentification que /api/jobs/run : en-tête
 * `x-jobs-key: <JOBS_RUN_KEY>` ou `Authorization: Bearer <CRON_SECRET>`. Voir docs/LIVE-COMMERCE.md.
 * (Le webhook et l'écran du direct balaient déjà au fil de l'activité ; cette route garantit l'expiration
 * même sans activité.)
 */
function configured(value: string | undefined): string | null {
  if (!value) return null;
  if (process.env.NODE_ENV === "production" && isPlaceholderSecret(value)) return null;
  return value;
}

function authorized(req: NextRequest): boolean {
  const key = configured(process.env.JOBS_RUN_KEY);
  const given = req.headers.get("x-jobs-key");
  if (key && given && safeEqual(given, key)) return true;
  const cron = configured(process.env.CRON_SECRET);
  const auth = req.headers.get("authorization");
  return !!(cron && auth && safeEqual(auth, `Bearer ${cron}`));
}

async function handle(req: NextRequest) {
  if (!configured(process.env.JOBS_RUN_KEY) && !configured(process.env.CRON_SECRET)) return NextResponse.json({ ok: false, error: "JOBS_RUN_KEY non configurée" }, { status: 503 });
  if (!authorized(req)) return NextResponse.json({ ok: false, error: "Non autorisé" }, { status: 401 });
  const result = await sweepLiveClaims({ limit: 500 });
  return NextResponse.json({ ok: true, ...result });
}

export const GET = handle;
export const POST = handle;
