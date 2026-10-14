import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { SITE } from "@/config/site";
import { buildLabel } from "@/lib/shipping/label";
import { CARRIER_LABELS, type CarrierId } from "@/lib/carriers/types";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Étiquette d'expédition", robots: { index: false } };

/**
 * Étiquette interne A6 / 100 × 150 mm (lot 3 §1.2) : expéditeur, destinataire (prénom et téléphone
 * partiellement masqué — données personnelles minimisées), repère de zone, référence, poids, QR du
 * lien de suivi et code-barres Code 128. Impression navigateur, sans dépendance ni image générée.
 */
export default async function ShipmentLabelPage({ params }: { params: Promise<{ storeId: string; orderId: string; shipmentId: string }> }) {
  const { storeId, orderId, shipmentId } = await params;
  const ctx = await getStoreContext(storeId, "orders.manage");

  const shipment = await db.shipment.findFirst({
    where: { id: shipmentId, storeId: ctx.store.id, orderId },
    select: {
      id: true,
      carrier: true,
      trackingNumber: true,
      weightGrams: true,
      items: { select: { quantity: true } },
      location: { select: { name: true, address: true, city: true, phone: true } },
      order: {
        select: {
          reference: true,
          customerName: true,
          customerPhone: true,
          deliveryAddress: true,
          deliveryZoneName: true,
          customerNote: true,
          trackingToken: true,
          paymentStatus: true,
          amountDue: true,
          total: true,
        },
      },
    },
  });
  if (!shipment) notFound();

  const base = process.env.NEXT_PUBLIC_APP_URL ?? SITE.url ?? "http://localhost:3000";
  const label = buildLabel({
    reference: shipment.order.reference,
    trackingNumber: shipment.trackingNumber,
    trackingUrl: `${base}/suivi/${shipment.order.trackingToken}`,
    weightGrams: shipment.weightGrams,
    sender: {
      name: ctx.store.name,
      phone: ctx.store.contactPhone ?? ctx.store.whatsappNumber ?? null,
      address: shipment.location?.address ?? ctx.store.address ?? null,
      city: shipment.location?.city ?? ctx.store.city ?? null,
    },
    recipient: {
      name: shipment.order.customerName,
      phone: shipment.order.customerPhone,
      address: shipment.order.deliveryAddress,
      city: shipment.order.deliveryZoneName,
      note: shipment.order.customerNote,
    },
    itemsCount: shipment.items.reduce((s, i) => s + i.quantity, 0),
    cashToCollect: shipment.order.paymentStatus === "PAID" ? 0 : (shipment.order.amountDue ?? shipment.order.total),
    currency: ctx.store.currency,
    carrierLabel: CARRIER_LABELS[shipment.carrier as CarrierId] ?? shipment.carrier,
    zoneLabel: shipment.order.deliveryZoneName,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">Étiquette {label.reference}</h1>
          <p className="text-sm text-ink-muted">Format A6 (100 × 150 mm). Imprimez sans marges pour une étiquette autocollante.</p>
        </div>
        <PrintButton />
      </div>

      <div className="label-sheet mx-auto w-full max-w-[400px] bg-white p-4 text-black ring-1 ring-black/15 print:max-w-none print:ring-0">
        <div className="flex items-start justify-between gap-3 border-b border-black/20 pb-2">
          <div>
            <p className="text-[11px] uppercase tracking-wide">Expéditeur</p>
            <p className="text-[13px] font-semibold">{label.sender.name}</p>
            <p className="text-[11px]">{label.sender.address}</p>
            <p className="text-[11px]">{label.sender.phone}</p>
          </div>
          <div className="w-[76px] shrink-0" dangerouslySetInnerHTML={{ __html: label.qrSvg }} />
        </div>

        <div className="py-2">
          <p className="text-[11px] uppercase tracking-wide">Destinataire</p>
          <p className="text-[18px] font-bold leading-tight">{label.recipient.name}</p>
          <p className="text-[13px]">{label.recipient.address}</p>
          <p className="text-[13px] tabular">{label.recipient.phone}</p>
          {label.recipient.note && <p className="mt-1 text-[11px] italic">Repère : {label.recipient.note}</p>}
        </div>

        {label.zoneLabel && (
          <p className="border-y border-black/20 py-1 text-center text-[16px] font-bold uppercase tracking-wide">{label.zoneLabel}</p>
        )}

        <div className="flex items-center justify-between gap-2 py-2 text-[11px]">
          <span>{label.itemsLabel}</span>
          <span>{label.weightLabel}</span>
          <span>{label.carrierLabel}</span>
        </div>

        {label.cashLabel && <p className="mb-2 rounded border border-black/40 px-2 py-1 text-center text-[13px] font-bold">{label.cashLabel}</p>}

        <div className="pt-1" dangerouslySetInnerHTML={{ __html: label.barcodeSvg }} />
        <p className="mt-1 text-center text-[12px] font-semibold tracking-[0.12em]">{label.code}</p>
      </div>
    </div>
  );
}
