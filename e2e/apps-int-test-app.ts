/**
 * Petite application EXTERNE de recette (équipe INT, App Store v2), qui joue le rôle du serveur d'un développeur :
 *
 *   GET  /callback   reçoit la redirection d'installation, vérifie `hmac`, échange le code sur /api/oauth/token
 *                    (client_id + client_secret, sans PKCE) puis appelle GET /api/v1/products?limit=1 ;
 *   GET  /embed      page embarquée : valide `session` via POST /api/apps/session/verify ;
 *   POST /webhooks   reçoit les webhooks de cycle de vie et vérifie `Axi-Webhook-Signature` ;
 *   GET  /api-check  rappelle l'API avec le jeton obtenu (preuve du refus après désinstallation) ;
 *   GET  /state      état observé (JSON) pour les assertions.
 *
 * Utilisé par e2e/17-apps-v2-int.spec.ts (démarré dans le processus du test). Lançable seul :
 *   AXI_TEST_CLIENT_ID=… AXI_TEST_CLIENT_SECRET=… AXI_TEST_SIGNING_SECRET=… node --import tsx e2e/apps-int-test-app.ts
 * N'utilise que le contrat public (docs/apps-v2/int.md) : aucun accès à la base d'Axi.
 */
import http from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";

export type TestAppConfig = { port: number; axiBase: string; clientId: string; clientSecret: string; signingSecret: string };

export type TestAppState = {
  callback: null | { hmacOk: boolean; shop: string | null; state: string | null; tokenStatus: number; tokenError: string | null; scope: string | null };
  accessToken: string | null;
  refreshToken: string | null;
  apiCalls: { status: number; at: string }[];
  embed: null | { status: number; body: unknown };
  webhooks: { topic: string | null; shop: string | null; id: string | null; signatureOk: boolean; body: unknown }[];
};

/* Vérifications, réécrites ici comme le ferait un développeur à partir du contrat (pas d'import d'Axi). */

function verifyInstallHmac(query: URLSearchParams, secret: string): boolean {
  const given = query.get("hmac") ?? "";
  const params = [...query.entries()].filter(([k]) => k !== "hmac" && k !== "signature").sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  // Chaîne canonique : paires triées puis réencodées (application/x-www-form-urlencoded).
  const message = new URLSearchParams(params).toString();
  const expected = createHmac("sha256", secret).update(message, "utf8").digest();
  const got = Buffer.from(given, "hex");
  const fresh = Math.abs(Date.now() / 1000 - Number(query.get("timestamp"))) <= 300;
  return got.length === expected.length && timingSafeEqual(got, expected) && fresh;
}

function verifyWebhookSignature(header: string | undefined, rawBody: string, secret: string): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=", 2) as [string, string]));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`, "utf8").digest();
  return header
    .split(",")
    .filter((p) => p.startsWith("v1="))
    .some((p) => {
      const got = Buffer.from(p.slice(3), "hex");
      return got.length === expected.length && timingSafeEqual(got, expected);
    });
}

const page = (title: string, body: string) =>
  `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${title}</title><style>body{font:16px system-ui;margin:24px;color:#111}code{background:#f3f3f3;padding:2px 4px}</style></head><body><h1>${title}</h1>${body}</body></html>`;
const esc = (v: unknown) => String(v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function startTestApp(cfg: TestAppConfig): Promise<{ server: http.Server; state: TestAppState; close: () => Promise<void> }> {
  const state: TestAppState = { callback: null, accessToken: null, refreshToken: null, apiCalls: [], embed: null, webhooks: [] };

  const callApi = async () => {
    const r = await fetch(`${cfg.axiBase}/api/v1/products?limit=1`, { headers: { authorization: `Bearer ${state.accessToken}` } });
    state.apiCalls.push({ status: r.status, at: new Date().toISOString() });
    return r;
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${cfg.port}`);
    const html = (status: number, title: string, body: string) => {
      res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(page(title, body));
    };
    try {
      if (req.method === "GET" && url.pathname === "/callback") {
        const hmacOk = verifyInstallHmac(url.searchParams, cfg.signingSecret);
        if (!hmacOk) {
          state.callback = { hmacOk, shop: url.searchParams.get("shop"), state: url.searchParams.get("state"), tokenStatus: 0, tokenError: "hmac", scope: null };
          return html(400, "Signature invalide", "<p>hmac refusé.</p>");
        }
        const tr = await fetch(`${cfg.axiBase}/api/oauth/token`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ grant_type: "authorization_code", code: url.searchParams.get("code") ?? "", client_id: cfg.clientId, client_secret: cfg.clientSecret }).toString(),
        });
        const tj = (await tr.json()) as { access_token?: string; refresh_token?: string; scope?: string; error?: string };
        state.accessToken = tj.access_token ?? null;
        state.refreshToken = tj.refresh_token ?? null;
        state.callback = { hmacOk, shop: url.searchParams.get("shop"), state: url.searchParams.get("state"), tokenStatus: tr.status, tokenError: tj.error ?? null, scope: tj.scope ?? null };
        const api = state.accessToken ? await callApi() : null;
        const apiBody = api ? await api.text() : "";
        return html(
          200,
          "Installation réussie",
          `<p data-testid="shop">Boutique : <strong>${esc(url.searchParams.get("shop"))}</strong></p><p data-testid="token">Jeton : ${state.accessToken ? "obtenu" : "absent"} (HTTP ${tr.status}, scope « ${esc(tj.scope ?? "")} »)</p><p data-testid="api">Appel API /api/v1/products : HTTP ${api?.status ?? "-"}</p><pre>${esc(apiBody.slice(0, 400))}</pre><p><a href="${esc(url.searchParams.get("host") ?? cfg.axiBase)}">Retour à Axi</a></p>`,
        );
      }
      if (req.method === "GET" && url.pathname === "/embed") {
        const vr = await fetch(`${cfg.axiBase}/api/apps/session/verify`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64")}` },
          body: JSON.stringify({ token: url.searchParams.get("session") ?? "" }),
        });
        const vj = (await vr.json()) as Record<string, unknown>;
        state.embed = { status: vr.status, body: vj };
        if (vr.status !== 200) return html(401, "Session refusée", `<p>${esc(vj.error)}</p>`);
        return html(200, "App de test INT", `<p data-testid="embed">Session vérifiée : boutique <strong>${esc(vj.shop)}</strong>, utilisateur ${esc(vj.userId)}, scopes ${esc((vj.scopes as string[]).join(" "))}</p>`);
      }
      if (req.method === "POST" && url.pathname === "/webhooks") {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const raw = Buffer.concat(chunks).toString("utf8");
        const signatureOk = verifyWebhookSignature(req.headers["axi-webhook-signature"] as string | undefined, raw, cfg.signingSecret);
        let body: unknown = null;
        try {
          body = JSON.parse(raw);
        } catch {
          body = raw;
        }
        state.webhooks.push({ topic: (req.headers["axi-webhook-topic"] as string) ?? null, shop: (req.headers["axi-webhook-shop"] as string) ?? null, id: (req.headers["axi-webhook-id"] as string) ?? null, signatureOk, body });
        res.writeHead(signatureOk ? 200 : 401).end();
        return;
      }
      if (req.method === "GET" && url.pathname === "/api-check") {
        const r = await callApi();
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ status: r.status, body: await r.json().catch(() => null) }));
        return;
      }
      if (req.method === "GET" && url.pathname === "/state") {
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(state));
        return;
      }
      res.writeHead(404).end();
    } catch (e) {
      res.writeHead(500, { "content-type": "text/plain" }).end(String(e));
    }
  });

  return new Promise((resolve) => {
    server.listen(cfg.port, () => resolve({ server, state, close: () => new Promise((r) => server.close(() => r())) }));
  });
}

// Lancement autonome.
if (process.argv[1] && /apps-int-test-app\.ts$/.test(process.argv[1])) {
  const env = process.env;
  void startTestApp({
    port: Number(env.AXI_TEST_PORT ?? 4555),
    axiBase: env.AXI_BASE ?? "http://localhost:3000",
    clientId: env.AXI_TEST_CLIENT_ID ?? "",
    clientSecret: env.AXI_TEST_CLIENT_SECRET ?? "",
    signingSecret: env.AXI_TEST_SIGNING_SECRET ?? "",
  }).then(() => console.log(`App de test sur http://localhost:${env.AXI_TEST_PORT ?? 4555}`));
}
