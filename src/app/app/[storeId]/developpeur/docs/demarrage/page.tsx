import type { Metadata } from "next";
import { DevLink } from "@/app/app/[storeId]/developpeur/_components/dev-link";
import { appBaseUrl } from "@/lib/mcp/runtime";
import { C, Code, DocTitle, H2, NextLink, Note, OL, P, UL } from "../_ui";

export const metadata: Metadata = { title: "Démarrage rapide" };

export default function QuickstartPage() {
  const BASE = appBaseUrl();
  return (
    <>
      <DocTitle
        title="Démarrage rapide"
        lead="En 15 minutes : créer l'application, la relier à votre serveur, l'installer en test sur votre boutique et faire un premier appel."
      />

      <H2 id="modele">Le modèle : votre app vit chez vous</H2>
      <P>Axi n&apos;héberge pas le code des applications. Comme sur Shopify, votre application est un service web à vous :</P>
      <UL>
        <li><strong>Votre serveur</strong> (Node, PHP, Python…) détient le <C>client_secret</C>, mène le flux OAuth et stocke les jetons de chaque boutique.</li>
        <li><strong>Axi</strong> authentifie le marchand, lui demande son consentement, puis vous délivre des jetons limités aux autorisations (scopes) accordées.</li>
        <li><strong>L&apos;admin du marchand</strong> affiche votre page (URL de l&apos;app) dans l&apos;espace Applications de sa boutique.</li>
      </UL>

      <H2 id="etapes">Les étapes</H2>
      <OL>
        <li>
          <DevLink to="/apps/nouvelle" className="font-medium text-primary-deep underline">Créez une application</DevLink> : nom, identifiant, autorisations,
          adresse de redirection OAuth (par exemple <C>https://mon-app.com/oauth/callback</C> ou <C>http://localhost:4000/oauth/callback</C> en développement).
          Copiez le <C>client_secret</C> : il ne s&apos;affiche qu&apos;une fois.
        </li>
        <li>Dans l&apos;onglet <strong>Configuration</strong>, renseignez l&apos;URL de l&apos;app (page https affichée dans l&apos;admin) et, si besoin, l&apos;URL de webhook.</li>
        <li>Lancez votre serveur (voir l&apos;<DevLink to="/docs/exemple-node" className="font-medium text-primary-deep underline">exemple Node complet</DevLink>) avec vos identifiants.</li>
        <li>Dans l&apos;onglet <strong>Tests</strong>, installez l&apos;app en test sur votre boutique : aucune facturation, même en brouillon.</li>
        <li>Ouvrez l&apos;app depuis l&apos;admin de la boutique, faites l&apos;autorisation OAuth et appelez l&apos;API.</li>
        <li>Quand tout fonctionne, soumettez l&apos;app à la revue (onglet <strong>Statut et revue</strong>).</li>
      </OL>

      <H2 id="variables">Variables de votre serveur</H2>
      <Code
        label=".env (côté serveur uniquement)"
        code={`AXI_BASE_URL=${BASE}
AXI_CLIENT_ID=axi_cli_...
AXI_CLIENT_SECRET=axi_cs_...        # ne jamais l'exposer au navigateur
AXI_REDIRECT_URI=http://localhost:4000/oauth/callback
AXI_SCOPES=store:read catalog:read`}
      />
      <Note title="Plan de la boutique.">
        La connexion OAuth (jetons d&apos;application) est disponible pour les boutiques au plan <strong>Business</strong> ou supérieur, et le
        marchand qui autorise doit être propriétaire ou gérant. Les autorisations réellement accordées sont toujours bornées par le plan.
      </Note>
      <NextLink slug="oauth" />
    </>
  );
}
