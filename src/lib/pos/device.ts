import "server-only";
import { db } from "@/lib/db";
import { hmacSha256, requireAppSecret } from "@/lib/crypto";
import { randomToken } from "@/lib/utils";
import { acceptFromRevokedDevice } from "./sync";

/**
 * Appareils de caisse (lot 3 §2 et §6) : jeton aléatoire de 32 octets, affiché UNE SEULE FOIS à
 * l'enregistrement, conservé en base sous forme d'empreinte HMAC (`tokenHash`). Révocable à tout
 * moment ; les ventes déjà en file sont encore acceptées 24 h après la révocation pour ne pas perdre
 * un encaissement, puis refusées.
 */

export const POS_DEVICE_HEADER = "axi-pos-device";

/**
 * Empreinte du jeton d'appareil. `requireAppSecret()` lève si `APP_SECRET` est absent ou factice :
 * sans lui, l'ancien `process.env.APP_SECRET ?? ""` calculait l'empreinte avec une clé VIDE, donc
 * reproductible par quiconque connaît le format — un jeton d'appareil forgeable (mineur n° 12).
 */
export function hashDeviceToken(token: string): string {
  return hmacSha256(requireAppSecret(), `pos-device:${token}`);
}

export function newDeviceToken(): { token: string; tokenHash: string; tokenPrefix: string } {
  const token = randomToken(24);
  return { token, tokenHash: hashDeviceToken(token), tokenPrefix: token.slice(0, 6) };
}

export type AuthenticatedDevice = {
  id: string;
  storeId: string;
  locationId: string;
  name: string;
  revokedAt: Date | null;
  lastSyncAt: Date | null;
};

export type DeviceAuthResult =
  | { ok: true; device: AuthenticatedDevice }
  | { ok: false; status: 401 | 403; error: string };

/**
 * Authentifie un appareil par son jeton (en-tête `Axi-Pos-Device`), filtré par boutique.
 * `allowRevokedGrace` : accepte un appareil révoqué depuis moins de 24 h (synchronisation de la file).
 */
export async function authenticateDevice(storeId: string, token: string | null | undefined, opts: { allowRevokedGrace?: boolean; now?: Date } = {}): Promise<DeviceAuthResult> {
  const value = (token ?? "").trim();
  if (!value) return { ok: false, status: 401, error: "Appareil non identifié." };
  const device = await db.posDevice.findFirst({
    where: { tokenHash: hashDeviceToken(value), storeId },
    select: { id: true, storeId: true, locationId: true, name: true, revokedAt: true, lastSyncAt: true },
  });
  if (!device) return { ok: false, status: 401, error: "Appareil inconnu ou révoqué." };
  if (device.revokedAt) {
    const now = opts.now ?? new Date();
    if (!opts.allowRevokedGrace || !acceptFromRevokedDevice(device.revokedAt, now)) {
      return { ok: false, status: 403, error: "Cet appareil a été révoqué. Contactez le gérant." };
    }
  }
  return { ok: true, device };
}

export async function touchDevice(deviceId: string, p: { synced?: boolean } = {}): Promise<void> {
  await db.posDevice.update({
    where: { id: deviceId },
    data: { lastSeenAt: new Date(), ...(p.synced ? { lastSyncAt: new Date() } : {}) },
  });
}
