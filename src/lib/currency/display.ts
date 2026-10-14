import "server-only";
import { cookies, headers } from "next/headers";
import type { Subscription } from "@prisma/client";
import type { FxContext } from "./convert";
import { loadStoreFx } from "./rates";
import { CURRENCY_COOKIE, currencyName, pickDisplayCurrency } from "./pick";

/**
 * Devise d'affichage de l'acheteur courant (vitrine, panier, checkout). Lit le cookie `axi_cur`, puis
 * `x-vercel-ip-country` et `Accept-Language` (§1.2). Ne retourne qu'une devise ACTIVE dont le taux est frais ;
 * sinon la devise de la boutique (fx = null).
 */
export type DisplayCurrency = {
  storeCurrency: string;
  currency: string;
  fx: FxContext | null;
  /** Devises affichables (hors devise boutique), dans l'ordre d'activation. */
  available: string[];
};

type FxStore = { id: string; currency: string; subscription?: Subscription | null };

export async function getDisplayCurrency(store: FxStore, now = new Date()): Promise<DisplayCurrency> {
  const state = await loadStoreFx(store, now);
  if (state.available.length === 0) return { storeCurrency: store.currency, currency: store.currency, fx: null, available: [] };
  const [jar, h] = await Promise.all([cookies(), headers()]);
  const currency = pickDisplayCurrency({
    cookie: jar.get(CURRENCY_COOKIE)?.value ?? null,
    ipCountry: h.get("x-vercel-ip-country"),
    acceptLanguage: h.get("accept-language"),
    available: state.available,
    storeCurrency: store.currency,
  });
  return { storeCurrency: store.currency, currency, fx: state.contexts.get(currency) ?? null, available: state.available };
}

/** Données du sélecteur de devise (`<CurrencyPicker>`), à passer telles quelles au composant client. */
export type CurrencyPickerData = { current: string; options: { code: string; label: string }[] };

/** Données du sélecteur à partir d'un contexte déjà chargé (module pur : aucune relecture du cookie). */
export function currencyPickerData(d: DisplayCurrency): CurrencyPickerData | null {
  if (d.available.length === 0) return null;
  const codes = [d.storeCurrency, ...d.available];
  return { current: d.currency, options: codes.map((code) => ({ code, label: `${code === "XOF" || code === "XAF" ? "FCFA" : code} · ${currencyName(code)}` })) };
}

export async function getCurrencyPickerData(store: FxStore): Promise<CurrencyPickerData | null> {
  return currencyPickerData(await getDisplayCurrency(store));
}
