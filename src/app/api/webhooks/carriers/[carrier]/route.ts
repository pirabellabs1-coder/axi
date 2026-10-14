import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { isCarrierId } from "@/lib/carriers/types";
import { carrierCredentials, getCarrierAdapter } from "@/lib/carriers/registry";
import { recordShipmentEvent } from "@/lib/shipping/service";
import { rateLimit } from "@/lib/rate-limit";
import { webhookNonceKey, WEBHOOK_NONCE_TTL_SECONDS } from "@/lib/carriers/webhook";

export const dynamic = "force-dynamic";

/**
 * Webhooks transporteurs (lot 3 §1.2 et §6) : signature HMAC vérifiée avec le secret du compte
 * transporteur, HORODATAGE OBLIGATOIRE (drapeau de configuration `allowMissingTimestamp` par compte),
 * anti-rejeu par nonce (signature déjà vue, TTL 10 min), idempotence par `(shipmentId, providerEventId)`
 * (contrainte en base), statuts ordonnés (`applyCarrierStatus` : un événement tardif ne rétrograde
 * jamais une expédition).
 *
 * L'expédition est retrouvée par `providerRef`, à défaut par le numéro de suivi, TOUJOURS restreinte à
 * la boutique propriétaire du compte transporteur : un transporteur ne peut pas toucher une expédition
 * d'une autre boutique.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ carrier: string }> }) {
  const { carrier } = await params;
  if (!isCarrierId(carrier) || carrier === "manual") {
    return NextResponse.json({ ok: false, error: "Transporteur inconnu" }, { status: 404 });
  }
  const limited = await rateLimit(`carrier:webhook:${carrier}`, 600, 60);
  if (!limited.ok) return NextResponse.json({ ok: false, error: "Trop de requêtes" }, { status: 429 });

  const raw = await req.text();
  if (raw.length > 100_000) return NextResponse.json({ ok: false, error: "Charge trop volumineuse" }, { status: 413 });
  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  const adapter = getCarrierAdapter(carrier);
  if (!adapter.verifyWebhook) return NextResponse.json({ ok: false, error: "Webhooks non pris en charge" }, { status: 404 });

  /* Anti-rejeu par NONCE (mineur n° 7) : la signature reçue est mémorisée 10 minutes. Deux requêtes au
     corps identique portent la même signature : la seconde est donc un rejeu, même dans la fenêtre
     d'horodatage tolérée. La table `RateLimit` sert de mémoire (TTL natif, multi-instances) : une
     limite de 1 sur la fenêtre = « vu une seule fois ». Contrôlé AVANT toute écriture, et seulement si
     une signature est présente (sinon la vérification échouera de toute façon). */
  const signature = headers["x-axi-signature"] ?? headers["x-signature"] ?? headers["signature"] ?? null;
  if (signature) {
    const fresh = await rateLimit(webhookNonceKey(carrier, signature), 1, WEBHOOK_NONCE_TTL_SECONDS);
    if (!fresh.ok) return NextResponse.json({ ok: true, ignored: "replay" });
  }

  // Comptes de ce transporteur : la signature est essayée avec chaque secret (plusieurs boutiques).
  const accounts = await db.carrierAccount.findMany({
    where: { carrier, active: true, credentialsEncrypted: { not: null } },
    select: { id: true, storeId: true, credentialsEncrypted: true },
    take: 500,
  });
  for (const account of accounts) {
    const parsed = adapter.verifyWebhook(raw, headers, carrierCredentials(account.credentialsEncrypted));
    if (!parsed) continue;
    const shipment = await db.shipment.findFirst({
      where: {
        storeId: account.storeId,
        carrier,
        OR: [{ providerRef: parsed.providerRef }, { trackingNumber: parsed.providerRef }],
      },
      select: { id: true, storeId: true },
    });
    // Signature valide mais expédition inconnue : 200 pour éviter que le transporteur ne rejoue sans fin.
    if (!shipment) return NextResponse.json({ ok: true, ignored: "shipment_not_found" });

    let applied = 0;
    for (const event of parsed.events) {
      const result = await recordShipmentEvent({
        storeId: shipment.storeId,
        shipmentId: shipment.id,
        status: event.status,
        source: "webhook",
        message: event.message ?? null,
        locationLabel: event.locationLabel ?? null,
        providerEventId: event.providerEventId ?? null,
        occurredAt: event.occurredAt,
      });
      if (result.applied) applied += 1;
    }
    return NextResponse.json({ ok: true, applied });
  }
  // Aucun secret ne valide la signature : rejet explicite (jamais d'événement accepté sans preuve).
  return NextResponse.json({ ok: false, error: "Signature invalide" }, { status: 401 });
}
