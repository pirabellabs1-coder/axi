import type { Availability, DnsTarget, DomainDetail, OperationStatus, Registrar, TldPrices } from "./types";

/**
 * Registrar SIMULÉ (en mémoire, par processus) : développement local et tests. Jamais sélectionné en production
 * (voir getRegistrar). Règles déterministes :
 *  - un nom contenant « pris » ou « taken » est indisponible ; « fail » : l'opération d'enregistrement échoue ;
 *  - prix : .com 13 $, .shop 30 $, autres 20 $ (renouvellement identique) ;
 *  - une opération passe SUCCESSFUL au 1er getOperation (IN_PROGRESS si le nom contient « slow »).
 */
type FakeDomain = DomainDetail & { name: string; hostedZoneId?: string; records?: DnsTarget };
/**
 * Injection de pannes (tests) pour le PROCHAIN appel facturé :
 *  - "refused"         : HTTP 400, rien n'est soumis ;
 *  - "throttled"       : HTTP 429, rien n'est soumis ;
 *  - "timeout_before"  : délai dépassé, rien n'est soumis ;
 *  - "timeout_after"   : l'opération EST soumise mais la réponse est perdue (cas du double achat).
 */
export type FakeFault = "refused" | "throttled" | "timeout_before" | "timeout_after";
type FakeState = {
  domains: Map<string, FakeDomain>;
  ops: Map<string, { domain: string; kind: "register" | "renew"; years: number; polls: number; submittedAt: Date }>;
  calls: { register: number; renew: number; autoRenew: { domain: string; enabled: boolean }[] };
  seq: number;
  nextFault: FakeFault | null;
};

function fault(s: FakeState, submit: () => string): string {
  const f = s.nextFault;
  s.nextFault = null;
  if (f === "refused") throw Object.assign(new Error("InvalidInput: refus simulé"), { name: "InvalidInput", $metadata: { httpStatusCode: 400 } });
  if (f === "throttled") throw Object.assign(new Error("Rate exceeded"), { name: "ThrottlingException", $metadata: { httpStatusCode: 429 } });
  if (f === "timeout_before") throw Object.assign(new Error("socket timeout"), { name: "TimeoutError" });
  const id = submit();
  if (f === "timeout_after") throw Object.assign(new Error("socket timeout"), { name: "TimeoutError" });
  return id;
}

const KEY = Symbol.for("axi.fakeRegistrar");
function state(): FakeState {
  const g = globalThis as unknown as Record<symbol, FakeState | undefined>;
  return (g[KEY] ??= { domains: new Map(), ops: new Map(), calls: { register: 0, renew: 0, autoRenew: [] }, seq: 0, nextFault: null });
}

/** Réinitialise l'état (tests). */
export function resetFakeRegistrar() {
  const g = globalThis as unknown as Record<symbol, FakeState | undefined>;
  g[KEY] = undefined;
}

/** Inspection (tests). */
export function fakeRegistrarState() {
  return state();
}

const PRICES: Record<string, number> = { com: 1300, shop: 3000 };

export const fakeRegistrar: Registrar = {
  id: "fake",
  async checkAvailability(domain): Promise<Availability> {
    if (/pris|taken/.test(domain)) return "UNAVAILABLE";
    return state().domains.has(domain) ? "UNAVAILABLE" : "AVAILABLE";
  },
  async suggestions(domain, max) {
    const [label] = domain.split(".");
    return ["com", "shop", "store", "online", "net"].map((t) => `${label}-boutique.${t}`).slice(0, max).map((d) => ({ domain: d, available: true }));
  },
  async prices(tld): Promise<TldPrices | null> {
    const p = PRICES[tld] ?? 2000;
    return { registerUsdCents: p, renewUsdCents: p };
  },
  async register({ domain, years }) {
    const s = state();
    const operationId = fault(s, () => {
      s.calls.register++;
      if (s.domains.has(domain)) throw Object.assign(new Error("DomainLimitExceeded: déjà enregistré"), { name: "DomainLimitExceeded", $metadata: { httpStatusCode: 400 } });
      const id = `fake-op-${++s.seq}`;
      s.ops.set(id, { domain, kind: "register", years, polls: 0, submittedAt: new Date() });
      return id;
    });
    return { operationId };
  },
  async findOperation({ domain, kind, since }) {
    for (const [id, op] of state().ops) {
      if (op.domain === domain && op.kind === (kind === "REGISTER" ? "register" : "renew") && op.submittedAt.getTime() >= since.getTime() - 5 * 60_000) return { operationId: id, status: "SUBMITTED" as OperationStatus };
    }
    return null;
  },
  async getOperation(operationId) {
    const s = state();
    const op = s.ops.get(operationId);
    if (!op) return { status: "ERROR" as OperationStatus, message: "Opération inconnue" };
    op.polls++;
    if (op.domain.includes("fail")) return { status: "FAILED" as OperationStatus, message: "Refus du registre (simulé)" };
    if (op.domain.includes("slow") && op.polls < 2) return { status: "IN_PROGRESS" as OperationStatus };
    if (op.kind === "register" && !s.domains.has(op.domain)) {
      const expiresAt = new Date();
      expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + op.years);
      s.domains.set(op.domain, { name: op.domain, expiresAt, autoRenew: false, nameServers: ["ns-1.fake.test", "ns-2.fake.test"] });
    }
    return { status: "SUCCESSFUL" as OperationStatus };
  },
  async renew({ domain, years, currentExpiryYear }) {
    const s = state();
    const d = s.domains.get(domain);
    if (!d?.expiresAt) throw new Error("Domaine inconnu");
    if (d.expiresAt.getUTCFullYear() !== currentExpiryYear) throw Object.assign(new Error("InvalidInput: CurrentExpiryYear ne correspond pas"), { name: "InvalidInput", $metadata: { httpStatusCode: 400 } });
    const operationId = fault(s, () => {
      s.calls.renew++;
      const next = new Date(d.expiresAt!);
      next.setUTCFullYear(next.getUTCFullYear() + years);
      d.expiresAt = next;
      const id = `fake-op-${++s.seq}`;
      s.ops.set(id, { domain, kind: "renew", years, polls: 0, submittedAt: new Date() });
      return id;
    });
    return { operationId };
  },
  async setAutoRenew(domain, enabled) {
    const s = state();
    s.calls.autoRenew.push({ domain, enabled });
    const d = s.domains.get(domain);
    if (d) d.autoRenew = enabled;
  },
  async getDetail(domain) {
    const d = state().domains.get(domain);
    return d ? { expiresAt: d.expiresAt, autoRenew: d.autoRenew, nameServers: d.nameServers } : null;
  },
  async ensureDns(domain, target) {
    const d = state().domains.get(domain);
    if (!d) throw new Error("Domaine inconnu");
    d.hostedZoneId ??= `/hostedzone/FAKE${domain.replace(/\W/g, "").toUpperCase()}`;
    d.records = target;
    return { hostedZoneId: d.hostedZoneId };
  },
};
