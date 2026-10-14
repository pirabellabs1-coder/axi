import "server-only";
import {
  Route53DomainsClient,
  CheckDomainAvailabilityCommand,
  GetDomainSuggestionsCommand,
  ListPricesCommand,
  RegisterDomainCommand,
  GetOperationDetailCommand,
  RenewDomainCommand,
  DisableDomainAutoRenewCommand,
  GetDomainDetailCommand,
  UpdateDomainNameserversCommand,
  ListOperationsCommand,
  type ContactDetail,
} from "@aws-sdk/client-route-53-domains";
import { Route53Client, ListHostedZonesByNameCommand, CreateHostedZoneCommand, ChangeResourceRecordSetsCommand, GetHostedZoneCommand, type Change } from "@aws-sdk/client-route-53";
import { randomBytes } from "node:crypto";
import { registrarPhone, type DomainContact } from "../names";
import { usdToCents } from "../pricing";
import type { Availability, OperationStatus, Registrar, TldPrices } from "./types";

/**
 * Amazon Route 53 Domains (revendeur). Identifiants : chaîne par défaut du SDK, c'est-à-dire le RÔLE IAM DE
 * L'INSTANCE EC2 en production (aucune clé dans le code ni en base). Politique IAM exacte : docs/DOMAINES.md.
 * L'API route53domains n'existe qu'en us-east-1 ; Route 53 (DNS) est global.
 * Délais : 5 s de connexion, 20 s par requête. Lectures : 3 tentatives (backoff du SDK). Appels FACTURÉS
 * (RegisterDomain, RenewDomain) : client dédié à 1 seule tentative (aucun rejeu automatique du SDK) ; un résultat
 * inconnu est réconcilié par ListOperations (src/lib/domains/service.ts).
 */
const REGION = "us-east-1";
const HANDLER = { connectionTimeout: 5_000, requestTimeout: 20_000 };

let domainsClient: Route53DomainsClient | null = null;
let dnsClient: Route53Client | null = null;
let billedClient: Route53DomainsClient | null = null;
const domains = () => (domainsClient ??= new Route53DomainsClient({ region: REGION, maxAttempts: 3, requestHandler: HANDLER }));
const billed = () => (billedClient ??= new Route53DomainsClient({ region: REGION, maxAttempts: 1, requestHandler: HANDLER }));
const dns = () => (dnsClient ??= new Route53Client({ region: REGION, maxAttempts: 3, requestHandler: HANDLER }));

function toContact(c: DomainContact): ContactDetail {
  return {
    FirstName: c.firstName,
    LastName: c.lastName,
    ContactType: c.organization ? "COMPANY" : "PERSON",
    OrganizationName: c.organization,
    AddressLine1: c.address1,
    City: c.city,
    State: c.state,
    CountryCode: c.country as ContactDetail["CountryCode"],
    ZipCode: c.zip,
    PhoneNumber: registrarPhone(c.phone, c.country),
    Email: c.email,
  };
}

function mapAvailability(a: string | undefined): Availability {
  switch (a) {
    case "AVAILABLE":
      return "AVAILABLE";
    case "UNAVAILABLE":
    case "UNAVAILABLE_PREMIUM": // les noms premium ne sont pas vendus (prix hors grille)
    case "UNAVAILABLE_RESTRICTED":
    case "RESERVED":
    case "AVAILABLE_RESERVED":
    case "AVAILABLE_PREORDER":
    case "PENDING":
      return "UNAVAILABLE";
    case "INVALID_NAME_FOR_TLD":
      return "UNSUPPORTED";
    default:
      return "UNKNOWN";
  }
}

/** Grille de prix par extension, mémorisée 6 h par processus (ListPrices est limité en débit). */
const priceMemo = new Map<string, { at: number; value: TldPrices | null }>();
const PRICE_TTL_MS = 6 * 3600_000;

export const route53Registrar: Registrar = {
  id: "route53",

  async checkAvailability(domain) {
    try {
      const r = await domains().send(new CheckDomainAvailabilityCommand({ DomainName: domain }));
      return mapAvailability(r.Availability);
    } catch (e) {
      if ((e as { name?: string }).name === "UnsupportedTLD") return "UNSUPPORTED";
      throw e;
    }
  },

  async suggestions(domain, max) {
    const r = await domains().send(new GetDomainSuggestionsCommand({ DomainName: domain, SuggestionCount: Math.min(Math.max(max, 1), 20), OnlyAvailable: true }));
    return (r.SuggestionsList ?? []).filter((s) => s.DomainName).map((s) => ({ domain: s.DomainName!.toLowerCase(), available: s.Availability === "AVAILABLE" }));
  },

  async prices(tld) {
    const hit = priceMemo.get(tld);
    if (hit && Date.now() - hit.at < PRICE_TTL_MS) return hit.value;
    const r = await domains().send(new ListPricesCommand({ Tld: tld }));
    const p = r.Prices?.find((x) => x.Name === tld);
    const reg = p?.RegistrationPrice;
    const ren = p?.RenewalPrice;
    const value = reg?.Price && reg.Currency === "USD" && ren?.Price && ren.Currency === "USD" ? { registerUsdCents: usdToCents(reg.Price), renewUsdCents: usdToCents(ren.Price) } : null;
    priceMemo.set(tld, { at: Date.now(), value });
    return value;
  },

  async register({ domain, years, contact, privacy }) {
    const c = toContact(contact);
    const r = await billed().send(
      new RegisterDomainCommand({
        DomainName: domain,
        DurationInYears: years,
        // Toujours désactivé chez AWS : seul un renouvellement PAYÉ appelle RenewDomain.
        AutoRenew: false,
        AdminContact: c,
        RegistrantContact: c,
        TechContact: c,
        PrivacyProtectAdminContact: privacy,
        PrivacyProtectRegistrantContact: privacy,
        PrivacyProtectTechContact: privacy,
      }),
    );
    if (!r.OperationId) throw new Error("Route 53 : OperationId absent");
    return { operationId: r.OperationId };
  },

  async findOperation({ domain, kind, since }) {
    let marker: string | undefined;
    for (let page = 0; page < 10; page++) {
      const r = await domains().send(new ListOperationsCommand({ SubmittedSince: new Date(since.getTime() - 5 * 60_000), Type: [kind === "REGISTER" ? "REGISTER_DOMAIN" : "RENEW_DOMAIN"], Marker: marker, MaxItems: 100 }));
      const hit = (r.Operations ?? []).find((o) => o.DomainName?.toLowerCase() === domain && o.OperationId);
      if (hit) return { operationId: hit.OperationId!, status: (hit.Status ?? "SUBMITTED") as OperationStatus };
      if (!r.NextPageMarker) return null;
      marker = r.NextPageMarker;
    }
    return null;
  },

  async getOperation(operationId) {
    const r = await domains().send(new GetOperationDetailCommand({ OperationId: operationId }));
    return { status: (r.Status ?? "SUBMITTED") as OperationStatus, message: r.Message };
  },

  async renew({ domain, years, currentExpiryYear }) {
    const r = await billed().send(new RenewDomainCommand({ DomainName: domain, DurationInYears: years, CurrentExpiryYear: currentExpiryYear }));
    if (!r.OperationId) throw new Error("Route 53 : OperationId absent");
    return { operationId: r.OperationId };
  },

  async setAutoRenew(domain, enabled) {
    // L'auto-renouvellement AWS reste désactivé en permanence (refusé aussi par la politique IAM).
    if (enabled) throw new Error("Auto-renouvellement AWS interdit : seul un renouvellement payé appelle RenewDomain");
    await domains().send(new DisableDomainAutoRenewCommand({ DomainName: domain }));
  },

  async getDetail(domain) {
    try {
      const r = await domains().send(new GetDomainDetailCommand({ DomainName: domain }));
      return { expiresAt: r.ExpirationDate ?? null, autoRenew: !!r.AutoRenew, nameServers: (r.Nameservers ?? []).map((n) => n.Name ?? "").filter(Boolean) };
    } catch (e) {
      // Domaine absent du compte : InvalidInput (« Domain … not found »)
      if ((e as { name?: string }).name === "InvalidInput") return null;
      throw e;
    }
  },

  async ensureDns(domain, target) {
    const apex = `${domain}.`;
    // Route 53 crée la zone hébergée à l'enregistrement ; sinon on la crée et on aligne les serveurs de noms.
    const list = await dns().send(new ListHostedZonesByNameCommand({ DNSName: domain, MaxItems: 1 }));
    let zoneId = list.HostedZones?.find((z) => z.Name === apex && !z.Config?.PrivateZone)?.Id ?? null;
    if (!zoneId) {
      const created = await dns().send(new CreateHostedZoneCommand({ Name: domain, CallerReference: `axi-${domain}-${randomBytes(8).toString("hex")}` }));
      zoneId = created.HostedZone?.Id ?? null;
      if (!zoneId) throw new Error("Route 53 : création de zone impossible");
      const ns = created.DelegationSet?.NameServers ?? (await dns().send(new GetHostedZoneCommand({ Id: zoneId }))).DelegationSet?.NameServers ?? [];
      if (ns.length) await domains().send(new UpdateDomainNameserversCommand({ DomainName: domain, Nameservers: ns.map((Name) => ({ Name })) }));
    }
    const changes: Change[] = [];
    for (const name of [apex, `www.${apex}`]) {
      changes.push({ Action: "UPSERT", ResourceRecordSet: { Name: name, Type: "A", TTL: 300, ResourceRecords: [{ Value: target.ipv4 }] } });
      if (target.ipv6) changes.push({ Action: "UPSERT", ResourceRecordSet: { Name: name, Type: "AAAA", TTL: 300, ResourceRecords: [{ Value: target.ipv6 }] } });
    }
    await dns().send(new ChangeResourceRecordSetsCommand({ HostedZoneId: zoneId, ChangeBatch: { Comment: "Axi : boutique", Changes: changes } }));
    return { hostedZoneId: zoneId };
  },
};
