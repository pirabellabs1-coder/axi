"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { guard, fail, success, type ActionResult } from "@/lib/action";
import { clientIp, rateLimitAll, rateLimitMessage } from "@/lib/rate-limit";
import { sha256 } from "@/lib/crypto";
import { REPORT_REASONS } from "./constants";

const schema = z.object({
  slug: z.string().trim().min(1).max(80).regex(/^[a-z0-9-]+$/, "Boutique inconnue"),
  reason: z.enum(REPORT_REASONS, { message: "Choisissez un motif" }),
  message: z.string().trim().max(1000, "1 000 caractères maximum").optional(),
  email: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().toLowerCase().email("Adresse e-mail invalide").max(254).optional()),
});

/**
 * Signalement public d'une boutique (bouton « Signaler cette boutique »). Entrée non authentifiée :
 * validation stricte, limitation de débit par IP et par boutique, réponse identique que la boutique
 * existe ou non. Le message est stocké brut et affiché échappé (React) dans /admin/signalements.
 */
export async function reportStore(slug: string, reason: string, message?: string, email?: string): Promise<ActionResult> {
  return guard(async () => {
    const parsed = schema.safeParse({ slug, reason, message, email });
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return fail(first?.message ?? "Signalement invalide", first ? { [String(first.path[0])]: [first.message] } : undefined);
    }
    const ip = await clientIp();
    const ipKey = sha256(ip).slice(0, 24);
    const rl = await rateLimitAll([
      { key: `report:ip:${ipKey}`, limit: 5, windowSec: 3600 },
      { key: `report:store:${parsed.data.slug}:${ipKey}`, limit: 2, windowSec: 86_400 },
    ]);
    if (!rl.ok) return fail(rateLimitMessage(rl.retryAfter));

    const store = await db.store.findUnique({ where: { slug: parsed.data.slug }, select: { id: true, status: true } });
    if (store && store.status !== "ARCHIVED") {
      const report = await db.storeReport.create({
        data: { storeId: store.id, reason: parsed.data.reason, message: parsed.data.message || null, reporterEmail: parsed.data.email ?? null },
      });
      await audit({ storeId: store.id, action: "store.reported", target: report.id, metadata: { reason: parsed.data.reason } });
    }
    return success(undefined, "Merci. Notre équipe examine votre signalement.");
  });
}
