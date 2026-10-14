import type { Metadata } from "next";
import { appBaseUrl } from "@/lib/mcp/runtime";
import { SESSION_TOKEN_TTL_SEC } from "@/lib/apps/session-token";
import { C, Code, DocTitle, H2, H3, NextLink, Note, OL, P, Table, UL } from "../_ui";

export const metadata: Metadata = { title: "Applications embarquées" };

export default function EmbeddedDocPage() {
  const BASE = appBaseUrl();
  return (
    <>
      <DocTitle
        title="Applications embarquées"
        lead="Votre application s'affiche dans l'admin du marchand, sous l'en-tête Axi : Axi charge l'URL de l'app (onglet Configuration) dans un cadre, en lui transmettant la boutique et un jeton de session court à vérifier côté serveur."
      />

      <H2 id="chargement">Ce que reçoit votre page</H2>
      <P>Quand un membre clique sur « Ouvrir l&apos;application » (fiche de l&apos;app ou carte de « Mes applications », si une URL d&apos;app est déclarée), Axi affiche <C>/app/&#123;storeId&#125;/applications/&#123;slug&#125;/ouvrir</C> et charge dans le cadre :</P>
      <Code code={`https://mon-app.com/embed?shop=chez-aicha&host=${encodeURIComponent(BASE)}&session=axs1.eyJpc3Mi...`} />
      <Table
        head={["Paramètre", "Sens"]}
        rows={[
          [<C key="s">shop</C>, "Slug de la boutique. Indication seulement : ne faites confiance qu'au résultat de la vérification."],
          [<C key="h">host</C>, "Base d'Axi."],
          [<C key="t">session</C>, `Jeton de session (axs1.…), valable ${SESSION_TOKEN_TTL_SEC / 60} minutes, propre à votre app et au membre connecté.`],
        ]}
      />
      <UL>
        <li>L&apos;URL doit être en https (<C>http://localhost</C> accepté en développement) et d&apos;une autre origine qu&apos;Axi. Les paramètres déjà présents dans l&apos;URL sont conservés.</li>
        <li>Cadre isolé (<C>sandbox</C> : scripts, formulaires, fenêtres et téléchargements autorisés ; pas de navigation de la page parente), sans en-tête <C>Referer</C>.</li>
        <li>Les cookies d&apos;Axi ne vous sont jamais transmis : la session est le seul moyen d&apos;identifier la boutique et le membre.</li>
        <li>Votre serveur doit autoriser l&apos;encadrement : en-tête <C>{`Content-Security-Policy: frame-ancestors ${BASE}`}</C>.</li>
      </UL>

      <H2 id="verifier">Vérifier le jeton de session</H2>
      <P>Depuis votre serveur (jamais depuis le navigateur : il faut le <C>client_secret</C>) :</P>
      <Code
        code={`curl -s -X POST ${BASE}/api/apps/session/verify \\
  -u "$AXI_CLIENT_ID:$AXI_CLIENT_SECRET" \\
  -H "Content-Type: application/json" \\
  -d '{"token":"axs1.eyJpc3Mi..."}'`}
      />
      <Code
        label="Réponse 200"
        code={`{
  "active": true,
  "shop": "chez-aicha",
  "storeId": "clx...",
  "userId": "clu...",
  "appId": "cla...",
  "scopes": ["store:read", "catalog:read"],
  "iat": 1760000000,
  "exp": 1760000300
}`}
      />
      <H3>Refus</H3>
      <UL>
        <li><C>401 invalid_client</C> : identifiants de l&apos;app incorrects (ou app suspendue).</li>
        <li><C>401 invalid_token</C> : jeton faux, expiré, émis pour une autre app, app désinstallée, ou membre qui n&apos;a plus accès à la boutique.</li>
        <li><C>400 invalid_request</C> : corps illisible ou <C>token</C> manquant. <C>429 slow_down</C> : trop de requêtes.</li>
      </UL>

      <H2 id="session">Ouvrir votre propre session</H2>
      <OL>
        <li>Votre page reçoit <C>session</C>, l&apos;envoie à votre serveur, qui appelle <C>/api/apps/session/verify</C>.</li>
        <li>Si <C>active</C>, retrouvez les jetons OAuth enregistrés pour <C>shop</C> (obtenus à l&apos;installation).</li>
        <li>Ouvrez votre propre session (cookie <C>SameSite=None; Secure; Partitioned</C> pour fonctionner dans un cadre tiers), ou repassez le jeton à chaque requête.</li>
        <li>Le jeton expire en {SESSION_TOKEN_TTL_SEC / 60} minutes : à l&apos;expiration, le membre rouvre l&apos;app depuis Axi pour en obtenir un nouveau.</li>
      </OL>
      <Note>
        Pas d&apos;URL d&apos;app ? L&apos;application reste installable (intégration « invisible » par API et webhooks) mais n&apos;affiche aucune page dans l&apos;admin.
      </Note>
      <NextLink slug="exemple-node" />
    </>
  );
}
