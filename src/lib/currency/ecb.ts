/**
 * Source de référence des taux : BCE, fichier quotidien XML (HTTPS, aucune clé). Module PUR (analyse), testé.
 *
 * POINT D'INTÉGRATION : URL par défaut `ECB_DAILY_URL`, surchargeable par `FX_ECB_URL` (HTTPS obligatoire, ex. miroir
 * interne). Format attendu : `<Cube time="AAAA-MM-JJ"><Cube currency="USD" rate="1.0845"/>…</Cube>` (taux = 1 EUR
 * en devise). Les parités fixes BCEAO (XOF, XAF) ne viennent JAMAIS de cette source.
 */
import { FIXED_EUR_PARITIES, parseRate } from "./convert";

export const ECB_DAILY_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

export type EcbRate = { currency: string; rate: string };

/** Extrait les couples (devise, taux) ; ignore les entrées invalides, les doublons et les devises à parité fixe. */
export function parseEcbXml(xml: string): { date: string | null; rates: EcbRate[] } {
  const out: EcbRate[] = [];
  const seen = new Set<string>();
  const date = /<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(xml)?.[1] ?? null;
  const re = /<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9.]{1,24})['"]\s*\/?>/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const [, currency, rate] = m;
    if (seen.has(currency) || currency === "EUR" || FIXED_EUR_PARITIES[currency]) continue;
    if (!parseRate(rate)) continue;
    seen.add(currency);
    out.push({ currency, rate });
  }
  return { date, rates: out };
}

/** URL de la source : `FX_ECB_URL` si elle est en HTTPS, sinon l'URL BCE. */
export function ecbUrl(env: string | undefined): string {
  if (env && /^https:\/\/[^\s]+$/i.test(env.trim())) return env.trim();
  return ECB_DAILY_URL;
}
