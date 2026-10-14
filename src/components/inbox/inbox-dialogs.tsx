"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageSquarePlus, Zap, Trash2 } from "lucide-react";
import { startConversation, saveQuickReply, deleteQuickReply } from "@/lib/inbox/actions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/misc";
import { FormMessage, fieldError } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { toast } from "@/components/ui/toast";
import type { QuickReplyDTO } from "./composer";

export function NewConversationButton({ storeId, label = "Nouvelle conversation", variant = "primary" }: { storeId: string; label?: string; variant?: "primary" | "outline" }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(startConversation, undefined);
  const router = useRouter();
  useEffect(() => {
    if (state?.ok && state.data?.id) {
      setOpen(false);
      router.push(`/app/${storeId}/conversations?c=${state.data.id}`);
    }
  }, [state, router, storeId]);
  return (
    <>
      <Button size="sm" variant={variant} onClick={() => setOpen(true)} aria-haspopup="dialog">
        <MessageSquarePlus className="size-4" aria-hidden /> {label}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Nouvelle conversation" description="Ouvrez un fil avec un client à partir de son numéro WhatsApp." size="sm">
        <form action={action} className="space-y-4" noValidate>
          <input type="hidden" name="storeId" value={storeId} />
          <FormMessage state={state} toastSuccess={false} />
          <Field id="nc-phone" label="Numéro WhatsApp" required error={fieldError(state, "phone")} hint="Format local ou international, ex. 97 00 00 00">
            {(p) => <Input {...p} name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="01 97 00 00 00" />}
          </Field>
          <Field id="nc-name" label="Nom du client" hint="Facultatif : repris de la fiche client si elle existe.">
            {(p) => <Input {...p} name="name" maxLength={80} autoComplete="off" />}
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <SubmitButton>Ouvrir la conversation</SubmitButton>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function QuickRepliesButton({ storeId, replies, canManage }: { storeId: string; replies: QuickReplyDTO[]; canManage: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(saveQuickReply, undefined);
  const [pending, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      router.refresh();
    }
  }, [state, router]);

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <Zap className="size-4" aria-hidden /> Réponses rapides
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Réponses rapides" description="Tapez / dans le composer pour les insérer. Variables : {prenom}, {boutique}." size="lg">
        {replies.length === 0 ? (
          <EmptyState icon={Zap} title="Aucune réponse rapide" description="Enregistrez vos réponses fréquentes : horaires, moyens de paiement, délais de livraison." className="py-8 ring-0" />
        ) : (
          <ul className="divide-y divide-line rounded-[var(--radius-md)] ring-1 ring-line">
            {replies.map((r) => (
              <li key={r.id} className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-xs font-semibold text-primary">/{r.shortcut}</p>
                  <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink-muted">{r.body}</p>
                </div>
                {canManage && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Supprimer /${r.shortcut}`}
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const res = await deleteQuickReply(storeId, r.id);
                        if (res.ok) {
                          toast.success(res.message ?? "Supprimée");
                          router.refresh();
                        } else toast.error(res.error);
                      })
                    }
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {canManage ? (
          <form ref={formRef} action={action} className="mt-5 space-y-4 rounded-[var(--radius-md)] bg-surface-2/60 p-4" noValidate>
            <p className="text-sm font-semibold text-ink">Ajouter ou modifier</p>
            <input type="hidden" name="storeId" value={storeId} />
            <FormMessage state={state} />
            <Field id="qr-shortcut" label="Raccourci" required error={fieldError(state, "shortcut")} hint="Même raccourci = mise à jour. Ex. horaires, paiement, livraison.">
              {(p) => <Input {...p} name="shortcut" maxLength={25} autoComplete="off" placeholder="horaires" />}
            </Field>
            <Field id="qr-body" label="Texte" required error={fieldError(state, "body")}>
              {(p) => <Textarea {...p} name="body" maxLength={1000} placeholder="Bonjour {prenom}, nous sommes ouverts du lundi au samedi de 8 h à 19 h." />}
            </Field>
            <div className="flex justify-end">
              <SubmitButton size="sm">Enregistrer</SubmitButton>
            </div>
          </form>
        ) : (
          <p className="mt-4 text-sm text-ink-muted">Seuls le propriétaire et les gérants peuvent modifier les réponses rapides.</p>
        )}
      </Dialog>
    </>
  );
}
