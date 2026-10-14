import { z } from "zod";
import type { CollaboratorPermission } from "./collaborators";

/**
 * Collaborateurs développeurs : règles pures (sans base ni serveur), partagées par les actions,
 * la page marchand, la page d'acceptation et les tests.
 *
 * `COLLABORATOR_PERMISSIONS` vit dans `collaborators.ts` (server-only) : on recopie ici les valeurs
 * pour pouvoir les utiliser côté client, avec une vérification de type dans les deux sens.
 */
export const COLLAB_PERMISSIONS = ["apps.test_install", "apps.manage_installs"] as const satisfies readonly CollaboratorPermission[];
// Garde-fou : échoue à la compilation si `collaborators.ts` ajoute une permission non reprise ici.
const _exhaustive: readonly (typeof COLLAB_PERMISSIONS)[number][] = [] as CollaboratorPermission[];
void _exhaustive;

export const COLLAB_INVITE_DAYS = 7;
const DAY_MS = 86_400_000;

/** Libellés en clair, affichés au marchand et au développeur invité. */
export const COLLAB_PERMISSION_LABELS: Record<CollaboratorPermission, { title: string; text: string }> = {
  "apps.test_install": {
    title: "Installer ses applications en test",
    text: "Le développeur peut installer ses propres applications (même non publiées) sur votre boutique pour les essayer.",
  },
  "apps.manage_installs": {
    title: "Gérer les installations",
    text: "Le développeur peut reconfigurer ou désinstaller les applications qu'il a installées sur votre boutique.",
  },
};

/** Ce qu'un collaborateur ne peut jamais faire, quelles que soient ses permissions. */
export const COLLAB_CANNOT = [
  "Voir ou modifier les commandes",
  "Voir les clients et leurs coordonnées",
  "Accéder aux paiements, à l'abonnement ou aux reversements",
  "Modifier les réglages, l'équipe ou le domaine",
] as const;

export const collaboratorInviteSchema = z.object({
  storeId: z.string().min(1),
  email: z.string().trim().toLowerCase().max(254).email("Adresse e-mail invalide"),
  permissions: z.preprocess(
    (v) => (v == null ? [] : Array.isArray(v) ? v : [v]),
    z
      .array(z.enum(COLLAB_PERMISSIONS, { error: "Permission inconnue" }))
      .min(1, "Choisissez au moins une permission")
      .transform((list) => COLLAB_PERMISSIONS.filter((p) => list.includes(p))),
  ),
  message: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().max(500, "Message trop long (500 caractères maximum)").optional(),
  ),
});
export type CollaboratorInviteInput = z.infer<typeof collaboratorInviteSchema>;

/** Jeton d'invitation brut : 32 octets en hexadécimal (`randomToken(32)`). */
export function isCollaboratorToken(token: unknown): token is string {
  return typeof token === "string" && /^[a-f0-9]{64}$/.test(token);
}

export function collaboratorInviteExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + COLLAB_INVITE_DAYS * DAY_MS);
}

export type CollaboratorStatusValue = "PENDING" | "ACTIVE" | "REVOKED";
/** État affiché : une invitation en attente dont la date est passée est « expirée ». */
export type CollaboratorState = "pending" | "expired" | "active" | "revoked";

type Row = { status: CollaboratorStatusValue; expiresAt: Date; revokedAt?: Date | null };

export function collaboratorState(row: Row, now: Date = new Date()): CollaboratorState {
  if (row.status === "REVOKED" || row.revokedAt) return "revoked";
  if (row.status === "ACTIVE") return "active";
  return row.expiresAt.getTime() <= now.getTime() ? "expired" : "pending";
}

export const COLLAB_STATE_LABELS: Record<CollaboratorState, string> = {
  pending: "En attente",
  expired: "Expirée",
  active: "Actif",
  revoked: "Révoqué",
};

/**
 * Transitions autorisées :
 *  - PENDING → PENDING (renvoi), ACTIVE (acceptation), REVOKED (révocation ou refus) ;
 *  - ACTIVE → REVOKED ;
 *  - REVOKED → PENDING (nouvelle invitation de la même adresse).
 */
const TRANSITIONS: Record<CollaboratorStatusValue, CollaboratorStatusValue[]> = {
  PENDING: ["PENDING", "ACTIVE", "REVOKED"],
  ACTIVE: ["REVOKED"],
  REVOKED: ["PENDING"],
};

export function canTransition(from: CollaboratorStatusValue, to: CollaboratorStatusValue): boolean {
  return TRANSITIONS[from].includes(to);
}

export type AcceptProblem = "unknown" | "revoked" | "already" | "expired" | "wrong_email";

export const ACCEPT_PROBLEM_MESSAGES: Record<AcceptProblem, string> = {
  unknown: "Invitation introuvable ou lien invalide.",
  revoked: "Cette invitation a été révoquée ou refusée.",
  already: "Cette invitation a déjà été acceptée.",
  expired: "Cette invitation a expiré. Demandez au marchand de la renvoyer.",
  wrong_email: "Cette invitation est destinée à une autre adresse e-mail. Connectez-vous avec l'adresse invitée.",
};

/** Vérifie qu'une invitation peut être acceptée (ou refusée) par l'utilisateur connecté. `null` = OK. */
export function acceptanceProblem(row: (Row & { email: string }) | null | undefined, userEmail: string, now: Date = new Date()): AcceptProblem | null {
  if (!row) return "unknown";
  const state = collaboratorState(row, now);
  if (state === "revoked") return "revoked";
  if (state === "active") return "already";
  if (state === "expired") return "expired";
  if (row.email.trim().toLowerCase() !== userEmail.trim().toLowerCase()) return "wrong_email";
  return null;
}
