import "server-only";
import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { GRAPH_VERSION } from "@/lib/social/graph-client";

/**
 * Modèles de messages WhatsApp (Meta `message_templates`) et santé du numéro.
 *
 * Les modèles vivent côté Meta (sur la WABA du marchand) : on les LIT, on en CRÉE (soumission à validation) et on
 * en SUPPRIME directement via l'API Graph, sans rien stocker côté Axi (aucune table). Le jeton et le `wabaId`
 * proviennent de l'intégration `whatsapp_cloud` active (saisie manuelle ou mode partenaire, indifféremment).
 *
 * POINT D'INTÉGRATION : non testé contre Meta (pas de compte). Les appels sont couverts par des tests avec `fetch`
 * simulé ; le jeton n'est jamais journalisé ni inclus dans les messages d'erreur.
 */

const TIMEOUT_MS = 15_000;

export type WabaCreds = { token: string; wabaId: string; phoneNumberId: string };

/** Erreur « métier » affichable (message déjà nettoyé, sans secret). */
export class TemplateError extends Error {}

/** Charge l'intégration WhatsApp Cloud ACTIVE : jeton déchiffré + wabaId + phoneNumberId. */
export async function loadWabaCreds(storeId: string): Promise<WabaCreds | { error: string }> {
  const i = await db.integration.findUnique({
    where: { storeId_kind: { storeId, kind: "whatsapp_cloud" } },
    select: { status: true, phoneNumberId: true, config: true, secretsEncrypted: true },
  });
  if (!i || i.status !== "active" || !i.phoneNumberId || !i.secretsEncrypted) return { error: "Intégration WhatsApp Cloud inactive" };
  const wabaId = (i.config as { wabaId?: unknown } | null)?.wabaId;
  if (typeof wabaId !== "string" || !/^\d{5,32}$/.test(wabaId)) return { error: "Identifiant WABA absent de l'intégration" };
  try {
    const parsed = JSON.parse(decryptSecret(i.secretsEncrypted)) as { token?: unknown };
    if (typeof parsed.token !== "string" || !parsed.token) return { error: "Jeton WhatsApp absent" };
    return { token: parsed.token, wabaId, phoneNumberId: i.phoneNumberId };
  } catch {
    return { error: "Jeton WhatsApp illisible" };
  }
}

type Json = Record<string, unknown>;

/** Appel Graph générique : timeout, erreur réseau et erreur Meta normalisées (jamais de secret). */
async function graph<T extends Json>(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  } catch (e) {
    const timeout = (e as Error).name === "TimeoutError";
    throw new TemplateError(timeout ? "Meta : délai de réponse dépassé." : "Meta : erreur réseau.");
  }
  const text = await res.text().catch(() => "");
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const err = (json as { error?: { message?: string } } | null)?.error;
    throw new TemplateError(`Meta ${res.status} : ${(err?.message ?? "erreur inconnue").slice(0, 200)}`);
  }
  return (json ?? {}) as T;
}

export type TemplateStatus = "APPROVED" | "PENDING" | "REJECTED" | "PAUSED" | "DISABLED" | string;
export type TemplateCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION";
export type WaTemplate = { id: string | null; name: string; status: TemplateStatus; category: string; language: string };

/** Liste les modèles de la WABA (jusqu'à 100). */
export async function listTemplates(creds: WabaCreds, fetchImpl: typeof fetch = fetch): Promise<WaTemplate[]> {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${creds.wabaId}/message_templates?fields=name,status,category,language,id&limit=100`;
  const data = await graph<{ data?: Array<Record<string, unknown>> }>(fetchImpl, url, { headers: { Authorization: `Bearer ${creds.token}` } });
  return (data.data ?? []).map((t) => ({
    id: typeof t.id === "string" ? t.id : null,
    name: String(t.name ?? ""),
    status: String(t.status ?? "UNKNOWN"),
    category: String(t.category ?? ""),
    language: String(t.language ?? ""),
  }));
}

export type NewTemplate = {
  name: string;
  category: "MARKETING" | "UTILITY";
  language: string;
  body: string;
  footer?: string;
  headerText?: string;
};

/** Crée (soumet à validation) un modèle. Renvoie l'id Meta et le statut initial (souvent PENDING). */
export async function createTemplate(creds: WabaCreds, input: NewTemplate, fetchImpl: typeof fetch = fetch): Promise<{ id: string | null; status: string }> {
  if (!/^[a-z0-9_]{1,512}$/.test(input.name)) throw new TemplateError("Nom de modèle invalide : minuscules, chiffres et « _ » uniquement.");
  if (!input.body.trim()) throw new TemplateError("Le corps du message est requis.");
  const components: Json[] = [];
  if (input.headerText?.trim()) components.push({ type: "HEADER", format: "TEXT", text: input.headerText.trim() });
  components.push({ type: "BODY", text: input.body.trim() });
  if (input.footer?.trim()) components.push({ type: "FOOTER", text: input.footer.trim() });
  const data = await graph<{ id?: string; status?: string }>(fetchImpl, `https://graph.facebook.com/${GRAPH_VERSION}/${creds.wabaId}/message_templates`, {
    method: "POST",
    headers: { Authorization: `Bearer ${creds.token}`, "content-type": "application/json" },
    body: JSON.stringify({ name: input.name, language: input.language, category: input.category, components }),
  });
  return { id: data.id ?? null, status: data.status ?? "PENDING" };
}

/** Supprime un modèle par son nom. */
export async function deleteTemplate(creds: WabaCreds, name: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  if (!/^[a-z0-9_]{1,512}$/.test(name)) throw new TemplateError("Nom de modèle invalide.");
  await graph(fetchImpl, `https://graph.facebook.com/${GRAPH_VERSION}/${creds.wabaId}/message_templates?name=${encodeURIComponent(name)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${creds.token}` },
  });
}

export type PhoneHealth = {
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  qualityRating: string | null;
  nameStatus: string | null;
  codeVerificationStatus: string | null;
  platformType: string | null;
};

/** Santé du numéro : note de qualité, nom vérifié, statut d'inscription. */
export async function phoneHealth(creds: WabaCreds, fetchImpl: typeof fetch = fetch): Promise<PhoneHealth> {
  const fields = "display_phone_number,verified_name,quality_rating,name_status,code_verification_status,platform_type";
  const data = await graph<Record<string, unknown>>(fetchImpl, `https://graph.facebook.com/${GRAPH_VERSION}/${creds.phoneNumberId}?fields=${fields}`, {
    headers: { Authorization: `Bearer ${creds.token}` },
  });
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    displayPhoneNumber: str(data.display_phone_number),
    verifiedName: str(data.verified_name),
    qualityRating: str(data.quality_rating),
    nameStatus: str(data.name_status),
    codeVerificationStatus: str(data.code_verification_status),
    platformType: str(data.platform_type),
  };
}
