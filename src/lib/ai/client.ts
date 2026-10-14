import "server-only";
import { AI_MODEL } from "./parse";

/**
 * Appel minimal à l'API Messages d'Anthropic en `fetch` (aucune dépendance ajoutée).
 * Désactivé tant que ANTHROPIC_API_KEY n'est pas configurée.
 */

export function isAiConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export class AiError extends Error {
  constructor(
    message: string,
    public retryable = false,
  ) {
    super(message);
  }
}

type ContentBlock = { type: string; text?: string };
type MessagesResponse = { content?: ContentBlock[]; stop_reason?: string; usage?: { input_tokens?: number; output_tokens?: number }; error?: { message?: string } };

export type AiCallResult = { text: string; usage: { input: number; output: number } };

/** Image transmise au modèle (lot 4 §9 : photos du commerçant, réduites à 1 024 px côté client). */
export type AiImage = { mediaType: string; data: string };

export const AI_IMAGE_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
/** Base64 d'une image ≤ ~1,5 Mo (6 photos au maximum par appel). */
export const MAX_AI_IMAGE_BASE64 = 2_000_000;
export const MAX_AI_IMAGES = 6;

function imageBlocks(images: AiImage[] | undefined) {
  return (images ?? [])
    .filter((im) => (AI_IMAGE_MEDIA_TYPES as readonly string[]).includes(im.mediaType) && typeof im.data === "string" && im.data.length > 0 && im.data.length <= MAX_AI_IMAGE_BASE64)
    .slice(0, MAX_AI_IMAGES)
    .map((im) => ({ type: "image", source: { type: "base64", media_type: im.mediaType, data: im.data } }));
}

/**
 * Une requête, réponse JSON contrainte par `schema` (sorties structurées). Si l'API refuse le
 * paramètre de format (400), on retente une fois sans : le prompt exige déjà du JSON strict.
 * `model` : modèle explicite (lot 4 §9, `AI_MODEL_DESIGN`) ; `images` : pièces jointes en base64.
 */
export async function callClaudeJson(p: {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
  model?: string;
  images?: AiImage[];
  effort?: "low" | "medium" | "high";
  timeoutMs?: number;
}): Promise<AiCallResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new AiError("Assistant IA non configuré.");
  const blocks = imageBlocks(p.images);
  const content = blocks.length ? [...blocks, { type: "text", text: p.user }] : p.user;
  const body = (structured: boolean) => ({
    model: p.model || AI_MODEL,
    max_tokens: p.maxTokens ?? 2000,
    system: p.system,
    messages: [{ role: "user", content }],
    output_config: { effort: p.effort ?? "low", ...(structured ? { format: { type: "json_schema", schema: p.schema } } : {}) },
  });

  const send = async (structured: boolean) =>
    fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body(structured)),
      signal: AbortSignal.timeout(p.timeoutMs ?? 45_000),
      cache: "no-store",
    });

  let res: Response;
  try {
    res = await send(true);
    if (res.status === 400) res = await send(false);
  } catch (e) {
    throw new AiError((e as Error).name === "TimeoutError" ? "L'assistant a mis trop de temps à répondre. Réessayez." : "Assistant IA injoignable. Réessayez.", true);
  }
  const data = (await res.json().catch(() => ({}))) as MessagesResponse;
  if (!res.ok) {
    if (res.status === 429 || res.status >= 500) throw new AiError("Assistant IA momentanément indisponible. Réessayez dans un instant.", true);
    console.error("[ai] HTTP", res.status, data.error?.message);
    throw new AiError("L'assistant IA a refusé la requête.");
  }
  if (data.stop_reason === "refusal") throw new AiError("L'assistant n'a pas pu rédiger ce texte. Reformulez les mots-clés.");
  if (data.stop_reason === "max_tokens") throw new AiError("Réponse trop longue, interrompue. Réessayez avec moins de mots-clés.", true);
  const text = (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
  if (!text.trim()) throw new AiError("Réponse vide de l'assistant. Réessayez.", true);
  return { text, usage: { input: data.usage?.input_tokens ?? 0, output: data.usage?.output_tokens ?? 0 } };
}
