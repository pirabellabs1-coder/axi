"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createReturn } from "@/lib/returns/actions";
import { ITEM_CONDITIONS, RETURN_REASONS } from "@/lib/returns/policy";
import { formatMoney } from "@/lib/money";
import { Field, Input, Select, Textarea, Checkbox } from "@/components/ui/field";
import { FormMessage, fieldError } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";

export type CreatableItem = { id: string; name: string; variantName: string | null; unitPrice: number; remaining: number; returnable: boolean };

type Line = { orderItemId: string; quantity: number; restock: boolean; condition: keyof typeof ITEM_CONDITIONS };

export function CreateReturnForm({ storeId, orderId, items, currency }: { storeId: string; orderId: string; items: CreatableItem[]; currency: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"APPROVED" | "RECEIVED">("RECEIVED");
  const [lines, setLines] = useState<Line[]>(() => items.map((i) => ({ orderItemId: i.id, quantity: 0, restock: true, condition: "neuf" })));
  const [state, action] = useActionState(createReturn, undefined);
  useEffect(() => {
    if (state?.ok && state.data?.id) router.push(`/app/${storeId}/retours/${state.data.id}`);
  }, [state, router, storeId]);
  const set = (id: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.orderItemId === id ? { ...l, ...patch } : l)));

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="storeId" value={storeId} />
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="mode" value={mode} />
      <input type="hidden" name="items" value={JSON.stringify(lines.filter((l) => l.quantity > 0))} />
      <FormMessage state={state} />

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-ink">Articles rapportés</legend>
        <ul className="space-y-3">
          {items.map((it) => {
            const l = lines.find((x) => x.orderItemId === it.id)!;
            const disabled = !it.returnable || it.remaining === 0;
            return (
              <li key={it.id} className="rounded-[var(--radius-md)] bg-surface-2/60 p-3.5 ring-1 ring-inset ring-line">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 text-sm">
                    <p className="font-medium text-ink">{it.name}</p>
                    <p className="text-ink-muted">
                      {it.variantName ? `${it.variantName} · ` : ""}
                      {formatMoney(it.unitPrice, currency)} · {disabled ? (it.returnable ? "déjà retourné" : "non retournable") : `${it.remaining} retournable${it.remaining > 1 ? "s" : ""}`}
                    </p>
                  </div>
                  <Field id={`q-${it.id}`} label="Quantité" className="w-28">
                    {(p) => (
                      <Input
                        {...p}
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={it.remaining}
                        disabled={disabled}
                        value={l.quantity}
                        onChange={(e) => set(it.id, { quantity: Math.max(0, Math.min(it.remaining, Number(e.target.value) || 0)) })}
                      />
                    )}
                  </Field>
                </div>
                {mode === "RECEIVED" && l.quantity > 0 && (
                  <div className="mt-3 flex flex-wrap items-end gap-4">
                    <Field id={`c-${it.id}`} label="État" className="w-40">
                      {(p) => (
                        <Select {...p} value={l.condition} onChange={(e) => set(it.id, { condition: e.target.value as Line["condition"], restock: e.target.value === "abime" ? false : l.restock })}>
                          {Object.entries(ITEM_CONDITIONS).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                    <Checkbox label="Remettre en stock" checked={l.restock} onChange={(e) => set(it.id, { restock: e.target.checked })} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {fieldError(state, "items") && <p className="mt-2 text-sm text-danger">{fieldError(state, "items")}</p>}
      </fieldset>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="reason" label="Motif" required error={fieldError(state, "reason")}>
          {(p) => (
            <Select {...p} name="reason" defaultValue="other">
              {Object.entries(RETURN_REASONS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id="mode" label="Étape">
          {(p) => (
            <Select {...p} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
              <option value="RECEIVED">Articles déjà reçus en boutique</option>
              <option value="APPROVED">Retour accepté, articles à recevoir</option>
            </Select>
          )}
        </Field>
      </div>
      <Field id="note" label="Note interne (facultatif)">
        {(p) => <Textarea {...p} name="note" rows={2} maxLength={1000} />}
      </Field>
      <SubmitButton className="h-11 w-full sm:w-auto">Créer le retour</SubmitButton>
    </form>
  );
}
