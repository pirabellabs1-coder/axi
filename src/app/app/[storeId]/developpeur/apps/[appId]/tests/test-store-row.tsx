"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, FlaskConical, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { formatDate } from "@/lib/utils";
import { installAppForTesting, uninstallTestInstall } from "@/lib/apps/dev-actions";

export type TestRowState = "none" | "test" | "live";

/** Une boutique éligible : installer / retirer l'installation de test, ouvrir l'app dans l'admin. */
export function TestStoreRow({
  appId, appSlug, store, state, installedAt, grantedCount, requestedCount,
}: {
  appId: string;
  appSlug: string;
  store: { id: string; name: string; slug: string; via: "membership" | "collaborator" };
  state: TestRowState;
  installedAt: string | null;
  grantedCount: number;
  requestedCount: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);
  const openHref = `/app/${store.id}/applications/${appSlug}`;

  const install = () =>
    start(async () => {
      const r = await installAppForTesting(appId, store.id);
      if (r.ok) {
        toast.success(r.message ?? "Installée en test");
        if (r.data?.redirectUrl) setRedirectUrl(r.data.redirectUrl);
        router.refresh();
      } else toast.error(r.error);
    });
  const uninstall = () =>
    start(async () => {
      const r = await uninstallTestInstall(appId, store.id);
      if (r.ok) {
        toast.success(r.message ?? "Retirée");
        router.refresh();
      } else toast.error(r.error);
    });

  return (
    <li className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
          <span className="truncate">{store.name}</span>
          {store.via === "collaborator" && <Badge tone="info">Collaborateur</Badge>}
          {state === "test" && <Badge tone="accent" dot>Installée en test</Badge>}
          {state === "live" && <Badge tone="success" dot>Installation réelle</Badge>}
        </p>
        <p className="mt-0.5 text-xs text-ink-muted">
          <span className="font-mono">{store.slug}</span>
          {installedAt && <> · depuis le {formatDate(installedAt)}</>}
          {state !== "none" && grantedCount < requestedCount && <> · {grantedCount}/{requestedCount} autorisations (limitées par le plan)</>}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {state === "none" && (
          <Button onClick={install} loading={pending} size="sm" className="min-h-11">
            <FlaskConical className="size-4" aria-hidden /> Installer en test
          </Button>
        )}
        {state !== "none" && (
          <Link href={openHref} className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-sm font-medium text-ink ring-1 ring-inset ring-line-strong hover:bg-surface-2">
            <ExternalLink className="size-4" aria-hidden /> Ouvrir dans la boutique
          </Link>
        )}
        {state === "test" && (
          <Button onClick={uninstall} loading={pending} variant="ghost" size="sm" className="min-h-11">
            <Trash2 className="size-4" aria-hidden /> Désinstaller
          </Button>
        )}
      </div>
      <Dialog
        open={!!redirectUrl}
        onClose={() => setRedirectUrl(null)}
        title="Terminer l'installation sur votre serveur"
        description="Comme pour un marchand, Axi renvoie vers votre adresse de redirection avec un code d'installation signé (valable 60 secondes, usage unique)."
        footer={
          <>
            <Button variant="ghost" onClick={() => setRedirectUrl(null)}>Plus tard</Button>
            {redirectUrl && (
              <a href={redirectUrl} className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-medium text-on-primary hover:bg-primary-hover">
                <ExternalLink className="size-4" aria-hidden /> Ouvrir mon application
              </a>
            )}
          </>
        }
      >
        <p className="text-sm text-ink-muted">
          Votre serveur vérifie le paramètre <code className="font-mono">hmac</code>, puis échange le <code className="font-mono">code</code> contre des jetons sur
          <code className="font-mono"> /api/oauth/token</code>. Votre serveur n&apos;est pas démarré ? Fermez cette fenêtre : vous pourrez désinstaller puis réinstaller pour obtenir un nouveau code.
        </p>
      </Dialog>
    </li>
  );
}
