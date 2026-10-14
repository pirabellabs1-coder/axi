import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { verifyPlatformWebhook, type PlatformBillingProvider } from "@/lib/billing/platform-billing";
import { confirmInvoicePayment } from "@/lib/billing/service";
import { confirmationHasAmount } from "@/lib/billing/rules";
import { recordInvalidWebhook } from "@/lib/payments/service";

export const dynamic = "force-dynamic";

const MAX_BODY = 1_000_000; // 1 Mo
const PROVIDERS: PlatformBillingProvider[] = ["fedapay", "kkiapay", "stripe"];

/**
 * Webhook de facturation PLATEFORME (abonnements et options Axi), distinct du webhook des ventes.
 * À déclarer chez le fournisseur : {APP_URL}/api/webhooks/billing/{fedapay|kkiapay|stripe}.
 *
 * 1. Signature vérifiée sur le corps brut avec les clés plateforme (env), sinon 400.
 * 2. Idempotence : ProviderEvent unique (provider = "billing_{provider}", eventId) ; un doublon renvoie 200.
 * 3. Facture retrouvée par providerRef (session / transaction) ou par l'identifiant de facture repris
 *    en métadonnée (attemptId / client_reference_id), montant et devise contrôlés.
 * 4. Statut CONFIRMED → confirmInvoicePayment() : facture payée, abonnement ou option activé.
 */
export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!PROVIDERS.includes(provider as PlatformBillingProvider)) return text("unknown provider", 404);
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY) return text("Payload Too Large", 413);
  const raw = await req.text();
  if (raw.length > MAX_BODY) return text("Payload Too Large", 413);

  let payload: Prisma.InputJsonValue;
  try {
    payload = JSON.parse(raw) as Prisma.InputJsonValue;
  } catch {
    return text("invalid json", 400);
  }

  const v = await verifyPlatformWebhook(provider as PlatformBillingProvider, raw, req.headers);
  const source = `billing_${provider}`;
  if (!v.ok) {
    // Échantillon borné (taille + 512 premiers caractères), et au plus quelques traces par fenêtre (m14).
    await recordInvalidWebhook(source, raw, v.error);
    return text(v.error, 400);
  }

  try {
    await db.providerEvent.create({ data: { provider: source, eventId: v.eventId, type: v.type, payload, signatureValid: true } });
  } catch (e) {
    if (!(e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2002")) throw e;
    // Rejeu : déjà traité → 200 ; traitement précédent interrompu (erreur 500) → on retraite (confirmation idempotente).
    const prev = await db.providerEvent.findUnique({ where: { provider_eventId: { provider: source, eventId: v.eventId } } });
    if (!prev || prev.processedAt || !prev.signatureValid) return text("duplicate", 200);
  }

  const invoiceHint = findString(payload, ["attemptId", "client_reference_id", "invoiceId"]);
  const byRef = await db.invoice.findFirst({ where: { providerRef: v.providerRef } });
  const byHint = invoiceHint ? await db.invoice.findUnique({ where: { id: invoiceHint } }) : null;
  if (byRef && byHint && byRef.id !== byHint.id) {
    await orphan(source, v, null, "référence et métadonnée désignent deux factures différentes");
    return text("ambiguous invoice", 200);
  }
  const invoice = byRef ?? byHint;
  if (v.status !== "CONFIRMED") {
    await mark(source, v.eventId, invoice ? null : "invoice not found");
    return text(`ignored ${v.status.toLowerCase()}`, 200);
  }
  if (!invoice) {
    await orphan(source, v, null, "facture introuvable");
    return text("no matching invoice", 202);
  }
  // m12 : un paiement confirmé sans montant ni devise n'est jamais appliqué (à vérifier à la main).
  if (!confirmationHasAmount(v)) {
    await orphan(source, v, invoice.id, "confirmation sans montant ou sans devise : à vérifier auprès du fournisseur");
    return text("missing amount recorded", 200);
  }
  if (v.amount !== invoice.amount || v.currency!.toUpperCase() !== invoice.currency.toUpperCase()) {
    await orphan(source, v, invoice.id, `montant ou devise différents (${v.amount} ${v.currency ?? ""} au lieu de ${invoice.amount} ${invoice.currency})`);
    return text("mismatch recorded", 200);
  }
  // Facture déjà réglée par une AUTRE transaction : double encaissement, à rembourser (jamais ignoré).
  if (invoice.status === "PAID" && invoice.providerRef && invoice.providerRef !== v.providerRef) {
    await orphan(source, v, invoice.id, `paiement en double : facture ${invoice.number} déjà réglée (référence ${invoice.providerRef}), à rembourser`);
    return text("duplicate payment recorded", 200);
  }
  if (invoice.status === "VOID") {
    await orphan(source, v, invoice.id, `facture ${invoice.number} annulée entre-temps (changement de plan)`);
    return text("invoice void, recorded", 200);
  }

  const r = await confirmInvoicePayment(invoice.id, { via: "webhook", providerRef: v.providerRef });
  await mark(source, v.eventId, r.ok ? null : (r.error ?? "confirm failed"));
  return text(r.already ? "already paid" : "ok", 200);
}

export function GET() {
  return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
}

/**
 * Paiement confirmé chez le fournisseur mais non applicable (facture annulée, introuvable, montant différent) :
 * l'argent est encaissé, donc on ne l'ignore jamais. Ticket support + audit pour remboursement ou réaffectation.
 */
async function orphan(provider: string, v: { eventId: string; providerRef: string; amount?: number; currency?: string; status: string }, invoiceId: string | null, reason: string) {
  await mark(provider, v.eventId, reason);
  if (v.status !== "CONFIRMED") return;
  const inv = invoiceId ? await db.invoice.findUnique({ where: { id: invoiceId }, include: { subscription: { select: { storeId: true } } } }) : null;
  const storeId = inv?.subscription.storeId ?? null;
  await db.supportTicket.create({
    data: {
      storeId,
      email: "billing@axi.africa",
      subject: `Paiement à régulariser (${provider}) : ${v.providerRef}`,
      message: `Paiement confirmé par ${provider} mais non appliqué : ${reason}.
Référence fournisseur : ${v.providerRef}
Événement : ${v.eventId}
Montant : ${v.amount ?? "?"} ${v.currency ?? ""}
Facture : ${inv?.number ?? "aucune"}
À rembourser ou à réaffecter depuis /admin.`,
    },
  });
  await db.auditLog.create({ data: { storeId, action: "invoice.payment_orphaned", target: invoiceId, metadata: { provider, providerRef: v.providerRef, eventId: v.eventId, reason } } });
}

function text(body: string, status: number) {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

async function mark(provider: string, eventId: string, error: string | null) {
  await db.providerEvent.updateMany({ where: { provider, eventId }, data: { processedAt: new Date(), error } });
}

/** Recherche d'une clé (profondeur bornée) dans un payload JSON non fiable. */
function findString(node: unknown, keys: string[], depth = 0): string | null {
  if (!node || typeof node !== "object" || depth > 6) return null;
  for (const [k, val] of Object.entries(node as Record<string, unknown>)) {
    if (keys.includes(k) && typeof val === "string" && /^[a-z0-9]{8,64}$/i.test(val)) return val;
    const nested = findString(val, keys, depth + 1);
    if (nested) return nested;
  }
  return null;
}
