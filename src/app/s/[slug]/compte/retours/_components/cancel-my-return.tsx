"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { cancelMyReturn } from "@/lib/returns/actions";

export type Proof = { kind: "token"; token: string; slug?: string } | { kind: "session"; slug: string; reference: string };

/** Annulation d'une demande encore en attente (jeton de suivi ou session acheteur). */
export function CancelMyReturnButton({ proof, returnId }: { proof: Proof; returnId: string }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(cancelMyReturn, undefined);
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);
  return (
    <form
      action={action}
      className="mt-3"
      onSubmit={(e) => {
        if (!window.confirm("Annuler cette demande de retour ?")) e.preventDefault();
      }}
    >
      {proof.kind === "token" ? (
        <input type="hidden" name="token" value={proof.token} />
      ) : (
        <>
          <input type="hidden" name="slug" value={proof.slug} />
          <input type="hidden" name="reference" value={proof.reference} />
        </>
      )}
      <input type="hidden" name="returnId" value={returnId} />
      {state && !state.ok && (
        <p className="mb-2 text-sm text-danger" role="alert">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className="inline-flex min-h-11 items-center text-sm font-medium text-ink-muted underline underline-offset-4 hover:text-ink disabled:opacity-50">
        Annuler ma demande
      </button>
    </form>
  );
}
