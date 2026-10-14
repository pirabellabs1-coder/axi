import "server-only";
import type { Prisma, Subscription } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { effectivePlanId } from "@/lib/billing/rules";
import type { TaxSettingsInput } from "./compute";
import { collectsTax, parseTaxRegistration } from "./registration";

/**
 * Réglages de taxe d'une boutique, prêts pour `computeTaxes`. SOURCE UNIQUE : le pipeline de commande
 * (`previewTotals`, `createOrder`, `createExchangeOrder`) et les factures passent tous par ici, pour qu'une
 * boutique ne puisse pas collecter la taxe au checkout et l'ignorer sur la facture (ou l'inverse).
 *
 * Trois conditions cumulatives pour collecter :
 *  - `Store.taxesEnabled` (choix du commerçant) ;
 *  - régime fiscal autre que TPS (`collectsTax`) : en TPS, aucune taxe n'est collectée même si des taux existent ;
 *  - plan autorisant la fonction (`features.taxes`) : une boutique rétrogradée arrête de ventiler la TVA.
 *
 * Pays de taxation au lot 2 : `Store.country`, normalisé en majuscules. Seuls les taux ACTIFS de ce pays
 * (`regionKey "*"`) sont retenus. Toute lecture est filtrée par `storeId`.
 */

type Db = Tx | typeof db;

/** Colonnes nécessaires au calcul : utilisable avec une boutique déjà chargée par l'appelant. */
export type TaxStoreRow = {
  id: string;
  country: string;
  taxesEnabled: boolean;
  pricesIncludeTax: boolean;
  /** Identité fiscale (régime) : requise ici pour que le régime TPS soit honoré partout. */
  taxRegistration: Prisma.JsonValue | null;
  /** Abonnement : requis pour le contrôle de plan (`features.taxes`). */
  subscription: Subscription | null;
};

export const TAX_STORE_SELECT = { id: true, country: true, taxesEnabled: true, pricesIncludeTax: true, taxRegistration: true, subscription: true } as const;

/** Vrai si la boutique collecte effectivement une taxe (réglage, régime ET plan). */
export function storeCollectsTax(store: TaxStoreRow): boolean {
  if (!collectsTax(store.taxesEnabled, parseTaxRegistration(store.taxRegistration))) return false;
  return PLANS[effectivePlanId(store.subscription ?? null)].features.taxes;
}

/** Réglages pour une boutique DÉJÀ chargée (`TAX_STORE_SELECT`). `enabled = false` = aucune taxe. */
export async function taxSettingsForStore(client: Db, store: TaxStoreRow, country?: string): Promise<TaxSettingsInput> {
  const pricesIncludeTax = store.pricesIncludeTax;
  if (!storeCollectsTax(store)) return { enabled: false, pricesIncludeTax, rates: [] };
  const rates = await client.taxRate.findMany({
    where: { storeId: store.id, country: (country ?? store.country).toUpperCase(), regionKey: "*", active: true },
    select: { name: true, rateBps: true, taxCategory: true, appliesToShipping: true },
    orderBy: { taxCategory: "asc" },
  });
  return { enabled: true, pricesIncludeTax, rates };
}

/**
 * Variante « cœur commerce » : null quand aucune taxe n'est collectée (le pipeline attend `TaxSettingsInput | null`).
 * La boutique est déjà chargée par l'appelant (`TAX_STORE_SELECT`), aucune relecture.
 */
export async function taxSettingsOrNull(client: Db, store: TaxStoreRow): Promise<TaxSettingsInput | null> {
  const settings = await taxSettingsForStore(client, store);
  return settings.enabled ? settings : null;
}

/** Réglages par identifiant de boutique (factures, MCP). */
export async function loadTaxSettings(storeId: string, tx: Db = db, country?: string): Promise<TaxSettingsInput> {
  const store = await tx.store.findUnique({ where: { id: storeId }, select: TAX_STORE_SELECT });
  if (!store) return { enabled: false, pricesIncludeTax: true, rates: [] };
  return taxSettingsForStore(tx, store, country);
}
