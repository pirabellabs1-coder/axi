"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCw, Send, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, ConfirmButton } from "@/components/ui/dialog";
import { Alert } from "@/components/ui/misc";
import { CodeBlock } from "@/app/app/[storeId]/integrations/ia/code-block";
import { toast } from "@/components/ui/toast";
import { submitApp, regenerateClientSecret } from "@/lib/apps/dev-actions";

/** Soumission à la revue (brouillon uniquement). */
export function SubmitAppButton({ appId, disabled }: { appId: string; disabled?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const submit = () =>
    start(async () => {
      const r = await submitApp(appId);
      if (r.ok) {
        toast.success(r.message ?? "Soumise");
        router.refresh();
      } else toast.error(r.error);
    });
  return (
    <Button onClick={submit} loading={pending} disabled={disabled}>
      <Send className="size-4" aria-hidden /> Soumettre à la revue
    </Button>
  );
}

/** Régénération du secret client (affiché une seule fois). */
export function RegenerateSecretButton({ appId }: { appId: string }) {
  const router = useRouter();
  const [secret, setSecret] = useState<string | null>(null);

  const regenerate = async () => {
    const r = await regenerateClientSecret(appId);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    setSecret(r.data!.clientSecret);
    router.refresh();
  };

  return (
    <>
      <ConfirmButton
        title="Régénérer le secret client ?"
        description="Le secret actuel cessera immédiatement de fonctionner. Le nouveau s'affiche une seule fois ; mettez à jour votre serveur ensuite."
        confirmLabel="Régénérer"
        tone="primary"
        onConfirm={regenerate}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-sm font-medium text-ink ring-1 ring-inset ring-line-strong hover:bg-surface-2"
      >
        <RotateCw className="size-4" aria-hidden /> Régénérer le secret
      </ConfirmButton>

      <Dialog
        open={!!secret}
        onClose={() => setSecret(null)}
        title="Nouveau secret client"
        description="Copiez-le maintenant : il ne sera plus jamais affiché."
        size="lg"
        footer={<Button onClick={() => setSecret(null)}>J&apos;ai copié le secret</Button>}
      >
        {secret && (
          <div className="space-y-4">
            <Alert tone="warning" title="Secret affiché une seule fois">
              L&apos;ancien secret est désormais invalide. Mettez à jour votre serveur avec ce nouveau secret.
            </Alert>
            <CodeBlock code={secret} label="Client secret (confidentiel)" />
            <p className="flex items-start gap-2 text-xs text-ink-muted">
              <ShieldAlert className="mt-px size-4 shrink-0" aria-hidden /> Ne le placez jamais dans un navigateur, une app mobile ni un dépôt public.
            </p>
          </div>
        )}
      </Dialog>
    </>
  );
}
