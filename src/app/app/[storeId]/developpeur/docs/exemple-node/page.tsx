import type { Metadata } from "next";
import { appBaseUrl } from "@/lib/mcp/runtime";
import { C, Code, DocTitle, H2, NextLink, Note, OL, P } from "../_ui";

export const metadata: Metadata = { title: "Exemple Node complet" };

const SERVER = `// server.mjs — Node 20+, Express 4. Démarrage : node --env-file=.env server.mjs
import express from "express";
import crypto from "node:crypto";

const { AXI_BASE_URL, AXI_CLIENT_ID, AXI_CLIENT_SECRET, AXI_SIGNING_SECRET, PORT = 4000 } = process.env;
const BASIC = "Basic " + Buffer.from(\`\${AXI_CLIENT_ID}:\${AXI_CLIENT_SECRET}\`).toString("base64");

// Jetons par boutique. En production : une base de données, secrets chiffrés.
const shops = new Map(); // shop -> { accessToken, refreshToken, expiresAt, scope }

const app = express();

/* ---------- Signatures ---------- */
const safeEqual = (a, b) => a.length === b.length && crypto.timingSafeEqual(a, b);

// Paramètres triés par nom puis RÉENCODÉS (URLSearchParams) : chaîne canonique non ambiguë.
function verifyInstallHmac(searchParams) {
  const hmac = searchParams.get("hmac") ?? "";
  if (!/^[0-9a-f]{64}$/.test(hmac)) return false;
  const pairs = [...searchParams].filter(([k]) => k !== "hmac" && k !== "signature").sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const expected = crypto.createHmac("sha256", AXI_SIGNING_SECRET).update(new URLSearchParams(pairs).toString()).digest();
  if (!safeEqual(Buffer.from(hmac, "hex"), expected)) return false;
  return Math.abs(Date.now() / 1000 - Number(searchParams.get("timestamp"))) <= 300;
}

function verifyWebhook(rawBody, header = "") {
  const parts = header.split(",").map((p) => p.split("="));
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const expected = crypto.createHmac("sha256", AXI_SIGNING_SECRET).update(\`\${t}.\${rawBody}\`).digest();
  return parts.some(([k, v]) => k === "v1" && safeEqual(Buffer.from(v ?? "", "hex"), expected));
}

/* ---------- OAuth ---------- */
async function tokenRequest(params) {
  const res = await fetch(\`\${AXI_BASE_URL}/api/oauth/token\`, {
    method: "POST",
    headers: { Authorization: BASIC, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(\`\${json.error}: \${json.error_description}\`);
  return json;
}

function save(shop, t) {
  shops.set(shop, { accessToken: t.access_token, refreshToken: t.refresh_token, scope: t.scope, expiresAt: Date.now() + (t.expires_in - 60) * 1000 });
}

async function accessTokenFor(shop) {
  const s = shops.get(shop);
  if (!s) throw new Error("Boutique inconnue : réinstallez l'application.");
  if (Date.now() < s.expiresAt) return s.accessToken;
  save(shop, await tokenRequest({ grant_type: "refresh_token", refresh_token: s.refreshToken })); // rotation
  return shops.get(shop).accessToken;
}

// 1. Installation : Axi redirige ici avec code, shop, host, state, timestamp, hmac.
//    Le state d'installation n'est lié à aucune session : ne l'utilisez pas pour rattacher un compte.
app.get("/oauth/callback", async (req, res) => {
  if (!verifyInstallHmac(new URL(req.originalUrl, "http://localhost").searchParams)) return res.status(401).send("Signature invalide");
  try {
    save(String(req.query.shop), await tokenRequest({ grant_type: "authorization_code", code: String(req.query.code) }));
    res.send("Application installée. Retournez dans votre admin Axi et ouvrez l'application.");
  } catch (e) {
    res.status(400).send(String(e.message));
  }
});

/* ---------- API ---------- */
async function axi(shop, path) {
  const res = await fetch(\`\${AXI_BASE_URL}/api/v1\${path}\`, { headers: { Authorization: \`Bearer \${await accessTokenFor(shop)}\` } });
  if (!res.ok) throw new Error(\`API \${res.status}: \${(await res.json()).detail ?? ""}\`);
  return res.json();
}

// 2. Page embarquée : Axi la charge avec ?shop=…&host=…&session=…
app.get("/embed", async (req, res) => {
  const v = await fetch(\`\${AXI_BASE_URL}/api/apps/session/verify\`, {
    method: "POST",
    headers: { Authorization: BASIC, "Content-Type": "application/json" },
    body: JSON.stringify({ token: String(req.query.session ?? "") }),
  });
  if (!v.ok) return res.status(401).send("Session Axi invalide ou expirée : rouvrez l'application depuis Axi.");
  const session = await v.json(); // { active, shop, storeId, userId, scopes, exp }
  res.set("Content-Security-Policy", \`frame-ancestors \${AXI_BASE_URL}\`); // autorise l'affichage dans l'admin Axi
  try {
    const { data } = await axi(session.shop, "/products?limit=5");
    const items = data.map((p) => \`<li>\${escapeHtml(p.name)}</li>\`).join("");
    res.send(\`<h1>Boutique \${escapeHtml(session.shop)}</h1><ul>\${items || "<li>Aucun produit</li>"}</ul>\`);
  } catch (e) {
    res.status(502).send(escapeHtml(String(e.message)));
  }
});

// 3. Webhooks de cycle de vie : corps BRUT pour la signature.
app.post("/webhooks/axi", express.raw({ type: "application/json" }), (req, res) => {
  const raw = req.body.toString("utf8");
  if (!verifyWebhook(raw, req.get("Axi-Webhook-Signature"))) return res.sendStatus(401);
  const event = JSON.parse(raw);
  if (event.type === "app.uninstalled") shops.delete(event.shop); // jetons déjà révoqués côté Axi
  res.sendStatus(200);
});

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

app.listen(PORT, () => console.log(\`App Axi sur http://localhost:\${PORT}\`));`;

export default function NodeExamplePage() {
  const BASE = appBaseUrl();
  return (
    <>
      <DocTitle
        title="Exemple Node complet"
        lead="Un serveur Express minimal qui gère l'installation (vérification du hmac, échange du code), le rafraîchissement des jetons, la page embarquée (vérification de la session) et les webhooks de cycle de vie."
      />
      <H2 id="installer">1. Préparer le projet</H2>
      <Code code={`mkdir mon-app-axi && cd mon-app-axi
npm init -y && npm pkg set type=module
npm install express@4`} />
      <Code
        label=".env"
        code={`AXI_BASE_URL=${BASE}
AXI_CLIENT_ID=axi_cli_...          # onglet Identifiants
AXI_CLIENT_SECRET=axi_cs_...       # affiché une seule fois à la création
AXI_SIGNING_SECRET=whsec_...       # onglet Identifiants (change si vous régénérez le client_secret)
PORT=4000`}
      />
      <P>Dans l&apos;onglet Configuration de votre app, déclarez :</P>
      <OL>
        <li>Adresse de redirection OAuth : <C>http://localhost:4000/oauth/callback</C></li>
        <li>URL de l&apos;application : <C>http://localhost:4000/embed</C></li>
        <li>URL de webhook : votre URL publique (tunnel https), les adresses locales étant refusées pour les webhooks.</li>
      </OL>

      <H2 id="code">2. Le serveur</H2>
      <Code label="server.mjs" code={SERVER} />

      <H2 id="essayer">3. Essayer</H2>
      <OL>
        <li><C>node --env-file=.env server.mjs</C></li>
        <li>Onglet <strong>Tests</strong> de votre app : « Installer en test » sur votre boutique, puis « Ouvrir mon application » : le code arrive sur <C>/oauth/callback</C>.</li>
        <li>Dans l&apos;admin de la boutique, Applications › votre app › Ouvrir : la page <C>/embed</C> s&apos;affiche avec les produits.</li>
      </OL>
      <Note title="Plan de la boutique.">
        L&apos;API REST demande le plan Business (lecture) ou Scale (écriture) et les jetons OAuth le plan Business ou supérieur. Sur un plan inférieur, l&apos;appel renvoie
        <C>403 plan_required</C> ou une erreur d&apos;autorisation.
      </Note>
      <NextLink slug="facturation" />
    </>
  );
}
