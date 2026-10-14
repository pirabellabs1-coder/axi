"use client";

import { useEffect } from "react";
import type { ActionResult } from "@/lib/action";
import { Alert } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";

/** Affiche l'erreur globale d'une action ; les succès partent en toast. */
export function FormMessage({ state, toastSuccess = true }: { state?: ActionResult<unknown>; toastSuccess?: boolean }) {
  useEffect(() => {
    if (state?.ok && state.message && toastSuccess) toast.success(state.message);
  }, [state, toastSuccess]);
  if (!state || state.ok) return null;
  return (
    <Alert tone="danger" className="mb-4">
      {state.error}
    </Alert>
  );
}

export function fieldError(state: ActionResult<unknown> | undefined, name: string): string | undefined {
  if (!state || state.ok) return undefined;
  return state.fieldErrors?.[name]?.[0];
}
