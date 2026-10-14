"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Rocket, Copy, Check } from "lucide-react";
import { publishStore } from "@/lib/store/actions";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

export function PublishPanel({ storeId, ready }: { storeId: string; ready: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const publish = () =>
    start(async () => {
      setError(null);
      const res = await publishStore(storeId);
      if (res.ok) {
        toast.success("Boutique publiée", "Vos clients peuvent maintenant commander.");
        router.refresh();
      } else {
        setError(res.error);
      }
    });

  return (
    <div className="space-y-3">
      <Button variant="accent" onClick={publish} loading={pending} trailing={Rocket} aria-describedby={error ? "publish-error" : !ready ? "publish-hint" : undefined}>
        Publier ma boutique
      </Button>
      {!ready && !error && (
        <p id="publish-hint" className="text-xs text-ink-muted">
          Il manque encore des étapes. En cliquant, nous vous indiquerons précisément ce qui reste à faire.
        </p>
      )}
      {error && (
        <Alert tone="danger">
          <span id="publish-error">{error}</span>
        </Alert>
      )}
    </div>
  );
}

/** Lien public de la boutique avec bouton copier. */
export function ShareLink({ url, className }: { url: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Lien copié");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Copie impossible", "Sélectionnez le lien et copiez-le manuellement.");
    }
  };

  return (
    <div className={cn("flex items-center gap-2 rounded-full bg-surface-2 p-1 pl-4 ring-1 ring-inset ring-line", className)}>
      <input
        readOnly
        value={url}
        aria-label="Lien de la boutique"
        onFocus={(e) => e.currentTarget.select()}
        className="h-10 min-w-0 flex-1 bg-transparent font-mono text-[13px] text-ink outline-none"
      />
      <Button variant="primary" size="sm" onClick={copy} className="h-10 shrink-0">
        {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
        <span aria-live="polite">{copied ? "Copié" : "Copier"}</span>
      </Button>
    </div>
  );
}
