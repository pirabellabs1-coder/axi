import "server-only";
import { isFresh, ONE, resolvePlatformRate, type FxRate } from "@/lib/currency/convert";
import { loadPlatformRates } from "@/lib/currency/rates";
import { TiktokShopError } from "./types";

/**
 * Taux plateforme `from → to` (1 unité de `from` = x unités de `to`) pour TikTok Shop : taux BCE / parités fixes
 * (src/lib/currency). Taux absent ou de plus de 72 h : erreur RETENTABLE (on ne publie ni n'importe jamais avec un
 * taux périmé ; le job repasse après le rafraîchissement quotidien `fx.refresh`).
 */
export async function platformRate(from: string, to: string, now = new Date()): Promise<{ rate: FxRate; source: string }> {
  if (from === to) return { rate: ONE, source: "identity" };
  const r = resolvePlatformRate(from, to, await loadPlatformRates());
  if (!r || !isFresh(r, now)) throw new TiktokShopError(`Taux de change ${from} → ${to} indisponible ou trop ancien`, "config", null, true);
  return { rate: r.rate, source: r.source };
}
