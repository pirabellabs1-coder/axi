import { normalizePhone } from "@/lib/utils";

/**
 * Numéros WhatsApp (module pur) : le numéro « Commander sur WhatsApp » (wa.me) doit être celui relié à l'API,
 * sinon les messages des clients n'arrivent pas dans la boîte Axi. Formats stockés : E.164 sans « + ».
 */

/** Numéro saisi au format international explicite (« + » ou « 00 ») : chiffres E.164, quel que soit le pays. */
export function internationalDigits(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim();
  if (!t.startsWith("+") && !t.startsWith("00")) return null;
  const digits = t.replace(/\D/g, "").replace(/^00/, "");
  return digits.length >= 8 && digits.length <= 15 && !digits.startsWith("0") ? digits : null;
}

/** Saisie du marchand → E.164 sans « + » : international explicite accepté, sinon plan national du pays. */
export function normalizeWaNumber(raw: string, dialCode: string): string | null {
  return internationalDigits(raw) ?? normalizePhone(raw, dialCode);
}

/** Numéro affiché par Meta (« +1 555-475-7216 ») → E.164 sans « + », ou null. */
export function apiNumberDigits(displayPhoneNumber: string | null | undefined): string | null {
  const digits = (displayPhoneNumber ?? "").replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15 && !digits.startsWith("0") ? digits : null;
}

/** Les deux numéros désignent-ils la même ligne ? (comparaison sur les chiffres) */
export function sameNumber(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = (a ?? "").replace(/\D/g, "");
  const db = (b ?? "").replace(/\D/g, "");
  return da.length > 0 && da === db;
}
