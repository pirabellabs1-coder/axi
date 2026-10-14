"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { guard, parseForm, fail, success, zOptionalString, type ActionResult } from "@/lib/action";
import { rateLimit } from "@/lib/rate-limit";
import { courierDeliver, courierFail, courierPickUp, revealCustomerPhone } from "./courier";
import { ShippingError } from "./service";

/**
 * Actions de la page livreur `/livraison/[token]` (lot 3 §1.2).
 * Le livreur n'est PAS authentifié : le jeton d'URL fait foi (aléatoire, expirant). Chaque action est
 * donc limitée en débit par jeton, et les essais de code de remise sont bornés à 5 côté service.
 */

const zToken = z.string().regex(/^[a-f0-9]{32,64}$/i, "Lien invalide");

async function limited(token: string, bucket: string, limit: number): Promise<ActionResult<never> | null> {
  const r = await rateLimit(`courier:${bucket}:${token.slice(0, 32)}`, limit, 300);
  return r.ok ? null : fail("Trop de tentatives. Patientez quelques minutes.");
}

const geoSchema = z.object({
  token: zToken,
  latitude: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().min(-90).max(90).optional()),
  longitude: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().min(-180).max(180).optional()),
});

function geoOf(d: { latitude?: number; longitude?: number }) {
  return d.latitude != null && d.longitude != null ? { latitude: d.latitude, longitude: d.longitude } : null;
}

export async function courierPickUpAction(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(geoSchema, formData);
    if ("error" in parsed) return parsed.error;
    const blocked = await limited(parsed.data.token, "pickup", 20);
    if (blocked) return blocked;
    try {
      await courierPickUp(parsed.data.token, geoOf(parsed.data));
    } catch (e) {
      if (e instanceof ShippingError) return fail(e.message);
      throw e;
    }
    revalidatePath(`/livraison/${parsed.data.token}`);
    return success(undefined, "Colis marqué comme récupéré");
  });
}

/**
 * Mineur n° 5 : plus aucun champ de photo dans le formulaire. La preuve est le fichier déjà téléversé
 * par `POST /api/livraison/{token}/preuve` (clé interne du stockage, relue en base par `courierDeliver`).
 */
const deliverSchema = geoSchema.extend({ code: zOptionalString });

export async function courierDeliverAction(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(deliverSchema, formData);
    if ("error" in parsed) return parsed.error;
    const d = parsed.data;
    const blocked = await limited(d.token, "deliver", 20);
    if (blocked) return blocked;
    try {
      const result = await courierDeliver(d.token, { code: d.code ?? null, geo: geoOf(d) });
      if (!result.ok) return fail(result.error);
    } catch (e) {
      if (e instanceof ShippingError) return fail(e.message);
      throw e;
    }
    revalidatePath(`/livraison/${d.token}`);
    return success(undefined, "Livraison confirmée. Merci !");
  });
}

const failSchema = geoSchema.extend({ reason: z.string().trim().min(3, "Motif requis").max(200) });

export async function courierFailAction(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(failSchema, formData);
    if ("error" in parsed) return parsed.error;
    const d = parsed.data;
    const blocked = await limited(d.token, "fail", 20);
    if (blocked) return blocked;
    try {
      await courierFail(d.token, d.reason, geoOf(d));
    } catch (e) {
      if (e instanceof ShippingError) return fail(e.message);
      throw e;
    }
    revalidatePath(`/livraison/${d.token}`);
    return success(undefined, "Échec enregistré : le commerçant est prévenu.");
  });
}

/** Numéro complet du destinataire (bouton « Appeler ») : chaque révélation est journalisée. */
export async function revealPhoneAction(token: string): Promise<ActionResult<{ phone: string }>> {
  return guard(async () => {
    const parsed = zToken.safeParse(token);
    if (!parsed.success) return fail("Lien invalide");
    const blocked = await limited(token, "reveal", 10);
    if (blocked) return blocked;
    const phone = await revealCustomerPhone(token);
    if (!phone) return fail("Lien expiré ou inconnu.");
    return success({ phone });
  });
}
