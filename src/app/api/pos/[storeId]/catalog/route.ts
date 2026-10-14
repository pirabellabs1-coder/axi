import { NextResponse, type NextRequest } from "next/server";
import { loadStoreContext } from "@/lib/auth/permissions";
import { authenticateDevice, POS_DEVICE_HEADER, touchDevice } from "@/lib/pos/device";
import { buildCatalogSnapshot } from "@/lib/pos/catalog";
import { posPlanGuard } from "@/lib/pos/plan";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Instantané du catalogue pour la caisse hors ligne (lot 3 §2).
 * Triple contrôle : session membre avec `pos.sell`, PLAN de la boutique (mineur n° 8 de l'audit) ET
 * jeton d'appareil (`Axi-Pos-Device`). Le stock renvoyé est celui du DÉPÔT de l'appareil.
 *
 * C'est la SEULE route qui avance `PosDevice.lastSyncAt` : cette date est la référence de fraîcheur de
 * l'instantané et sert de preuve technique du hors-ligne (`decideOffline`). `POST .../sales` ne la touche
 * pas : vider la file ne rafraîchit aucun prix.
 *
 * L'appareil doit donc VIDER SA FILE AVANT de rafraîchir son catalogue (`caisse-client.tsx`) : sinon il
 * perd lui-même la preuve du hors-ligne de ses ventes en attente, qui seront enregistrées au prix
 * serveur. Ce marqueur n'est JAMAIS piloté par un paramètre de requête : un appareil compromis pourrait
 * alors geler sa fraîcheur à volonté et s'ouvrir l'exception de prix hors ligne en permanence.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const ctx = await loadStoreContext(storeId);
  if (!ctx) return NextResponse.json({ ok: false, error: "Accès refusé" }, { status: 401 });
  if (!ctx.can("pos.sell")) return NextResponse.json({ ok: false, error: "Votre rôle ne permet pas la caisse" }, { status: 403 });
  const plan = posPlanGuard(ctx.planId);
  if (plan) return NextResponse.json({ ok: false, error: plan }, { status: 403 });

  const auth = await authenticateDevice(storeId, req.headers.get(POS_DEVICE_HEADER));
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const limited = await rateLimit(`pos:catalog:${auth.device.id}`, 30, 60);
  if (!limited.ok) return NextResponse.json({ ok: false, error: "Trop de requêtes" }, { status: 429, headers: { "retry-after": String(limited.retryAfter) } });

  const snapshot = await buildCatalogSnapshot({ storeId, locationId: auth.device.locationId });
  await touchDevice(auth.device.id, { synced: true });
  return NextResponse.json(
    { ok: true, device: { id: auth.device.id, name: auth.device.name, locationId: auth.device.locationId }, snapshot },
    { headers: { "cache-control": "no-store" } },
  );
}
