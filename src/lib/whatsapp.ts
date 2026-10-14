import { formatMoney } from "@/lib/money";

/**
 * Lien wa.me prérempli (P0). Le clic est journalisé comme *tentative* : il n'atteste jamais de l'envoi.
 */
export function waLink(number: string, text: string): string {
  const n = number.replace(/[^\d]/g, "");
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}

export function buildOrderMessage(params: {
  storeName: string;
  reference: string;
  customerName?: string;
  items: { name: string; variantName?: string | null; quantity: number; lineTotal: number }[];
  currency: string;
  subtotal: number;
  discount: number;
  deliveryFee: number;
  total: number;
  fulfillment: "PICKUP" | "DELIVERY" | "WHATSAPP" | "DIGITAL";
  address?: string | null;
  trackingUrl?: string;
  note?: string | null;
}): string {
  const lines: string[] = [];
  lines.push(`Bonjour ${params.storeName}`);
  lines.push(`Je souhaite commander (réf. *${params.reference}*) :`);
  lines.push("");
  for (const it of params.items) {
    lines.push(`▪ ${it.quantity} × ${it.name}${it.variantName ? ` (${it.variantName})` : ""} : ${formatMoney(it.lineTotal, params.currency)}`);
  }
  lines.push("");
  if (params.discount > 0) lines.push(`Remise : −${formatMoney(params.discount, params.currency)}`);
  if (params.fulfillment === "DELIVERY") {
    lines.push(`Livraison : ${params.deliveryFee > 0 ? formatMoney(params.deliveryFee, params.currency) : "offerte"}`);
    if (params.address) lines.push(`Adresse : ${params.address}`);
  } else if (params.fulfillment === "PICKUP") {
    lines.push("Mode : retrait en boutique");
  }
  lines.push(`*Total : ${formatMoney(params.total, params.currency)}*`);
  if (params.customerName) lines.push(`Nom : ${params.customerName}`);
  if (params.note) lines.push(`Note : ${params.note}`);
  if (params.trackingUrl) {
    lines.push("");
    lines.push(`Détails : ${params.trackingUrl}`);
  }
  return lines.join("\n");
}

export function buildCartMessage(params: { storeName: string; items: { name: string; variantName?: string | null; quantity: number; lineTotal: number }[]; currency: string; total: number; cartUrl?: string }): string {
  const lines = [`Bonjour ${params.storeName}`, "Je suis intéressé(e) par :", ""];
  for (const it of params.items) lines.push(`▪ ${it.quantity} × ${it.name}${it.variantName ? ` (${it.variantName})` : ""} : ${formatMoney(it.lineTotal, params.currency)}`);
  lines.push("", `*Total estimé : ${formatMoney(params.total, params.currency)}*`);
  if (params.cartUrl) lines.push("", `Mon panier : ${params.cartUrl}`);
  return lines.join("\n");
}
