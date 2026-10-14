/**
 * Registre des adaptateurs transporteurs (lot 3 §1.2) et accès aux identifiants chiffrés.
 * Les identifiants ne sont déchiffrés que côté serveur, au moment de l'appel, et ne sortent jamais
 * d'un module serveur (jamais de prop client, jamais de journal).
 */

import "server-only";
import { decryptSecret } from "@/lib/crypto";
import { manualAdapter } from "./manual";
import { dhlAdapter, gozemAdapter, laposteBjAdapter, yangoAdapter } from "./adapters";
import type { CarrierAdapter, CarrierCredentials, CarrierId } from "./types";

const ADAPTERS: Record<CarrierId, CarrierAdapter> = {
  manual: manualAdapter,
  gozem: gozemAdapter,
  yango: yangoAdapter,
  dhl: dhlAdapter,
  laposte_bj: laposteBjAdapter,
};

export function getCarrierAdapter(carrier: string): CarrierAdapter {
  return ADAPTERS[carrier as CarrierId] ?? ADAPTERS.manual;
}

export function carrierAdapters(): CarrierAdapter[] {
  return Object.values(ADAPTERS);
}

/** Déchiffre les identifiants d'un compte transporteur ; `{}` si absents ou illisibles. */
export function carrierCredentials(credentialsEncrypted: string | null | undefined): CarrierCredentials {
  if (!credentialsEncrypted) return {};
  try {
    const parsed: unknown = JSON.parse(decryptSecret(credentialsEncrypted));
    if (!parsed || typeof parsed !== "object") return {};
    const out: CarrierCredentials = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}
