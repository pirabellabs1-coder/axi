import { isIP } from "node:net";

/**
 * Protection SSRF des webhooks sortants (lot 2 §4.1).
 *
 *  - URL : https uniquement, ports 443 et 8443, sans identifiants, 2 000 caractères maximum ;
 *  - résolution DNS AVANT CHAQUE ENVOI ; refus si UNE des adresses résolues est privée, de bouclage, lien-local,
 *    CGNAT, de métadonnées (169.254.169.254, fd00:ec2::254), réservée, multicast, IPv6 ULA ou IPv4 encapsulée
 *    dans de l'IPv6 (mappée, NAT64, 6to4) vers une telle adresse ;
 *  - l'adresse validée est ensuite IMPOSÉE à la connexion (voir deliver.ts) : un second tour DNS qui répondrait
 *    autrement (DNS rebinding) n'est jamais utilisé.
 *
 * Mode test local (jamais en production) : `AXI_WEBHOOKS_ALLOW_LOCALHOST=1` accepte http(s) vers localhost,
 * 127.0.0.1 et ::1 sur n'importe quel port, pour un serveur de réception de test. Aucune autre adresse privée.
 */

export const ALLOWED_PORTS = [443, 8443] as const;
export const MAX_URL_LENGTH = 2000;

export type LookupAddress = { address: string; family: number };
export type LookupFn = (hostname: string) => Promise<LookupAddress[]>;

export type UrlCheck = { ok: true; url: URL; hostname: string; port: number; loopbackTest: boolean } | { ok: false; reason: string };
export type TargetCheck = { ok: true; url: URL; hostname: string; port: number; address: string; family: 4 | 6 } | { ok: false; reason: string };

/** Mode de test local autorisé ? Toujours faux en production, quelle que soit la variable. */
export function localhostTestMode(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV !== "production" && env.AXI_WEBHOOKS_ALLOW_LOCALHOST === "1";
}

const LOOPBACK_NAMES = new Set(["localhost", "127.0.0.1", "::1"]);
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa", ".intranet", ".corp"];

/* ───────────────────────── IPv4 ───────────────────────── */

function v4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

const V4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8], // « ce réseau »
  ["10.0.0.0", 8], // privé
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // bouclage
  ["169.254.0.0", 16], // lien-local, dont 169.254.169.254 (métadonnées cloud)
  ["172.16.0.0", 12], // privé
  ["192.0.0.0", 24], // affectations IETF
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // relais 6to4
  ["192.168.0.0", 16], // privé
  ["198.18.0.0", 15], // bancs de test
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // réservé + diffusion
];

export function isBlockedIPv4(ip: string): boolean {
  const n = v4ToInt(ip);
  if (n == null) return true;
  return V4_BLOCKED.some(([base, bits]) => {
    const b = v4ToInt(base)!;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return ((n & mask) >>> 0) === ((b & mask) >>> 0);
  });
}

/* ───────────────────────── IPv6 ───────────────────────── */

/** Adresse IPv6 → 16 octets (gère « :: », la notation IPv4 finale, refuse les zones « %eth0 »). */
export function parseIPv6(ip: string): number[] | null {
  if (ip.includes("%")) return null;
  let s = ip;
  let tail: number[] = [];
  const lastColon = s.lastIndexOf(":");
  if (s.slice(lastColon + 1).includes(".")) {
    const n = v4ToInt(s.slice(lastColon + 1));
    if (n == null) return null;
    tail = [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
    s = s.slice(0, lastColon + 1) + "0:0";
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 ? (halves[1] ? halves[1].split(":") : []) : [];
  const groups = halves.length === 2 ? [...head, ...Array(8 - head.length - rest.length).fill("0"), ...rest] : head;
  if (groups.length !== 8) return null;
  const bytes: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    const v = parseInt(g, 16);
    bytes.push(v >> 8, v & 255);
  }
  if (tail.length) bytes.splice(12, 4, ...tail);
  return bytes;
}

const v4FromBytes = (b: number[], at: number) => `${b[at]}.${b[at + 1]}.${b[at + 2]}.${b[at + 3]}`;

export function isBlockedIPv6(ip: string): boolean {
  const b = parseIPv6(ip);
  if (!b) return true;
  const zeroUpTo = (n: number) => b.slice(0, n).every((x) => x === 0);
  if (zeroUpTo(15) && (b[15] === 0 || b[15] === 1)) return true; // :: et ::1
  if (zeroUpTo(10) && b[10] === 0xff && b[11] === 0xff) return isBlockedIPv4(v4FromBytes(b, 12)); // ::ffff:a.b.c.d
  if (zeroUpTo(12)) return true; // ::a.b.c.d (IPv4 compatible, obsolète)
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) return isBlockedIPv4(v4FromBytes(b, 12)); // 64:ff9b::/96 NAT64
  if (b[0] === 0x20 && b[1] === 0x02) return isBlockedIPv4(v4FromBytes(b, 2)); // 2002::/16 6to4
  if ((b[0] & 0xfe) === 0xfc) return true; // fc00::/7 ULA (dont fd00:ec2::254, métadonnées AWS)
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true; // fe80::/10 lien-local
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0xc0) return true; // fec0::/10 site-local (obsolète)
  if (b[0] === 0xff) return true; // multicast
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return true; // 2001:db8::/32 documentation
  if (b[0] === 0x01 && b[1] === 0x00 && b.slice(2, 8).every((x) => x === 0)) return true; // 100::/64 rejet
  return false;
}

/** Adresse interdite comme destination de webhook (toute famille ; non-IP = interdite). */
export function isBlockedAddress(ip: string): boolean {
  const fam = isIP(ip);
  if (fam === 4) return isBlockedIPv4(ip);
  if (fam === 6) return isBlockedIPv6(ip);
  return true;
}

function isLoopbackAddress(ip: string): boolean {
  const fam = isIP(ip);
  if (fam === 4) return ip.startsWith("127.");
  if (fam === 6) {
    const b = parseIPv6(ip);
    return !!b && b.slice(0, 15).every((x) => x === 0) && b[15] === 1;
  }
  return false;
}

/* ───────────────────────── URL ───────────────────────── */

/** Contrôle syntaxique (à la création et avant chaque envoi). */
export function checkWebhookUrl(raw: unknown, env: Record<string, string | undefined> = process.env): UrlCheck {
  if (typeof raw !== "string" || !raw.trim()) return { ok: false, reason: "URL manquante" };
  if (raw.length > MAX_URL_LENGTH || /[\s\u0000-\u001f]/.test(raw)) return { ok: false, reason: "URL invalide" };
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "URL invalide" };
  }
  if (url.username || url.password) return { ok: false, reason: "Les identifiants dans l'URL sont interdits" };
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  if (!hostname) return { ok: false, reason: "URL invalide" };

  const testMode = localhostTestMode(env) && LOOPBACK_NAMES.has(hostname);
  if (testMode) {
    if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, reason: "Seules les URL https sont acceptées" };
    const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
    return { ok: true, url, hostname, port, loopbackTest: true };
  }

  if (url.protocol !== "https:") return { ok: false, reason: "Seules les URL https sont acceptées" };
  const port = url.port ? Number(url.port) : 443;
  if (!(ALLOWED_PORTS as readonly number[]).includes(port)) return { ok: false, reason: "Port non autorisé (443 ou 8443 uniquement)" };
  if (LOOPBACK_NAMES.has(hostname) || BLOCKED_SUFFIXES.some((s) => hostname === s.slice(1) || hostname.endsWith(s))) {
    return { ok: false, reason: "Adresse interne interdite" };
  }
  if (isIP(hostname)) {
    if (isBlockedAddress(hostname)) return { ok: false, reason: "Adresse IP privée ou réservée interdite" };
  } else if (!hostname.includes(".")) {
    return { ok: false, reason: "Nom d'hôte invalide (nom de domaine complet requis)" };
  }
  return { ok: true, url, hostname, port, loopbackTest: false };
}

/**
 * Contrôle complet juste avant l'envoi : URL + résolution DNS. TOUTES les adresses résolues doivent être publiques
 * (un enregistrement mixte public/privé est refusé). Renvoie l'adresse à imposer à la connexion.
 */
export async function resolveWebhookTarget(raw: string, lookup: LookupFn, env: Record<string, string | undefined> = process.env): Promise<TargetCheck> {
  const u = checkWebhookUrl(raw, env);
  if (!u.ok) return u;
  let addresses: LookupAddress[];
  if (isIP(u.hostname)) {
    addresses = [{ address: u.hostname, family: isIP(u.hostname) }];
  } else {
    try {
      addresses = await lookup(u.hostname);
    } catch {
      return { ok: false, reason: "Nom de domaine introuvable (DNS)" };
    }
  }
  if (!addresses.length) return { ok: false, reason: "Nom de domaine introuvable (DNS)" };
  for (const a of addresses) {
    if (u.loopbackTest ? !isLoopbackAddress(a.address) : isBlockedAddress(a.address)) {
      return { ok: false, reason: `Le domaine pointe vers une adresse interdite (${a.address})` };
    }
  }
  const chosen = addresses[0];
  return { ok: true, url: u.url, hostname: u.hostname, port: u.port, address: chosen.address, family: chosen.family === 6 ? 6 : 4 };
}
