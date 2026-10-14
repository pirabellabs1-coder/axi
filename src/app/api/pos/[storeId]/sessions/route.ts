import { NextResponse, type NextRequest } from "next/server";
import { loadStoreContext } from "@/lib/auth/permissions";
import { authenticateDevice, POS_DEVICE_HEADER } from "@/lib/pos/device";
import { openSession, PosSessionError, sessionReport } from "@/lib/pos/session";
import { posPlanGuard } from "@/lib/pos/plan";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Session de caisse de l'appareil (lot 3 §2) :
 *  - GET  : session ouverte (ou aucune) + rapport Z en direct, pour l'écran de caisse ;
 *  - POST : ouverture avec un fond de caisse (idempotente : reprend la session ouverte).
 * Triple contrôle : session membre `pos.sell`, PLAN de la boutique (mineur n° 8) et jeton d'appareil.
 */
async function authorize(req: NextRequest, storeId: string) {
  const ctx = await loadStoreContext(storeId);
  if (!ctx) return { error: NextResponse.json({ ok: false, error: "Accès refusé" }, { status: 401 }) };
  if (!ctx.can("pos.sell")) return { error: NextResponse.json({ ok: false, error: "Votre rôle ne permet pas la caisse" }, { status: 403 }) };
  const plan = posPlanGuard(ctx.planId);
  if (plan) return { error: NextResponse.json({ ok: false, error: plan }, { status: 403 }) };
  const auth = await authenticateDevice(storeId, req.headers.get(POS_DEVICE_HEADER));
  if (!auth.ok) return { error: NextResponse.json({ ok: false, error: auth.error }, { status: auth.status }) };
  return { ctx, device: auth.device };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const authorized = await authorize(req, storeId);
  if ("error" in authorized) return authorized.error;
  const session = await db.posSession.findFirst({
    where: { storeId, deviceId: authorized.device.id, status: "OPEN" },
    orderBy: { openedAt: "desc" },
    select: { id: true, openedAt: true, openingFloat: true },
  });
  if (!session) return NextResponse.json({ ok: true, session: null }, { headers: { "cache-control": "no-store" } });
  const report = await sessionReport(storeId, session.id);
  return NextResponse.json({ ok: true, session, report: report.report }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const authorized = await authorize(req, storeId);
  if ("error" in authorized) return authorized.error;
  let body: { openingFloat?: unknown } = {};
  try {
    body = (await req.json()) as { openingFloat?: unknown };
  } catch {
    body = {};
  }
  const openingFloat = Number(body.openingFloat ?? 0);
  if (!Number.isInteger(openingFloat) || openingFloat < 0 || openingFloat > 100_000_000) {
    return NextResponse.json({ ok: false, error: "Fond de caisse invalide" }, { status: 400 });
  }
  try {
    const session = await openSession({
      storeId,
      deviceId: authorized.device.id,
      locationId: authorized.device.locationId,
      actorId: authorized.ctx.user.id,
      openingFloat,
    });
    return NextResponse.json({ ok: true, session }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof PosSessionError) return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    throw e;
  }
}
