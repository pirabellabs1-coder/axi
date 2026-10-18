"use client";

import { useActionState, useState } from "react";
import { updateAccountSettings } from "@/lib/buyer/merchant-actions";
import { Field, Switch, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage, fieldError } from "@/components/forms/form-message";
import { cn } from "@/lib/utils";

const CHANNELS = [
  { value: "store_whatsapp", title: "WhatsApp de votre boutique", text: "Le code part de votre numéro WhatsApp Business (1 crédit WhatsApp utilitaire par code, remboursé si l'envoi échoue). Sans crédit disponible ou si l'envoi échoue, le code n'est pas envoyé : gardez des crédits WhatsApp. L'expéditeur Axi n'est utilisé que si votre WhatsApp Business n'est pas connecté." },
  { value: "platform", title: "Expéditeur Axi", text: "Le code part du numéro Axi (sans crédit), ou par e-mail pour les clients qui ont vérifié leur adresse." },
] as const;

export function AccountsForm({ storeId, initial, whatsappActive, welcomeMax, paidPlan, freeDailyQuota }: { storeId: string; paidPlan: boolean; freeDailyQuota: number; initial: { accountsEnabled: boolean; channel: "store_whatsapp" | "platform"; welcomeText: string }; whatsappActive: boolean; welcomeMax: number }) {
  const [state, action] = useActionState(updateAccountSettings, undefined);
  const [enabled, setEnabled] = useState(initial.accountsEnabled);
  const [channel, setChannel] = useState(initial.channel);
  return (
    <form action={action} className="space-y-6" noValidate>
      <input type="hidden" name="storeId" value={storeId} />
      <FormMessage state={state} />
      <div>
        <Switch name="accountsEnabled" checked={enabled} onChange={setEnabled} label="Proposer un compte client sur ma boutique" />
        <p className="mt-1.5 text-sm text-ink-muted">Vos clients se connectent avec un code reçu sur WhatsApp. La commande sans compte reste toujours possible.</p>
      </div>

      <fieldset disabled={!enabled} className="space-y-6 disabled:opacity-60">
        <div>
          <legend className="mb-2 text-sm font-medium text-ink">Envoi du code de connexion</legend>
          <div className="grid gap-3 md:grid-cols-2">
            {CHANNELS.map((c) => (
              <label key={c.value} className={cn("flex min-h-11 cursor-pointer gap-3 rounded-[var(--radius-md)] p-4 ring-1 ring-inset transition-shadow", channel === c.value ? "bg-primary-soft ring-2 ring-primary" : "ring-line hover:bg-surface-2")}>
                <input type="radio" name="channel" value={c.value} checked={channel === c.value} onChange={() => setChannel(c.value)} className="mt-0.5 size-5 shrink-0 accent-[var(--c-primary)]" />
                <span>
                  <span className="block text-sm font-semibold text-ink">{c.title}</span>
                  <span className="mt-0.5 block text-[13px] leading-relaxed text-ink-muted">{c.text}</span>
                  {c.value === "store_whatsapp" && !whatsappActive && (
                    <span className="mt-1.5 block text-[13px] font-medium text-warning">
                      WhatsApp Business n&apos;est pas connecté : l&apos;expéditeur Axi sera utilisé.
                    </span>
                  )}
                  {c.value === "platform" && !paidPlan && (
                    <span className="mt-1.5 block text-[13px] text-ink-muted">
                      Sans plan actif : {freeDailyQuota} codes par jour.{" "}
                      <a href={`/app/${storeId}/abonnement`} className="font-semibold text-primary underline underline-offset-4">
                        Voir les plans
                      </a>
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
        </div>

        <Field id="welcomeText" label="Texte d'accueil de la page de connexion" hint={`Facultatif, ${welcomeMax} caractères maximum. Exemple : « Retrouvez vos commandes et cumulez vos points. »`} error={fieldError(state, "welcomeText")}>
          {(p) => <Textarea {...p} name="welcomeText" rows={3} maxLength={welcomeMax} defaultValue={initial.welcomeText} />}
        </Field>
      </fieldset>
      {/* Le fieldset désactivé n'envoie rien : on transmet le canal courant pour ne pas le perdre. */}
      {!enabled && <input type="hidden" name="channel" value={channel} />}
      {!enabled && <input type="hidden" name="welcomeText" value={initial.welcomeText} />}

      <SubmitButton>Enregistrer</SubmitButton>
    </form>
  );
}
