import { createHash, timingSafeEqual } from "node:crypto";
import { currencyDecimals } from "@/lib/money";
import { SITE } from "@/config/site";
import type { GatewayStatus } from "../provider";

/** Délai maximal d'un appel fournisseur : jamais de requête pendante dans un parcours client. */
export const PROVIDER_TIMEOUT_MS = 15_000;

export type ProviderResponse = { ok: boolean; status: number; json: Record<string, unknown> | null } | { ok: false; status: 0; json: null; networkError: string };

/** fetch borné dans le temps, sans exception : erreurs réseau et JSON invalide sont rendus comme valeurs. */
export async function providerFetch(url: string, init: RequestInit = {}, timeoutMs = PROVIDER_TIMEOUT_MS): Promise<ProviderResponse> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    const text = await res.text();
    let json: Record<string, unknown> | null = null;
    try {
      const parsed: unknown = text ? JSON.parse(text) : null;
      json = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json };
  } catch (e) {
    const name = (e as Error)?.name;
    return { ok: false, status: 0, json: null, networkError: name === "TimeoutError" || name === "AbortError" ? "délai dépassé" : "fournisseur injoignable" };
  }
}

export function networkErrorOf(r: ProviderResponse): string | null {
  return "networkError" in r ? r.networkError : null;
}

/** Comparaison en temps constant de deux chaînes (longueurs différentes : faux). */
export function safeEqualStr(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** Montant Axi (XOF entier, EUR en centimes) → unités majeures en chaîne (« 1500 », « 12.50 »). */
export function toMajorString(amount: number, currency: string): string {
  if (currencyDecimals(currency) === 0) return String(Math.round(amount));
  const v = Math.round(amount);
  return `${Math.trunc(v / 100)}.${String(Math.abs(v % 100)).padStart(2, "0")}`;
}

/** Unités majeures du fournisseur (« 1500.00 ») → montant Axi ; null si illisible. */
export function fromMajor(value: unknown, currency: string): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim()) ? Number(value) : NaN;
  if (!Number.isFinite(n)) return null;
  return currencyDecimals(currency) === 0 ? Math.round(n) : Math.round(n * 100);
}

/** Téléphone en chiffres seuls (E.164 sans « + »). */
export function digitsOnly(phone: string | null | undefined): string {
  return String(phone ?? "").replace(/\D/g, "");
}

/** Nom complet → prénom / nom d'au moins 2 caractères (exigence CinetPay). */
export function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  const pad = (s: string | undefined) => (s && s.length >= 2 ? s.slice(0, 120) : "Client");
  if (parts.length === 0) return { first: "Client", last: "Client" };
  if (parts.length === 1) return { first: pad(parts[0]), last: pad(parts[0]) };
  return { first: pad(parts[0]), last: pad(parts.slice(1).join(" ")) };
}

/**
 * POINT D'INTÉGRATION : e-mail technique quand le client n'en a pas donné.
 * Paystack et CinetPay exigent un e-mail valide ; une boutique WhatsApp n'en collecte pas toujours.
 * On dérive une adresse non routable mais syntaxiquement valide sur le domaine de la plateforme
 * (`client-<téléphone>@<domaine>`). Si le fournisseur refuse ce domaine, remplacez-la ici
 * (ex. une boîte catch-all dédiée) : c'est l'unique endroit concerné.
 */
export function payerEmail(email: string | null | undefined, phone: string): string {
  const e = String(email ?? "").trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254) return e;
  let host = "axi.africa";
  try {
    const h = new URL(SITE.url).hostname;
    if (h.includes(".") && !/^\d+\.\d+\.\d+\.\d+$/.test(h)) host = h;
  } catch {
    // SITE.url invalide : domaine par défaut.
  }
  return `client-${digitsOnly(phone) || "inconnu"}@${host}`;
}

/** Raccourcit une URL de retour à `max` caractères : sans requête, puis origine seule (le webhook fait foi). */
export function fitUrl(url: string, max: number): string {
  if (url.length <= max) return url;
  try {
    const u = new URL(url);
    const noQuery = `${u.origin}${u.pathname}`;
    if (noQuery.length <= max) return noQuery;
    return `${u.origin}/`.slice(0, max);
  } catch {
    return url.slice(0, max);
  }
}

/** Texte limité à [A-Za-z0-9 ] (messages relevés pawaPay). */
export function alnumText(s: string, max: number): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}

/** Session de paiement abandonnée au-delà de ce délai : considérée expirée. */
export const ABANDONED_AFTER_MS = 30 * 60_000;

export function isAbandoned(ctx: { initiatedAt?: Date | null } | undefined, now = Date.now(), afterMs = ABANDONED_AFTER_MS): boolean {
  const at = ctx?.initiatedAt?.getTime();
  return typeof at === "number" && now - at > afterMs;
}

export type { GatewayStatus };
