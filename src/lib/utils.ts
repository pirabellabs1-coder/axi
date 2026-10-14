import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Tailles typographiques du design system (sinon twMerge les confond avec des couleurs `text-*`).
const twMerge = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ text: ["display", "h1", "h2", "h3"] }] } },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sans 0/O/1/I pour la lisibilité

export function randomReference(prefix = "AX", length = 6): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return `${prefix}-${out}`;
}

export function randomToken(bytes = 32): string {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function formatDate(d: Date | string, opts: Intl.DateTimeFormatOptions = {}) {
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric", ...opts }).format(date);
}

export function formatDateTime(d: Date | string) {
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function relativeTime(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const diff = (date.getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  return formatDate(date);
}

/** Normalise un numéro local en E.164 sans '+'. Retourne null si invalide. */
/**
 * Plans de numérotation où le 0 initial fait partie du numéro national (10 chiffres).
 * Bénin : depuis le 30/11/2024, numéros à 10 chiffres préfixés « 01 » (les anciens numéros à 8 chiffres reçoivent « 01 »).
 * Côte d'Ivoire : 10 chiffres depuis 2021, 0 initial conservé.
 */
const NATIONAL_PLANS: Record<string, { length: number; legacyLength?: number; legacyPrefix?: string }> = {
  "229": { length: 10, legacyLength: 8, legacyPrefix: "01" },
  "225": { length: 10 },
};

/** Normalise un numéro local en E.164 sans '+'. Retourne null si invalide. */
export function normalizePhone(raw: string, dialCode: string): string | null {
  let digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (digits.startsWith("00")) digits = digits.slice(2);
  let national = digits.startsWith(dialCode) && digits.length > dialCode.length + 7 ? digits.slice(dialCode.length) : digits;
  const plan = NATIONAL_PLANS[dialCode];
  if (plan) {
    if (national.length === plan.length) return `${dialCode}${national}`;
    if (plan.legacyLength && plan.legacyPrefix && national.length === plan.legacyLength) return `${dialCode}${plan.legacyPrefix}${national}`;
    if (national.length === plan.length - 1 && !national.startsWith("0")) return `${dialCode}0${national}`;
    return null;
  }
  if (national.startsWith("0")) national = national.slice(1);
  if (national.length < 6 || national.length > 11) return null;
  return `${dialCode}${national}`;
}

export function formatPhone(e164: string): string {
  // 22997000000 -> +229 97 00 00 00
  const m = e164.match(/^(\d{3})(\d+)$/);
  if (!m) return `+${e164}`;
  // Groupes de deux chiffres en partant de la fin : un numéro de longueur impaire garde un chiffre isolé en tête.
  const rest = m[2].replace(/\B(?=(\d{2})+$)/g, " ");
  return `+${m[1]} ${rest}`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export function currentPeriod(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

export function addMonths(d: Date, months: number): Date {
  const r = new Date(d);
  r.setMonth(r.getMonth() + months);
  return r;
}

/** Exemple de numéro national affiché en placeholder selon l'indicatif. */
export function phonePlaceholder(dialCode = "229"): string {
  const map: Record<string, string> = { "229": "01 97 00 00 00", "225": "07 07 00 00 00", "221": "77 123 45 67", "228": "90 00 00 00", "237": "6 71 00 00 00", "33": "6 12 34 56 78" };
  return map[dialCode] ?? "Numéro local";
}
