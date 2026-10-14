import "server-only";
import http from "node:http";
import https from "node:https";
import { lookup as dnsLookup } from "node:dns/promises";
import type { LookupFunction } from "node:net";
import { resolveWebhookTarget, type LookupFn } from "./ssrf";
import { DELIVERY_TIMEOUT_MS, RESPONSE_SNIPPET_BYTES, truncateUtf8 } from "./policy";

/**
 * Envoi HTTP d'un webhook : résolution DNS et contrôle SSRF juste avant, connexion IMPOSÉE à l'adresse validée
 * (option `lookup`), SNI et certificat vérifiés sur le nom d'hôte d'origine, délai global de 10 s, aucune
 * redirection suivie (node:https ne les suit pas ; un 3xx est un échec), au plus 4 Ko de réponse lus.
 */

export type SendResult = { ok: boolean; status: number | null; error: string | null; snippet: string | null; durationMs: number; blocked?: boolean };

export const systemLookup: LookupFn = async (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

export async function sendSignedRequest(
  url: string,
  body: string,
  headers: Record<string, string>,
  opts: { lookup?: LookupFn; timeoutMs?: number; env?: Record<string, string | undefined> } = {},
): Promise<SendResult> {
  const started = Date.now();
  const target = await resolveWebhookTarget(url, opts.lookup ?? systemLookup, opts.env);
  if (!target.ok) return { ok: false, status: null, error: `Envoi bloqué : ${target.reason}`, snippet: null, durationMs: Date.now() - started, blocked: true };

  const pinned: LookupFunction = (_hostname, options, cb) => {
    const all = typeof options === "object" && options !== null && (options as { all?: boolean }).all;
    if (all) (cb as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address: target.address, family: target.family }]);
    else cb(null, target.address, target.family);
  };

  const client = target.url.protocol === "https:" ? https : http;
  const timeoutMs = opts.timeoutMs ?? DELIVERY_TIMEOUT_MS;

  return new Promise<SendResult>((resolve) => {
    let settled = false;
    const done = (r: Omit<SendResult, "durationMs">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...r, durationMs: Date.now() - started });
    };
    const req = client.request(
      target.url,
      {
        method: "POST",
        lookup: pinned,
        headers: { ...headers, "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(body, "utf8")), "User-Agent": "Axi-Webhooks/2026-10", Connection: "close" },
        agent: false,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const chunks: Buffer[] = [];
        let size = 0;
        const finish = () => {
          const snippet = truncateUtf8(Buffer.concat(chunks), RESPONSE_SNIPPET_BYTES);
          const ok = status >= 200 && status < 300;
          done({ ok, status, error: ok ? null : status >= 300 && status < 400 ? `Redirection ${status} non suivie` : `Réponse HTTP ${status}`, snippet: snippet || null });
        };
        res.on("data", (c: Buffer) => {
          if (size >= RESPONSE_SNIPPET_BYTES) return;
          chunks.push(c);
          size += c.length;
          // Inutile de lire davantage : on coupe la connexion (un destinataire bavard ne bloque pas le worker).
          if (size >= RESPONSE_SNIPPET_BYTES) {
            finish();
            res.destroy();
          }
        });
        res.on("end", finish);
        res.on("error", finish);
        res.on("close", finish);
      },
    );
    const timer = setTimeout(() => {
      req.destroy(new Error("timeout"));
      done({ ok: false, status: null, error: `Délai dépassé (${Math.round(timeoutMs / 1000)} s)`, snippet: null });
    }, timeoutMs);
    req.on("error", (e) => done({ ok: false, status: null, error: `Connexion impossible : ${(e as NodeJS.ErrnoException).code ?? e.message}`.slice(0, 300), snippet: null }));
    req.end(body);
  });
}
