import { describe, it, expect } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { vi } from "vitest";

vi.mock("server-only", () => ({}));

import { checkWebhookUrl, isBlockedAddress, isBlockedIPv6, localhostTestMode, parseIPv6, resolveWebhookTarget, type LookupFn } from "@/lib/webhooks/ssrf";
import { sendSignedRequest } from "@/lib/webhooks/deliver";

const PROD = { NODE_ENV: "production" } as Record<string, string>;
const lookupOf = (...addrs: string[]): LookupFn => async () => addrs.map((a) => ({ address: a, family: a.includes(":") ? 6 : 4 }));

describe("SSRF : adresses", () => {
  it.each([
    "127.0.0.1", "127.255.0.9", "10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "169.254.0.1",
    "100.64.0.1", "100.127.255.254", "0.0.0.0", "224.0.0.1", "255.255.255.255", "192.0.2.10", "198.18.0.1",
  ])("IPv4 interdite : %s", (ip) => expect(isBlockedAddress(ip)).toBe(true));

  it.each(["8.8.8.8", "1.1.1.1", "41.138.89.1", "172.32.0.1", "100.128.0.1", "169.255.0.1"])("IPv4 publique : %s", (ip) => expect(isBlockedAddress(ip)).toBe(false));

  it.each([
    "::1", "::", "fc00::1", "fd00:ec2::254", "fe80::1", "fec0::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:7f00:1",
    "64:ff9b::a9fe:a9fe", "2002:c0a8:0101::1", "2001:db8::1", "::127.0.0.1", "fe80::1%eth0",
  ])("IPv6 interdite : %s", (ip) => expect(isBlockedIPv6(ip)).toBe(true));

  it.each(["2a00:1450:4007:80e::200e", "2606:4700:4700::1111", "::ffff:8.8.8.8", "64:ff9b::808:808"])("IPv6 publique : %s", (ip) => expect(isBlockedAddress(ip)).toBe(false));

  it("analyse IPv6 avec notation IPv4 finale", () => {
    expect(parseIPv6("::ffff:192.168.0.1")?.slice(12)).toEqual([192, 168, 0, 1]);
    expect(parseIPv6("1:2:3")).toBeNull();
  });
});

describe("SSRF : URL", () => {
  it("https uniquement, ports 443 / 8443, sans identifiants, pas de nom interne", () => {
    expect(checkWebhookUrl("https://hooks.exemple.com/axi", PROD).ok).toBe(true);
    expect(checkWebhookUrl("https://hooks.exemple.com:8443/axi", PROD).ok).toBe(true);
    expect(checkWebhookUrl("http://hooks.exemple.com/axi", PROD).ok).toBe(false);
    expect(checkWebhookUrl("https://hooks.exemple.com:8080/axi", PROD).ok).toBe(false);
    expect(checkWebhookUrl("https://user:pw@hooks.exemple.com/", PROD).ok).toBe(false);
    expect(checkWebhookUrl("https://localhost/", PROD).ok).toBe(false);
    expect(checkWebhookUrl("https://db.internal/", PROD).ok).toBe(false);
    expect(checkWebhookUrl("https://intranet/", PROD).ok).toBe(false);
    expect(checkWebhookUrl("https://169.254.169.254/latest/meta-data", PROD).ok).toBe(false);
    expect(checkWebhookUrl("https://[::1]/", PROD).ok).toBe(false);
    // Formes numériques normalisées par le parseur WHATWG
    expect(checkWebhookUrl("https://2130706433/", PROD).ok).toBe(false);
    expect(checkWebhookUrl("https://0x7f.1/", PROD).ok).toBe(false);
    expect(checkWebhookUrl("ftp://exemple.com/", PROD).ok).toBe(false);
  });

  it("mode test localhost : jamais en production, seulement le bouclage", () => {
    const dev = { NODE_ENV: "development", AXI_WEBHOOKS_ALLOW_LOCALHOST: "1" };
    expect(localhostTestMode(dev)).toBe(true);
    expect(localhostTestMode({ NODE_ENV: "production", AXI_WEBHOOKS_ALLOW_LOCALHOST: "1" })).toBe(false);
    expect(checkWebhookUrl("http://localhost:4567/h", dev).ok).toBe(true);
    expect(checkWebhookUrl("http://localhost:4567/h", { NODE_ENV: "production", AXI_WEBHOOKS_ALLOW_LOCALHOST: "1" }).ok).toBe(false);
    expect(checkWebhookUrl("http://10.0.0.1:4567/h", dev).ok).toBe(false);
  });
});

describe("SSRF : résolution DNS avant chaque envoi", () => {
  it("refuse si UNE adresse résolue est privée (enregistrement mixte)", async () => {
    expect((await resolveWebhookTarget("https://ok.exemple.com/", lookupOf("93.184.216.34"), PROD)).ok).toBe(true);
    const mixed = await resolveWebhookTarget("https://mix.exemple.com/", lookupOf("93.184.216.34", "10.0.0.5"), PROD);
    expect(mixed.ok).toBe(false);
    expect((await resolveWebhookTarget("https://v6.exemple.com/", lookupOf("fd12::1"), PROD)).ok).toBe(false);
  });

  it("DNS rebinding simulé : la 1re résolution est publique, la 2e privée → le 2e envoi est bloqué", async () => {
    let call = 0;
    const rebinding: LookupFn = async () => [{ address: call++ === 0 ? "93.184.216.34" : "127.0.0.1", family: 4 }];
    expect((await resolveWebhookTarget("https://rebind.exemple.com/", rebinding, PROD)).ok).toBe(true);
    const second = await sendSignedRequest("https://rebind.exemple.com/", "{}", {}, { lookup: rebinding, env: PROD });
    expect(second.ok).toBe(false);
    expect(second.blocked).toBe(true);
    expect(second.error).toMatch(/127\.0\.0\.1/);
  });

  it("échec DNS : refus propre", async () => {
    const r = await resolveWebhookTarget("https://nx.exemple.com/", async () => { throw new Error("ENOTFOUND"); }, PROD);
    expect(r).toEqual({ ok: false, reason: "Nom de domaine introuvable (DNS)" });
  });
});

describe("envoi HTTP (serveur local, mode test)", () => {
  const env = { NODE_ENV: "test", AXI_WEBHOOKS_ALLOW_LOCALHOST: "1" };
  const withServer = async (handler: Parameters<typeof createServer>[1], fn: (url: string) => Promise<void>) => {
    const server: Server = createServer(handler);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as AddressInfo;
    try {
      await fn(`http://localhost:${port}/hook`);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    }
  };

  it("2xx = succès, en-têtes transmis, corps de réponse limité à 4 Ko", async () => {
    let received: Record<string, string | string[] | undefined> = {};
    await withServer(
      (req, res) => {
        received = req.headers;
        res.writeHead(200);
        res.end("x".repeat(10_000));
      },
      async (url) => {
        const r = await sendSignedRequest(url, '{"a":1}', { "Axi-Event": "app.ping" }, { lookup: async () => [{ address: "127.0.0.1", family: 4 }], env });
        expect(r.ok).toBe(true);
        expect(r.status).toBe(200);
        expect(r.snippet!.length).toBeLessThanOrEqual(4096);
        expect(received["axi-event"]).toBe("app.ping");
        expect(received["content-type"]).toBe("application/json");
      },
    );
  });

  it("redirection non suivie (échec), délai dépassé (échec)", async () => {
    await withServer(
      (req, res) => {
        if (req.url === "/hook") {
          res.writeHead(302, { Location: "http://169.254.169.254/" });
          res.end();
        }
      },
      async (url) => {
        const r = await sendSignedRequest(url, "{}", {}, { lookup: async () => [{ address: "127.0.0.1", family: 4 }], env });
        expect(r.ok).toBe(false);
        expect(r.status).toBe(302);
        expect(r.error).toMatch(/Redirection/);
      },
    );
    await withServer(
      () => {
        /* ne répond jamais */
      },
      async (url) => {
        const r = await sendSignedRequest(url, "{}", {}, { lookup: async () => [{ address: "127.0.0.1", family: 4 }], env, timeoutMs: 300 });
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/Délai dépassé/);
      },
    );
  });
});
