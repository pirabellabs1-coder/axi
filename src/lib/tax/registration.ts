import { z } from "zod";
import { TAX_REGIMES, DEFAULT_EXEMPTION_MENTION, type TaxRegime } from "@/config/taxes";

/**
 * Identité fiscale de la boutique (Store.taxRegistration, JSON). Fonctions pures.
 *
 * `autoIssueInvoices` : le schéma n'a pas de colonne dédiée à l'émission automatique au passage PAID ;
 * le réglage est rangé dans ce même JSON (écart signalé, voir docs/vague2/T-taxes-factures.md).
 * Sans identité fiscale enregistrée (JSON absent ou illisible), il vaut `false` : une boutique qui n'a jamais
 * ouvert /parametres/taxes n'émet JAMAIS de factures immuables à son insu. L'écran pose `true` à la première
 * configuration (case cochée par défaut).
 */
export type TaxRegistration = {
  legalName: string;
  taxId: string;
  rccm: string;
  address: string;
  regime: TaxRegime;
  exemptionMention: string;
  autoIssueInvoices: boolean;
};

const str = (max: number) => z.preprocess((v) => (typeof v === "string" ? v.trim().slice(0, max) : ""), z.string());

export const taxRegistrationSchema = z.object({
  legalName: str(160),
  taxId: str(60),
  rccm: str(60),
  address: str(300),
  regime: z.preprocess((v) => ((TAX_REGIMES as readonly string[]).includes(String(v)) ? v : "TVA"), z.enum(TAX_REGIMES)),
  exemptionMention: str(200),
  autoIssueInvoices: z.preprocess((v) => (typeof v === "boolean" ? v : true), z.boolean()),
});

export const DEFAULT_TAX_REGISTRATION: TaxRegistration = {
  legalName: "",
  taxId: "",
  rccm: "",
  address: "",
  regime: "TVA",
  exemptionMention: "",
  autoIssueInvoices: false,
};

/** Vrai si la boutique a DÉJÀ enregistré une identité fiscale lisible (JSON présent et conforme). */
export function hasTaxRegistration(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  return taxRegistrationSchema.safeParse(raw).success;
}

/**
 * Lecture tolérante (JSON inconnu ou ancien) : jamais d'exception, valeurs par défaut.
 * JSON absent ou illisible → `autoIssueInvoices: false` (aucune émission automatique non demandée) ;
 * JSON présent sans la clé (réglage antérieur à son ajout) → `true`, le réglage existant est respecté.
 */
export function parseTaxRegistration(raw: unknown): TaxRegistration {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULT_TAX_REGISTRATION };
  const parsed = taxRegistrationSchema.safeParse(raw);
  return parsed.success ? parsed.data : { ...DEFAULT_TAX_REGISTRATION };
}

/** Le commerçant collecte-t-il effectivement une taxe ? (taxes activées ET régime TVA ou autre). */
export function collectsTax(taxesEnabled: boolean, reg: Pick<TaxRegistration, "regime">): boolean {
  return taxesEnabled && reg.regime !== "TPS";
}

/** Mention d'exonération à imprimer quand aucune taxe n'est collectée. */
export function exemptionMentionFor(taxesEnabled: boolean, reg: Pick<TaxRegistration, "regime" | "exemptionMention">): string | null {
  if (collectsTax(taxesEnabled, reg)) return reg.exemptionMention || null;
  return reg.exemptionMention || DEFAULT_EXEMPTION_MENTION;
}
