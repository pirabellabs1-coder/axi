"use client";

import { useSyncExternalStore } from "react";
import { lineKey } from "./format";

export { lineKey };

/**
 * Panier côté client, persisté dans localStorage (clé `axi:cart:{slug}`).
 * Les montants stockés sont purement indicatifs : le serveur recalcule tout (createOrder / previewTotals).
 */
export type CartSnapshot = { name: string; variantName: string | null; unitPrice: number; image: string | null; productSlug: string; optionNames?: string[]; /** Lot 1 : carte cadeau. */ isGiftCard?: boolean; /** Nature vendue (défaut : produit physique). */ kind?: "PHYSICAL" | "DIGITAL" | "SERVICE" | "GIFT_CARD" };

/** Lot 1 : destinataire d'une carte cadeau (revalidé par le serveur, `placeOrder.items[].giftCard`). */
export type GiftCardRecipientInput = { recipientName?: string; recipientPhone?: string; recipientEmail?: string; message?: string; sendAt?: string };

export type CartLine = {
  key: string;
  productId: string;
  variantId: string | null;
  optionIds: string[];
  quantity: number;
  snapshot: CartSnapshot;
  giftCard?: GiftCardRecipientInput;
};

const RECIPIENT_LIMITS: Record<keyof GiftCardRecipientInput, number> = { recipientName: 80, recipientPhone: 20, recipientEmail: 160, message: 300, sendAt: 40 };

function isRecipient(v: unknown): v is GiftCardRecipientInput {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  return Object.entries(v as Record<string, unknown>).every(([k, x]) => k in RECIPIENT_LIMITS && typeof x === "string" && x.length <= RECIPIENT_LIMITS[k as keyof GiftCardRecipientInput]);
}

/** Clé de ligne : une carte cadeau par destinataire (deux destinataires = deux lignes). */
function cartLineKey(l: Pick<CartLine, "productId" | "variantId" | "optionIds" | "giftCard">): string {
  const base = lineKey(l.productId, l.variantId, l.optionIds);
  if (!l.giftCard) return base;
  const raw = JSON.stringify([l.giftCard.recipientName ?? "", l.giftCard.recipientPhone ?? "", l.giftCard.recipientEmail ?? "", l.giftCard.message ?? "", l.giftCard.sendAt ?? ""]);
  let h = 5381;
  for (let i = 0; i < raw.length; i++) h = ((h << 5) + h + raw.charCodeAt(i)) >>> 0;
  return `${base}~gc${h.toString(36)}`;
}

type CartState = { lines: CartLine[]; open: boolean; hydrated: boolean };

const EMPTY: CartState = { lines: [], open: false, hydrated: false };
const stores = new Map<string, { state: CartState; listeners: Set<() => void> }>();

function storageKey(slug: string) {
  return `axi:cart:${slug}`;
}

function readStorage(slug: string): CartLine[] {
  try {
    const raw = window.localStorage.getItem(storageKey(slug));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isLine);
  } catch {
    return [];
  }
}

function isLine(l: unknown): l is CartLine {
  if (!l || typeof l !== "object") return false;
  const x = l as Record<string, unknown>;
  const s = x.snapshot as Record<string, unknown> | undefined;
  return (
    typeof x.key === "string" &&
    typeof x.productId === "string" &&
    (x.variantId === null || typeof x.variantId === "string") &&
    Number.isInteger(x.quantity) && (x.quantity as number) > 0 && (x.quantity as number) <= 999 &&
    Array.isArray(x.optionIds) && x.optionIds.every((o) => typeof o === "string") &&
    !!s && typeof s === "object" &&
    typeof s.name === "string" &&
    (s.variantName === null || typeof s.variantName === "string") &&
    typeof s.unitPrice === "number" && Number.isFinite(s.unitPrice) &&
    (s.image === null || typeof s.image === "string") &&
    typeof s.productSlug === "string" &&
    (s.optionNames === undefined || (Array.isArray(s.optionNames) && s.optionNames.every((o) => typeof o === "string"))) &&
    (s.isGiftCard === undefined || typeof s.isGiftCard === "boolean") &&
    (s.kind === undefined || (typeof s.kind === "string" && ["PHYSICAL", "DIGITAL", "SERVICE", "GIFT_CARD"].includes(s.kind))) &&
    (x.giftCard === undefined || isRecipient(x.giftCard))
  );
}

function writeStorage(slug: string, lines: CartLine[]) {
  try {
    window.localStorage.setItem(storageKey(slug), JSON.stringify(lines));
  } catch {
    /* quota / navigation privée : le panier reste en mémoire */
  }
}

function entry(slug: string) {
  let e = stores.get(slug);
  if (!e) {
    e = { state: EMPTY, listeners: new Set() };
    stores.set(slug, e);
  }
  return e;
}

function setState(slug: string, patch: Partial<CartState>, persist = false) {
  const e = entry(slug);
  e.state = { ...e.state, ...patch };
  if (persist && typeof window !== "undefined") writeStorage(slug, e.state.lines);
  e.listeners.forEach((l) => l());
}

function hydrate(slug: string) {
  const e = entry(slug);
  if (e.state.hydrated || typeof window === "undefined") return;
  e.state = { ...e.state, lines: readStorage(slug), hydrated: true };
}

function subscribe(slug: string, listener: () => void) {
  const e = entry(slug);
  e.listeners.add(listener);
  if (!e.state.hydrated) {
    hydrate(slug);
    // Notifier après hydratation (hors rendu) pour éviter un mismatch SSR.
    queueMicrotask(() => e.listeners.forEach((l) => l()));
  }
  const onStorage = (ev: StorageEvent) => {
    if (ev.key === storageKey(slug)) setState(slug, { lines: readStorage(slug) });
  };
  window.addEventListener("storage", onStorage);
  return () => {
    e.listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

const actionsCache = new Map<string, ReturnType<typeof buildActions>>();

export function cartActions(slug: string) {
  let a = actionsCache.get(slug);
  if (!a) {
    a = buildActions(slug);
    actionsCache.set(slug, a);
  }
  return a;
}

function buildActions(slug: string) {
  return {
    /** `open: false` : ajout rapide sans ouvrir le tiroir (retour visuel sur le bouton et le compteur). */
    add(line: Omit<CartLine, "key">, opts: { open?: boolean } = {}) {
      hydrate(slug);
      const key = cartLineKey(line);
      const lines = entry(slug).state.lines;
      const existing = lines.find((l) => l.key === key);
      const next = existing
        ? lines.map((l) => (l.key === key ? { ...l, quantity: Math.min(999, l.quantity + line.quantity), snapshot: line.snapshot } : l))
        : [...lines, { ...line, quantity: Math.min(999, line.quantity), key }];
      setState(slug, { lines: next, open: opts.open ?? true }, true);
    },
    setQuantity(key: string, quantity: number) {
      hydrate(slug);
      const lines = entry(slug).state.lines;
      const next = quantity <= 0 ? lines.filter((l) => l.key !== key) : lines.map((l) => (l.key === key ? { ...l, quantity: Math.min(999, quantity) } : l));
      setState(slug, { lines: next }, true);
    },
    /**
     * Montée en gamme : remplace la ligne `key` par `line`, à la même position. Si le produit proposé est déjà au
     * panier avec la même sélection, les quantités sont fusionnées. Renvoie `false` si la ligne n'existe plus.
     */
    replace(key: string, line: Omit<CartLine, "key">): boolean {
      hydrate(slug);
      const lines = entry(slug).state.lines;
      const index = lines.findIndex((l) => l.key === key);
      if (index < 0) return false;
      const nextKey = cartLineKey(line);
      const twin = lines.find((l) => l.key === nextKey && l.key !== key);
      const next = twin
        ? lines.filter((l) => l.key !== key).map((l) => (l.key === nextKey ? { ...l, quantity: Math.min(999, l.quantity + line.quantity), snapshot: line.snapshot } : l))
        : lines.map((l, i) => (i === index ? { ...line, quantity: Math.min(999, Math.max(1, line.quantity)), key: nextKey } : l));
      setState(slug, { lines: next }, true);
      return true;
    },
    remove(key: string) {
      hydrate(slug);
      setState(slug, { lines: entry(slug).state.lines.filter((l) => l.key !== key) }, true);
    },
    clear() {
      setState(slug, { lines: [] }, true);
      writeCartGiftCards(slug, []);
      clearOfferAttribution(slug);
    },
    openSheet() {
      setState(slug, { open: true });
    },
    closeSheet() {
      setState(slug, { open: false });
    },
  };
}

/** Lignes courantes du panier, hors React (lecture ponctuelle, tests). */
export function readCartLines(slug: string): CartLine[] {
  hydrate(slug);
  return entry(slug).state.lines;
}

export function useCart(slug: string) {
  const state = useSyncExternalStore(
    (l) => subscribe(slug, l),
    () => entry(slug).state,
    () => EMPTY,
  );
  const count = state.lines.reduce((s, l) => s + l.quantity, 0);
  const total = state.lines.reduce((s, l) => s + l.snapshot.unitPrice * l.quantity, 0);
  return { ...state, count, total, ...cartActions(slug) };
}

/* ───────── Note de commande et jeton de panier (brouillon serveur) ───────── */

export function readCartNote(slug: string): string {
  try {
    return window.localStorage.getItem(`axi:cart-note:${slug}`)?.slice(0, 500) ?? "";
  } catch {
    return "";
  }
}

export function writeCartNote(slug: string, note: string) {
  try {
    if (note.trim()) window.localStorage.setItem(`axi:cart-note:${slug}`, note.slice(0, 500));
    else window.localStorage.removeItem(`axi:cart-note:${slug}`);
  } catch {
    /* stockage indisponible */
  }
}

const TOKEN_RE = /^[0-9a-f]{32}$/;

/** Jeton du brouillon de panier côté serveur (saveCheckoutDraft), conservé jusqu'à la commande. */
export function readCartToken(slug: string): string | null {
  try {
    const t = window.localStorage.getItem(`axi:cart-token:${slug}`);
    return t && TOKEN_RE.test(t) ? t : null;
  } catch {
    return null;
  }
}

export function writeCartToken(slug: string, token: string | null) {
  try {
    if (token && TOKEN_RE.test(token)) window.localStorage.setItem(`axi:cart-token:${slug}`, token);
    else window.localStorage.removeItem(`axi:cart-token:${slug}`);
  } catch {
    /* stockage indisponible */
  }
}

/** Remplace le panier (restauration depuis un lien de relance). */
export function replaceCart(slug: string, lines: Omit<CartLine, "key">[]) {
  hydrate(slug);
  const merged: CartLine[] = [];
  for (const l of lines) {
    const key = cartLineKey(l);
    const ex = merged.find((m) => m.key === key);
    if (ex) ex.quantity = Math.min(999, ex.quantity + l.quantity);
    else merged.push({ ...l, quantity: Math.min(999, Math.max(1, l.quantity)), key });
  }
  setState(slug, { lines: merged }, true);
}

/* ───────── Lot 1 : cartes cadeaux saisies au panier, attribution des offres ───────── */

const GC_RE = /^[0-9A-HJKMNP-TV-Z]{16}$/;

/** Codes de cartes cadeaux saisis au panier (repris au checkout). Le serveur revalide tout. */
export function readCartGiftCards(slug: string): string[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(`axi:cart-giftcards:${slug}`) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((c): c is string => typeof c === "string" && GC_RE.test(c)).slice(0, 3) : [];
  } catch {
    return [];
  }
}

export function writeCartGiftCards(slug: string, codes: string[]) {
  try {
    const clean = codes.filter((c) => GC_RE.test(c)).slice(0, 3);
    if (clean.length) window.localStorage.setItem(`axi:cart-giftcards:${slug}`, JSON.stringify(clean));
    else window.localStorage.removeItem(`axi:cart-giftcards:${slug}`);
  } catch {
    /* stockage indisponible */
  }
}

const OFFER_RE = /^[\w-]{8,64}$/;

/** Offres au panier ayant conduit à un ajout (Order.attribution.offers), revalidées côté serveur. */
export function readOfferAttribution(slug: string): string[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(`axi:cart-offers:${slug}`) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((c): c is string => typeof c === "string" && OFFER_RE.test(c)).slice(0, 20) : [];
  } catch {
    return [];
  }
}

export function recordOfferAttribution(slug: string, offerId: string) {
  if (!OFFER_RE.test(offerId)) return;
  try {
    const next = [...new Set([...readOfferAttribution(slug), offerId])].slice(-20);
    window.localStorage.setItem(`axi:cart-offers:${slug}`, JSON.stringify(next));
  } catch {
    /* stockage indisponible */
  }
}

function clearOfferAttribution(slug: string) {
  try {
    window.localStorage.removeItem(`axi:cart-offers:${slug}`);
  } catch {
    /* stockage indisponible */
  }
}
