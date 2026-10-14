/**
 * Client Route 53 (src/lib/domains/registrar/route53.ts) avec le SDK AWS simulé : aucun rejeu des appels facturés
 * (maxAttempts 1), AutoRenew toujours false, réconciliation ListOperations, CallerReference aléatoire.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type Sent = { client: string; maxAttempts: number; command: string; input: Record<string, unknown> };
const sent: Sent[] = [];
const responses: Record<string, (input: Record<string, unknown>) => unknown> = {};

function fakeSdk(clientName: string, commands: string[]) {
  const mod: Record<string, unknown> = {};
  mod[clientName] = class {
    maxAttempts: number;
    constructor(cfg: { maxAttempts: number }) {
      this.maxAttempts = cfg.maxAttempts;
    }
    async send(cmd: { name: string; input: Record<string, unknown> }) {
      sent.push({ client: clientName, maxAttempts: this.maxAttempts, command: cmd.name, input: cmd.input });
      return responses[cmd.name]?.(cmd.input) ?? {};
    }
  };
  for (const c of commands) {
    mod[c] = class {
      name = c;
      constructor(public input: Record<string, unknown>) {}
    };
  }
  return mod;
}

vi.mock("@aws-sdk/client-route-53-domains", () =>
  fakeSdk("Route53DomainsClient", [
    "CheckDomainAvailabilityCommand", "GetDomainSuggestionsCommand", "ListPricesCommand", "RegisterDomainCommand", "GetOperationDetailCommand",
    "RenewDomainCommand", "EnableDomainAutoRenewCommand", "DisableDomainAutoRenewCommand", "GetDomainDetailCommand", "UpdateDomainNameserversCommand", "ListOperationsCommand",
  ]),
);
vi.mock("@aws-sdk/client-route-53", () => fakeSdk("Route53Client", ["ListHostedZonesByNameCommand", "CreateHostedZoneCommand", "ChangeResourceRecordSetsCommand", "GetHostedZoneCommand"]));

const { route53Registrar } = await import("@/lib/domains/registrar/route53");
const contact = { firstName: "Ada", lastName: "K", email: "a@b.co", phone: "+22997000000", address1: "Rue 1", city: "Cotonou", country: "BJ" };

describe("client Route 53", () => {
  beforeEach(() => {
    sent.length = 0;
    for (const k of Object.keys(responses)) delete responses[k];
  });

  it("E1/E2 : RegisterDomain sans rejeu SDK et AutoRenew=false", async () => {
    responses.RegisterDomainCommand = () => ({ OperationId: "op-1" });
    await route53Registrar.register({ domain: "a.com", years: 1, contact, privacy: true });
    const call = sent.find((c) => c.command === "RegisterDomainCommand")!;
    expect(call.maxAttempts).toBe(1);
    expect(call.input.AutoRenew).toBe(false);
    expect(call.input.PrivacyProtectRegistrantContact).toBe(true);
  });

  it("E1 : RenewDomain sans rejeu SDK ; lectures avec rejeu", async () => {
    responses.RenewDomainCommand = () => ({ OperationId: "op-2" });
    await route53Registrar.renew({ domain: "a.com", years: 1, currentExpiryYear: 2027 });
    await route53Registrar.getOperation("op-2");
    expect(sent.find((c) => c.command === "RenewDomainCommand")!.maxAttempts).toBe(1);
    expect(sent.find((c) => c.command === "GetOperationDetailCommand")!.maxAttempts).toBe(3);
  });

  it("E1 : réconciliation par ListOperations (type, date de réclamation, domaine, pagination)", async () => {
    const since = new Date("2026-10-14T10:00:00Z");
    let page = 0;
    responses.ListOperationsCommand = () =>
      page++ === 0
        ? { Operations: [{ OperationId: "x", DomainName: "autre.com", Status: "SUCCESSFUL" }], NextPageMarker: "m" }
        : { Operations: [{ OperationId: "op-9", DomainName: "a.com", Status: "IN_PROGRESS" }] };
    expect(await route53Registrar.findOperation({ domain: "a.com", kind: "REGISTER", since })).toEqual({ operationId: "op-9", status: "IN_PROGRESS" });
    const calls = sent.filter((c) => c.command === "ListOperationsCommand");
    expect(calls).toHaveLength(2);
    expect(calls[0].input.Type).toEqual(["REGISTER_DOMAIN"]);
    expect((calls[0].input.SubmittedSince as Date).getTime()).toBeLessThanOrEqual(since.getTime());
    expect(calls[1].input.Marker).toBe("m");
    responses.ListOperationsCommand = () => ({ Operations: [] });
    expect(await route53Registrar.findOperation({ domain: "a.com", kind: "RENEW", since })).toBeNull();
  });

  it("F4 : CallerReference unique (suffixe aléatoire) et enregistrements A/AAAA uniquement", async () => {
    responses.ListHostedZonesByNameCommand = () => ({ HostedZones: [] });
    responses.CreateHostedZoneCommand = () => ({ HostedZone: { Id: "/hostedzone/Z1" }, DelegationSet: { NameServers: ["ns1"] } });
    await route53Registrar.ensureDns("a.com", { ipv4: "1.2.3.4", ipv6: "::1" });
    await route53Registrar.ensureDns("a.com", { ipv4: "1.2.3.4" });
    const refs = sent.filter((c) => c.command === "CreateHostedZoneCommand").map((c) => String(c.input.CallerReference));
    expect(refs).toHaveLength(2);
    expect(refs[0]).toMatch(/^axi-a\.com-[0-9a-f]{16}$/);
    expect(refs[0]).not.toBe(refs[1]);
    const types = sent.filter((c) => c.command === "ChangeResourceRecordSetsCommand").flatMap((c) => (c.input.ChangeBatch as { Changes: { ResourceRecordSet: { Type: string } }[] }).Changes.map((x) => x.ResourceRecordSet.Type));
    expect(new Set(types)).toEqual(new Set(["A", "AAAA"]));
  });
});
