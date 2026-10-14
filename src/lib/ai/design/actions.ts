"use server";

import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireStore, type StoreContext } from "@/lib/auth/permissions";
import { guard, fail, success, zRawId, type ActionResult } from "@/lib/action";
import { PLANS } from "@/config/plans";
import { audit } from "@/lib/audit";
import { debitCredits, getBalances, refundCredits } from "@/lib/credits";
import { rateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { randomToken } from "@/lib/utils";
import { enqueue } from "@/lib/jobs";
import { isDisplayableImageUrl } from "@/lib/storage/public-url";
import { collectReferences, validateThemeDocument, type ThemeRefs } from "@/lib/theme-engine/validate";
import type { ThemeDocument } from "@/lib/theme-engine/types";
import { AiError, callClaudeJson, isAiConfigured, MAX_AI_IMAGE_BASE64, MAX_AI_IMAGES } from "../client";
import { extractJson } from "../parse";
import { compileBrief, type StoreDesignData } from "./compile";
import { DESIGN_CREDITS, GENERATION_RATE, generationCost, grantOnboardingGiftSafe } from "./credits";
import { fakeAssistant, fakeBrief, isFakeAi } from "./fake";
import { buildAssistantPrompt, buildDesignPrompt, designModel, summarizeDocument, ASSISTANT_JSON_SCHEMA, ASSISTANT_SYSTEM, DESIGN_SYSTEM } from "./prompts";
import { parseBrief, STORE_DESIGN_BRIEF_SCHEMA, type StoreDesignDirection } from "./schema";
import { loadStoreDesignData, STORE_DESIGN_SELECT } from "./store-data";
import { applyAssistantOperations, parseAssistantResponse } from "./assistant";

/**
 * Lot 4 §9 et §10 : actions serveur de la génération de boutique et de l'assistant de design.
 *
 * Garanties :
 *  - aucune sortie IA n'est écrite sans passer par le compilateur, la liste blanche et `validateThemeDocument` ;
 *  - rien n'est enregistré à la génération (les 3 candidats restent dans `ThemeGeneration`, 7 jours) ;
 *  - le choix écrit le BROUILLON, après une `ThemeVersion` « Avant génération IA » ; jamais de publication ;
 *  - crédits débités AVANT l'appel, remboursés en cas d'échec ou de sortie invalide ;
 *  - audit `ai.store_design` (modèle, jetons, crédits, réussite).
 */

const GENERATION_TTL_DAYS = 7;
const MAX_CANDIDATES = 3;

const imageSchema = z.object({ mediaType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]), data: z.string().min(16).max(MAX_AI_IMAGE_BASE64) });

const generateSchema = z.object({
  storeId: zRawId,
  brief: z.string().trim().min(10, "Décrivez votre boutique en une phrase (10 caractères minimum).").max(500, "500 caractères maximum."),
  audience: z.string().trim().max(160).nullable().optional(),
  bannedWords: z.array(z.string().trim().max(40)).max(20).default([]),
  locale: z.string().trim().max(10).default("fr"),
  /** Photos déjà téléversées (stockage de la boutique) : utilisées par le compilateur. */
  photos: z.array(z.string().max(2000)).max(6).default([]),
  /** Mêmes photos réduites à 1 024 px, en base64, pour l'analyse par le modèle. */
  images: z.array(imageSchema).max(MAX_AI_IMAGES).default([]),
});

export type GenerateDesignInput = z.input<typeof generateSchema>;

export type DesignCandidate = {
  index: number;
  id: string;
  name: string;
  rationale: string;
  doc: ThemeDocument;
  notes: string[];
  fallback: boolean;
};

export type GenerateDesignResult = { generationId: string; candidates: DesignCandidate[]; creditsUsed: number; balance: number; simulated: boolean };

function refsOf(data: StoreDesignData): ThemeRefs {
  return { collectionIds: new Set(data.collections.map((c) => c.id)), productIds: new Set(data.products.map((p) => p.id)) };
}

/** Disponibilité de la génération : plan, configuration, crédits (affichage du formulaire). */
export async function getDesignStatus(storeId: string): Promise<ActionResult<{ available: boolean; reason: string | null; balance: number; cost: number; assistant: boolean; simulated: boolean; gift: number }>> {
  return guard(async () => {
    if (!zRawId.safeParse(storeId).success) return fail("Boutique invalide.");
    const ctx = await requireStore(storeId, "theme.manage");
    const plan = PLANS[ctx.planId];
    const gift = await grantOnboardingGiftSafe(ctx.store.id);
    const balance = (await getBalances(ctx.store.id)).AI;
    const configured = isAiConfigured() || isFakeAi();
    const reason = !plan.features.aiStoreBuilder
      ? "La génération de boutique par l'IA n'est pas incluse dans votre plan."
      : !configured
        ? "L'assistant IA n'est pas encore activé sur la plateforme."
        : balance < DESIGN_CREDITS.generate
          ? `Crédits IA insuffisants : ${DESIGN_CREDITS.generate} crédits sont nécessaires (solde ${balance}).`
          : null;
    return success({
      available: !reason,
      reason,
      balance,
      cost: DESIGN_CREDITS.generate,
      assistant: plan.features.designAssistant,
      simulated: isFakeAi(),
      gift,
    });
  });
}

/** §9 : génère 3 directions. Rien n'est enregistré dans le thème (ni brouillon, ni publication). */
export async function generateStoreDesign(input: GenerateDesignInput): Promise<ActionResult<GenerateDesignResult>> {
  return guard<GenerateDesignResult>(async () => {
    const p = generateSchema.safeParse(input);
    if (!p.success) return fail(p.error.issues[0]?.message ?? "Demande invalide.");
    const d = p.data;
    const ctx = await requireStore(d.storeId, "theme.manage");
    const plan = PLANS[ctx.planId];
    if (!plan.features.aiStoreBuilder) return fail("La génération de boutique par l'IA n'est pas incluse dans votre plan.");
    const simulated = isFakeAi();
    if (!isAiConfigured() && !simulated) return fail("L'assistant IA n'est pas encore activé sur la plateforme.");

    const rl = await rateLimit(`ai:design:${ctx.store.id}`, GENERATION_RATE.limit, GENERATION_RATE.windowSec);
    if (!rl.ok) return fail(rateLimitMessage(rl.retryAfter));

    const photos = d.photos.filter((u) => isDisplayableImageUrl(u));
    const images = simulated ? [] : d.images;
    const cost = generationCost(images.length);
    const model = designModel();

    await grantOnboardingGiftSafe(ctx.store.id);
    const store = await db.store.findUniqueOrThrow({ where: { id: ctx.store.id }, select: STORE_DESIGN_SELECT });
    const data = await loadStoreDesignData(store, photos);

    const reference = `aidesign:${randomToken(8)}`;
    const debit = await db.$transaction((tx) => debitCredits(ctx.store.id, "AI", cost, reference, tx));
    if (!debit.ok) return fail(debit.error);

    const generation = await db.themeGeneration.create({
      data: {
        storeId: ctx.store.id,
        status: "RUNNING",
        input: { brief: d.brief, audience: d.audience ?? null, bannedWords: d.bannedWords, photos, locale: d.locale, simulated } as unknown as Prisma.InputJsonValue,
        model,
        creditsUsed: cost,
        createdById: ctx.user.id,
        expiresAt: new Date(Date.now() + GENERATION_TTL_DAYS * 86_400_000),
      },
      select: { id: true },
    });
    // Purge des générations expirées (7 jours) : job dédié, planifié après chaque génération.
    await enqueue("ai.generation_purge", {}, { storeId: ctx.store.id, runAt: new Date(Date.now() + GENERATION_TTL_DAYS * 86_400_000) }).catch(() => {});

    const giveUp = async (message: string, meta: Record<string, unknown>) => {
      await refundCredits(ctx.store.id, reference, null);
      await db.themeGeneration.update({ where: { id: generation.id }, data: { status: "FAILED", error: message.slice(0, 500), creditsUsed: 0 } }).catch(() => {});
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "ai.store_design", target: generation.id, metadata: { ok: false, model, credits: 0, ...meta } }).catch(() => {});
      return fail(`${message} Vos crédits n'ont pas été débités.`);
    };

    let usage = { input: 0, output: 0 };
    let raw: unknown;
    try {
      if (simulated) {
        raw = fakeBrief(data, d.brief);
      } else {
        const res = await callClaudeJson({
          system: DESIGN_SYSTEM,
          user: buildDesignPrompt({ data, brief: d.brief, audience: d.audience, bannedWords: d.bannedWords, locale: d.locale, photoCount: images.length }),
          schema: STORE_DESIGN_BRIEF_SCHEMA as unknown as Record<string, unknown>,
          model,
          images,
          maxTokens: 8000,
          effort: "medium",
          timeoutMs: 90_000,
        });
        usage = res.usage;
        raw = extractJson(res.text);
      }
    } catch (e) {
      return giveUp(e instanceof AiError ? e.message : "L'assistant n'a pas pu proposer de direction.", { error: "call", inputTokens: usage.input, outputTokens: usage.output });
    }

    const brief = parseBrief(raw);
    if (!brief.ok) return giveUp("La proposition reçue était incomplète. Réessayez.", { error: "parse", inputTokens: usage.input, outputTokens: usage.output });

    const refs = refsOf(data);
    const candidates: DesignCandidate[] = brief.brief.directions.slice(0, MAX_CANDIDATES).map((direction, index) => {
      const r = compileBrief(direction, data, { refs });
      return { index, id: direction.id, name: direction.name, rationale: direction.rationale, doc: r.doc, notes: r.notes, fallback: r.fallback };
    });
    if (!candidates.length) return giveUp("Aucune direction exploitable n'a été produite.", { error: "empty", inputTokens: usage.input, outputTokens: usage.output });

    await db.themeGeneration.update({
      where: { id: generation.id },
      data: {
        status: "SUCCEEDED",
        candidates: candidates as unknown as Prisma.InputJsonValue,
        inputTokens: usage.input,
        outputTokens: usage.output,
      },
    });
    await audit({
      storeId: ctx.store.id,
      actorId: ctx.user.id,
      action: "ai.store_design",
      target: generation.id,
      metadata: { ok: true, model, credits: cost, photos: images.length, directions: candidates.length, fallbacks: candidates.filter((c) => c.fallback).length, inputTokens: usage.input, outputTokens: usage.output, simulated },
    }).catch(() => {});

    return success(
      { generationId: generation.id, candidates, creditsUsed: cost, balance: debit.balance, simulated },
      "3 directions prêtes : comparez les aperçus, rien n'est encore enregistré.",
    );
  });
}

/** §9 : régénère UNE direction (4 crédits). Remplace le candidat à l'index donné. */
export async function regenerateDirection(storeId: string, generationId: string, index: number): Promise<ActionResult<{ candidate: DesignCandidate; balance: number }>> {
  return guard(async () => {
    if (!zRawId.safeParse(storeId).success || !zRawId.safeParse(generationId).success) return fail("Demande invalide.");
    if (!Number.isInteger(index) || index < 0 || index >= MAX_CANDIDATES) return fail("Direction inconnue.");
    const ctx = await requireStore(storeId, "theme.manage");
    if (!PLANS[ctx.planId].features.aiStoreBuilder) return fail("La génération de boutique par l'IA n'est pas incluse dans votre plan.");
    const simulated = isFakeAi();
    if (!isAiConfigured() && !simulated) return fail("L'assistant IA n'est pas encore activé sur la plateforme.");

    const row = await db.themeGeneration.findFirst({ where: { id: generationId, storeId: ctx.store.id }, select: { id: true, input: true, candidates: true, model: true } });
    if (!row) return fail("Génération introuvable.");
    const existing = Array.isArray(row.candidates) ? (row.candidates as unknown as DesignCandidate[]) : [];
    if (!existing[index]) return fail("Direction introuvable.");

    const rl = await rateLimit(`ai:design:${ctx.store.id}`, GENERATION_RATE.limit, GENERATION_RATE.windowSec);
    if (!rl.ok) return fail(rateLimitMessage(rl.retryAfter));

    const inputData = (row.input ?? {}) as { brief?: string; audience?: string | null; bannedWords?: string[]; photos?: string[]; locale?: string };
    const store = await db.store.findUniqueOrThrow({ where: { id: ctx.store.id }, select: STORE_DESIGN_SELECT });
    const data = await loadStoreDesignData(store, inputData.photos ?? []);

    const reference = `aidesign:${randomToken(8)}`;
    const debit = await db.$transaction((tx) => debitCredits(ctx.store.id, "AI", DESIGN_CREDITS.regenerate, reference, tx));
    if (!debit.ok) return fail(debit.error);

    const model = designModel();
    let usage = { input: 0, output: 0 };
    let direction: StoreDesignDirection | null = null;
    try {
      if (simulated) {
        const alt = fakeBrief(data, `${inputData.brief ?? ""} variante ${index + 1}`);
        direction = alt.directions[(index + 1) % alt.directions.length] ?? null;
      } else {
        const res = await callClaudeJson({
          system: DESIGN_SYSTEM,
          user: `${buildDesignPrompt({ data, brief: inputData.brief ?? "", audience: inputData.audience ?? null, bannedWords: inputData.bannedWords ?? [], locale: inputData.locale ?? "fr", photoCount: 0 })}

La direction « ${existing[index].name} » n'a pas convenu : proposez 3 directions NOUVELLES, nettement différentes de celle-ci.`,
          schema: STORE_DESIGN_BRIEF_SCHEMA as unknown as Record<string, unknown>,
          model,
          maxTokens: 8000,
          effort: "medium",
          timeoutMs: 90_000,
        });
        usage = res.usage;
        const brief = parseBrief(extractJson(res.text));
        direction = brief.ok ? (brief.brief.directions[0] ?? null) : null;
      }
    } catch (e) {
      await refundCredits(ctx.store.id, reference, null);
      return fail(`${e instanceof AiError ? e.message : "Nouvelle proposition impossible."} Vos crédits n'ont pas été débités.`);
    }
    if (!direction) {
      await refundCredits(ctx.store.id, reference, null);
      return fail("La proposition reçue était incomplète. Vos crédits n'ont pas été débités.");
    }

    const r = compileBrief(direction, data, { refs: refsOf(data) });
    const candidate: DesignCandidate = { index, id: direction.id, name: direction.name, rationale: direction.rationale, doc: r.doc, notes: r.notes, fallback: r.fallback };
    const next = existing.map((c, i) => (i === index ? candidate : c));
    await db.themeGeneration.update({
      where: { id: row.id },
      data: { candidates: next as unknown as Prisma.InputJsonValue, inputTokens: { increment: usage.input }, outputTokens: { increment: usage.output }, creditsUsed: { increment: DESIGN_CREDITS.regenerate } },
    });
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "ai.store_design", target: row.id, metadata: { ok: true, model, credits: DESIGN_CREDITS.regenerate, regenerate: index, simulated } }).catch(() => {});
    return success({ candidate, balance: debit.balance }, "Nouvelle direction proposée.");
  });
}

/**
 * §9 : retient une direction. Écrit le BROUILLON après avoir enregistré une version « Avant génération IA ».
 * Aucune publication automatique : le commerçant ajuste puis publie lui-même.
 */
export async function chooseDirection(storeId: string, generationId: string, index: number): Promise<ActionResult<{ doc: ThemeDocument; versionId: string }>> {
  return guard(async () => {
    if (!zRawId.safeParse(storeId).success || !zRawId.safeParse(generationId).success) return fail("Demande invalide.");
    if (!Number.isInteger(index) || index < 0 || index >= MAX_CANDIDATES) return fail("Direction inconnue.");
    const ctx = await requireStore(storeId, "theme.manage");
    const row = await db.themeGeneration.findFirst({ where: { id: generationId, storeId: ctx.store.id }, select: { id: true, candidates: true, expiresAt: true } });
    if (!row) return fail("Génération introuvable.");
    if (row.expiresAt.getTime() < Date.now()) return fail("Cette génération a expiré. Relancez une génération.");
    const candidates = Array.isArray(row.candidates) ? (row.candidates as unknown as DesignCandidate[]) : [];
    const chosen = candidates[index];
    if (!chosen) return fail("Direction introuvable.");

    // Revalidation complète avec les références réelles : rien n'est écrit sans ce contrôle.
    const refs = collectReferences(chosen.doc as ThemeDocument);
    const [collections, products, menus] = await Promise.all([
      refs.collectionIds.length ? db.category.findMany({ where: { storeId: ctx.store.id, id: { in: refs.collectionIds } }, select: { id: true } }) : [],
      refs.productIds.length ? db.product.findMany({ where: { storeId: ctx.store.id, id: { in: refs.productIds } }, select: { id: true } }) : [],
      db.storeMenu.findMany({ where: { storeId: ctx.store.id }, select: { handle: true } }),
    ]);
    const checked = validateThemeDocument(chosen.doc, {
      refs: {
        collectionIds: new Set(collections.map((c) => c.id)),
        productIds: new Set(products.map((p) => p.id)),
        menuHandles: new Set(["main", "footer", "legal", ...menus.map((m) => m.handle)]),
      },
    });
    if (!checked.ok) return fail("Cette direction n'est plus applicable (produits ou collections modifiés). Relancez une génération.");

    const doc: ThemeDocument = { ...checked.doc, updatedAt: new Date().toISOString() };
    const store = await db.store.findUniqueOrThrow({ where: { id: ctx.store.id }, select: { themeDoc: true, themeDocDraft: true } });
    const previous = store.themeDocDraft ?? store.themeDoc;

    const versionId = await db.$transaction(async (tx) => {
      let id = "";
      if (previous) {
        const v = await tx.themeVersion.create({
          data: { storeId: ctx.store.id, label: "Avant génération IA", document: previous as Prisma.InputJsonValue, actorId: ctx.user.id },
          select: { id: true },
        });
        id = v.id;
      }
      await tx.store.update({ where: { id: ctx.store.id }, data: { themeDocDraft: doc as unknown as Prisma.InputJsonValue } });
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "ai.store_design_chosen", target: row.id, metadata: { index, name: chosen.name, versionId: id || null } }, tx);
      return id;
    });
    await db.themeGeneration.update({ where: { id: row.id }, data: { chosenIndex: index } });

    return success({ doc, versionId }, "Direction appliquée au brouillon. Ajustez puis publiez quand vous êtes prêt.");
  });
}

/* ───────────── §10 Assistant de design ───────────── */

const assistantSchema = z.object({
  storeId: zRawId,
  instruction: z.string().trim().min(3, "Décrivez ce que vous voulez changer.").max(500, "500 caractères maximum."),
  docJson: z.string().min(2).max(3_600_000),
  template: z.string().trim().max(32).default("home"),
  selection: z.string().trim().max(64).nullable().optional(),
});

export type DesignAssistantInput = z.input<typeof assistantSchema>;
export type DesignAssistantResult = { explanation: string; operations: unknown[]; creditsUsed: number; balance: number; refused: boolean };

/** §10 : traduit une instruction en opérations validées. L'éditeur les applique au brouillon (annulable en un clic). */
export async function runDesignAssistant(input: DesignAssistantInput): Promise<ActionResult<DesignAssistantResult>> {
  return guard<DesignAssistantResult>(async () => {
    const p = assistantSchema.safeParse(input);
    if (!p.success) return fail(p.error.issues[0]?.message ?? "Demande invalide.");
    const d = p.data;
    const ctx = await requireStore(d.storeId, "theme.manage");
    if (!PLANS[ctx.planId].features.designAssistant) return fail(`L'assistant de design est inclus à partir du plan Business (plan actuel : ${PLANS[ctx.planId].name}).`);
    const simulated = isFakeAi();
    if (!isAiConfigured() && !simulated) return fail("L'assistant IA n'est pas encore activé sur la plateforme.");

    const rl = await rateLimit(`ai:assistant:${ctx.store.id}`, 20, 600);
    if (!rl.ok) return fail(rateLimitMessage(rl.retryAfter));

    let parsedDoc: unknown;
    try {
      parsedDoc = JSON.parse(d.docJson);
    } catch {
      return fail("Document de thème illisible. Rechargez l'éditeur.");
    }
    const current = validateThemeDocument(parsedDoc);
    if (!current.ok) return fail("Le brouillon contient des réglages à corriger avant d'utiliser l'assistant.");
    const doc = current.doc;
    const template = doc.templates[d.template as keyof typeof doc.templates] ? (d.template as keyof typeof doc.templates) : "home";

    const reference = `aiassist:${randomToken(8)}`;
    const debit = await db.$transaction((tx) => debitCredits(ctx.store.id, "AI", DESIGN_CREDITS.assistant, reference, tx));
    if (!debit.ok) return fail(debit.error);

    const model = designModel();
    const log = (ok: boolean, meta: Record<string, unknown>) =>
      audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "ai.design_assistant", metadata: { ok, model, credits: ok ? DESIGN_CREDITS.assistant : 0, simulated, ...meta } }).catch(() => {});

    const summary = summarizeDocument(doc, template);
    let usage = { input: 0, output: 0 };
    let output: { explanation: string; operations: unknown[] };
    try {
      if (simulated) {
        output = fakeAssistant(d.instruction, { template, sectionIds: doc.templates[template].order, selection: d.selection ?? null });
      } else {
        const res = await callClaudeJson({
          system: ASSISTANT_SYSTEM,
          user: buildAssistantPrompt({ summary, instruction: d.instruction, selection: d.selection ?? null }),
          schema: ASSISTANT_JSON_SCHEMA as unknown as Record<string, unknown>,
          model,
          maxTokens: 3000,
        });
        usage = res.usage;
        const parsed = parseAssistantResponse(res.text);
        if (!parsed.ok) {
          await refundCredits(ctx.store.id, reference, null);
          await log(false, { error: "parse" });
          return fail(`${parsed.error} Vos crédits n'ont pas été débités.`);
        }
        output = parsed.data;
      }
    } catch (e) {
      await refundCredits(ctx.store.id, reference, null);
      await log(false, { error: "call" });
      if (e instanceof AiError) return fail(`${e.message} Vos crédits n'ont pas été débités.`);
      throw e;
    }

    if (!output.operations.length) {
      // Refus explicite ou demande hors cadre : rien n'est modifié, les crédits sont rendus.
      await refundCredits(ctx.store.id, reference, null);
      await log(false, { error: "refused" });
      return success(
        { explanation: output.explanation || "Je ne peux pas faire cela : je ne modifie que l'apparence de la boutique.", operations: [], creditsUsed: 0, balance: debit.balance + DESIGN_CREDITS.assistant, refused: true },
        "Aucune modification : vos crédits n'ont pas été débités.",
      );
    }

    // Les opérations sont ESSAYÉES ici (liste blanche + revalidation) : le client ne reçoit que des opérations applicables.
    const refs = collectReferences(doc);
    const [collections, products] = await Promise.all([
      refs.collectionIds.length ? db.category.findMany({ where: { storeId: ctx.store.id, id: { in: refs.collectionIds } }, select: { id: true } }) : [],
      refs.productIds.length ? db.product.findMany({ where: { storeId: ctx.store.id, id: { in: refs.productIds } }, select: { id: true } }) : [],
    ]);
    const applied = applyAssistantOperations(doc, output.operations, {
      refs: { collectionIds: new Set(collections.map((c) => c.id)), productIds: new Set(products.map((x) => x.id)) },
    });
    if (!applied.ok) {
      await refundCredits(ctx.store.id, reference, null);
      await log(false, { error: "operations", detail: applied.error });
      return fail(`La modification proposée a été refusée (${applied.error}). Vos crédits n'ont pas été débités.`);
    }

    await log(true, { operations: output.operations.length, inputTokens: usage.input, outputTokens: usage.output });
    return success(
      { explanation: output.explanation, operations: output.operations, creditsUsed: DESIGN_CREDITS.assistant, balance: debit.balance, refused: false },
      "Modification appliquée au brouillon.",
    );
  });
}

/** Contexte serveur partagé (évite de refaire les mêmes requêtes dans les pages). */
export type DesignStoreContext = StoreContext;
