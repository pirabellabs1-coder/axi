import { catalogOrderSummary } from "@/lib/social/whatsapp-order";

/** Message WhatsApp tel que reçu dans les webhooks Meta (messages, échos coexistence, historique). */
export type WaMessage = {
  id?: string;
  from?: string;
  to?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
  image?: { caption?: string };
  video?: { caption?: string };
  document?: { caption?: string; filename?: string };
  location?: { name?: string; address?: string };
  order?: unknown; // panier du catalogue WhatsApp (lot 1 bis, src/lib/social/whatsapp-order.ts)
};

const MEDIA_LABELS: Record<string, string> = {
  image: "Photo reçue",
  video: "Vidéo reçue",
  audio: "Message vocal reçu",
  voice: "Message vocal reçu",
  document: "Document reçu",
  sticker: "Autocollant reçu",
  location: "Position partagée",
  contacts: "Contact partagé",
  reaction: "Réaction",
};

/** Chaîne ou undefined : les charges utiles Meta ne sont pas typées, un champ inattendu ne doit jamais lever. */
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** Texte affichable d'un message (légende ou libellé du média), borné à 4000 caractères. Ne lève jamais. */
export function bodyOf(m: WaMessage): string {
  const type = str(m.type) ?? "";
  if (type === "order") return catalogOrderSummary(m.order);
  const interactive = obj(m.interactive);
  const location = m.location ? obj(m.location) : null;
  const text =
    str(obj(m.text).body) ??
    str(obj(m.button).text) ??
    str(obj(interactive.button_reply).title) ??
    str(obj(interactive.list_reply).title) ??
    str(obj(m.image).caption) ??
    str(obj(m.video).caption) ??
    str(obj(m.document).caption) ??
    (location ? [str(location.name), str(location.address)].filter(Boolean).join(", ") : undefined);
  const label = Object.prototype.hasOwnProperty.call(MEDIA_LABELS, type) ? MEDIA_LABELS[type] : undefined;
  if (text && label && type !== "text") return `[${label}] ${text}`.slice(0, 4000);
  return (text ?? (label ? `[${label}]` : "[Message non pris en charge]")).slice(0, 4000);
}

/** Tolérance d'horloge pour un horodatage Meta dans le futur. */
const MAX_FUTURE_MS = 5 * 60_000;

/** Horodatage Meta (secondes Unix) → Date, borné à maintenant + 5 min ; maintenant si absent/invalide. */
export function dateOf(timestamp: unknown): Date {
  const now = Date.now();
  const ts = typeof timestamp === "string" || typeof timestamp === "number" ? Number(timestamp) : NaN;
  if (!Number.isFinite(ts) || ts <= 0) return new Date(now);
  return new Date(Math.min(ts * 1000, now + MAX_FUTURE_MS));
}
