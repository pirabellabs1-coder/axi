"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Check, AlertTriangle, Lock, Trash2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Alert } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { installApp, uninstallApp, cancelAppSubscription } from "@/lib/apps/actions";
import { formatBillingStatus } from "@/lib/apps/billing";
import { cn } from "@/lib/utils";

export type ScopeView = { key: string; label: string; description: string; write: boolean; granted: boolean };

/** Bouton « Installer » + écran de confirmation des permissions, ou bouton « Désinstaller » si déjà installée. */
export function InstallControls({
  storeId,
  slug,
  appName,
  installed,
  installationId,
  scopes,
  canManage,
  billingStatus = null,
  trialEndsLabel = null,
}: {
  storeId: string;
  slug: string;
  appName: string;
  installed: boolean;
  installationId: string | null;
  scopes: ScopeView[];
  canManage: boolean;
  billingStatus?: string | null;
  trialEndsLabel?: string | null;
}) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [pending, start] = useTransition();
  const limited = scopes.filter((s) => !s.granted);
  const canCancel = billingStatus === "trialing" || billingStatus === "active" || billingStatus === "past_due";
  const showBilling = billingStatus !== null && billingStatus !== "none";

  const runCancel = () =>
    start(async () => {
      if (!installationId) return;
      const r = await cancelAppSubscription(storeId, installationId);
      if (r.ok) {
        toast.success(r.message ?? "Abonnement annulé.");
        setCancelOpen(false);
        router.refresh();
      } else {
        toast.error(r.error);
      }
    });

  const runInstall = () =>
    start(async () => {
      const r = await installApp(storeId, slug);
      if (r.ok) {
        toast.success(r.message ?? "Application installée.");
        // App externe avec OAuth : l'app reçoit le code d'autorisation sur son serveur (redirection signée).
        if (r.data?.redirectUrl) {
          window.location.assign(r.data.redirectUrl);
          return;
        }
        setConfirmOpen(false);
        router.refresh();
      } else {
        toast.error(r.error);
      }
    });

  const runUninstall = () =>
    start(async () => {
      if (!installationId) return;
      const r = await uninstallApp(storeId, installationId);
      if (r.ok) {
        toast.success(r.message ?? "Application désinstallée.");
        setConfirmOpen(false);
        router.refresh();
      } else {
        toast.error(r.error);
      }
    });

  if (!canManage) {
    return (
      <p className="inline-flex items-center gap-1.5 text-sm text-ink-muted">
        <Lock className="size-4" aria-hidden /> Seul le propriétaire de la boutique peut installer des applications.
      </p>
    );
  }

  if (installed) {
    return (
      <div className="flex flex-col items-start gap-3">
        <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-3.5 py-2 text-sm font-medium text-primary-deep">
          <Check className="size-4" aria-hidden /> Installée
        </span>
        {canCancel && (
          <Button variant="outline" onClick={() => setCancelOpen(true)}>
            Annuler l&apos;abonnement
          </Button>
        )}
        <Button variant="outline" onClick={() => setConfirmOpen(true)} className="text-danger">
          <Trash2 className="size-4" aria-hidden /> Désinstaller
        </Button>
        {showBilling && (
          <span className="text-sm text-ink-muted">
            Facturation : <span className="font-medium text-ink">{formatBillingStatus(billingStatus)}</span>
            {billingStatus === "trialing" && trialEndsLabel ? ` · fin d'essai le ${trialEndsLabel}` : ""}
          </span>
        )}
        <Dialog
          open={cancelOpen}
          onClose={() => setCancelOpen(false)}
          title={`Annuler l'abonnement de « ${appName} » ?`}
          description="L'application reste installée et utilisable, mais ne sera plus facturée. Vous pourrez la désinstaller à tout moment."
          size="sm"
          footer={
            <>
              <button type="button" onClick={() => setCancelOpen(false)} className="h-10 rounded-full px-4 text-sm font-medium text-ink hover:bg-surface-2">
                Revenir
              </button>
              <Button size="sm" loading={pending} onClick={runCancel}>
                Annuler l&apos;abonnement
              </Button>
            </>
          }
        >
          <p className="text-sm text-ink-muted">Le renouvellement est stoppé immédiatement.</p>
        </Dialog>
        <Dialog
          open={confirmOpen}
          onClose={() => setConfirmOpen(false)}
          title={`Désinstaller « ${appName} » ?`}
          description="L'application perd immédiatement l'accès à votre boutique. Vous pourrez la réinstaller plus tard."
          size="sm"
          footer={
            <>
              <button type="button" onClick={() => setConfirmOpen(false)} className="h-10 rounded-full px-4 text-sm font-medium text-ink hover:bg-surface-2">
                Annuler
              </button>
              <Button variant="danger" size="sm" loading={pending} onClick={runUninstall}>
                Désinstaller
              </Button>
            </>
          }
        >
          <p className="text-sm text-ink-muted">Les autorisations accordées seront révoquées.</p>
        </Dialog>
        </div>
      </div>
    );
  }

  return (
    <>
      <Button onClick={() => setConfirmOpen(true)} loading={pending}>
        <Download className="size-4" aria-hidden /> Installer
      </Button>
      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={`Installer « ${appName} »`}
        description="Cette application pourra accéder aux données suivantes de votre boutique :"
        size="md"
        footer={
          <>
            <button type="button" onClick={() => setConfirmOpen(false)} className="h-10 rounded-full px-4 text-sm font-medium text-ink hover:bg-surface-2">
              Annuler
            </button>
            <Button loading={pending} onClick={runInstall}>
              Autoriser et installer
            </Button>
          </>
        }
      >
        <ul className="space-y-2.5">
          {scopes.map((s) => (
            <li key={s.key} className={cn("flex items-start gap-3 rounded-[var(--radius-md)] p-3 ring-1 ring-inset", s.granted ? "bg-surface-2 ring-line" : "bg-sun-soft/40 ring-sun/30")}>
              <ShieldCheck className={cn("mt-0.5 size-4 shrink-0", s.write ? "text-accent" : "text-primary")} aria-hidden />
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">
                  {s.label}
                  <span className="ml-2 align-middle text-[11px] font-normal text-ink-muted">{s.write ? "écriture" : "lecture"}</span>
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{s.description}</p>
                {!s.granted && (
                  <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-[#8a5a00] dark:text-sun">
                    <AlertTriangle className="size-3" aria-hidden /> Limitée par votre plan actuel
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
        {limited.length > 0 && (
          <Alert tone="warning" className="mt-4">
            Certaines autorisations seront limitées selon votre plan : l&apos;application fonctionnera avec les accès disponibles.
          </Alert>
        )}
      </Dialog>
    </>
  );
}
