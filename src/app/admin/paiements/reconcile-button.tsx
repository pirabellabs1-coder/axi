"use client";

import { useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { runReconciliation } from "@/lib/admin/actions";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

export function ReconcileButton() {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="secondary"
      size="sm"
      loading={pending}
      onClick={() =>
        start(async () => {
          const res = await runReconciliation();
          if (res.ok) toast.success(res.message ?? "Rapprochement terminé");
          else toast.error(res.error);
        })
      }
    >
      <RefreshCw className="size-4" aria-hidden /> Lancer le rapprochement
    </Button>
  );
}
