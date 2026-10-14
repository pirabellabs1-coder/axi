import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { appBaseUrl } from "@/lib/mcp/runtime";
import { formatScopes } from "@/lib/mcp/scopes";
import { appSigningSecret } from "@/lib/apps/install-signing";
import { db } from "@/lib/db";
import { Alert } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { CodeBlock } from "@/app/app/[storeId]/integrations/ia/code-block";
import { RegenerateSecretButton } from "../app-actions-panel";
import { MaskedSecret } from "./masked-secret";
import { loadAppTab } from "../_data";

export const metadata: Metadata = { title: "Identifiants" };

export default async function AppCredentialsPage({ params }: { params: Promise<{ storeId: string; appId: string }> }) {
  const { app, client, dev } = await loadAppTab(params);
  const base = appBaseUrl();
  const redirect = client?.redirectUris[0] ?? "https://votre-app.com/oauth/callback";
  const authorizeUrl =
    `${base}/oauth/authorize?response_type=code` +
    `&client_id=${encodeURIComponent(client?.clientId ?? "CLIENT_ID")}` +
    `&redirect_uri=${encodeURIComponent(redirect)}` +
    `&scope=${encodeURIComponent(formatScopes(app.requestedScopes))}` +
    `&state=ETAT_ALEATOIRE&code_challenge=CHALLENGE_S256&code_challenge_method=S256`;

  // Empreinte du client_secret lue ici seulement (jamais transmise au client) : le secret de signature en dérive.
  const secretHash = client
    ? (await db.oAuthClient.findUnique({ where: { clientId: client.clientId }, select: { clientSecretHash: true } }))?.clientSecretHash ?? null
    : null;
  let signingSecret: string | null = null;
  try {
    signingSecret = appSigningSecret(app.id, secretHash);
  } catch {
    signingSecret = null; // APP_SECRET absent : configuration serveur à corriger
  }

  if (!client) {
    return (
      <Alert tone="warning" title="Aucune identité OAuth">
        Cette application n&apos;a pas de client OAuth associé. Contactez le support Axi.
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Identifiants du client OAuth" description="Votre serveur s'en sert pour échanger le code d'autorisation contre des jetons. Le client_id est public ; le secret est confidentiel." />
        <CardBody className="space-y-4">
          <CodeBlock code={client.clientId} label="client_id (public)" />
          <div>
            <p className="mb-1.5 text-xs font-medium text-ink-muted">client_secret (confidentiel)</p>
            <p className="rounded-[var(--radius-md)] bg-surface-2 px-3 py-2.5 font-mono text-sm text-ink-muted ring-1 ring-inset ring-line">
              ••••••••••••••••  <span className="font-sans text-xs">(affiché une seule fois à la création ; Axi n&apos;en garde qu&apos;une empreinte)</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <RegenerateSecretButton appId={app.id} />
            <p className="flex items-start gap-1.5 text-xs text-ink-muted">
              <ShieldAlert className="mt-px size-4 shrink-0" aria-hidden /> Secret perdu ou exposé ? Régénérez-le : l&apos;ancien cesse aussitôt de fonctionner.
            </p>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Secret de signature"
          description="Vérifie le paramètre hmac de la redirection d'installation et la signature des webhooks de cycle de vie (en-tête Axi-Webhook-Signature). Confidentiel : à garder côté serveur."
        />
        <CardBody>
          {signingSecret ? (
            <div className="space-y-3">
              <MaskedSecret value={signingSecret} label="Secret de signature (whsec_…)" />
              <ul className="list-disc space-y-1 pl-5 text-sm text-ink-muted">
                <li>Vérifier le paramètre <code className="font-mono">hmac</code> de la redirection d&apos;installation (tous les paramètres sauf hmac, triés par nom puis réencodés comme une query string).</li>
                <li>Vérifier l&apos;en-tête <code className="font-mono">Axi-Webhook-Signature</code> des webhooks de cycle de vie (t + &quot;.&quot; + corps brut).</li>
                <li>Régénérer le client_secret renouvelle aussi ce secret : mettez les deux à jour ensemble sur votre serveur. Gardez-le côté serveur.</li>
              </ul>
            </div>
          ) : (
            <p className="text-sm text-danger">Secret indisponible : configuration du serveur Axi incomplète. Contactez le support.</p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Adresses de redirection autorisées"
          description={<>Axi ne renvoie le marchand qu&apos;à l&apos;une de ces adresses (correspondance exacte). Modifiables dans l&apos;onglet <Link href={`${dev}/apps/${app.id}/configuration`} className="font-medium text-primary-deep underline">Configuration</Link>.</>}
        />
        <CardBody>
          {client.redirectUris.length ? (
            <ul className="space-y-1.5">
              {client.redirectUris.map((u) => (
                <li key={u} className="break-all rounded-[var(--radius-md)] bg-surface-2 px-3 py-2 font-mono text-sm text-ink ring-1 ring-inset ring-line">{u}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-muted">Aucune adresse déclarée.</p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Points d'accès" description="L'installation par le marchand envoie le code à votre première adresse de redirection ; votre serveur l'échange sur le point de jeton." />
        <CardBody className="space-y-4">
          <CodeBlock code={authorizeUrl} label="Reconnexion à l'initiative de l'app (PKCE) : remplacez state et code_challenge" />
          <CodeBlock code={`${base}/api/oauth/token`} label="Point de jeton (POST, depuis votre serveur)" />
          <CodeBlock code={`${base}/.well-known/oauth-authorization-server`} label="Métadonnées du serveur d'autorisation (RFC 8414)" />
          <Link href={`${dev}/docs/oauth`} className="inline-flex min-h-11 items-center text-sm font-medium text-primary-deep hover:underline">
            Lire le guide OAuth
          </Link>
        </CardBody>
      </Card>
    </div>
  );
}
