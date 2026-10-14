"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { Check, X, RotateCcw, MessageSquareReply } from "lucide-react";
import type { ReviewStatus } from "@prisma/client";
import { moderateReview, replyToReview } from "@/lib/reviews/actions";
import { ActionButton } from "@/components/app/action-controls";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/forms/submit-button";
import { toast } from "@/components/ui/toast";

export function ModerationButtons({ storeId, id, status }: { storeId: string; id: string; status: ReviewStatus }) {
  return (
    <div className="flex flex-wrap gap-2">
      {status !== "APPROVED" && (
        <ActionButton size="sm" action={() => moderateReview(storeId, id, "APPROVED")}>
          <Check className="size-4" aria-hidden /> Publier
        </ActionButton>
      )}
      {status !== "REJECTED" && (
        <ActionButton size="sm" variant="outline" action={() => moderateReview(storeId, id, "REJECTED")}>
          <X className="size-4" aria-hidden /> Refuser
        </ActionButton>
      )}
      {status !== "PENDING" && (
        <ActionButton size="sm" variant="ghost" action={() => moderateReview(storeId, id, "PENDING")}>
          <RotateCcw className="size-4" aria-hidden /> Remettre en attente
        </ActionButton>
      )}
    </div>
  );
}

export function ReplyForm({ storeId, id, reply }: { storeId: string; id: string; reply: string | null }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(replyToReview, undefined);
  const fid = useId();
  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success(state.message ?? "Enregistré");
      setOpen(false);
    } else toast.error(state.error);
  }, [state]);

  if (!open) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <MessageSquareReply className="size-4" aria-hidden /> {reply ? "Modifier la réponse" : "Répondre publiquement"}
      </Button>
    );
  }
  return (
    <form action={action} className="mt-3 w-full space-y-2">
      <input type="hidden" name="storeId" value={storeId} />
      <input type="hidden" name="reviewId" value={id} />
      <label htmlFor={fid} className="text-sm font-medium text-ink">
        Réponse publique de la boutique
      </label>
      <Textarea id={fid} name="reply" defaultValue={reply ?? ""} maxLength={1000} rows={3} placeholder="Merci pour votre retour !" autoFocus />
      <p className="text-xs text-ink-muted">Visible sous l&apos;avis dans votre boutique. Laissez vide pour retirer la réponse.</p>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Annuler
        </Button>
        <SubmitButton size="sm">Publier la réponse</SubmitButton>
      </div>
    </form>
  );
}
