"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireStore } from "@/lib/auth/permissions";
import { guard, parseForm, fail, success, badIds, type ActionResult } from "@/lib/action";
import { PLANS } from "@/config/plans";
import { rateLimit } from "@/lib/rate-limit";
import { contactSchema } from "./names";
import { domainSalesEnabled } from "./registrar";
import { MAX_YEARS } from "./pricing";
import { applyAutoRenew, createDomainPurchase, issueRenewalInvoice, searchDomains, type SearchItem } from "./service";

/**
 * Achat de noms de domaine par le marchand (page Domaine). Capacité `billing.manage` : l'achat crée une facture.
 * Prix et disponibilité TOUJOURS recalculés côté serveur ; le registrar n'est appelé pour l'achat qu'après
 * paiement de la facture (job domain.register).
 */
const UPSELL = "L'achat de domaine est inclus à partir du plan Business.";

export async function searchDomainAction(storeId: string, query: string): Promise<ActionResult<{ query: SearchItem; suggestions: SearchItem[] }>> {
  return guard(async () => {
    const bad = badIds(storeId);
    if (bad) return bad;
    const ctx = await requireStore(storeId, "billing.manage");
    if (!PLANS[ctx.planId].features.customDomain) return fail(UPSELL);
    if (!domainSalesEnabled()) return fail("L'achat de domaine n'est pas encore ouvert. Connectez un domaine que vous possédez.");
    if (typeof query !== "string" || query.length > 253) return fail("Recherche invalide.");
    const rl = await rateLimit(`domain-search:${ctx.store.id}`, 30, 600);
    if (!rl.ok) return fail("Trop de recherches. Réessayez dans quelques minutes.");
    const r = await searchDomains(query, ctx.store.currency);
    if (!r.ok) return fail(r.error);
    return success({ query: r.query, suggestions: r.suggestions });
  });
}

const buySchema = contactSchema.extend({
  storeId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  domain: z.string().trim().min(3).max(253),
  years: z.coerce.number().int().min(1).max(MAX_YEARS).default(1),
  accept: z.literal("on", { error: "Acceptez les conditions d'enregistrement." }),
});

export async function buyDomain(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  let invoiceUrl = "";
  const r = await guard(async () => {
    const parsed = parseForm(buySchema, formData);
    if ("error" in parsed) return parsed.error;
    const { storeId, domain, years, accept: _accept, ...contact } = parsed.data;
    void _accept;
    const ctx = await requireStore(storeId, "billing.manage");
    if (!PLANS[ctx.planId].features.customDomain) return fail(UPSELL);
    if (!domainSalesEnabled()) return fail("L'achat de domaine n'est pas encore ouvert.");
    const rl = await rateLimit(`domain-buy:${ctx.store.id}`, 10, 3600);
    if (!rl.ok) return fail("Trop de tentatives. Réessayez plus tard.");
    const res = await createDomainPurchase({ storeId: ctx.store.id, actorId: ctx.user.id, domain, years, contact });
    if (!res.ok) return fail(res.error);
    revalidatePath(`/app/${ctx.store.id}/domaine`);
    invoiceUrl = `/app/${ctx.store.id}/abonnement/factures/${res.invoiceId}`;
    return success(undefined, "Facture créée");
  });
  if (r.ok && invoiceUrl) redirect(invoiceUrl);
  return r;
}

export async function setDomainAutoRenewAction(storeId: string, registrationId: string, enabled: boolean): Promise<ActionResult> {
  return guard(async () => {
    const bad = badIds(storeId, registrationId);
    if (bad) return bad;
    const ctx = await requireStore(storeId, "billing.manage");
    const reg = await db.domainRegistration.findFirst({ where: { id: registrationId, storeId: ctx.store.id, status: "REGISTERED" } });
    if (!reg) return fail("Domaine introuvable.");
    if (reg.autoRenew === !!enabled) return success(undefined, "Réglage inchangé");
    await applyAutoRenew(reg.id, !!enabled, { actorId: ctx.user.id, reason: "merchant" });
    revalidatePath(`/app/${ctx.store.id}/domaine`);
    return success(undefined, enabled ? "Renouvellement automatique activé" : "Renouvellement automatique désactivé");
  });
}

export async function renewDomainNow(storeId: string, registrationId: string): Promise<ActionResult<{ url: string }>> {
  return guard(async () => {
    const bad = badIds(storeId, registrationId);
    if (bad) return bad;
    const ctx = await requireStore(storeId, "billing.manage");
    const reg = await db.domainRegistration.findFirst({ where: { id: registrationId, storeId: ctx.store.id, status: "REGISTERED" }, select: { id: true } });
    if (!reg) return fail("Domaine introuvable.");
    const r = await issueRenewalInvoice(reg.id, { actorId: ctx.user.id });
    if (!r.ok) return fail(r.error);
    revalidatePath(`/app/${ctx.store.id}/domaine`);
    return success({ url: `/app/${ctx.store.id}/abonnement/factures/${r.invoiceId}` }, "Facture de renouvellement prête");
  });
}
