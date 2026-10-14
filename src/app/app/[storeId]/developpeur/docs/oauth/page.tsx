import type { Metadata } from "next";
import { appBaseUrl } from "@/lib/mcp/runtime";
import { SCOPES, SCOPE_LABELS } from "@/lib/mcp/scopes";
import { ACCESS_TOKEN_TTL_SEC, CODE_TTL_SEC, REFRESH_TOKEN_TTL_SEC } from "@/lib/mcp/oauth";
import { INSTALL_HMAC_TOLERANCE_SEC } from "@/lib/apps/install-signing";
import { C, Code, DocTitle, H2, H3, NextLink, Note, OL, P, Table, UL } from "../_ui";

export const metadata: Metadata = { title: "Authentification OAuth" };

export default function OAuthDocPage() {
  const BASE = appBaseUrl();
  return (
    <>
      <DocTitle
        title="Authentification OAuth"
        lead="Axi implémente OAuth 2.1. Pour une application de l'App Store, c'est l'installation par le marchand qui déclenche l'autorisation : Axi redirige vers votre serveur avec un code signé, que vous échangez contre des jetons propres à la boutique."
      />

      <H2 id="points">Points d&apos;accès</H2>
      <Table
        head={["Rôle", "URL"]}
        rows={[
          ["Jeton (votre serveur)", <C key="t">{`POST ${BASE}/api/oauth/token`}</C>],
          ["Révocation (RFC 7009)", <C key="r">{`POST ${BASE}/api/oauth/revoke`}</C>],
          ["Autorisation à l'initiative de l'app", <C key="a">{`GET ${BASE}/oauth/authorize`}</C>],
          ["Métadonnées (RFC 8414)", <C key="m">{`${BASE}/.well-known/oauth-authorization-server`}</C>],
        ]}
      />
      <P>Vos identifiants (<C>client_id</C>, <C>client_secret</C>) et votre secret de signature (<C>whsec_…</C>) sont dans l&apos;onglet <strong>Identifiants</strong> de votre application. Le secret de signature est dérivé de votre <C>client_secret</C> : <strong>régénérer le client_secret renouvelle aussi ce secret</strong>. Mettez les deux à jour ensemble sur votre serveur.</P>

      <H2 id="installation">1. Le marchand installe votre application</H2>
      <P>
        Le propriétaire de la boutique ouvre la fiche de l&apos;app (Applications), clique sur « Installer », voit les autorisations, puis « Autoriser et installer » (vous : onglet Tests). Axi crée l&apos;installation et l&apos;accès OAuth, puis redirige le navigateur vers la <strong>première</strong> adresse
        de redirection web déclarée (https, ou <C>http://localhost</C> en développement) avec ces paramètres :
      </P>
      <Code code={`https://mon-app.com/oauth/callback?code=axi_code_...&host=${encodeURIComponent(BASE)}&shop=chez-aicha&state=...&timestamp=1760000000&hmac=5f2b...`} />
      <Table
        head={["Paramètre", "Sens"]}
        rows={[
          [<C key="c">code</C>, `Code d'installation, ${CODE_TTL_SEC} s, usage unique.`],
          [<C key="s">shop</C>, "Identifiant (slug) de la boutique : votre clé de stockage des jetons."],
          [<C key="h">host</C>, "Base d'Axi qui a émis la redirection."],
          [<C key="st">state</C>, "Valeur opaque aléatoire générée par Axi. Elle n'est liée à aucune session de votre app : ne vous en servez pas comme protection CSRF (voir ci-dessous)."],
          [<C key="ts">timestamp</C>, `Heure d'émission (secondes). Refusez au-delà de ${INSTALL_HMAC_TOLERANCE_SEC} s d'écart.`],
          [<C key="hm">hmac</C>, "Signature de tous les autres paramètres."],
        ]}
      />
      <H3>Vérifier le hmac</H3>
      <P>
        Prenez <strong>tous</strong> les paramètres reçus sauf <C>hmac</C> (et <C>signature</C>), triez-les par nom, puis <strong>réencodez</strong>-les comme une
        query string (<C>new URLSearchParams(paires_triées).toString()</C> : espaces en <C>+</C>, <C>&amp;</C> et <C>=</C> encodés). Calculez ensuite
        <C>hex(HMAC-SHA256(secret_de_signature, chaîne))</C> et comparez en temps constant. Exemple de chaîne :
        <C>{`code=axi_code_x&host=${encodeURIComponent(BASE)}&shop=chez-aicha&state=st&timestamp=1760000000`}</C>.
      </P>
      <Code
        label="Node.js"
        code={`import crypto from "node:crypto";

// searchParams : new URL(req.originalUrl, "http://localhost").searchParams
export function verifyInstallHmac(searchParams, signingSecret, toleranceSec = ${INSTALL_HMAC_TOLERANCE_SEC}) {
  const hmac = searchParams.get("hmac") ?? "";
  if (!/^[0-9a-f]{64}$/.test(hmac)) return false;
  const pairs = [...searchParams]
    .filter(([k]) => k !== "hmac" && k !== "signature")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const message = new URLSearchParams(pairs).toString(); // réencodage : chaîne non ambiguë
  const expected = crypto.createHmac("sha256", signingSecret).update(message).digest();
  const given = Buffer.from(hmac, "hex");
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return false;
  return Math.abs(Date.now() / 1000 - Number(searchParams.get("timestamp"))) <= toleranceSec;
}`}
      />

      <H3>Le <C>state</C> d&apos;installation n&apos;authentifie pas votre utilisateur</H3>
      <P>
        L&apos;installation est lancée depuis Axi : son <C>state</C> n&apos;est lié à <strong>aucune session de votre app</strong>. Le <C>hmac</C> prouve que la
        redirection vient d&apos;Axi, pas que le navigateur qui l&apos;ouvre est celui du marchand. Ignorez ce <C>state</C> (ou remplacez-le) : ne rattachez
        jamais la boutique à une session déjà ouverte chez vous sur la seule foi de cette redirection. Pour lier un compte de votre app, utilisez
        <strong> votre propre</strong> <C>state</C> (stocké dans la session de l&apos;utilisateur) via <C>/oauth/authorize</C> (section « Autorisation à l&apos;initiative de l&apos;app » ci-dessous), ou identifiez
        l&apos;utilisateur par la session signée de la page embarquée.
      </P>

      <H2 id="echange">2. Échanger le code (depuis votre serveur)</H2>
      <P>Client confidentiel obligatoire (le <C>client_secret</C> prouve l&apos;identité de l&apos;app) ; pas de PKCE pour ce code ; <C>redirect_uri</C> facultative, mais identique si fournie.</P>
      <Code
        code={`curl -s -X POST ${BASE}/api/oauth/token \\
  -u "$AXI_CLIENT_ID:$AXI_CLIENT_SECRET" \\
  -d grant_type=authorization_code \\
  -d code=axi_code_...`}
      />
      <P>Authentification : en-tête <C>Authorization: Basic</C> (ci-dessus) ou <C>client_id</C> + <C>client_secret</C> dans le corps (<C>application/x-www-form-urlencoded</C> ou JSON). Réponse :</P>
      <Code
        code={`{
  "access_token": "axi_oat_...",
  "token_type": "Bearer",
  "expires_in": ${ACCESS_TOKEN_TTL_SEC},
  "refresh_token": "axi_ort_...",
  "scope": "store:read catalog:read"
}`}
      />
      <Note>
        Le <C>scope</C> renvoyé est la portée <strong>effective</strong> : autorisations de l&apos;installation ∩ plan de la boutique ∩ rôle du membre qui a installé.
        Enregistrez les jetons par <C>shop</C>, côté serveur uniquement.
      </Note>

      <H2 id="rafraichir">3. Rafraîchir le jeton</H2>
      <P>
        Jeton d&apos;accès : {ACCESS_TOKEN_TTL_SEC / 3600} h. Jeton de rafraîchissement : {REFRESH_TOKEN_TTL_SEC / 86400} jours, <strong>usage unique</strong> (rotation) :
        enregistrez toujours le nouveau. Présenter un refresh déjà utilisé révoque tout l&apos;accès.
      </P>
      <Code
        code={`curl -s -X POST ${BASE}/api/oauth/token \\
  -u "$AXI_CLIENT_ID:$AXI_CLIENT_SECRET" \\
  -d grant_type=refresh_token \\
  -d refresh_token=axi_ort_...`}
      />
      <P>Un paramètre <C>scope</C> plus restreint réduit <strong>définitivement</strong> l&apos;autorisation à ce sous-ensemble.</P>

      <H2 id="validite">Validité des jetons</H2>
      <UL>
        <li>Un jeton n&apos;est valable que tant que l&apos;app est <strong>installée et active</strong> sur la boutique : à la désinstallation, tous les jetons sont révoqués.</li>
        <li>La boutique doit être au plan <strong>Business</strong> ou supérieur (connexions OAuth), et le membre qui a installé doit toujours y avoir accès (propriétaire ou gérant).</li>
        <li>Une app suspendue par Axi voit ses jetons refusés.</li>
      </UL>

      <H3>Erreurs</H3>
      <P>Format standard : <C>{`{ "error": "invalid_grant", "error_description": "..." }`}</C>. <C>invalid_client</C> (401) : identifiants incorrects ; <C>invalid_grant</C> : code expiré ou déjà utilisé, app désinstallée, accès retiré ; <C>slow_down</C> (429) : 60 requêtes par minute et par IP.</P>

      <H2 id="pkce">Autorisation à l&apos;initiative de l&apos;app (reconnexion)</H2>
      <P>
        Si vous avez perdu les jetons d&apos;une boutique, renvoyez le membre qui a installé l&apos;app vers <C>/oauth/authorize</C> (flux standard avec PKCE S256 obligatoire).
        Le jeton obtenu n&apos;est accepté que s&apos;il se rattache à l&apos;installation active (même membre, même boutique).
      </P>
      <Code
        code={`${BASE}/oauth/authorize?response_type=code
  &client_id=axi_cli_...
  &redirect_uri=https%3A%2F%2Fmon-app.com%2Foauth%2Fcallback
  &scope=store%3Aread%20catalog%3Aread
  &state=ALEATOIRE
  &code_challenge=BASE64URL_SHA256_DU_VERIFIER
  &code_challenge_method=S256`}
      />
      <P>Retour : <C>code</C>, <C>state</C> et <C>iss</C> ; échange avec <C>grant_type=authorization_code</C>, <C>code</C>, <C>redirect_uri</C> identique et <C>code_verifier</C>.</P>

      <H2 id="scopes">Scopes</H2>
      <Table
        head={["Scope", "Accès", "Description"]}
        rows={SCOPES.map((s) => [<C key={s}>{s}</C>, SCOPE_LABELS[s].write ? "Écriture" : "Lecture", SCOPE_LABELS[s].description])}
      />
      <OL>
        <li>Gratuit : lecture seule ; Starter : + catalogue, stock, commandes, contenus ; Business et plus : tous les scopes.</li>
        <li>Les scopes accordés ne dépassent jamais le plan de la boutique ; un changement de plan s&apos;applique immédiatement.</li>
      </OL>
      <NextLink slug="api" />
    </>
  );
}
