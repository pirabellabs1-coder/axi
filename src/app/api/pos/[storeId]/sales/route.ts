import { NextResponse, type NextRequest } from "next/server";
import { loadStoreContext } from "@/lib/auth/permissions";
import { authenticateDevice, POS_DEVICE_HEADER, touchDevice } from "@/lib/pos/device";
import { createPosSale, PosError } from "@/lib/pos/service";
import { dedupeByKey, SALES_BATCH_SIZE, validateQueuedSale } from "@/lib/pos/sync";
import { isPaymentKind, isPosRole, type PaymentSplit, type PosRole } from "@/lib/pos/cash";
import { posPlanGuard } from "@/lib/pos/plan";
import { rateLimit } from "@/lib/rate-limit";
import { db } from "@/lib/db";
import { notifyStore } from "@/lib/notifications/service";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * Synchronisation des ventes de la caisse (lot 3 §2) : lots de 20 au maximum, chaque vente portant une
 * clé d'idempotence UUID v4 générée sur l'appareil. Une vente déjà enregistrée est renvoyée telle
 * quelle (jamais de doublon).
 * Réponse : un résultat PAR vente, avec un drapeau `permanent` (bloquant n° 3) : l'appareil ne retire
 * de sa file que les ventes ACCEPTÉES ou DÉFINITIVEMENT invalides. Un refus récupérable (session fermée,
 * article devenu indisponible, plafond de remise, code du gérant) laisse la vente en file — elle est
 * déjà encaissée — et la signale au gérant.
 *
 * Sécurité (correctifs de l'audit de la vague 3) :
 *  - contrôle de PLAN côté serveur (mineur n° 8) ;
 *  - aucun drapeau de dérogation accepté : le dépassement du plafond de remise exige le `managerCode`,
 *    vérifié par `createPosSale` (bloquant n° 1) ;
 *  - « hors ligne » est prouvé par le serveur depuis `PosDevice.lastSyncAt` (majeur n° 2) ;
 *  - un appareil RÉVOQUÉ n'obtient la tolérance de 24 h que pour ses ventes réellement hors ligne et
 *    antérieures à la révocation — jamais pour une vente en ligne (majeur n° 4) ;
 *  - le rôle du VENDEUR transmis par la file ne sert qu'à ABAISSER le plafond de remise
 *    (`effectiveDiscountRole`) : une charge utile ne peut jamais élargir un droit.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const ctx = await loadStoreContext(storeId);
  if (!ctx) return NextResponse.json({ ok: false, error: "Session expirée : reconnectez-vous pour synchroniser." }, { status: 401 });
  if (!ctx.can("pos.sell")) return NextResponse.json({ ok: false, error: "Votre rôle ne permet pas la caisse" }, { status: 403 });
  const plan = posPlanGuard(ctx.planId);
  if (plan) return NextResponse.json({ ok: false, error: plan }, { status: 403 });

  // La tolérance est accordée à l'AUTHENTIFICATION pour pouvoir lire la file d'un appareil révoqué ;
  // chaque vente est ensuite filtrée individuellement par `acceptRevokedSale` dans `createPosSale`.
  const auth = await authenticateDevice(storeId, req.headers.get(POS_DEVICE_HEADER), { allowRevokedGrace: true });
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const limited = await rateLimit(`pos:sales:${auth.device.id}`, 60, 60);
  if (!limited.ok) return NextResponse.json({ ok: false, error: "Trop de requêtes" }, { status: 429, headers: { "retry-after": String(limited.retryAfter) } });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Corps JSON invalide" }, { status: 400 });
  }
  const raw = body && typeof body === "object" && Array.isArray((body as { sales?: unknown }).sales) ? ((body as { sales: unknown[] }).sales as unknown[]) : null;
  if (!raw) return NextResponse.json({ ok: false, error: "Champ `sales` attendu" }, { status: 400 });
  if (raw.length > SALES_BATCH_SIZE) return NextResponse.json({ ok: false, error: `Maximum ${SALES_BATCH_SIZE} ventes par lot` }, { status: 400 });

  // Validation de forme AVANT tout accès base, puis dédoublonnage interne au lot.
  const parsed: { input: Record<string, unknown>; key: string; idempotencyKey: string }[] = [];
  const results: { idempotencyKey: string; ok: boolean; orderId?: string; reference?: string; total?: number; duplicate?: boolean; error?: string; permanent?: boolean }[] = [];
  for (const item of raw) {
    const check = validateQueuedSale(item);
    if (!check.ok) {
      const key = item && typeof item === "object" && typeof (item as { idempotencyKey?: unknown }).idempotencyKey === "string" ? (item as { idempotencyKey: string }).idempotencyKey : "";
      // Vente définitivement invalide (forme) : l'appareil la retire de sa file (elle ne passera jamais).
      results.push({ idempotencyKey: key, ok: false, error: check.error, permanent: true });
      continue;
    }
    parsed.push({ input: item as Record<string, unknown>, key: check.sale.idempotencyKey, idempotencyKey: check.sale.idempotencyKey });
  }
  const { unique, duplicates } = dedupeByKey(parsed);
  for (const key of duplicates) results.push({ idempotencyKey: key, ok: true, duplicate: true });

  const device = await db.posDevice.findUnique({ where: { id: auth.device.id }, select: { lastSyncAt: true, locationId: true, revokedAt: true } });

  for (const entry of unique) {
    const sale = entry.input;
    const payments: PaymentSplit[] = [];
    for (const p of (sale.payments as { kind: string; amount: number; reference?: string | null }[]) ?? []) {
      if (!isPaymentKind(p.kind)) {
        payments.length = 0;
        break;
      }
      payments.push({ kind: p.kind, amount: p.amount, reference: p.reference ?? null });
    }
    if (!payments.length) {
      results.push({ idempotencyKey: entry.idempotencyKey, ok: false, error: "Moyen de paiement inconnu.", permanent: true });
      continue;
    }
    try {
      const result = await createPosSale({
        storeId,
        deviceId: auth.device.id,
        sessionId: String(sale.sessionId ?? ""),
        locationId: device?.locationId ?? auth.device.locationId,
        actorId: ctx.user.id,
        role: ctx.role as PosRole,
        // Rôle du vendeur au moment de l'encaissement (file hors ligne) : ne peut qu'abaisser le plafond.
        claimedRole: isPosRole(sale.sellerRole) ? sale.sellerRole : null,
        idempotencyKey: entry.idempotencyKey,
        items: (sale.items as { productId: string; variantId?: string | null; quantity: number; optionIds?: string[] }[]) ?? [],
        payments,
        discountPercent: typeof sale.discountPercent === "number" ? sale.discountPercent : 0,
        // Code SAISI par le gérant ; aucun drapeau `managerOverride` n'est lu dans le corps JSON.
        managerCode: typeof sale.managerCode === "string" ? sale.managerCode : null,
        customerPhone: typeof sale.customerPhone === "string" ? sale.customerPhone : null,
        customerName: typeof sale.customerName === "string" ? sale.customerName : null,
        collectedTotal: typeof sale.collectedTotal === "number" ? sale.collectedTotal : null,
        offlineCreatedAt: typeof sale.offlineCreatedAt === "string" ? sale.offlineCreatedAt : null,
        deviceLastSyncAt: device?.lastSyncAt ?? auth.device.lastSyncAt ?? null,
        deviceRevokedAt: device?.revokedAt ?? auth.device.revokedAt ?? null,
      });
      results.push({ idempotencyKey: entry.idempotencyKey, ok: true, orderId: result.orderId, reference: result.reference, total: result.total, duplicate: result.duplicate });
    } catch (e) {
      if (e instanceof PosError) {
        // `permanent` décide du sort de la vente dans la file de l'appareil (jamais d'encaissement perdu).
        results.push({ idempotencyKey: entry.idempotencyKey, ok: false, error: e.message, permanent: e.permanent });
        if (!e.permanent) {
          // Vente DÉJÀ ENCAISSÉE que le serveur refuse : le gérant doit la régulariser. Notification
          // dédoublonnée par clé d'idempotence (un rejeu n'en crée pas une seconde) et audit.
          await notifyStore(storeId, {
            kind: "other",
            key: `pos:blocked:${entry.idempotencyKey}`,
            title: "Vente de caisse à régulariser",
            text: `Une vente encaissée sur « ${auth.device.name} » n'a pas pu être enregistrée : ${e.message} Elle reste en file sur l'appareil.`,
            href: `/app/${storeId}/caisse`,
          }).catch(() => undefined);
          await audit({
            storeId,
            actorId: ctx.user.id,
            action: "pos.sale_blocked",
            target: entry.idempotencyKey,
            metadata: { deviceId: auth.device.id, reason: e.message },
          }).catch(() => undefined);
        }
        continue;
      }
      console.error("[pos/sales]", e);
      // Erreur inattendue : l'appareil GARDE la vente en file et réessaiera.
      return NextResponse.json({ ok: false, results, error: "Erreur serveur : la file est conservée." }, { status: 500 });
    }
  }

  // `lastSeenAt` seulement : vider la file ne rafraîchit PAS l'instantané du catalogue. Avancer
  // `lastSyncAt` ici effacerait la preuve technique du hors-ligne des ventes encore en file
  // (lots suivants, ou ventes refusées puis réessayées) — cf. `decideOffline`.
  await touchDevice(auth.device.id);
  return NextResponse.json({ ok: true, results }, { headers: { "cache-control": "no-store" } });
}
