"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireStore } from "@/lib/auth/permissions";
import { guard, parseForm, fail, success, badIds, type ActionResult } from "@/lib/action";
import { PLANS } from "@/config/plans";
import { audit } from "@/lib/audit";
import { parseMoneyInput, formatMoney } from "@/lib/money";
import { deductTx, grantTx } from "./service";
import { StoreCreditError } from "./errors";
import { STORE_CREDIT_MAX_OPERATION, STORE_CREDIT_NOTE_MAX } from "./rules";

/**
 * Avoir : crédit (geste commercial, motif obligatoire) et débit marchand. Capacité `customers.manage`,
 * audit `store_credit.*`. Le crédit exige la fonctionnalité de plan `storeCredit` ; le débit reste possible
 * après une baisse de plan.
 */

const schema = z.object({
  storeId: z.string(),
  customerId: z.string(),
  amount: z.string().trim().min(1, "Indiquez un montant"),
  reason: z.string().trim().min(3, "Indiquez un motif (3 caractères minimum)").max(STORE_CREDIT_NOTE_MAX, `${STORE_CREDIT_NOTE_MAX} caractères maximum`),
});

async function run(formData: FormData, direction: "grant" | "deduct"): Promise<ActionResult> {
  const parsed = parseForm(schema, formData);
  if ("error" in parsed) return parsed.error;
  const d = parsed.data;
  const bad = badIds(d.storeId, d.customerId);
  if (bad) return bad;
  const ctx = await requireStore(d.storeId, "customers.manage");
  if (direction === "grant" && !PLANS[ctx.planId].features.storeCredit) {
    return fail(`Les avoirs clients sont inclus à partir du plan ${PLANS.BUSINESS.name} (plan actuel : ${PLANS[ctx.planId].name}). Changez de plan depuis /app/${ctx.store.id}/abonnement.`);
  }
  const amount = parseMoneyInput(d.amount, ctx.store.currency);
  if (amount == null || amount <= 0 || amount > STORE_CREDIT_MAX_OPERATION) return fail("Montant invalide.", { amount: ["Montant invalide"] });
  const customer = await db.customer.findFirst({ where: { id: d.customerId, storeId: ctx.store.id }, select: { id: true } });
  if (!customer) return fail("Client introuvable.");
  try {
    const m = await db.$transaction(async (tx) => {
      const movement =
        direction === "grant"
          ? await grantTx(tx, { storeId: ctx.store.id, customerId: customer.id, amount, kind: "GRANT", note: d.reason, actorId: ctx.user.id })
          : await deductTx(tx, { storeId: ctx.store.id, customerId: customer.id, amount, note: d.reason, actorId: ctx.user.id });
      await audit(
        { storeId: ctx.store.id, actorId: ctx.user.id, action: direction === "grant" ? "store_credit.granted" : "store_credit.deducted", target: customer.id, metadata: { amount: movement.amount, balanceAfter: movement.balanceAfter, reason: d.reason } },
        tx,
      );
      return movement;
    });
    revalidatePath(`/app/${ctx.store.id}/clients/${customer.id}`);
    return success(undefined, `${direction === "grant" ? "Avoir crédité" : "Avoir débité"} : nouveau solde ${formatMoney(m.balanceAfter, ctx.store.currency)}`);
  } catch (e) {
    if (e instanceof StoreCreditError) return fail(e.message, e.code === "insufficient" ? { amount: ["Supérieur au solde"] } : undefined);
    throw e;
  }
}

export async function grantStoreCredit(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(() => run(formData, "grant"));
}

export async function deductStoreCredit(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(() => run(formData, "deduct"));
}
