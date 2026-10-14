import "server-only";
import { db } from "@/lib/db";
import { MCP_LIMITS, type PlanId } from "@/config/plans";
import { rateLimit, rateLimitAll, type RateLimitResult } from "@/lib/rate-limit";

/**
 * Services d'exécution du connecteur IA : interrupteur d'arrêt d'urgence (console admin), quotas d'appels
 * par plan, journal des appels (ApiRequestLog), URL publiques.
 */

/* ───────────────────────── URL ───────────────────────── */

/** Base publique FIXE (jamais dérivée de l'en-tête Host, contrôlé par le client). */
export function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");
}

/** Identifiant de ressource protégée (RFC 8707 / RFC 9728) du serveur MCP marchand. */
export function mcpResourceUrl(): string {
  return `${appBaseUrl()}/api/mcp`;
}

export function protectedResourceMetadataUrl(): string {
  return `${appBaseUrl()}/.well-known/oauth-protected-resource/api/mcp`;
}

/** Normalise un paramètre `resource` : identique à la ressource MCP (barre finale tolérée), sinon null. */
export function canonicalResource(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw) return null;
  const expected = mcpResourceUrl();
  const value = raw.replace(/\/+$/, "");
  return value === expected ? expected : null;
}

/* ───────────────────────── Arrêt d'urgence ───────────────────────── */

export const MCP_KILL_SWITCH_KEY = "mcp.kill_switch";
export type McpKillSwitch = { enabled: boolean; message: string };

let killCache: { value: McpKillSwitch; at: number } | null = null;
const KILL_TTL_MS = 10_000;

/** État de l'arrêt d'urgence (mis en cache 10 s par instance : effet quasi immédiat, sans requête par appel). */
export async function getMcpKillSwitch(fresh = false): Promise<McpKillSwitch> {
  if (!fresh && killCache && Date.now() - killCache.at < KILL_TTL_MS) return killCache.value;
  const row = await db.platformSetting.findUnique({ where: { key: MCP_KILL_SWITCH_KEY } });
  const v = row?.value && typeof row.value === "object" && !Array.isArray(row.value) ? (row.value as Partial<McpKillSwitch>) : null;
  const value = { enabled: v?.enabled === true, message: typeof v?.message === "string" ? v.message : "" };
  killCache = { value, at: Date.now() };
  return value;
}

export function resetKillSwitchCache() {
  killCache = null;
}

/* ───────────────────────── Quotas ───────────────────────── */

/** Règles de débit par minute (boutique + jeton/application). Fonction pure, testée. */
export function minuteRules(planId: PlanId, storeId: string, principalKey: string): { key: string; limit: number; windowSec: number }[] {
  const perMinute = MCP_LIMITS[planId].callsPerMinute;
  return [
    { key: `mcp:store:${storeId}:min`, limit: perMinute, windowSec: 60 },
    { key: `mcp:principal:${principalKey}:min`, limit: perMinute, windowSec: 60 },
  ];
}

/** Applique `cost` fois une vérification (un lot de N messages consomme N unités ; N ≤ 20). */
async function charged(cost: number, check: () => Promise<RateLimitResult>): Promise<RateLimitResult> {
  let worst: RateLimitResult = { ok: true, retryAfter: 0 };
  for (let i = 0; i < Math.max(1, Math.min(cost, 20)); i++) {
    const r = await check();
    if (!r.ok && (worst.ok || r.retryAfter > worst.retryAfter)) worst = r;
  }
  return worst;
}

export async function checkMinuteQuota(planId: PlanId, storeId: string, principalKey: string, cost = 1): Promise<RateLimitResult> {
  return charged(cost, () => rateLimitAll(minuteRules(planId, storeId, principalKey)));
}

/** Quota journalier d'appels d'outils (fenêtre glissante de 24 h à partir du premier appel). */
export async function checkDailyQuota(planId: PlanId, storeId: string): Promise<RateLimitResult> {
  const perDay = MCP_LIMITS[planId].callsPerDay;
  if (perDay == null) return { ok: true, retryAfter: 0 };
  return rateLimit(`mcp:store:${storeId}:day`, perDay, 86_400);
}

/** Débit du MCP vitrine public, par adresse IP (et par boutique). */
export async function checkPublicQuota(ip: string, slug: string, cost = 1): Promise<RateLimitResult> {
  return charged(cost, () => rateLimitAll([
    { key: `mcp-public:ip:${ip}:min`, limit: 60, windowSec: 60 },
    { key: `mcp-public:ip:${ip}:slug:${slug}:hour`, limit: 600, windowSec: 3600 },
  ]));
}

/* ───────────────────────── Statistiques du MCP vitrine (agrégées) ───────────────────────── */

/**
 * Les appels du MCP public ne sont PAS journalisés ligne par ligne (le journal du marchand reste réservé à
 * ses propres jetons et applications) : un compteur par boutique, outil et jour dans `UsageCounter`
 * (metric « mcp_public:<outil> », period « AAAA-MM-JJ »), purgé après 90 jours.
 */
export const PUBLIC_METRIC_PREFIX = "mcp_public:";

export function publicMetric(tool: string): string {
  return `${PUBLIC_METRIC_PREFIX}${tool.replace(/[^a-z_]/g, "").slice(0, 40)}`;
}

export function dayPeriod(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function countPublicCall(storeId: string, tool: string): void {
  const metric = publicMetric(tool);
  const period = dayPeriod();
  void db.usageCounter
    .upsert({ where: { storeId_metric_period: { storeId, metric, period } }, create: { storeId, metric, period, value: 1 }, update: { value: { increment: 1 } } })
    .catch((e) => console.error("[mcp] public counter", e));
}

/* ───────────────────────── Journal ───────────────────────── */

export const LOG_RETENTION_DAYS = 30;

export type RequestLogInput = {
  storeId: string;
  tokenId?: string | null;
  grantId?: string | null;
  actorLabel: string;
  method: string;
  tool?: string | null;
  status: "ok" | "error" | "denied" | "rate_limited";
  errorCode?: number | null;
  durationMs: number;
  ip?: string | null;
};

/** Écriture best effort, hors chemin critique : un échec de journalisation ne fait jamais échouer l'appel. */
export function logApiRequest(input: RequestLogInput): void {
  void db.apiRequestLog
    .create({
      data: {
        storeId: input.storeId,
        tokenId: input.tokenId ?? null,
        grantId: input.grantId ?? null,
        actorLabel: input.actorLabel.slice(0, 120),
        method: input.method.slice(0, 60),
        tool: input.tool?.slice(0, 80) ?? null,
        status: input.status,
        errorCode: input.errorCode ?? null,
        durationMs: Math.max(0, Math.round(input.durationMs)),
        ip: input.ip?.slice(0, 64) ?? null,
      },
    })
    .catch((e) => console.error("[mcp] log", e));
  // Purge opportuniste (~1 appel sur 200) en plus du balayage périodique de /api/jobs/run.
  if (Math.random() < 0.005) void purgeMcpData().catch(() => {});
}

/** Purge : journal > 30 jours, codes d'autorisation et jetons OAuth expirés depuis plus de 7 jours. */
export async function purgeMcpData(now = new Date()): Promise<{ logs: number; codes: number; tokens: number; publicCounters: number }> {
  const logsBefore = new Date(now.getTime() - LOG_RETENTION_DAYS * 86_400_000);
  const expiredBefore = new Date(now.getTime() - 7 * 86_400_000);
  const [logs, codes, tokens, counters] = await Promise.all([
    db.apiRequestLog.deleteMany({ where: { createdAt: { lt: logsBefore } } }),
    db.oAuthAuthorizationCode.deleteMany({ where: { expiresAt: { lt: expiredBefore } } }),
    db.oAuthToken.deleteMany({ where: { expiresAt: { lt: expiredBefore } } }),
    db.usageCounter.deleteMany({ where: { metric: { startsWith: PUBLIC_METRIC_PREFIX }, period: { lt: dayPeriod(new Date(now.getTime() - 90 * 86_400_000)) } } }),
  ]);
  return { logs: logs.count, codes: codes.count, tokens: tokens.count, publicCounters: counters.count };
}

/** Mise à jour de « dernière utilisation » au plus une fois par minute (évite une écriture par appel). */
export function touchApiToken(tokenId: string, ip: string): void {
  const threshold = new Date(Date.now() - 60_000);
  void db.apiToken
    .updateMany({ where: { id: tokenId, OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: threshold } }] }, data: { lastUsedAt: new Date(), lastUsedIp: ip.slice(0, 64) } })
    .catch(() => {});
}

export function touchOAuthGrant(grantId: string, clientDbId: string): void {
  const threshold = new Date(Date.now() - 60_000);
  void db.oAuthGrant.updateMany({ where: { id: grantId, OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: threshold } }] }, data: { lastUsedAt: new Date() } }).catch(() => {});
  void db.oAuthClient.updateMany({ where: { id: clientDbId, OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: threshold } }] }, data: { lastUsedAt: new Date() } }).catch(() => {});
}
