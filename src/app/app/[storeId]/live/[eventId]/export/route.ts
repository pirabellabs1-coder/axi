import { requireStore, AuthError } from "@/lib/auth/permissions";
import { audit } from "@/lib/audit";
import { PLANS } from "@/config/plans";
import { csvResponse, toCsv } from "@/lib/csv";
import { listLiveClaims } from "@/lib/live/claims";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = { RESERVED: "Réservé", MESSAGED: "Lien envoyé", PAID: "Payé", EXPIRED: "Expiré", CANCELLED: "Annulé" };

/** Export CSV des réservations d'un direct (capacité `export`, isolation par boutique). Aucun identifiant social exporté. */
export async function GET(_req: Request, { params }: { params: Promise<{ storeId: string; eventId: string }> }) {
  const { storeId, eventId } = await params;
  try {
    const ctx = await requireStore(storeId, "export");
    if (!PLANS[ctx.planId].features.liveShopping) return new Response("Le live shopping est inclus à partir du plan Scale.", { status: 403 });
    const event = await db.liveEvent.findFirst({ where: { id: eventId, storeId: ctx.store.id }, select: { id: true } });
    if (!event) return new Response("Introuvable", { status: 404 });
    const rows = await listLiveClaims(ctx.store.id, event.id, 5000);
    const csv = toCsv(
      ["Date", "Plateforme", "Client", "Commentaire", "Code", "Article", "Quantité", "Montant", "Devise", "Statut", "Commande"],
      rows.map((r) => [
        r.createdAt.toISOString(),
        r.platform === "FACEBOOK" ? "Facebook" : "Instagram",
        r.authorName ?? "",
        r.commentText,
        r.code.toUpperCase(),
        r.productLabel,
        r.quantity,
        r.amount,
        r.currency,
        r.ordered && r.status !== "PAID" ? "Commandé" : STATUS[r.status],
        r.orderId ?? "",
      ]),
    );
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "live.claims_exported", target: event.id, metadata: { rows: rows.length } });
    return csvResponse(`reservations-direct-${event.id.slice(-6)}.csv`, csv);
  } catch (e) {
    if (e instanceof AuthError) return new Response(e.message, { status: e.code === "UNAUTHENTICATED" ? 401 : 403 });
    throw e;
  }
}
