/**
 * Logique PURE du portail développeur (importable côté client et dans les tests — n'importe aucun
 * module `server-only`) : schéma de validation du formulaire d'application, garde de propriété et
 * transitions de statut autorisées côté développeur. La crypto (clientId/secret) reste dans les
 * actions serveur (src/lib/apps/dev-actions.ts) et réutilise src/lib/mcp/tokens.ts.
 */
import { z } from "zod";
import type { AppStatus } from "@prisma/client";
import { APP_CATEGORIES } from "./types";
import { isAllowedRedirectUri } from "@/lib/mcp/tokens";
import { isScope } from "@/lib/mcp/scopes";

export const APP_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const CATEGORY_IDS = APP_CATEGORIES.map((c) => c.id) as [string, ...string[]];

/** Normalise un champ reçu en tableau (case à cocher unique → valeur simple). */
const zArray = z.preprocess((v) => (v == null ? [] : Array.isArray(v) ? v : [v]), z.array(z.string()));

/** URL https facultative (champ vitrine) ; vide → undefined. */
const zHttpsUrl = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v),
  z
    .string()
    .url("Adresse invalide")
    .max(500)
    .refine((u) => u.startsWith("https://"), "L'adresse doit commencer par https://")
    .optional(),
);

/** Scopes demandés : sous-ensemble non vide de SCOPES, sans doublon. */
const zScopes = zArray.refine((a) => a.length > 0 && a.length <= 32 && a.every(isScope), "Choisissez au moins une autorisation valide.");

/** 1 à 10 URI de redirection OAuth, une par ligne, chacune autorisée (https, localhost ou schéma natif). */
const zRedirectUris = z.preprocess(
  (v) => (typeof v === "string" ? v.split(/[\r\n]+/).map((s) => s.trim()).filter(Boolean) : Array.isArray(v) ? v : []),
  z
    .array(z.string())
    .min(1, "Indiquez au moins une adresse de redirection OAuth.")
    .max(10, "10 adresses de redirection au maximum.")
    .refine((a) => a.every(isAllowedRedirectUri), "Adresse de redirection non autorisée (https, http://localhost ou schéma d'application natif, sans fragment)."),
);

const base = {
  name: z.string().trim().min(2, "Le nom doit comporter au moins 2 caractères.").max(80),
  tagline: z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().max(120).optional()),
  description: z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().max(5000).optional()),
  category: z.enum(CATEGORY_IDS, { message: "Catégorie invalide." }),
  requestedScopes: zScopes,
  pricingType: z.enum(["FREE", "SUBSCRIPTION", "ONE_TIME"]),
  priceAmount: z.coerce.number().int().min(0).max(1_000_000_000).default(0),
  priceInterval: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["month", "year"]).optional()),
  trialDays: z.coerce.number().int().min(0).max(365).default(0),
  appUrl: zHttpsUrl,
  webhookUrl: zHttpsUrl,
  supportUrl: zHttpsUrl,
  iconUrl: zHttpsUrl,
};

/** Cohérence tarifaire : un abonnement exige une période ; un prix > 0 exige un type payant. */
function pricingRefine<T extends { pricingType: "FREE" | "SUBSCRIPTION" | "ONE_TIME"; priceInterval?: "month" | "year"; priceAmount: number }>(
  v: T,
  ctx: z.RefinementCtx,
) {
  if (v.pricingType === "SUBSCRIPTION" && !v.priceInterval) {
    ctx.addIssue({ code: "custom", path: ["priceInterval"], message: "Choisissez une période (mois ou an) pour un abonnement." });
  }
  if (v.pricingType !== "FREE" && v.priceAmount <= 0) {
    ctx.addIssue({ code: "custom", path: ["priceAmount"], message: "Indiquez un montant supérieur à 0 pour une application payante." });
  }
}

/** Formulaire de création : tout + le slug (immuable ensuite) et les URI de redirection OAuth. */
export const createAppSchema = z
  .object({
    slug: z.string().trim().toLowerCase().min(3, "L'identifiant doit comporter au moins 3 caractères.").max(48).regex(APP_SLUG_RE, "Identifiant : minuscules, chiffres et tirets uniquement (ex. « mon-app »)."),
    redirectUris: zRedirectUris,
    ...base,
  })
  .superRefine(pricingRefine);

/** Formulaire de modification : sans le slug (immuable) ; les URI de redirection restent modifiables. */
export const updateAppSchema = z
  .object({ redirectUris: zRedirectUris, ...base })
  .superRefine(pricingRefine);

export type CreateAppInput = z.infer<typeof createAppSchema>;
export type UpdateAppInput = z.infer<typeof updateAppSchema>;

/* ───────────────────────── Propriété et transitions (pures, testées) ───────────────────────── */

/** Un développeur n'agit que sur SES applications (jamais les first-party de la plateforme). */
export function isAppOwner(app: { developerUserId: string | null }, userId: string): boolean {
  return app.developerUserId != null && app.developerUserId === userId;
}

/** Modification autorisée uniquement en brouillon ou une fois publiée (pas pendant la revue ni si suspendue). */
export function canEditApp(status: AppStatus): boolean {
  return status === "DRAFT" || status === "PUBLISHED";
}

/** Soumission à la revue : seulement depuis un brouillon. */
export function canSubmitApp(status: AppStatus): boolean {
  return status === "DRAFT";
}

/** Égalité d'ensembles de chaînes (ordre et doublons ignorés) — pour comparer scopes et URI. */
export function sameStringSet(a: readonly string[], b: readonly string[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size !== sb.size) return false;
  for (const v of sa) if (!sb.has(v)) return false;
  return true;
}

/** Origine (schéma + hôte + port) d'une URL ; null si absente ou invalide. */
export function urlOrigin(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    return new URL(u).origin;
  } catch {
    return null;
  }
}

type GovernedFields = { requestedScopes: readonly string[]; redirectUris: readonly string[]; appUrl?: string | null; webhookUrl?: string | null };

/**
 * Gouvernance : une app DÉJÀ PUBLIÉE dont on modifie les permissions (scopes), les URI de redirection OAuth, ou
 * l'ORIGINE de `appUrl` (iframe affiché dans l'admin) ou de `webhookUrl` (destinataire des données de cycle de vie)
 * doit repasser en revue (et être délistée). Un changement de chemin sur la même origine, de description, de tarif
 * ou d'icône reste en ligne.
 */
export function requiresReReview(status: AppStatus, current: GovernedFields, next: GovernedFields): boolean {
  if (status !== "PUBLISHED") return false;
  return (
    !sameStringSet(current.requestedScopes, next.requestedScopes) ||
    !sameStringSet(current.redirectUris, next.redirectUris) ||
    urlOrigin(current.appUrl) !== urlOrigin(next.appUrl) ||
    urlOrigin(current.webhookUrl) !== urlOrigin(next.webhookUrl)
  );
}

/* ───────────────────────── Installation de test (pure, testée) ───────────────────────── */

/**
 * Rôles de boutique autorisés à installer une app en test : OWNER seulement, comme l'installation réelle
 * (`integrations.manage`). Un gérant passe par une invitation de collaborateur (`apps.test_install`).
 */
export const TEST_INSTALL_ROLES = ["OWNER"] as const;

export type TestInstallRights = {
  /** L'utilisateur est propriétaire (developerUserId) de l'app. */
  isOwner: boolean;
  /** Adhésion de l'utilisateur à la boutique (null si aucune). */
  membership: { role: string; expiresAt: Date | null } | null;
  /** Collaborateur ACTIF de la boutique avec `apps.test_install`. */
  collaboratorCanTestInstall: boolean;
};

export type TestInstallDecision = { ok: true; via: "membership" | "collaborator" } | { ok: false; reason: "not_owner" | "no_store_access" | "suspended" };

/**
 * Droit d'installer (ou désinstaller) une app EN TEST sur une boutique :
 * propriétaire de l'app ET (OWNER non expiré de la boutique OU collaborateur actif avec
 * `apps.test_install`). Une app suspendue par la plateforme ne s'installe plus, même en test.
 * Le statut DRAFT / IN_REVIEW / PUBLISHED est accepté : c'est tout l'intérêt du test.
 */
export function decideTestInstall(rights: TestInstallRights, appStatus: AppStatus, now = new Date()): TestInstallDecision {
  if (!rights.isOwner) return { ok: false, reason: "not_owner" };
  if (appStatus === "SUSPENDED") return { ok: false, reason: "suspended" };
  const m = rights.membership;
  const memberOk = !!m && (TEST_INSTALL_ROLES as readonly string[]).includes(m.role) && (!m.expiresAt || m.expiresAt > now);
  if (memberOk) return { ok: true, via: "membership" };
  if (rights.collaboratorCanTestInstall) return { ok: true, via: "collaborator" };
  return { ok: false, reason: "no_store_access" };
}

/** Configuration JSON d'une installation de test. */
export const TEST_INSTALL_CONFIG = { test: true } as const;

/** Vrai si la configuration d'installation marque une installation de test (`{ test: true }`). */
export function isTestInstallConfig(config: unknown): boolean {
  return typeof config === "object" && config !== null && !Array.isArray(config) && (config as Record<string, unknown>).test === true;
}

/* ───────────────────────── Parcours développeur (pur) ───────────────────────── */

export type JourneyStepId = "create" | "configure" | "test" | "submit";
export type JourneyStep = { id: JourneyStepId; done: boolean };

/**
 * Les 4 étapes du parcours, calculées sur l'app la plus avancée du développeur :
 * créer une app → configurer OAuth/URL (au moins une redirection + URL de l'app) →
 * installer en test → soumettre (IN_REVIEW ou PUBLISHED).
 */
export function developerJourney(apps: { status: AppStatus; appUrl: string | null; redirectUriCount: number; testInstallCount: number }[]): JourneyStep[] {
  const created = apps.length > 0;
  const configured = apps.some((a) => a.redirectUriCount > 0 && !!a.appUrl);
  const tested = apps.some((a) => a.testInstallCount > 0);
  const submitted = apps.some((a) => a.status === "IN_REVIEW" || a.status === "PUBLISHED");
  return [
    { id: "create", done: created },
    { id: "configure", done: configured },
    { id: "test", done: tested },
    { id: "submit", done: submitted },
  ];
}

/* ───────────────────────── Profil développeur (pur) ───────────────────────── */

/** Profil public : seul le nom est persisté (App.developerName) — pas de modèle de profil en base. */
export const developerProfileSchema = z.object({
  developerName: z.string().trim().min(2, "Le nom doit comporter au moins 2 caractères.").max(80, "80 caractères au maximum."),
});
