import "server-only";
import { db, type Tx } from "@/lib/db";
import { ZONE_CURRENCY, type Interval, type PlanId, type PricingZone } from "@/config/plans";
import { defaultAddOnPrice, defaultPlanMonthly, priceForInterval, resolveOverride, type OverrideRow } from "./rules";

/**
 * Catalogue des prix effectif (V4 §21/§23) : dernière surcharge `PriceOverride` active pour
 * l'article et la zone, sinon le prix versionné dans src/config/plans.ts.
 * Utilisé à l'émission des factures (src/lib/billing/service.ts) : les prix modifiés dans
 * /admin/tarifs s'appliquent aux prochaines factures, jamais aux factures déjà émises.
 */
type Client = Tx | typeof db;

export type EffectivePrice = { amount: number | null; currency: string; overridden: boolean; defaultAmount: number | null };

async function activeOverride(client: Client, itemType: "plan" | "addon", itemId: string, zone: PricingZone): Promise<number | null> {
  const row = await client.priceOverride.findFirst({
    where: { itemType, itemId, zone, active: true },
    orderBy: { createdAt: "desc" },
    select: { amount: true },
  });
  return row?.amount ?? null;
}

/** Prix mensuel effectif d'un plan pour une zone. */
export async function getEffectivePlanPrice(planId: PlanId, zone: PricingZone, client: Client = db): Promise<EffectivePrice> {
  const def = defaultPlanMonthly(planId, zone);
  const o = planId === "FREE" ? null : await activeOverride(client, "plan", planId, zone);
  return { amount: o ?? def, currency: ZONE_CURRENCY[zone], overridden: o != null, defaultAmount: def };
}

/** Prix effectif d'un plan pour une période (annuel = 10 mois payés pour 12). */
export async function getEffectivePlanPriceFor(planId: PlanId, zone: PricingZone, interval: Interval, client: Client = db) {
  const p = await getEffectivePlanPrice(planId, zone, client);
  return priceForInterval(p.amount, zone, interval);
}

/** Prix effectif d'une option pour une zone. */
export async function getEffectiveAddOnPrice(addOnId: string, zone: PricingZone, client: Client = db): Promise<EffectivePrice> {
  const def = defaultAddOnPrice(addOnId, zone);
  const o = await activeOverride(client, "addon", addOnId, zone);
  return { amount: o ?? def, currency: ZONE_CURRENCY[zone], overridden: o != null, defaultAmount: def };
}

/** Toutes les surcharges actives (une requête) : pour les écrans qui affichent tout le catalogue. */
export async function loadActiveOverrides(client: Client = db): Promise<OverrideRow[]> {
  return client.priceOverride.findMany({ where: { active: true }, select: { itemType: true, itemId: true, zone: true, amount: true, active: true, createdAt: true } });
}

export function effectiveFromRows(rows: OverrideRow[], itemType: "plan" | "addon", itemId: string, zone: PricingZone): EffectivePrice {
  const def = itemType === "plan" ? defaultPlanMonthly(itemId as PlanId, zone) : defaultAddOnPrice(itemId, zone);
  const o = itemType === "plan" && itemId === "FREE" ? null : resolveOverride(rows, itemType, itemId, zone);
  return { amount: o ?? def, currency: ZONE_CURRENCY[zone], overridden: o != null, defaultAmount: def };
}
