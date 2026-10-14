"use server";

import { z } from "zod";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireStore } from "@/lib/auth/permissions";
import { PLANS } from "@/config/plans";
import { MAX_TAX_RATE_BPS, TAX_REGIMES, taxPresetFor } from "@/config/taxes";
import { guard, parseForm, fail, success, badIds, zBool, type ActionResult } from "@/lib/action";
import { TAX_CATEGORIES } from "./compute";
import { parseTaxRegistration } from "./registration";
import { InvoiceError, issueInvoice, issueMissingCreditNotes } from "./invoice";

const upsell = (storeId: string) => `/app/${storeId}/abonnement`;
const settingsPath = (storeId: string) => `/app/${storeId}/parametres/taxes`;
const text = (max: number) => z.preprocess((v) => (typeof v === "string" ? v.trim() : ""), z.string().max(max, `${max} caractères maximum`));

const settingsSchema = z.object({
  storeId: z.string(),
  taxesEnabled: zBool,
  pricesIncludeTax: z.enum(["true", "false"]).transform((v) => v === "true"),
  autoIssueInvoices: zBool,
  legalName: text(160),
  taxId: text(60),
  rccm: text(60),
  address: text(300),
  regime: z.enum(TAX_REGIMES, { error: "Régime invalide" }),
  exemptionMention: text(200),
});

/** Activation des taxes, TTC/HT, identité fiscale (IFU, NIF, RCCM), régime et émission automatique des factures. */
export async function updateTaxSettings(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(settingsSchema, formData);
    if ("error" in parsed) return parsed.error;
    const d = parsed.data;
    const ctx = await requireStore(d.storeId, "store.settings");
    const features = PLANS[ctx.planId].features;
    if (d.taxesEnabled && !ctx.store.taxesEnabled && !features.taxes) return fail(`Les taxes ne sont pas incluses dans le plan ${PLANS[ctx.planId].name}. Voir les plans : ${upsell(ctx.store.id)}`);
    if (d.taxesEnabled && d.regime === "TVA" && !d.taxId) return fail("Renseignez votre numéro fiscal (IFU, NIF…) pour facturer la TVA.", { taxId: ["Obligatoire pour facturer la TVA"] });

    const previous = parseTaxRegistration(ctx.store.taxRegistration);
    const registration = { legalName: d.legalName, taxId: d.taxId, rccm: d.rccm, address: d.address, regime: d.regime, exemptionMention: d.exemptionMention, autoIssueInvoices: d.autoIssueInvoices };
    await db.$transaction(async (tx) => {
      await tx.store.update({
        where: { id: ctx.store.id },
        data: { taxesEnabled: d.taxesEnabled, pricesIncludeTax: d.pricesIncludeTax, taxRegistration: registration as Prisma.InputJsonValue },
      });
      await audit(
        {
          storeId: ctx.store.id,
          actorId: ctx.user.id,
          action: "tax.settings_updated",
          metadata: {
            taxesEnabled: { from: ctx.store.taxesEnabled, to: d.taxesEnabled },
            pricesIncludeTax: { from: ctx.store.pricesIncludeTax, to: d.pricesIncludeTax },
            regime: { from: previous.regime, to: d.regime },
            taxIdChanged: previous.taxId !== d.taxId,
            autoIssueInvoices: d.autoIssueInvoices,
          },
        },
        tx,
      );
    });
    revalidatePath(settingsPath(ctx.store.id));
    return success(undefined, "Réglages fiscaux enregistrés");
  });
}

/** « 18 », « 18,9 », « 19.25 » → points de base (1800, 1890, 1925). */
const zRatePercent = z.preprocess(
  (v) => (typeof v === "string" ? Number(v.trim().replace(",", ".")) : v),
  z
    .number({ error: "Taux invalide" })
    .finite("Taux invalide")
    .min(0, "Taux négatif")
    .max(MAX_TAX_RATE_BPS / 100, `${MAX_TAX_RATE_BPS / 100} % maximum`)
    .refine((x) => Math.abs(x * 100 - Math.round(x * 100)) < 1e-6, "Deux décimales maximum")
    .transform((x) => Math.round(x * 100)),
);

const rateSchema = z.object({
  storeId: z.string(),
  rateId: z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional()),
  name: z.preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().min(1, "Nom requis").max(40, "40 caractères maximum")),
  country: z.preprocess((v) => (typeof v === "string" ? v.trim().toUpperCase() : v), z.string().regex(/^[A-Z]{2}$/, "Code pays à 2 lettres (BJ, SN…)")),
  taxCategory: z.enum(TAX_CATEGORIES, { error: "Catégorie invalide" }),
  rate: zRatePercent,
  appliesToShipping: zBool,
  active: zBool,
});

/** Crée ou modifie un taux (unique par boutique, pays et catégorie). */
export async function upsertTaxRate(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(rateSchema, formData);
    if ("error" in parsed) return parsed.error;
    const d = parsed.data;
    const ctx = await requireStore(d.storeId, "store.settings");
    if (!PLANS[ctx.planId].features.taxes) return fail(`Les taxes ne sont pas incluses dans le plan ${PLANS[ctx.planId].name}. Voir les plans : ${upsell(ctx.store.id)}`);
    const rateBps = d.taxCategory === "exempt" ? 0 : d.rate;
    if (d.taxCategory !== "exempt" && rateBps === 0) return fail("Un taux nul se déclare dans la catégorie « Exonéré ».", { rate: ["Taux nul : choisissez « Exonéré »"] });
    const data = { name: d.name, country: d.country, taxCategory: d.taxCategory, rateBps, appliesToShipping: d.appliesToShipping, active: d.active };
    try {
      await db.$transaction(async (tx) => {
        let id = d.rateId ?? null;
        if (id) {
          const r = await tx.taxRate.updateMany({ where: { id, storeId: ctx.store.id }, data });
          if (r.count === 0) throw new InvoiceError("Taux introuvable");
        } else {
          id = (await tx.taxRate.create({ data: { ...data, storeId: ctx.store.id, regionKey: "*" }, select: { id: true } })).id;
        }
        await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: d.rateId ? "tax.rate_updated" : "tax.rate_created", target: id, metadata: data }, tx);
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return fail("Un taux existe déjà pour ce pays et cette catégorie : modifiez-le.", { taxCategory: ["Déjà défini pour ce pays"] });
      if (e instanceof InvoiceError) return fail(e.message);
      throw e;
    }
    revalidatePath(settingsPath(ctx.store.id));
    return success(undefined, "Taux enregistré");
  });
}

/** Suppression d'un taux : sans effet sur les commandes et factures déjà émises (instantanés). */
export async function deleteTaxRate(storeId: string, rateId: string): Promise<ActionResult> {
  return guard(async () => {
    const bad = badIds(storeId, rateId);
    if (bad) return bad;
    const ctx = await requireStore(storeId, "store.settings");
    const removed = await db.$transaction(async (tx) => {
      const r = await tx.taxRate.deleteMany({ where: { id: rateId, storeId: ctx.store.id } });
      if (r.count) await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "tax.rate_deleted", target: rateId }, tx);
      return r.count;
    });
    if (!removed) return fail("Taux introuvable");
    revalidatePath(settingsPath(ctx.store.id));
    return success(undefined, "Taux supprimé");
  });
}

/** Crée le taux normal indicatif du pays de la boutique (préréglage à confirmer par le commerçant). */
export async function applyTaxPreset(storeId: string): Promise<ActionResult> {
  return guard(async () => {
    const bad = badIds(storeId);
    if (bad) return bad;
    const ctx = await requireStore(storeId, "store.settings");
    if (!PLANS[ctx.planId].features.taxes) return fail(`Les taxes ne sont pas incluses dans le plan ${PLANS[ctx.planId].name}. Voir les plans : ${upsell(ctx.store.id)}`);
    const preset = taxPresetFor(ctx.store.country);
    if (!preset) return fail("Aucun préréglage pour le pays de votre boutique : ajoutez votre taux manuellement.");
    const exists = await db.taxRate.findFirst({ where: { storeId: ctx.store.id, country: preset.country, regionKey: "*", taxCategory: "standard" }, select: { id: true } });
    if (exists) return fail("Un taux normal existe déjà pour ce pays.");
    try {
      await db.$transaction(async (tx) => {
        const r = await tx.taxRate.create({ data: { storeId: ctx.store.id, name: preset.name, country: preset.country, regionKey: "*", taxCategory: "standard", rateBps: preset.rateBps, appliesToShipping: true, active: true }, select: { id: true } });
        await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "tax.rate_created", target: r.id, metadata: { preset: preset.country, rateBps: preset.rateBps } }, tx);
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return fail("Un taux normal existe déjà pour ce pays.");
      throw e;
    }
    revalidatePath(settingsPath(ctx.store.id));
    return success(undefined, `Taux ${preset.name} ${preset.rateBps / 100} % ajouté. Vérifiez-le avec votre comptable.`);
  });
}

const productTaxSchema = z.object({ taxable: z.boolean(), taxCategory: z.enum(TAX_CATEGORIES) });

/** Champs fiscaux d'un produit (composant <ProductTaxFields>, enregistrement immédiat). */
export async function updateProductTax(storeId: string, productId: string, input: { taxable: boolean; taxCategory: string }): Promise<ActionResult> {
  return guard(async () => {
    const bad = badIds(storeId, productId);
    if (bad) return bad;
    const parsed = productTaxSchema.safeParse(input);
    if (!parsed.success) return fail("Catégorie fiscale invalide");
    const ctx = await requireStore(storeId, "products.manage");
    const r = await db.product.updateMany({ where: { id: productId, storeId: ctx.store.id }, data: parsed.data });
    if (!r.count) return fail("Produit introuvable");
    return success(undefined, "Fiscalité du produit enregistrée");
  });
}

/** Émission manuelle de la facture d'une commande payée (idempotente). */
export async function issueInvoiceAction(storeId: string, orderId: string): Promise<ActionResult<{ number: string }>> {
  return guard(async () => {
    const bad = badIds(storeId, orderId);
    if (bad) return bad;
    const ctx = await requireStore(storeId, "orders.manage");
    if (!PLANS[ctx.planId].features.invoices) return fail(`Les factures ne sont pas incluses dans le plan ${PLANS[ctx.planId].name}. Voir les plans : ${upsell(ctx.store.id)}`);
    try {
      const doc = await issueInvoice({ storeId: ctx.store.id, orderId, actorId: ctx.user.id });
      revalidatePath(`/app/${ctx.store.id}/commandes/${orderId}`);
      revalidatePath(`/app/${ctx.store.id}/commandes/${orderId}/facture`);
      return success({ number: doc.number }, doc.created ? `Facture ${doc.number} émise` : `Facture ${doc.number} déjà émise`);
    } catch (e) {
      if (e instanceof InvoiceError) return fail(e.message);
      throw e;
    }
  });
}

/** Régularise les avoirs manquants d'une commande facturée (remboursements sans avoir). Toujours permis : obligation fiscale. */
export async function issueMissingCreditNotesAction(storeId: string, orderId: string): Promise<ActionResult<{ count: number }>> {
  return guard(async () => {
    const bad = badIds(storeId, orderId);
    if (bad) return bad;
    const ctx = await requireStore(storeId, "orders.manage");
    try {
      const docs = await issueMissingCreditNotes({ storeId: ctx.store.id, orderId, actorId: ctx.user.id });
      revalidatePath(`/app/${ctx.store.id}/commandes/${orderId}/facture`);
      return success({ count: docs.length }, docs.length ? `${docs.length} avoir${docs.length > 1 ? "s" : ""} émis` : "Aucun avoir manquant");
    } catch (e) {
      if (e instanceof InvoiceError) return fail(e.message);
      throw e;
    }
  });
}
