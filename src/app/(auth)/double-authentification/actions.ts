"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createSession } from "@/lib/auth/session";
import { safeNext } from "@/lib/auth/redirect";
import { audit } from "@/lib/audit";
import { fail, guard, type ActionResult } from "@/lib/action";
import { clientIp, rateLimitAll, rateLimitMessage } from "@/lib/rate-limit";
import { clearMfaChallenge, readMfaChallenge, verifyUserSecondFactor } from "@/lib/admin/mfa-server";

const schema = z.object({ code: z.string().trim().min(6, "Saisissez le code à 6 chiffres.").max(20, "Code invalide.") });

/**
 * Deuxième étape de connexion : le jeton signé (cookie `axi_mfa`, 5 min) prouve le mot de passe ;
 * un code TOTP valide (ou un code de secours) crée la session complète. Essais limités par compte et par IP.
 */
export async function verifyMfaLogin(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const pending = await readMfaChallenge();
    if (!pending) return fail("Votre étape de connexion a expiré. Reconnectez-vous avec votre mot de passe.");
    const parsed = schema.safeParse({ code: formData.get("code") });
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Code invalide.", { code: [parsed.error.issues[0]?.message ?? "Code invalide."] });

    const ip = await clientIp();
    // La limite par utilisateur (6 / 15 min) est appliquée dans verifyUserSecondFactor.
    const rl = await rateLimitAll([{ key: `mfa:ip:${ip}`, limit: 20, windowSec: 15 * 60 }]);
    if (!rl.ok) return fail(rateLimitMessage(rl.retryAfter));

    const r = await verifyUserSecondFactor(pending.uid, parsed.data.code);
    if (!r.ok && r.retryAfter) return fail(rateLimitMessage(r.retryAfter));
    if (!r.ok) {
      await audit({ actorId: pending.uid, action: "user.mfa_failed" });
      return fail("Code incorrect ou expiré.", { code: ["Code incorrect ou expiré."] });
    }
    await clearMfaChallenge();
    await createSession(pending.uid);
    await audit({ actorId: pending.uid, action: "user.login", metadata: { mfa: true, backupCode: r.usedBackup, remainingBackup: r.usedBackup ? r.remainingBackup : undefined } });
    redirect(safeNext(pending.next, "/app"));
  });
}

export async function cancelMfaLogin() {
  await clearMfaChallenge();
  redirect("/connexion");
}
