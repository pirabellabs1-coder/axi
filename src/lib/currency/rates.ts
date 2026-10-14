import "server-only";
import type { StoreCurrency, Subscription } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { enqueue } from "@/lib/jobs";
import { effectivePlanId } from "@/lib/auth/permissions";
import { PLANS, type PlanId } from "@/config/plans";
import { FIXED_EUR_PARITIES, formatRate, isFresh, makeFx, parseRate, resolvePlatformRate, invert, type FxContext, type RateRow, type ResolvedRate } from "./convert";
import { ecbUrl, parseEcbXml } from "./ecb";
import { isRoundingRule, type RoundingRuleId } from "./rounding";

/**
 * Taux de change côté serveur : lecture des taux plateforme (ExchangeRate), configuration des devises d'une boutique
 * (StoreCurrency, limitée par le plan) et rafraîchissement quotidien (`fx.refresh`).
 *
 * Isolation : toute lecture de StoreCurrency est filtrée par `storeId`. Les taux plateforme sont communs (lecture
 * seule ici ; écriture par le job et par l'administrateur).
 */

/* ───────────────────────── Taux plateforme ───────────────────────── */

let memo: { at: number; rows: RateRow[] } | null = null;
const MEMO_MS = 60_000;

/**
 * Taux plateforme (table de quelques dizaines de lignes), mémorisés 60 s par processus.
 * `client` : passer le client transactionnel quand l'appel a lieu DANS une transaction (checkout), pour ne pas
 * consommer une seconde connexion du pool pendant qu'une transaction interactive est ouverte.
 */
export async function loadPlatformRates(opts: { fresh?: boolean; client?: Db } = {}): Promise<RateRow[]> {
  if (!opts.fresh && memo && Date.now() - memo.at < MEMO_MS) return memo.rows;
  const rows = await (opts.client ?? db).exchangeRate.findMany({ select: { base: true, quote: true, rate: true, source: true, fetchedAt: true } });
  const out: RateRow[] = rows.map((r) => ({ base: r.base, quote: r.quote, rate: r.rate.toString(), source: r.source, fetchedAt: r.fetchedAt }));
  memo = { at: Date.now(), rows: out };
  return out;
}

export function clearRatesMemo() {
  memo = null;
}

/* ───────────────────────── Devises d'une boutique ───────────────────────── */

type Db = Tx | typeof db;

export type StoreCurrencyConfig = Pick<StoreCurrency, "currency" | "enabled" | "rateMode" | "manualRate" | "markupBps" | "rounding" | "createdAt">;

/** Nombre de devises affichées autorisé par le plan (null = illimité ; 0 = fonction absente). */
export function currencyAllowance(planId: PlanId): number | null {
  const plan = PLANS[planId];
  if (!plan.features.multiCurrency) return 0;
  return plan.limits.currencies;
}

/**
 * Devises ACTIVES et autorisées par le plan, dans l'ordre d'activation. Après une rétrogradation de plan, seules
 * les N premières restent proposées (les autres sont conservées mais inactives : aucune perte de réglage).
 */
export async function activeStoreCurrencies(storeId: string, planId: PlanId, storeCurrency: string, client: Db = db): Promise<StoreCurrencyConfig[]> {
  const allowance = currencyAllowance(planId);
  if (allowance === 0) return [];
  const rows = await client.storeCurrency.findMany({
    where: { storeId, enabled: true, currency: { not: storeCurrency } },
    orderBy: { createdAt: "asc" },
    select: { currency: true, enabled: true, rateMode: true, manualRate: true, markupBps: true, rounding: true, createdAt: true },
  });
  return allowance == null ? rows : rows.slice(0, allowance);
}

export type StoreRate = ResolvedRate & { stale: boolean };

/**
 * Taux de base d'une devise de la boutique (avant marge) : manuel (« 1 unité affichée = x devise boutique »,
 * jamais périmé : le commerçant en est responsable), sinon taux plateforme.
 */
export function storeRateFor(storeCurrency: string, cfg: Pick<StoreCurrencyConfig, "currency" | "rateMode" | "manualRate">, rows: readonly RateRow[], now: Date): StoreRate | null {
  if (cfg.rateMode === "manual") {
    const manual = parseRate(cfg.manualRate?.toString() ?? null);
    if (!manual) return null;
    return { rate: invert(manual), source: "manual", fetchedAt: null, stale: false };
  }
  const r = resolvePlatformRate(storeCurrency, cfg.currency, rows);
  if (!r) return null;
  return { ...r, stale: !isFresh(r, now) };
}

/** Contexte de conversion prêt à l'emploi ; null si la devise n'est pas affichable (taux absent ou > 72 h). */
export function fxFor(storeCurrency: string, cfg: StoreCurrencyConfig, rows: readonly RateRow[], now: Date): FxContext | null {
  const r = storeRateFor(storeCurrency, cfg, rows, now);
  if (!r || r.stale) return null;
  const rounding: RoundingRuleId = isRoundingRule(cfg.rounding) ? cfg.rounding : "NONE";
  return makeFx({ base: storeCurrency, quote: cfg.currency, rate: r.rate, markupBps: cfg.markupBps, rounding, source: r.source });
}

export type StoreFxState = {
  storeCurrency: string;
  /** Devises affichables maintenant (taux frais), dans l'ordre d'activation. */
  available: string[];
  contexts: Map<string, FxContext>;
};

/**
 * Toutes les devises affichables d'une boutique (sélecteur de devise, checkout).
 *
 * `client` : client transactionnel de l'appelant, utilisé pour TOUTES les lectures (sinon une transaction
 * interactive ouverte attendrait une seconde connexion du pool, et lirait hors de sa propre transaction).
 * `schedule` : planification paresseuse de `fx.refresh`. JAMAIS depuis le checkout (elle ouvre sa propre
 * transaction : une transaction imbriquée dans celle de la commande) ; la vitrine et le cron la déclenchent.
 */
export async function loadStoreFx(
  store: { id: string; currency: string; subscription?: Subscription | null },
  now = new Date(),
  opts: { client?: Db; schedule?: boolean } = {},
): Promise<StoreFxState> {
  const client = opts.client ?? db;
  const planId = effectivePlanId(store.subscription ?? null);
  const configs = await activeStoreCurrencies(store.id, planId, store.currency, client);
  const contexts = new Map<string, FxContext>();
  if (configs.length === 0) return { storeCurrency: store.currency, available: [], contexts };
  const rows = await loadPlatformRates({ client });
  for (const cfg of configs) {
    const fx = fxFor(store.currency, cfg, rows, now);
    if (fx) contexts.set(cfg.currency, fx);
  }
  // Taux plateforme périmés ou absents : planifie un rafraîchissement (une fois par jour, sans bloquer).
  if (opts.schedule !== false) {
    const fixed = (c: string) => c === "EUR" || !!FIXED_EUR_PARITIES[c];
    const needsEcb = configs.some((c) => c.rateMode !== "manual" && !(fixed(store.currency) && fixed(c.currency)));
    if (needsEcb && needsRefresh(rows, now)) void scheduleDailyFxRefresh(now).catch(() => undefined);
  }
  return { storeCurrency: store.currency, available: [...contexts.keys()], contexts };
}

/* ───────────────────────── Rafraîchissement (job fx.refresh) ───────────────────────── */

const REFRESH_KEY = "fx.daily_refresh";

/** Vrai si le dernier taux BCE a plus de 24 h (ou s'il n'y en a aucun). */
export function needsRefresh(rows: readonly RateRow[], now: Date): boolean {
  const ecb = rows.filter((r) => r.source === "ECB");
  if (ecb.length === 0) return true;
  const latest = Math.max(...ecb.map((r) => r.fetchedAt.getTime()));
  return now.getTime() - latest > 24 * 3600_000;
}

/**
 * Planifie `fx.refresh` au plus une fois par jour UTC (réservation atomique dans PlatformSetting, même schéma que
 * les balayages des cartes cadeaux). Appelé par le cron (/api/jobs/run, voir la doc) et paresseusement quand les
 * taux sont vieux de plus de 24 h.
 */
export async function scheduleDailyFxRefresh(now = new Date()): Promise<{ scheduled: boolean; day: string }> {
  const day = now.toISOString().slice(0, 10);
  const value = JSON.stringify({ day });
  const scheduled = await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ key: string }[]>`
      INSERT INTO "PlatformSetting" ("key", "value", "updatedBy", "updatedAt")
      VALUES (${REFRESH_KEY}, ${value}::jsonb, 'system', now())
      ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = now(), "updatedBy" = 'system'
      WHERE "PlatformSetting"."value"->>'day' IS DISTINCT FROM ${day}
      RETURNING "key"`;
    if (rows.length === 0) return false;
    await enqueue("fx.refresh", { day }, {}, tx);
    return true;
  });
  return { scheduled, day };
}

/** Parités fixes BCEAO écrites en base (transparence, écran admin) ; la conversion utilise les constantes. */
export async function upsertFixedParities(now = new Date()) {
  const pairs: { base: string; quote: string; rate: string }[] = [
    ...Object.entries(FIXED_EUR_PARITIES).map(([quote, r]) => ({ base: "EUR", quote, rate: formatRate(r) })),
    { base: "XOF", quote: "XAF", rate: "1.0000000000" },
  ];
  for (const p of pairs) {
    await db.exchangeRate.upsert({
      where: { base_quote: { base: p.base, quote: p.quote } },
      create: { base: p.base, quote: p.quote, rate: p.rate, source: "BCEAO_FIXED", fetchedAt: now },
      update: { rate: p.rate, source: "BCEAO_FIXED", fetchedAt: now },
    });
  }
}

/**
 * Télécharge le fichier BCE (HTTPS, délai 10 s, sans redirection vers un autre schéma) et met à jour les taux
 * EUR → devise. Lève une erreur en cas d'échec (le job est retenté puis passe en DEAD) ; les anciens taux restent
 * en place et deviennent inaffichables au-delà de 72 h.
 */
export async function refreshPlatformRates(opts: { fetchImpl?: typeof fetch; now?: Date } = {}): Promise<{ updated: number; date: string | null }> {
  const now = opts.now ?? new Date();
  await upsertFixedParities(now);
  if (process.env.FX_REFRESH_DISABLED === "1") {
    clearRatesMemo();
    return { updated: 0, date: null };
  }
  const url = ecbUrl(process.env.FX_ECB_URL);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  let xml: string;
  try {
    const res = await (opts.fetchImpl ?? fetch)(url, { signal: ctrl.signal, redirect: "error", headers: { accept: "application/xml,text/xml" }, cache: "no-store" });
    if (!res.ok) throw new Error(`BCE : HTTP ${res.status}`);
    xml = (await res.text()).slice(0, 200_000);
  } finally {
    clearTimeout(timer);
  }
  const { date, rates } = parseEcbXml(xml);
  if (rates.length === 0) throw new Error("BCE : aucun taux lisible");
  for (const r of rates) {
    const rate = formatRate(parseRate(r.rate)!);
    await db.exchangeRate.upsert({
      where: { base_quote: { base: "EUR", quote: r.currency } },
      create: { base: "EUR", quote: r.currency, rate, source: "ECB", fetchedAt: now },
      update: { rate, source: "ECB", fetchedAt: now },
    });
  }
  clearRatesMemo();
  return { updated: rates.length, date };
}

export { formatRate };
