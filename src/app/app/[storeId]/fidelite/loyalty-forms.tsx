"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { saveLoyaltyConfig, adjustLoyaltyPoints } from "@/lib/loyalty/actions";
import type { LoyaltyConfig } from "@/lib/loyalty/config";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Switch } from "@/components/ui/field";
import { FormMessage, fieldError } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";

export function LoyaltyConfigForm({ storeId, config, currency, baseLabel, canEdit }: { storeId: string; config: LoyaltyConfig; currency: string; baseLabel: string; canEdit: boolean }) {
  const [state, action] = useActionState(saveLoyaltyConfig, undefined);
  const [enabled, setEnabled] = useState(config.enabled);
  const zeroDecimal = currency === "XOF" || currency === "XAF";
  const rewardDisplay = zeroDecimal ? String(config.rewardValue) : (config.rewardValue / 100).toFixed(2).replace(".", ",");
  return (
    <form action={action} className="space-y-5" noValidate>
      <input type="hidden" name="storeId" value={storeId} />
      <input type="hidden" name="enabled" value={enabled ? "true" : "false"} />
      <FormMessage state={state} />
      <Switch checked={enabled} onChange={setEnabled} label={enabled ? "Programme activé" : "Programme désactivé"} disabled={!canEdit} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field id="lc-points" label="Points gagnés" hint={`Pour chaque tranche de ${baseLabel} dépensée.`} error={fieldError(state, "pointsPer1000")} required>
          {(p) => <Input {...p} name="pointsPer1000" type="number" inputMode="numeric" min={1} max={1000} defaultValue={config.pointsPer1000} disabled={!canEdit} />}
        </Field>
        <Field id="lc-threshold" label="Seuil de récompense" hint="Nombre de points à atteindre." error={fieldError(state, "rewardPoints")} required>
          {(p) => <Input {...p} name="rewardPoints" type="number" inputMode="numeric" min={1} defaultValue={config.rewardPoints} disabled={!canEdit} />}
        </Field>
        <Field id="lc-value" label={`Valeur de la récompense (${zeroDecimal ? "FCFA" : currency})`} hint="Remise offerte au seuil." error={fieldError(state, "rewardValue")} required>
          {(p) => <Input {...p} name="rewardValue" inputMode="decimal" defaultValue={rewardDisplay} disabled={!canEdit} />}
        </Field>
      </div>
      {canEdit ? (
        <div className="flex justify-end">
          <SubmitButton>Enregistrer</SubmitButton>
        </div>
      ) : (
        <p className="text-sm text-ink-muted">Seuls le propriétaire et les gérants peuvent modifier le programme.</p>
      )}
    </form>
  );
}

export function AdjustPointsButton({ storeId, customers, defaultCustomerId, rewardPoints, label = "Ajuster des points" }: { storeId: string; customers: { id: string; name: string; points: number }[]; defaultCustomerId?: string; rewardPoints: number; label?: string }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(adjustLoyaltyPoints, undefined);
  const [kind, setKind] = useState<"add" | "remove" | "reward">("add");
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) {
      setOpen(false);
      formRef.current?.reset();
    }
  }, [state]);
  return (
    <>
      <Button size="sm" variant={defaultCustomerId ? "ghost" : "outline"} onClick={() => setOpen(true)} aria-haspopup="dialog">
        <SlidersHorizontal className="size-4" aria-hidden /> {label}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Ajuster les points" description="Chaque ajustement est enregistré dans le journal d'audit avec son motif." size="sm">
        <form ref={formRef} action={action} className="space-y-4" noValidate>
          <input type="hidden" name="storeId" value={storeId} />
          <FormMessage state={state} />
          <Field id="adj-customer" label="Client" required error={fieldError(state, "customerId")}>
            {(p) => (
              <Select {...p} name="customerId" defaultValue={defaultCustomerId ?? ""}>
                {!defaultCustomerId && <option value="">Choisir un client</option>}
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.points} pts)
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="adj-kind" label="Opération" required>
            {(p) => (
              <Select {...p} name="kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                <option value="add">Ajouter des points</option>
                <option value="remove">Retirer des points</option>
                <option value="reward">Récompense utilisée (retire {rewardPoints} pts)</option>
              </Select>
            )}
          </Field>
          {kind === "reward" ? (
            <input type="hidden" name="points" value={rewardPoints} />
          ) : (
            <Field id="adj-points" label="Points" required error={fieldError(state, "points")}>
              {(p) => <Input {...p} name="points" type="number" inputMode="numeric" min={1} />}
            </Field>
          )}
          <Field id="adj-note" label="Motif" required error={fieldError(state, "note")} hint="Ex. geste commercial, erreur de saisie, récompense remise en boutique.">
            {(p) => <Input {...p} name="note" maxLength={200} defaultValue={kind === "reward" ? "Récompense utilisée" : ""} key={kind} />}
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <SubmitButton>Valider</SubmitButton>
          </div>
        </form>
      </Dialog>
    </>
  );
}
