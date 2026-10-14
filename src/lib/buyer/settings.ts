import "server-only";
import type { Prisma } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { BUYER_KILL_SWITCH_KEY } from "./otp";

/**
 * Réglages des comptes acheteurs. `Store.accountsEnabled` est une colonne ; le canal et le texte d'accueil
 * vivent dans `Integration` (kind `buyer_accounts`, JSON `config`), comme les préférences `axi_prefs`
 * (pas de colonne `Store.settings` au schéma S1). Supprimés en cascade avec la boutique.
 */
export const ACCOUNT_SETTINGS_KIND = "buyer_accounts";

/** `store_whatsapp` : WhatsApp Cloud de la boutique d'abord (1 crédit), puis expéditeur Axi. `platform` : jamais de crédit boutique. */
export type OtpChannelPref = "store_whatsapp" | "platform";
export type AccountSettings = { channel: OtpChannelPref; welcomeText: string };

export const DEFAULT_ACCOUNT_SETTINGS: AccountSettings = { channel: "store_whatsapp", welcomeText: "" };
export const WELCOME_MAX = 280;

export function parseAccountSettings(raw: unknown): AccountSettings {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    channel: o.channel === "platform" ? "platform" : "store_whatsapp",
    welcomeText: typeof o.welcomeText === "string" ? o.welcomeText.slice(0, WELCOME_MAX) : "",
  };
}

export async function getAccountSettings(storeId: string, client: Tx | typeof db = db): Promise<AccountSettings> {
  const row = await client.integration.findUnique({ where: { storeId_kind: { storeId, kind: ACCOUNT_SETTINGS_KIND } }, select: { config: true } });
  return parseAccountSettings(row?.config);
}

export async function saveAccountSettings(storeId: string, s: AccountSettings, client: Tx | typeof db = db) {
  const config = { channel: s.channel, welcomeText: s.welcomeText.slice(0, WELCOME_MAX) } as Prisma.InputJsonValue;
  await client.integration.upsert({
    where: { storeId_kind: { storeId, kind: ACCOUNT_SETTINGS_KIND } },
    create: { storeId, kind: ACCOUNT_SETTINGS_KIND, status: "active", config },
    update: { config },
  });
}

/* ───────────── Arrêt d'urgence plateforme (`PlatformSetting` buyer_accounts.kill_switch) ───────────── */

export type BuyerKillSwitch = { enabled: boolean; message: string };
let killCache: { value: BuyerKillSwitch; at: number } | null = null;
const KILL_TTL_MS = 10_000;

/** Codes refusés et écritures bloquées ; les sessions existantes restent lisibles. Cache 10 s par instance. */
export async function getBuyerKillSwitch(fresh = false): Promise<BuyerKillSwitch> {
  if (!fresh && killCache && Date.now() - killCache.at < KILL_TTL_MS) return killCache.value;
  const row = await db.platformSetting.findUnique({ where: { key: BUYER_KILL_SWITCH_KEY } });
  const v = row?.value && typeof row.value === "object" && !Array.isArray(row.value) ? (row.value as Partial<BuyerKillSwitch>) : null;
  const value = { enabled: v?.enabled === true, message: typeof v?.message === "string" ? v.message.slice(0, 300) : "" };
  killCache = { value, at: Date.now() };
  return value;
}

export function resetBuyerKillSwitchCache() {
  killCache = null;
}
