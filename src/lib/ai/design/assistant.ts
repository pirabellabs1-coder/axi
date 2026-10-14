/**
 * Lot 4 §10 : assistant de design conversationnel (module PUR, testé).
 *
 * Sortie attendue du modèle : `{ explanation, operations }`. Chaque opération est validée UNE PAR UNE
 * (liste blanche d'opérations, puis `applyOperations` qui revérifie chaque champ et revalide le document).
 * Les textes proposés repassent par les garde-fous (`cleanCopy`) : aucun prix, promesse ni promotion.
 * Rien n'est appliqué si une seule opération est refusée (atomicité de `applyOperations`).
 */
import { z } from "zod";
import { applyOperations, type ApplyResult, type ThemeOperationName } from "@/lib/theme-engine/operations";
import type { ThemeDocument } from "@/lib/theme-engine/types";
import type { ThemeRefs } from "@/lib/theme-engine/validate";
import { extractJson } from "../parse";
import { cleanCopy } from "./guards";

/** Opérations que l'assistant peut employer (liste blanche : ni modèles alternatifs, ni sources dynamiques, ni sections enregistrées). */
export const ASSISTANT_OPERATIONS: readonly ThemeOperationName[] = [
  "addSection",
  "duplicateSection",
  "removeSection",
  "moveSection",
  "setSectionHidden",
  "updateSectionSetting",
  "applySectionPreset",
  "setSectionAnimation",
  "addBlock",
  "removeBlock",
  "moveBlock",
  "setBlockHidden",
  "updateBlockSetting",
  "updateGlobalSetting",
];

export const MAX_ASSISTANT_OPERATIONS = 20;

export const assistantOutputSchema = z.object({
  explanation: z.string().trim().max(400).default(""),
  operations: z.array(z.unknown()).max(40).default([]),
});

export type AssistantOutput = { explanation: string; operations: unknown[] };

/** Lecture de la réponse du modèle (tolère un bloc ```json``` ou du texte autour). */
export function parseAssistantResponse(text: string): { ok: true; data: AssistantOutput } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = extractJson(text);
  } catch {
    return { ok: false, error: "Réponse de l'assistant illisible. Reformulez votre demande." };
  }
  const p = assistantOutputSchema.safeParse(json);
  if (!p.success) return { ok: false, error: "Réponse de l'assistant incomplète. Réessayez." };
  const explanation = cleanCopy(p.data.explanation, 200) || p.data.explanation.slice(0, 200);
  return { ok: true, data: { explanation, operations: p.data.operations.slice(0, MAX_ASSISTANT_OPERATIONS) } };
}

/** Nettoie les valeurs texte des opérations (garde-fous §9) ; une valeur vidée annule l'opération. */
export function sanitizeAssistantOperations(operations: unknown[]): unknown[] {
  const out: unknown[] = [];
  for (const raw of operations) {
    if (!raw || typeof raw !== "object") continue;
    const op = { ...(raw as Record<string, unknown>) };
    if ((op.op === "updateSectionSetting" || op.op === "updateBlockSetting") && typeof op.value === "string") {
      const clean = cleanCopy(op.value, 600);
      if (!clean) continue;
      op.value = clean;
    }
    if (op.op === "updateGlobalSetting" && typeof op.value === "string" && /^(header\.announcement\.text|footer\.text)$/.test(String(op.path))) {
      const clean = cleanCopy(op.value, 200);
      if (!clean) continue;
      op.value = clean;
    }
    out.push(op);
  }
  return out.slice(0, MAX_ASSISTANT_OPERATIONS);
}

/** Applique les opérations de l'assistant à un document (liste blanche + revalidation). */
export function applyAssistantOperations(doc: ThemeDocument, operations: unknown[], opts: { refs?: ThemeRefs } = {}): ApplyResult {
  return applyOperations(doc, sanitizeAssistantOperations(operations), {
    maxOps: MAX_ASSISTANT_OPERATIONS,
    allow: ASSISTANT_OPERATIONS,
    validate: true,
    refs: opts.refs,
  });
}
