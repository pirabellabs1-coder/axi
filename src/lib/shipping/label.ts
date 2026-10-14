/**
 * Étiquette interne A6 / 100 × 150 mm des transporteurs « manual » (lot 3 §1.2).
 * Module PUR (aucun accès base, aucune dépendance) : il assemble les données de l'étiquette, le QR du
 * lien de suivi (src/lib/qr) et le code-barres Code 128 (./code128). Données personnelles minimisées :
 * prénom du destinataire et téléphone partiellement masqué.
 */

import { encodeText, toSvgString } from "@/lib/qr/encoder";
import { code128Svg, sanitizeCode128 } from "./code128";
import { firstNameOnly, maskPhone } from "./courier-code";

export type LabelParty = { name: string; phone?: string | null; address?: string | null; city?: string | null };

export type LabelInput = {
  reference: string;
  trackingNumber?: string | null;
  trackingUrl: string;
  weightGrams?: number | null;
  sender: LabelParty;
  recipient: LabelParty & { note?: string | null };
  itemsCount: number;
  cashToCollect?: number;
  currency?: string;
  carrierLabel: string;
  /** Repère de livraison (zone) affiché en gros sur l'étiquette. */
  zoneLabel?: string | null;
};

export type LabelView = {
  reference: string;
  code: string;
  barcodeSvg: string;
  qrSvg: string;
  weightLabel: string;
  sender: { name: string; phone: string; address: string };
  recipient: { name: string; phone: string; address: string; note: string | null };
  zoneLabel: string | null;
  itemsLabel: string;
  cashLabel: string | null;
  carrierLabel: string;
};

function addressLine(p: LabelParty): string {
  return [p.address, p.city].filter(Boolean).join(", ") || "—";
}

export function buildLabel(input: LabelInput): LabelView {
  const code = sanitizeCode128(input.trackingNumber || input.reference, 24);
  return {
    reference: input.reference,
    code,
    barcodeSvg: code128Svg(code, { height: 36 }),
    qrSvg: toSvgString(encodeText(input.trackingUrl, { ecc: "M" }), { border: 1, title: `Suivi ${input.reference}` }),
    weightLabel: input.weightGrams && input.weightGrams > 0 ? `${(input.weightGrams / 1000).toFixed(input.weightGrams % 1000 === 0 ? 0 : 2)} kg` : "Poids non renseigné",
    sender: { name: input.sender.name, phone: input.sender.phone ?? "—", address: addressLine(input.sender) },
    recipient: {
      // Prénom seul et téléphone masqué (minimisation) ; le numéro complet reste côté commerçant.
      name: firstNameOnly(input.recipient.name),
      phone: maskPhone(input.recipient.phone),
      address: addressLine(input.recipient),
      note: input.recipient.note?.slice(0, 120) ?? null,
    },
    zoneLabel: input.zoneLabel ?? null,
    itemsLabel: `${input.itemsCount} article${input.itemsCount > 1 ? "s" : ""}`,
    cashLabel: input.cashToCollect && input.cashToCollect > 0 ? `À encaisser : ${input.cashToCollect.toLocaleString("fr-FR")} ${input.currency ?? "XOF"}` : null,
    carrierLabel: input.carrierLabel,
  };
}
