"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireAdminPermission } from "@/lib/admin/context";
import { audit } from "@/lib/audit";
import { enqueue } from "@/lib/jobs";
import { guard, parseForm, fail, success, badIds, type ActionResult } from "@/lib/action";
import { MAX_MARGIN_BPS } from "./pricing";
import { MARGIN_SETTING_KEY, configureDns, getDomainMargin } from "./service";

/**
 * Administration des domaines vendus. Permission `billing.manage` (AuthError, jamais de redirect) ;
 * journal `admin.domains.*`.
 */
const marginSchema = z.object({
  percent: z.coerce.number().min(0, "Pourcentage positif").max(MAX_MARGIN_BPS / 100, `${MAX_MARGIN_BPS / 100} % maximum`),
  minUsd: z.coerce.number().min(0, "Minimum positif").max(1000, "1 000 $ maximum"),
});

export async function updateDomainMargin(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { user } = await requireAdminPermission("billing.manage");
    const parsed = parseForm(marginSchema, formData);
    if ("error" in parsed) return parsed.error;
    const before = await getDomainMargin();
    const value = { percentBps: Math.round(parsed.data.percent * 100), minUsdCentsPerYear: Math.round(parsed.data.minUsd * 100) };
    await db.$transaction(async (tx) => {
      await tx.platformSetting.upsert({
        where: { key: MARGIN_SETTING_KEY },
        create: { key: MARGIN_SETTING_KEY, value: value as Prisma.InputJsonValue, updatedBy: user.id },
        update: { value: value as Prisma.InputJsonValue, updatedBy: user.id },
      });
      await audit({ actorId: user.id, action: "admin.domains.margin_updated", target: MARGIN_SETTING_KEY, metadata: { before, after: value } }, tx);
    });
    revalidatePath("/admin/domaines");
    return success(undefined, "Marge enregistrée (appliquée aux prochaines factures)");
  });
}

/**
 * Relance d'une opération échouée APRÈS paiement. Passe TOUJOURS par la réconciliation : opération connue → suivi ;
 * sinon ListOperations depuis la réclamation et état du domaine ; un nouvel envoi n'a lieu que si rien n'a été soumis.
 */
export async function retryDomainCharge(chargeId: string): Promise<ActionResult> {
  return guard(async () => {
    const { user } = await requireAdminPermission("billing.manage");
    const bad = badIds(chargeId);
    if (bad) return bad;
    const charge = await db.domainCharge.findUnique({ where: { id: chargeId }, include: { invoice: { select: { status: true } }, registration: { select: { domainName: true } } } });
    if (!charge) return fail("Opération introuvable");
    if (charge.status !== "FAILED") return fail("Seule une opération en échec peut être relancée");
    if (charge.invoice?.status !== "PAID") return fail("Facture non payée : aucune opération possible");
    await db.$transaction(async (tx) => {
      // Toujours via la réconciliation (ListOperations, état du domaine) : jamais de nouvel envoi à l'aveugle.
      const r = await tx.domainCharge.updateMany({ where: { id: charge.id, status: "FAILED" }, data: { status: "PROCESSING", claimedAt: charge.claimedAt ?? charge.createdAt, lastError: null } });
      if (r.count === 0) return;
      if (charge.kind === "REGISTER") await tx.domainRegistration.update({ where: { id: charge.registrationId }, data: { status: "PENDING", lastError: null } });
      await enqueue("domain.poll", { chargeId: charge.id, polls: 0, resubmit: true }, { storeId: charge.storeId }, tx);
      await audit({ storeId: charge.storeId, actorId: user.id, action: "admin.domains.retry", target: charge.registrationId, metadata: { chargeId: charge.id, domain: charge.registration.domainName, kind: charge.kind, operationId: charge.operationId } }, tx);
    });
    revalidatePath("/admin/domaines");
    return success(undefined, "Opération relancée");
  });
}

export async function retryDomainDns(registrationId: string): Promise<ActionResult> {
  return guard(async () => {
    const { user } = await requireAdminPermission("billing.manage");
    const bad = badIds(registrationId);
    if (bad) return bad;
    const reg = await db.domainRegistration.findUnique({ where: { id: registrationId }, select: { id: true, storeId: true, domainName: true } });
    if (!reg) return fail("Domaine introuvable");
    const ok = await configureDns(reg.id);
    await audit({ storeId: reg.storeId, actorId: user.id, action: "admin.domains.dns_retry", target: reg.id, metadata: { domain: reg.domainName, ok } });
    revalidatePath("/admin/domaines");
    return ok ? success(undefined, "DNS configuré") : fail("Échec de la configuration DNS (voir l'erreur affichée)");
  });
}
