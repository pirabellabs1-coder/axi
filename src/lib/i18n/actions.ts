"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireStore } from "@/lib/auth/permissions";
import { guard, parseForm, fail, success, type ActionResult } from "@/lib/action";
import { audit } from "@/lib/audit";
import { PLANS } from "@/config/plans";
import { debitCredits, refundCredits } from "@/lib/credits";
import { rateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { randomToken } from "@/lib/utils";
import { AiError, callClaudeJson, isAiConfigured } from "@/lib/ai/client";
import { isSafeMarkdown } from "@/lib/theme-engine/validate";
import { isPlatformLocale, localeLabel, storeLocales } from "@/i18n/locales";
import { MAX_VALUE_LENGTH, TRANSLATABLE_RESOURCES, RESOURCE_META, type TranslatableResourceType } from "./resources";
import { sourceHash } from "./hash";
import { loadResources } from "./service";
import {
  MAX_BATCH_CHARS,
  TRANSLATE_JSON_SCHEMA,
  TRANSLATE_SYSTEM,
  batchItems,
  buildTranslatePrompt,
  countChars,
  itemKey,
  parseGlossary,
  parseItemKey,
  parseTranslateResponse,
  translationCost,
  type TranslationItem,
} from "./translate-ai";

/**
 * Actions des langues (lot 2 §1.1). Capacité `store.settings`, quota de plan `limits.languages` vérifié
 * côté serveur, isolation `storeId` sur toutes les lectures et écritures, journalisation `audit()`.
 *
 * La traduction par l'IA débite les crédits AVANT l'appel et les rembourse en cas d'échec
 * (même schéma que `src/lib/ai/actions.ts`). Un champ refusé par les garde-fous n'écrase jamais la source.
 */

const storeId = z.string().min(8).max(64);
const localeField = z.string().trim().toLowerCase().refine(isPlatformLocale, "Langue inconnue.");
const resourceType = z.enum(TRANSLATABLE_RESOURCES as unknown as [TranslatableResourceType, ...TranslatableResourceType[]]);

function revalidate(id: string, slug: string) {
  revalidatePath(`/app/${id}/langues`);
  revalidatePath(`/s/${slug}`, "layout");
}

/* ───────────────────────── Langues de la boutique ───────────────────────── */

const languagesSchema = z.object({
  storeId,
  primary: localeField,
  /** Langues secondaires, séparées par des virgules (champ caché du formulaire). */
  secondary: z.string().trim().max(200).optional().default(""),
});

export async function updateLanguages(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(languagesSchema, formData);
    if ("error" in parsed) return parsed.error;
    const ctx = await requireStore(parsed.data.storeId, "store.settings");
    const store = ctx.store;
    const limit = PLANS[ctx.planId].limits.languages;
    const requested = parsed.data.secondary
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s && s !== parsed.data.primary);
    const unknown = requested.find((c) => !isPlatformLocale(c));
    if (unknown) return fail("Langue inconnue.", { secondary: ["Choisissez des langues proposées par la plateforme."] });
    const secondary = [...new Set(requested)];
    const total = 1 + secondary.length;
    if (limit != null && total > limit) {
      return fail(
        limit <= 1
          ? `Le plan ${PLANS[ctx.planId].name} ne permet qu'une seule langue. Passez au plan Business pour en ajouter.`
          : `Votre plan ${PLANS[ctx.planId].name} permet ${limit} langues au total (langue principale comprise).`,
        { secondary: ["Retirez une langue."] },
      );
    }

    await db.store.update({ where: { id: store.id }, data: { locale: parsed.data.primary, enabledLocales: secondary } });
    await audit({ storeId: store.id, actorId: ctx.user.id, action: "i18n.languages_updated", metadata: { primary: parsed.data.primary, secondary } });
    revalidate(store.id, store.slug);
    return success(undefined, secondary.length ? `Langues enregistrées : ${[parsed.data.primary, ...secondary].map(localeLabel).join(", ")}.` : "Langue principale enregistrée.");
  });
}

const glossarySchema = z.object({ storeId, terms: z.string().trim().max(2_000).optional().default("") });

/** Glossaire : termes à ne jamais traduire (marques, références), un par ligne. */
export async function updateGlossary(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(glossarySchema, formData);
    if ("error" in parsed) return parsed.error;
    const ctx = await requireStore(parsed.data.storeId, "store.settings");
    const terms = [...new Set(parsed.data.terms.split(/[\n,;]/).map((t) => t.trim().slice(0, 60)).filter(Boolean))].slice(0, 100);
    const current = (ctx.store.i18nConfig && typeof ctx.store.i18nConfig === "object" && !Array.isArray(ctx.store.i18nConfig) ? ctx.store.i18nConfig : {}) as Record<string, unknown>;
    await db.store.update({ where: { id: ctx.store.id }, data: { i18nConfig: { ...current, glossary: terms.map((term) => ({ term })) } } });
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "i18n.glossary_updated", metadata: { count: terms.length } });
    revalidate(ctx.store.id, ctx.store.slug);
    return success(undefined, terms.length ? `${terms.length} terme(s) protégé(s).` : "Glossaire vidé.");
  });
}

/* ───────────────────────── Traduction manuelle ───────────────────────── */

const translationSchema = z.object({
  storeId,
  locale: localeField,
  resourceType,
  resourceId: z.string().trim().min(1).max(120),
  field: z.string().trim().min(1).max(200),
  value: z.string().max(MAX_VALUE_LENGTH.markdown),
});

/** Le champ existe-t-il réellement sur cette ressource de CETTE boutique ? (aucune écriture arbitraire) */
async function findSource(id: string, type: TranslatableResourceType, resourceId: string, field: string) {
  const entries = await loadResources(id, type, type === "MENU" || type === "THEME" || type === "STORE" ? null : [resourceId], { take: 1 });
  const entry = entries.find((e) => e.id === resourceId);
  return entry?.fields.find((f) => f.field === field) ?? null;
}

export async function upsertTranslation(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(translationSchema, formData);
    if ("error" in parsed) return parsed.error;
    const d = parsed.data;
    const ctx = await requireStore(d.storeId, "store.settings");
    const store = ctx.store;
    const locales = storeLocales(store, PLANS[ctx.planId].limits.languages);
    if (!locales.secondary.includes(d.locale)) return fail(`La langue ${localeLabel(d.locale)} n'est pas activée sur cette boutique.`);

    const source = await findSource(store.id, d.resourceType, d.resourceId, d.field);
    if (!source) return fail("Ce contenu n'existe plus : rechargez la page.");
    const value = d.value.trim();
    if (!value) return deleteOne(store.id, store.slug, ctx.user.id, d);
    if (value.length > MAX_VALUE_LENGTH[source.kind]) return fail(`Traduction trop longue (${MAX_VALUE_LENGTH[source.kind]} caractères maximum).`, { value: ["Raccourcissez le texte."] });
    if (!isSafeMarkdown(value)) return fail("Le texte ne peut pas contenir de HTML ni de lien non sécurisé.", { value: ["Retirez les balises."] });

    await db.translation.upsert({
      where: { storeId_resourceType_resourceId_locale_field: { storeId: store.id, resourceType: d.resourceType, resourceId: d.resourceId, locale: d.locale, field: d.field } },
      create: { storeId: store.id, resourceType: d.resourceType, resourceId: d.resourceId, locale: d.locale, field: d.field, value, source: "MANUAL", sourceHash: sourceHash(source.value), updatedById: ctx.user.id },
      update: { value, source: "MANUAL", sourceHash: sourceHash(source.value), updatedById: ctx.user.id },
    });
    await audit({ storeId: store.id, actorId: ctx.user.id, action: "i18n.translation_saved", target: `${d.resourceType}:${d.resourceId}`, metadata: { locale: d.locale, field: d.field } });
    revalidate(store.id, store.slug);
    return success(undefined, "Traduction enregistrée.");
  });
}

const deleteSchema = translationSchema.omit({ value: true });

export async function deleteTranslation(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(deleteSchema, formData);
    if ("error" in parsed) return parsed.error;
    const ctx = await requireStore(parsed.data.storeId, "store.settings");
    return deleteOne(ctx.store.id, ctx.store.slug, ctx.user.id, parsed.data);
  });
}

async function deleteOne(id: string, slug: string, actorId: string, d: { locale: string; resourceType: TranslatableResourceType; resourceId: string; field: string }): Promise<ActionResult> {
  // `deleteMany` filtré par storeId : une clé d'une autre boutique ne peut jamais être supprimée.
  const res = await db.translation.deleteMany({ where: { storeId: id, resourceType: d.resourceType, resourceId: d.resourceId, locale: d.locale, field: d.field } });
  if (res.count > 0) await audit({ storeId: id, actorId, action: "i18n.translation_deleted", target: `${d.resourceType}:${d.resourceId}`, metadata: { locale: d.locale, field: d.field } });
  revalidate(id, slug);
  return success(undefined, res.count > 0 ? "Traduction supprimée : le texte d'origine réapparaît." : "Aucune traduction à supprimer.");
}

/* ───────────────────────── Traduction par l'IA ───────────────────────── */

const aiSchema = z.object({
  storeId,
  locale: localeField,
  resourceType,
  ids: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
  /** Ne traduire que les champs sans traduction (défaut) ou tout réécrire. */
  overwrite: z.boolean().default(false),
});

export type TranslateInput = z.input<typeof aiSchema>;
export type TranslateSummary = { translated: number; rejected: { label: string; reason: string }[]; creditsUsed: number; chars: number };

export async function translateResources(input: TranslateInput): Promise<ActionResult<TranslateSummary>> {
  return guard<TranslateSummary>(async () => {
    const p = aiSchema.safeParse(input);
    if (!p.success) return fail(p.error.issues[0]?.message ?? "Demande invalide.");
    const d = p.data;
    const ctx = await requireStore(d.storeId, "store.settings");
    const store = ctx.store;
    const plan = PLANS[ctx.planId];
    if (!plan.features.aiTranslation) return fail(`La traduction par l'IA est incluse à partir du plan Business (plan actuel : ${plan.name}).`);
    if (!isAiConfigured()) return fail("L'assistant IA n'est pas encore activé sur la plateforme.");
    const locales = storeLocales(store, plan.limits.languages);
    if (!locales.secondary.includes(d.locale)) return fail(`Activez d'abord la langue ${localeLabel(d.locale)}.`);

    const rl = await rateLimit(`i18n:ai:${store.id}`, 20, 10 * 60);
    if (!rl.ok) return fail(rateLimitMessage(rl.retryAfter));

    /* Champs à traduire : sources de la boutique, moins ce qui est déjà traduit (sauf réécriture demandée) */
    const entries = await loadResources(store.id, d.resourceType, d.ids.length ? d.ids : null, { take: 50 });
    if (!entries.length) return fail(`Aucun contenu à traduire pour « ${RESOURCE_META[d.resourceType].plural} ».`);
    const existing = await db.translation.findMany({
      where: { storeId: store.id, locale: d.locale, resourceType: d.resourceType, resourceId: { in: entries.map((e) => e.id) } },
      select: { resourceId: true, field: true },
    });
    const done = new Set(existing.map((r) => `${r.resourceId}#${r.field}`));
    const labels = new Map<string, string>();
    const items: TranslationItem[] = [];
    for (const entry of entries) {
      for (const field of entry.fields) {
        const key = itemKey(entry.id, field.field);
        if (!d.overwrite && done.has(key)) continue;
        if (field.value.length > MAX_BATCH_CHARS) continue; // texte hors gabarit : traduction manuelle
        labels.set(key, `${entry.label} · ${field.label}`);
        items.push({ key, field });
      }
    }
    if (!items.length) return fail("Tout est déjà traduit dans cette langue.");

    const chars = countChars(items);
    const cost = translationCost(chars);
    const reference = `i18n:${randomToken(8)}`;
    const debit = await db.$transaction((tx) => debitCredits(store.id, "AI", cost, reference, tx));
    if (!debit.ok) return fail(debit.error);

    const log = (ok: boolean, extra: Record<string, unknown>) =>
      audit({ storeId: store.id, actorId: ctx.user.id, action: "i18n.translate_ai", target: d.resourceType, metadata: { ok, locale: d.locale, credits: ok ? cost : 0, chars, ...extra } }).catch(() => {});

    const glossary = parseGlossary(store.i18nConfig);
    const accepted: { resourceId: string; field: string; value: string; source: string }[] = [];
    const rejected: { label: string; reason: string }[] = [];

    try {
      for (const batch of batchItems(items)) {
        const res = await callClaudeJson({
          system: TRANSLATE_SYSTEM,
          user: buildTranslatePrompt({
            items: batch,
            targetLanguage: localeLabel(d.locale),
            sourceLanguage: localeLabel(locales.primary),
            storeName: store.name,
            glossary,
          }),
          schema: TRANSLATE_JSON_SCHEMA as unknown as Record<string, unknown>,
          maxTokens: 8_000,
        });
        const parsed = parseTranslateResponse(res.text, batch, { glossary });
        if (!parsed.ok) throw new AiError(parsed.error);
        for (const [key, value] of Object.entries(parsed.data.accepted)) {
          const k = parseItemKey(key);
          const item = batch.find((i) => i.key === key);
          if (!k || !item) continue;
          accepted.push({ resourceId: k.resourceId, field: k.field, value, source: item.field.value });
        }
        for (const r of parsed.data.rejected) rejected.push({ label: labels.get(r.key) ?? r.key, reason: r.reason });
      }
    } catch (e) {
      await refundCredits(store.id, reference, null);
      await log(false, { error: e instanceof AiError ? e.message : "exception" });
      if (e instanceof AiError) return fail(`${e.message} Vos crédits n'ont pas été débités.`);
      throw e;
    }

    if (!accepted.length) {
      await refundCredits(store.id, reference, null);
      await log(false, { error: "all_rejected", rejected: rejected.length });
      return fail("Aucune traduction n'a passé les contrôles de qualité. Vos crédits n'ont pas été débités.");
    }

    // Écriture en une transaction : filtre `storeId` sur chaque clé composée.
    await db.$transaction(
      accepted.map((a) =>
        db.translation.upsert({
          where: { storeId_resourceType_resourceId_locale_field: { storeId: store.id, resourceType: d.resourceType, resourceId: a.resourceId, locale: d.locale, field: a.field } },
          create: { storeId: store.id, resourceType: d.resourceType, resourceId: a.resourceId, locale: d.locale, field: a.field, value: a.value, source: "AI", sourceHash: sourceHash(a.source), updatedById: ctx.user.id },
          update: { value: a.value, source: "AI", sourceHash: sourceHash(a.source), updatedById: ctx.user.id },
        }),
      ),
    );
    await log(true, { translated: accepted.length, rejected: rejected.length });
    revalidate(store.id, store.slug);
    return success(
      { translated: accepted.length, rejected, creditsUsed: cost, chars },
      `${accepted.length} champ(s) traduit(s) par l'IA (${cost} crédit${cost > 1 ? "s" : ""}). Relisez les textes : ils portent le badge « Traduction automatique ».`,
    );
  });
}
