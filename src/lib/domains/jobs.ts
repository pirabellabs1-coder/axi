import "server-only";
import type { JobHandlers } from "@/lib/jobs";
import { processDomainCharge } from "./service";

/**
 * Jobs des domaines achetés (chargés à la demande par src/lib/jobs.ts) :
 *  - domain.register / domain.renew : mis en file par confirmInvoicePayment (facture payée), même transaction ;
 *  - domain.poll : suivi d'une opération registrar en cours (se replanifie avec un délai croissant).
 * Idempotents : processDomainCharge ne rappelle jamais le registrar pour une charge déjà soumise ou appliquée.
 */
export const handlers: JobHandlers = {
  "domain.register": async (p) => {
    await processDomainCharge(String(p.chargeId ?? ""));
  },
  "domain.renew": async (p) => {
    await processDomainCharge(String(p.chargeId ?? ""));
  },
  "domain.poll": async (p) => {
    await processDomainCharge(String(p.chargeId ?? ""), Number(p.polls ?? 0) || 0, new Date(), { resubmit: p.resubmit === true });
  },
};
