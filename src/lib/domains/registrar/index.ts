import "server-only";
import type { Registrar } from "./types";

export type { Registrar } from "./types";

/** Le registrar simulé n'est JAMAIS actif en production, même si DOMAINS_FAKE=1 y est posé par erreur. */
export function fakeRegistrarEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DOMAINS_FAKE === "1" && env.NODE_ENV !== "production";
}

/** Achat de domaines activé : registrar simulé (dev) ou Route 53 explicitement activé (DOMAINS_ENABLED=1). */
export function domainSalesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return fakeRegistrarEnabled(env) || env.DOMAINS_ENABLED === "1";
}

let override: Registrar | null = null;
/** Tests uniquement. */
export function setRegistrarForTests(r: Registrar | null) {
  override = r;
}

export async function getRegistrar(): Promise<Registrar> {
  if (override) return override;
  if (fakeRegistrarEnabled()) return (await import("./fake")).fakeRegistrar;
  return (await import("./route53")).route53Registrar;
}

/** Cible DNS des domaines achetés (IP publique / Elastic IP de l'instance qui sert Caddy). */
export function dnsTarget(env: NodeJS.ProcessEnv = process.env): { ipv4: string; ipv6: string | null } | null {
  const ipv4 = (env.DOMAINS_TARGET_IPV4 ?? "").trim();
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ipv4)) return fakeRegistrarEnabled(env) ? { ipv4: "127.0.0.1", ipv6: null } : null;
  const ipv6 = (env.DOMAINS_TARGET_IPV6 ?? "").trim() || null;
  return { ipv4, ipv6 };
}
