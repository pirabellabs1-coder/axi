import "server-only";
import { after } from "next/server";
import { db } from "@/lib/db";
import { sendSignedRequest, type SendResult } from "@/lib/webhooks/deliver";
import { signatureHeader } from "@/lib/webhooks/sign";
import { appBaseUrl } from "@/lib/mcp/runtime";
import { appSigningSecret } from "./install-signing";

/**
 * Webhooks de CYCLE DE VIE des applications externes (installation / désinstallation) vers `app.webhookUrl`.
 * Contrat publié : docs/apps-v2/int.md §6.
 *
 * Réutilise le mécanisme des webhooks sortants : `sendSignedRequest` (contrôle SSRF + résolution DNS juste avant
 * l'envoi, adresse IMPOSÉE à la connexion, 10 s, sans redirection) et `signatureHeader` (t=…,v1=…). Le secret est
 * le secret de signature de l'app (`appSigningSecret`, dérivé aussi de l'empreinte du client_secret), pas celui d'un point de webhook de boutique.
 *
 * Livraison : au moins une fois. Envoi après la réponse (`after()`), 3 tentatives (0 s, 5 s, 30 s). Les jobs
 * `app.installed` / `app.uninstalled` sont déjà écrits dans l'outbox (même transaction) ; leurs gestionnaires
 * `handlers` ci-dessous sont prêts mais ne sont branchés que si src/lib/jobs.ts les délègue ici (fichier protégé,
 * changement de 2 lignes à valider). L'en-tête `Axi-Webhook-Id` est stable : le destinataire déduplique.
 */

export type LifecycleEvent = "app.installed" | "app.uninstalled";
export type LifecycleInput = { event: LifecycleEvent; appId: string; storeId: string; installationId: string };
export type LifecycleOutcome = { outcome: "skipped"; reason: string } | { outcome: "sent" | "failed"; result: SendResult };

export const LIFECYCLE_API_VERSION = "2026-10";

export type LifecycleBody = {
  id: string;
  type: LifecycleEvent;
  created_at: string;
  api_version: string;
  app_id: string;
  store_id: string;
  shop: string;
  installation_id: string;
  data: { scopes: string[]; status: string; installed_at: string | null; uninstalled_at: string | null };
};

/** Identifiant d'événement stable (même transition = même id, quel que soit le nombre de tentatives). */
export function lifecycleEventId(event: LifecycleEvent, installationId: string, at: Date): string {
  return `evt_${event.replace(".", "_")}_${installationId}_${Math.floor(at.getTime() / 1000)}`;
}

/** En-têtes signés (fonction pure, testée). */
export function lifecycleHeaders(body: string, eventId: string, event: LifecycleEvent, shop: string, signingSecret: string, nowSec: number): Record<string, string> {
  return {
    "Axi-Webhook-Id": eventId,
    "Axi-Webhook-Topic": event,
    "Axi-Webhook-Shop": shop,
    "Axi-Webhook-Timestamp": String(nowSec),
    "Axi-Webhook-Api-Version": LIFECYCLE_API_VERSION,
    "Axi-Webhook-Signature": signatureHeader([signingSecret], nowSec, body),
  };
}

export async function deliverLifecycleWebhook(input: LifecycleInput, deps: { send?: typeof sendSignedRequest; now?: () => Date } = {}): Promise<LifecycleOutcome> {
  const [app, install] = await Promise.all([
    db.app.findUnique({ where: { id: input.appId }, select: { id: true, webhookUrl: true, oauthClientId: true } }),
    db.appInstallation.findFirst({
      where: { id: input.installationId, storeId: input.storeId, appId: input.appId },
      select: { id: true, status: true, grantedScopes: true, installedAt: true, uninstalledAt: true, store: { select: { slug: true } } },
    }),
  ]);
  if (!app?.webhookUrl) return { outcome: "skipped", reason: "no_webhook_url" };
  if (!install) return { outcome: "skipped", reason: "installation_not_found" };

  const now = deps.now?.() ?? new Date();
  const at = input.event === "app.uninstalled" ? (install.uninstalledAt ?? now) : install.installedAt;
  const eventId = lifecycleEventId(input.event, install.id, at);
  const payload: LifecycleBody = {
    id: eventId,
    type: input.event,
    created_at: at.toISOString(),
    api_version: LIFECYCLE_API_VERSION,
    app_id: app.id,
    store_id: input.storeId,
    shop: install.store.slug,
    installation_id: install.id,
    data: {
      scopes: input.event === "app.installed" ? install.grantedScopes : [],
      status: install.status,
      installed_at: install.installedAt.toISOString(),
      uninstalled_at: install.uninstalledAt?.toISOString() ?? null,
    },
  };
  const body = JSON.stringify(payload);
  // Secret dérivé de l'empreinte ACTUELLE du client_secret : il suit la rotation du secret par le développeur.
  const client = app.oauthClientId ? await db.oAuthClient.findUnique({ where: { clientId: app.oauthClientId }, select: { clientSecretHash: true } }) : null;
  const headers = lifecycleHeaders(body, eventId, input.event, install.store.slug, appSigningSecret(app.id, client?.clientSecretHash ?? null), Math.floor(now.getTime() / 1000));
  const result = await (deps.send ?? sendSignedRequest)(app.webhookUrl, body, headers);
  return { outcome: result.ok ? "sent" : "failed", result };
}

const RETRY_DELAYS_MS = [0, 5_000, 30_000];

/** Envoi après la réponse HTTP (jamais dans la transaction ni sur le chemin de la requête), 3 tentatives. */
export function scheduleLifecycleWebhook(input: LifecycleInput, baseUrl = appBaseUrl()): void {
  const run = async () => {
    for (const delay of RETRY_DELAYS_MS) {
      if (delay) await new Promise((r) => setTimeout(r, delay));
      try {
        const out = await deliverLifecycleWebhook(input);
        if (out.outcome !== "failed") return;
        // Envoi bloqué (SSRF) : inutile d'insister.
        if (out.result.blocked) {
          console.warn(`[apps/lifecycle] ${input.event} bloqué pour l'app ${input.appId} : ${out.result.error}`);
          return;
        }
        console.warn(`[apps/lifecycle] ${input.event} → échec (${out.result.error ?? out.result.status}) ; base ${baseUrl}`);
      } catch (e) {
        console.error("[apps/lifecycle]", e);
      }
    }
  };
  try {
    after(run);
  } catch {
    // Hors contexte de requête (scripts, tests) : envoi détaché.
    void run();
  }
}

/** Gestionnaires prêts pour l'outbox (à déléguer depuis src/lib/jobs.ts) : un échec lève → relance du worker. */
export const handlers: Record<LifecycleEvent, (p: Record<string, unknown>) => Promise<void>> = {
  "app.installed": async (p) => runJob("app.installed", p),
  "app.uninstalled": async (p) => runJob("app.uninstalled", p),
};

async function runJob(event: LifecycleEvent, p: Record<string, unknown>) {
  const input = { event, appId: String(p.appId ?? ""), storeId: String(p.storeId ?? ""), installationId: String(p.installationId ?? "") };
  if (!input.appId || !input.storeId || !input.installationId) return;
  const out = await deliverLifecycleWebhook(input);
  if (out.outcome === "failed" && !out.result.blocked) throw new Error(out.result.error ?? "Échec du webhook de cycle de vie");
}
