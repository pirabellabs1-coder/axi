import { Unplug } from "lucide-react";
import { db } from "@/lib/db";
import { socialLoginConfig, metaAppSecret } from "@/lib/meta-social/config";
import { disconnectSocialAccount } from "@/lib/meta-social/actions";
import { GRAPH_VERSION } from "@/lib/social/graph-client";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/misc";
import { ConfirmActionButton } from "@/components/app/action-controls";
import { SocialConnectButton } from "./social-connect";

/**
 * Comptes Facebook / Instagram reliés à la boutique pour le « commenter pour acheter ». Aucun jeton n'est lu ici
 * (seulement nom, plateforme, statut). Sans configuration Meta côté plateforme, l'écran explique ce qui manque.
 */
export async function SocialAccountsCard({ storeId, canManage }: { storeId: string; canManage: boolean }) {
  const accounts = await db.socialAccount.findMany({
    where: { storeId },
    orderBy: [{ pageId: "asc" }, { platform: "asc" }],
    select: { id: true, platform: true, name: true, status: true, lastError: true },
  });
  const cfg = socialLoginConfig();
  const ready = !!cfg && !!metaAppSecret();

  return (
    <Card>
      <CardHeader
        title="Commenter pour acheter"
        description="Vos spectateurs commentent « JP 12 » sur Facebook ou Instagram : l'article est réservé et un lien de paiement leur est envoyé en message privé."
      />
      <CardBody className="space-y-4">
        {accounts.length > 0 && (
          <ul className="divide-y divide-line rounded-[var(--radius-md)] ring-1 ring-line">
            {accounts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-sm font-medium text-ink">
                    {a.name}
                    <Badge tone="neutral">{a.platform === "FACEBOOK" ? "Page Facebook" : "Instagram"}</Badge>
                    {a.status === "active" ? <Badge tone="success">Actif</Badge> : <Badge tone="danger">À reconnecter</Badge>}
                  </span>
                  {a.status !== "active" && a.lastError && <span className="mt-0.5 block text-xs text-ink-muted">{a.lastError}</span>}
                </span>
                {canManage && a.platform === "FACEBOOK" && (
                  <ConfirmActionButton
                    action={disconnectSocialAccount.bind(null, storeId, a.id)}
                    className="min-h-11"
                    title="Déconnecter cette Page ?"
                    description="La Page et son compte Instagram lié ne réserveront plus d'articles. Les réservations existantes sont conservées."
                    confirmLabel="Déconnecter"
                  >
                    <Unplug className="size-4" aria-hidden />
                    <span className="sr-only">Déconnecter {a.name}</span>
                  </ConfirmActionButton>
                )}
              </li>
            ))}
          </ul>
        )}

        {!ready ? (
          <Alert tone="info" title="Connexion Facebook / Instagram bientôt disponible">
            La plateforme Axi doit encore activer la connexion Meta (configuration Facebook Login for Business). Vos directs fonctionnent déjà ; les réservations
            par commentaire s&apos;activeront dès que ce sera fait.
          </Alert>
        ) : canManage ? (
          <SocialConnectButton storeId={storeId} appId={cfg!.appId} configId={cfg!.configId} version={GRAPH_VERSION} connected={accounts.length > 0} />
        ) : (
          <p className="text-sm text-ink-muted">Seul un responsable des intégrations de la boutique peut connecter une Page.</p>
        )}
      </CardBody>
    </Card>
  );
}
