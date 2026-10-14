import { z } from "zod";
import { AuthError } from "@/lib/auth/permissions";

/** Résultat standard des actions serveur (compatible useActionState). */
export type ActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export function fail(error: string, fieldErrors?: Record<string, string[]>): ActionResult<never> {
  return { ok: false, error, fieldErrors };
}

export function success<T>(data?: T, message?: string): ActionResult<T> {
  return { ok: true, data, message };
}

export function formToObject(formData: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of formData.entries()) {
    if (k.startsWith("$ACTION")) continue;
    if (k.endsWith("[]")) {
      const key = k.slice(0, -2);
      (out[key] as unknown[] | undefined) ? (out[key] as unknown[]).push(v) : (out[key] = [v]);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function parseForm<S extends z.ZodTypeAny>(schema: S, formData: FormData): { data: z.infer<S> } | { error: ActionResult<never> } {
  const parsed = schema.safeParse(formToObject(formData));
  if (!parsed.success) {
    const flat = z.flattenError(parsed.error);
    const first = Object.values(flat.fieldErrors).flat()[0] ?? flat.formErrors[0] ?? "Formulaire invalide";
    return { error: fail(String(first), flat.fieldErrors as Record<string, string[]>) };
  }
  return { data: parsed.data };
}

/** Enveloppe une action : convertit AuthError / erreurs inattendues en ActionResult. */
export async function guard<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AuthError) return fail(e.message);
    // Les redirections Next (redirect / notFound) doivent remonter.
    if (e && typeof e === "object" && "digest" in e && String((e as { digest?: string }).digest).startsWith("NEXT_")) throw e;
    console.error("[action]", e);
    return fail("Une erreur est survenue. Réessayez.");
  }
}

export const zMoney = z.coerce.number().int().min(0).max(1_000_000_000);
export const zId = z.string().min(8).max(64);

/** Identifiant brut reçu par une action serveur (cuid) : chaîne non vide aux caractères sûrs, jamais un objet. */
export const zRawId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, "Identifiant invalide");

/** À appeler en tête d'action : échec explicite si l'un des identifiants bruts est invalide. */
export function badIds(...values: unknown[]): ActionResult<never> | null {
  return values.every((v) => zRawId.safeParse(v).success) ? null : fail("Identifiant invalide");
}
export const zOptionalString = z.preprocess((v) => (v === "" ? undefined : v), z.string().optional());
export const zBool = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());
