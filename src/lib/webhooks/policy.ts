/**
 * Règles pures des webhooks : relances, désactivation automatique, filtrage des données personnelles, corps envoyé.
 * Testées dans tests/webhook-retry.test.ts.
 */
import { WEBHOOK_API_VERSION } from "./events";

/* ───────────────────────── Relances ───────────────────────── */

/** Délais après le 1er, 2e… échec : 1 min, 5 min, 30 min, 2 h, 6 h, 12 h, 24 h ; au-delà : DEAD (8 tentatives au total). */
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 6 * 3_600_000, 12 * 3_600_000, 24 * 3_600_000] as const;
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

/** Délai avant la prochaine tentative après `attempts` tentatives échouées (1 = premier échec), ou null = DEAD. */
export function retryDelayMs(attempts: number): number | null {
  if (attempts < 1) return 0;
  return RETRY_DELAYS_MS[attempts - 1] ?? null;
}

/** Bail de traitement : une livraison réclamée n'est pas reprise par un autre worker avant ce délai. */
export const DELIVERY_LEASE_MS = 2 * 60_000;

/* ───────────────────────── Désactivation ───────────────────────── */

export const DISABLE_AFTER_FAILURES = 50;
export const DISABLE_AFTER_MS = 72 * 3_600_000;

/**
 * Le point doit-il être désactivé ? 50 échecs consécutifs ou plus ET une série d'échecs commencée il y a plus de 72 h
 * (`failingSince` = création de la plus ancienne livraison en échec depuis le dernier succès).
 */
export function shouldDisableEndpoint(consecutiveFailures: number, failingSince: Date | null, now = new Date()): boolean {
  return consecutiveFailures >= DISABLE_AFTER_FAILURES && !!failingSince && now.getTime() - failingSince.getTime() > DISABLE_AFTER_MS;
}

/* ───────────────────────── Réponse ───────────────────────── */

export const RESPONSE_SNIPPET_BYTES = 4096;
export const DELIVERY_TIMEOUT_MS = 10_000;

export function isSuccessStatus(status: number | null | undefined): boolean {
  return status != null && status >= 200 && status < 300;
}

/* ───────────────────────── Données personnelles ───────────────────────── */

/**
 * m8 : filtrage par LISTE BLANCHE, déclarée par type d'événement. Une liste noire laisse passer toute clé
 * personnelle nouvelle (champ ajouté par une équipe, renommage) ; ici, une clé non déclarée est RETIRÉE.
 * Ajouter un champ à un événement = l'ajouter ci-dessous (tests/webhook-retry.test.ts échoue sinon).
 *
 * Un événement SANS liste déclarée (événement d'un lot plus récent) retombe sur la liste noire historique :
 * la charge n'est pas perdue, mais le test de couverture signale l'oubli.
 */

/** Clés communes à tous les événements (origine de l'écriture, horodatage). */
const COMMON_KEYS = ["source", "createdAt", "created_at"] as const;

/** Commande : identifiants, statuts et montants (`src/lib/commerce/domain-events.ts`). */
const ORDER_KEYS = [
  "id", "reference", "status", "paymentStatus", "currency", "subtotal", "discount", "deliveryFee",
  "taxTotal", "taxesIncluded", "total", "amountDue", "presentmentCurrency", "presentmentTotal",
  "channel", "fulfillmentType", "from", "to",
] as const;

const PRODUCT_KEYS = ["product_id", "variant_id", "status", "updated_fields", "bulk", "duplicated_from"] as const;

export const ALLOWED_DATA_KEYS: Record<string, readonly string[]> = {
  "order.created": [...COMMON_KEYS, ...ORDER_KEYS],
  "order.updated": [...COMMON_KEYS, ...ORDER_KEYS, "updated_fields"],
  "order.status_changed": [...COMMON_KEYS, ...ORDER_KEYS],
  "order.paid": [...COMMON_KEYS, ...ORDER_KEYS],
  "order.cancelled": [...COMMON_KEYS, ...ORDER_KEYS],
  "order.refunded": [...COMMON_KEYS, ...ORDER_KEYS, "refundId", "amount", "destination", "returnId"],
  "product.created": [...COMMON_KEYS, ...PRODUCT_KEYS],
  "product.updated": [...COMMON_KEYS, ...PRODUCT_KEYS],
  "product.deleted": [...COMMON_KEYS, ...PRODUCT_KEYS],
  "inventory.updated": [...COMMON_KEYS, "product_id", "variant_id", "delta", "stock"],
  // `customer` est traité à part : sans droit, seul l'identifiant est conservé.
  "customer.created": [...COMMON_KEYS, "customer_id", "customer", "updated_fields"],
  "customer.updated": [...COMMON_KEYS, "customer_id", "customer", "updated_fields"],
  "return.created": [...COMMON_KEYS, "return_id", "reference", "order_id", "from", "status", "by", "resolution", "amount"],
  "return.status_changed": [...COMMON_KEYS, "return_id", "reference", "order_id", "from", "status", "by", "resolution", "amount"],
  "giftcard.issued": [...COMMON_KEYS, "gift_card_id", "last4", "initial_value", "currency", "expires_at", "order_id"],
  // Vague 2 : remise des fichiers numériques. Jamais le jeton ni d'URL de téléchargement.
  "digital.delivered": [...COMMON_KEYS, "order_id", "order_item_id", "grant_id", "product_id", "download_limit", "expires_at"],
  "app.ping": [...COMMON_KEYS, "message", "endpoint_id"],
};

/**
 * Clés considérées comme données personnelles (repli pour un événement sans liste blanche déclarée).
 */
export const PERSONAL_KEYS = new Set([
  "customer_name", "customer_phone", "customer_email", "customer_note", "customer_address",
  "first_name", "last_name", "full_name",
  "phone", "email", "address", "delivery_address", "shipping_address", "billing_address",
  "recipient_name", "recipient_email", "recipient_phone", "ip", "notes", "note", "reason", "message",
]);

/** Objet `customer` : seul l'identifiant est conservé sans droit aux données personnelles. */
function customerIdOnly(v: unknown): unknown {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const id = (v as { id?: unknown }).id;
  return id === undefined ? null : { id };
}

/** Repli (liste noire) : utilisé seulement pour un événement dont la liste blanche n'est pas déclarée. */
export function redactPersonalData(value: unknown, depth = 0): unknown {
  if (depth > 8) return null;
  if (Array.isArray(value)) return value.map((v) => redactPersonalData(v, depth + 1));
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (PERSONAL_KEYS.has(k)) continue;
    if (k === "customer") {
      out.customer = customerIdOnly(v);
      continue;
    }
    out[k] = redactPersonalData(v, depth + 1);
  }
  return out;
}

/**
 * Charge d'un événement pour un point SANS droit aux données personnelles : seules les clés déclarées pour cet
 * événement sont conservées (liste blanche), `customer` réduit à son identifiant.
 */
export function redactForEvent(event: string, data: unknown): unknown {
  const allowed = ALLOWED_DATA_KEYS[event];
  if (!allowed) return redactPersonalData(data);
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const keep = new Set<string>(allowed);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (!keep.has(k)) continue;
    if (k === "customer") {
      out.customer = customerIdOnly(v);
      continue;
    }
    out[k] = redactPersonalData(v);
  }
  return out;
}

/* ───────────────────────── Corps ───────────────────────── */

export type WebhookBody = { id: string; type: string; created_at: string; store_id: string; api_version: string; data: unknown };

export function buildWebhookBody(input: { eventId: string; event: string; createdAt: string; storeId: string; data: unknown; includePersonalData: boolean; apiVersion?: string }): WebhookBody {
  return {
    id: input.eventId,
    type: input.event,
    created_at: input.createdAt,
    store_id: input.storeId,
    api_version: input.apiVersion ?? WEBHOOK_API_VERSION,
    data: input.includePersonalData ? input.data : redactForEvent(input.event, input.data),
  };
}

/** Coupe une réponse à `max` octets UTF-8 sans casser un caractère multi-octets. */
export function truncateUtf8(buf: Buffer, max = RESPONSE_SNIPPET_BYTES): string {
  return buf.subarray(0, max).toString("utf8").replace(/�+$/, "");
}

/* ───────────────────────── Rôles ───────────────────────── */

/**
 * Miroir des capacités de src/lib/auth/permissions.ts utilisées par les webhooks (ce module est chargé par le worker
 * de jobs, qui ne peut pas importer permissions.ts : dépendance à next/navigation). Équivalence vérifiée par
 * tests/webhook-retry.test.ts.
 */
type Role = "OWNER" | "MANAGER" | "STAFF" | "SUPPORT";
/** integrations.manage */
export function canManageWebhooks(role: Role | string): boolean {
  return role === "OWNER";
}
/** customers.view (données personnelles dans les webhooks) */
export function canViewCustomers(role: Role | string): boolean {
  return role === "OWNER" || role === "MANAGER" || role === "SUPPORT";
}
