"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireStore } from "@/lib/auth/permissions";
import { requireAdminPermission } from "@/lib/admin/context";
import { guard, parseForm, fail, success, zBool, zOptionalString, type ActionResult } from "@/lib/action";
import { audit } from "@/lib/audit";
import { PLANS } from "@/config/plans";
import { currencyDecimals, parseMoneyInput } from "@/lib/money";
import { formatRate, parseRate, MAX_MARKUP_BPS } from "./convert";
import { ROUNDING_RULES, defaultRoundingFor, ruleAllowedFor } from "./rounding";
import { currencyAllowance, clearRatesMemo, loadPlatformRates, storeRateFor } from "./rates";
import { isCurrencyCode, currencyName } from "./pick";

/**
 * Actions des devises (lot 2, §1.2). Capacité `store.settings` pour les devises, `products.manage` pour les prix
 * fixés ; contrôle de plan côté serveur (`multiCurrency`, `limits.currencies`) ; tout est filtré par `storeId` et
 * journalisé. Les taux plateforme ne sont modifiables que par un administrateur (`settings.manage`, `admin.fx.*`).
 */

const MAX_STORE_CURRENCIES_HARD = 30;

function revalidate(storeId: string, slug: string) {
  revalidatePath(`/app/${storeId}/devises`);
  revalidatePath(`/s/${slug}`, "layout");
}

function planMessage(planName: string, allowance: number | null) {
  return allowance === 0
    ? `L'affichage multi-devises n'est pas inclus dans le plan ${planName}. Passez au plan Starter pour l'activer.`
    : `Votre plan ${planName} permet ${allowance} devise${(allowance ?? 0) > 1 ? "s" : ""} affichée${(allowance ?? 0) > 1 ? "s" : ""} en plus de la vôtre.`;
}

/* ───────────────────────── Activer une devise ───────────────────────── */

const addSchema = z.object({
  storeId: z.string().min(8).max(64),
  currency: z.string().trim().toUpperCase().refine(isCurrencyCode, "Code de devise invalide (3 lettres, ex. EUR)."),
});

export async function addStoreCurrency(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(addSchema, formData);
    if ("error" in parsed) return parsed.error;
    const { currency } = parsed.data;
    const ctx = await requireStore(parsed.data.storeId, "store.settings");
    const store = ctx.store;
    if (currency === store.currency) return fail("C'est déjà la devise de votre boutique.", { currency: ["Choisissez une autre devise."] });

    const allowance = currencyAllowance(ctx.planId);
    const enabled = await db.storeCurrency.count({ where: { storeId: store.id, enabled: true, currency: { not: store.currency } } });
    if (allowance === 0 || (allowance != null && enabled >= allowance)) return fail(planMessage(PLANS[ctx.planId].name, allowance));
    const total = await db.storeCurrency.count({ where: { storeId: store.id } });
    if (total >= MAX_STORE_CURRENCIES_HARD) return fail(`Maximum ${MAX_STORE_CURRENCIES_HARD} devises par boutique.`);

    // Mode automatique seulement si un taux plateforme existe ; sinon mode manuel, à compléter par le commerçant.
    const rows = await loadPlatformRates();
    const auto = storeRateFor(store.currency, { currency, rateMode: "auto", manualRate: null }, rows, new Date());
    const existing = await db.storeCurrency.findUnique({ where: { storeId_currency: { storeId: store.id, currency } }, select: { id: true } });
    if (existing) {
      await db.storeCurrency.update({ where: { id: existing.id }, data: { enabled: true } });
    } else {
      await db.storeCurrency.create({
        data: { storeId: store.id, currency, enabled: !!auto, rateMode: auto ? "auto" : "manual", rounding: defaultRoundingFor(currency), markupBps: 0 },
      });
    }
    await audit({ storeId: store.id, actorId: ctx.user.id, action: "currency.enabled", target: currency, metadata: { rateMode: auto ? "auto" : "manual" } });
    revalidate(store.id, store.slug);
    return success(
      undefined,
      auto || existing ? `${currencyName(currency)} ajoutée.` : `${currencyName(currency)} ajoutée, désactivée : aucun taux automatique, saisissez un taux manuel pour l'afficher.`,
    );
  });
}

/* ───────────────────────── Réglages d'une devise ───────────────────────── */

const updateSchema = z.object({
  storeId: z.string().min(8).max(64),
  currency: z.string().trim().toUpperCase().refine(isCurrencyCode, "Devise invalide."),
  enabled: zBool,
  rateMode: z.enum(["auto", "manual"]),
  manualRate: zOptionalString,
  markupPercent: z.preprocess((v) => (v === "" || v == null ? "0" : String(v).replace(",", ".")), z.coerce.number().min(0, "Marge entre 0 et 5 %.").max(MAX_MARKUP_BPS / 100, "Marge entre 0 et 5 %.")),
  rounding: z.enum(ROUNDING_RULES),
});

export async function updateStoreCurrency(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(updateSchema, formData);
    if ("error" in parsed) return parsed.error;
    const d = parsed.data;
    const ctx = await requireStore(d.storeId, "store.settings");
    const store = ctx.store;
    const row = await db.storeCurrency.findUnique({ where: { storeId_currency: { storeId: store.id, currency: d.currency } } });
    if (!row) return fail("Devise introuvable.");

    if (!ruleAllowedFor(d.rounding, currencyDecimals(d.currency))) return fail("Les terminaisons ,99 et ,95 sont réservées aux devises à centimes.", { rounding: ["Choisissez une autre règle."] });
    const markupBps = Math.round(d.markupPercent * 100);

    let manualRate: string | null = row.manualRate?.toString() ?? null;
    if (d.rateMode === "manual") {
      const r = parseRate(d.manualRate ?? "");
      if (!r) return fail("Indiquez un taux manuel positif (jusqu'à 10 décimales).", { manualRate: ["Exemple : 1 EUR = 655,957 FCFA, saisissez 655.957."] });
      manualRate = formatRate(r);
    }
    if (d.enabled && d.rateMode === "auto") {
      const auto = storeRateFor(store.currency, { currency: d.currency, rateMode: "auto", manualRate: null }, await loadPlatformRates(), new Date());
      if (!auto) return fail(`Aucun taux automatique pour ${d.currency} : passez en mode manuel.`, { rateMode: ["Taux automatique indisponible."] });
    }
    // Réactivation : contrôle du quota de plan (une devise déjà active ne compte pas deux fois).
    if (d.enabled && !row.enabled) {
      const allowance = currencyAllowance(ctx.planId);
      const enabled = await db.storeCurrency.count({ where: { storeId: store.id, enabled: true, currency: { not: store.currency } } });
      if (allowance === 0 || (allowance != null && enabled >= allowance)) return fail(planMessage(PLANS[ctx.planId].name, allowance));
    }

    await db.storeCurrency.updateMany({
      where: { id: row.id, storeId: store.id },
      data: { enabled: d.enabled, rateMode: d.rateMode, manualRate, markupBps, rounding: d.rounding },
    });
    await audit({
      storeId: store.id,
      actorId: ctx.user.id,
      action: "currency.updated",
      target: d.currency,
      metadata: { enabled: d.enabled, rateMode: d.rateMode, manualRate, markupBps, rounding: d.rounding, before: { enabled: row.enabled, rateMode: row.rateMode, manualRate: row.manualRate?.toString() ?? null, markupBps: row.markupBps, rounding: row.rounding } },
    });
    revalidate(store.id, store.slug);
    return success(undefined, "Devise enregistrée.");
  });
}

export async function removeStoreCurrency(storeId: string, currency: string): Promise<ActionResult> {
  return guard(async () => {
    if (!isCurrencyCode(currency)) return fail("Devise invalide.");
    const ctx = await requireStore(storeId, "store.settings");
    const r = await db.storeCurrency.deleteMany({ where: { storeId: ctx.store.id, currency } });
    if (r.count === 0) return fail("Devise introuvable.");
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "currency.removed", target: currency });
    revalidate(ctx.store.id, ctx.store.slug);
    return success(undefined, "Devise retirée. Les prix fixés dans cette devise sont conservés.");
  });
}

/* ───────────────────────── Prix fixés par devise (ProductPrice) ───────────────────────── */

const priceSchema = z.object({
  storeId: z.string().min(8).max(64),
  productId: z.string().min(8).max(64),
  currency: z.string().trim().toUpperCase().refine(isCurrencyCode, "Devise invalide."),
  price: z.string().trim().min(1, "Indiquez un prix."),
  compareAtPrice: zOptionalString,
});

/** Prix fixé d'un produit SIMPLE (sans variantes) dans une devise activée : prioritaire sur la conversion. */
export async function upsertProductPrice(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(priceSchema, formData);
    if ("error" in parsed) return parsed.error;
    const d = parsed.data;
    const ctx = await requireStore(d.storeId, "products.manage");
    const store = ctx.store;
    if (currencyAllowance(ctx.planId) === 0) return fail(planMessage(PLANS[ctx.planId].name, 0));
    // Devise DÉSACTIVÉE : aucun prix fixé (il ne serait jamais affiché et réapparaîtrait à la réactivation).
    const sc = await db.storeCurrency.findUnique({ where: { storeId_currency: { storeId: store.id, currency: d.currency } }, select: { id: true, enabled: true } });
    if (!sc) return fail("Activez d'abord cette devise.");
    if (!sc.enabled) return fail(`La devise ${d.currency} est désactivée : réactivez-la dans Devises avant de fixer un prix.`);
    const product = await db.product.findFirst({ where: { id: d.productId, storeId: store.id }, select: { id: true, name: true, isGiftCard: true, _count: { select: { variants: true } } } });
    if (!product) return fail("Produit introuvable.");
    if (product.isGiftCard) return fail("Une carte cadeau n'a de prix que dans la devise de la boutique.");
    if (product._count.variants > 0) return fail("Les prix fixés sont réservés aux produits sans variantes pour le moment.");
    const price = parseMoneyInput(d.price, d.currency);
    if (price == null || price <= 0 || price > 1_000_000_000) return fail("Prix invalide.", { price: ["Montant positif, par exemple 9,99."] });
    const compareAt = d.compareAtPrice ? parseMoneyInput(d.compareAtPrice, d.currency) : null;
    if (d.compareAtPrice && (compareAt == null || compareAt <= price)) return fail("Le prix barré doit être supérieur au prix.", { compareAtPrice: ["Supérieur au prix, ou vide."] });

    const itemKey = product.id; // produit simple : variantId ?? productId
    await db.productPrice.upsert({
      where: { itemKey_currency: { itemKey, currency: d.currency } },
      create: { storeId: store.id, productId: product.id, variantId: null, itemKey, currency: d.currency, price, compareAtPrice: compareAt },
      update: { price, compareAtPrice: compareAt },
    });
    await audit({ storeId: store.id, actorId: ctx.user.id, action: "product.price_fixed", target: product.id, metadata: { currency: d.currency, price, compareAtPrice: compareAt } });
    revalidate(store.id, store.slug);
    return success(undefined, `Prix fixé pour ${product.name}.`);
  });
}

export async function deleteProductPrice(storeId: string, priceId: string): Promise<ActionResult> {
  return guard(async () => {
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(priceId)) return fail("Identifiant invalide");
    const ctx = await requireStore(storeId, "products.manage");
    const r = await db.productPrice.deleteMany({ where: { id: priceId, storeId: ctx.store.id } });
    if (r.count === 0) return fail("Prix introuvable.");
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "product.price_unfixed", target: priceId });
    revalidate(ctx.store.id, ctx.store.slug);
    return success(undefined, "Prix fixé supprimé : le prix converti s'applique.");
  });
}

/* ───────────────────────── Administration plateforme ───────────────────────── */

async function requireFxAdmin() {
  const { user } = await requireAdminPermission("settings.manage");
  return user;
}

/** Rafraîchit immédiatement les taux BCE (à brancher sur l'écran admin). Audit `admin.fx.refresh`. */
export async function adminRefreshFxRates(): Promise<ActionResult<{ updated: number }>> {
  return guard(async () => {
    const user = await requireFxAdmin();
    const { refreshPlatformRates } = await import("./rates");
    const r = await refreshPlatformRates();
    await audit({ actorId: user.id, action: "admin.fx.refresh", metadata: { updated: r.updated, date: r.date } });
    return success({ updated: r.updated }, `${r.updated} taux mis à jour.`);
  });
}

const platformRateSchema = z.object({
  base: z.string().trim().toUpperCase().refine(isCurrencyCode),
  quote: z.string().trim().toUpperCase().refine(isCurrencyCode),
  rate: z.string().trim().min(1),
});

/** Taux plateforme saisi par l'administrateur (source `manual`). Les parités fixes BCEAO ne sont pas modifiables. */
export async function adminSetPlatformRate(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(platformRateSchema, formData);
    if ("error" in parsed) return parsed.error;
    const user = await requireFxAdmin();
    const { base, quote } = parsed.data;
    const fixed = ["XOF", "XAF", "EUR"];
    if (base === quote || (fixed.includes(base) && fixed.includes(quote))) return fail("Parité fixe ou identique : non modifiable.");
    const r = parseRate(parsed.data.rate);
    if (!r) return fail("Taux invalide.");
    const rate = formatRate(r);
    await db.exchangeRate.upsert({ where: { base_quote: { base, quote } }, create: { base, quote, rate, source: "manual", fetchedAt: new Date() }, update: { rate, source: "manual", fetchedAt: new Date() } });
    clearRatesMemo();
    await audit({ actorId: user.id, action: "admin.fx.rate_set", target: `${base}/${quote}`, metadata: { rate } });
    return success(undefined, "Taux enregistré.");
  });
}
