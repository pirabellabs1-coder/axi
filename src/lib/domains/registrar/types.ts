import type { DomainContact } from "../names";

/**
 * Contrat d'un registrar (revendeur de noms de domaine). Implémentations :
 *  - route53.ts : Amazon Route 53 Domains (production) ;
 *  - fake.ts    : registrar simulé en mémoire (`DOMAINS_FAKE=1`, JAMAIS en production) pour le dev et les tests.
 * Montants en centimes USD. Les noms sont en ASCII (punycode pour un IDN).
 */
export type Availability = "AVAILABLE" | "UNAVAILABLE" | "UNSUPPORTED" | "UNKNOWN";

export type TldPrices = { registerUsdCents: number; renewUsdCents: number };

export type OperationStatus = "SUBMITTED" | "IN_PROGRESS" | "SUCCESSFUL" | "FAILED" | "ERROR";

export type DomainDetail = { expiresAt: Date | null; autoRenew: boolean; nameServers: string[] };

export type DnsTarget = { ipv4: string; ipv6?: string | null };

export type OperationKind = "REGISTER" | "RENEW";

/**
 * Classement d'une erreur registrar (idempotence des appels qui facturent) :
 *  - refused   : refus explicite (HTTP 4xx hors limitation) → rien n'a été soumis, échec définitif ;
 *  - throttled : limitation de débit (429 / Throttling) → rien n'a été soumis, on peut réessayer ;
 *  - unknown   : délai dépassé, erreur réseau ou 5xx → la requête a PU être soumise : réconciliation obligatoire.
 */
export type RegistrarErrorKind = "refused" | "throttled" | "unknown";

export function classifyRegistrarError(e: unknown): RegistrarErrorKind {
  const err = e as { name?: string; $metadata?: { httpStatusCode?: number }; $fault?: string };
  const status = err?.$metadata?.httpStatusCode;
  if (status === 429 || /Throttl|TooManyRequests/i.test(err?.name ?? "")) return "throttled";
  if (typeof status === "number" && status >= 400 && status < 500) return "refused";
  return "unknown";
}

export interface Registrar {
  readonly id: "route53" | "fake";
  checkAvailability(domain: string): Promise<Availability>;
  suggestions(domain: string, max: number): Promise<{ domain: string; available: boolean }[]>;
  prices(tld: string): Promise<TldPrices | null>;
  register(input: { domain: string; years: number; contact: DomainContact; privacy: boolean }): Promise<{ operationId: string }>;
  getOperation(operationId: string): Promise<{ status: OperationStatus; message?: string }>;
  /** Opération soumise depuis `since` pour ce domaine (réconciliation après un appel au résultat inconnu). */
  findOperation(input: { domain: string; kind: OperationKind; since: Date }): Promise<{ operationId: string; status: OperationStatus } | null>;
  /** `currentExpiryYear` : idempotence côté registrar (un second appel après un renouvellement réussi est refusé). */
  renew(input: { domain: string; years: number; currentExpiryYear: number }): Promise<{ operationId: string }>;
  setAutoRenew(domain: string, enabled: boolean): Promise<void>;
  /** null si le domaine n'appartient pas au compte revendeur. */
  getDetail(domain: string): Promise<DomainDetail | null>;
  /** Zone DNS + enregistrements A/AAAA (apex et www) vers la plateforme. Idempotent (UPSERT). */
  ensureDns(domain: string, target: DnsTarget): Promise<{ hostedZoneId: string }>;
}
