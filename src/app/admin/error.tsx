"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { EmptyState } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[admin]", error);
  }, [error]);
  return (
    <EmptyState
      icon={AlertTriangle}
      title="Une erreur est survenue"
      description={error.digest ? `Référence : ${error.digest}` : "Réessayez dans un instant."}
      action={
        <Button variant="secondary" onClick={reset}>
          Réessayer
        </Button>
      }
    />
  );
}
