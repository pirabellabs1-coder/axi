"use client";

import { useState, useTransition } from "react";
import { Pencil, RotateCcw } from "lucide-react";
import { setPriceOverride, resetPriceOverride } from "@/lib/admin/pricing-actions";
import { formatMoney, parseMoneyInput, currencyDecimals } from "@/lib/money";
import type { PricingZone } from "@/config/plans";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toast";

type Props = {
  itemType: "plan" | "addon";
  itemId: string;
  itemName: string;
  zone: PricingZone;
  currency: string;
  amount: number | null;
  defaultAmount: number | null;
  overridden: boolean;
  canEdit: boolean;
  /** Sous-texte (ex. équivalent annuel). */
  sub?: string;
  fromPrice?: boolean;
};

const toInput = (amount: number | null, currency: string) => {
  if (amount == null) return "";
  const d = currencyDecimals(currency);
  return d === 0 ? String(amount) : (amount / 100).toFixed(2).replace(".", ",");
};

/** Cellule de prix éditable : prix effectif, marque « modifié », dialogue d'édition et retour au défaut. */
export function PriceCell({ itemType, itemId, itemName, zone, currency, amount, defaultAmount, overridden, canEdit, sub, fromPrice }: Props) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(toInput(amount, currency));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const zoneLabel = zone === "AFRICA" ? "Afrique (FCFA)" : "Monde (EUR)";

  const save = () =>
    start(async () => {
      const parsed = parseMoneyInput(value, currency);
      if (parsed == null) {
        setError("Saisissez un montant valide.");
        return;
      }
      const r = await setPriceOverride({ itemType, itemId, zone, amount: parsed, note: note || undefined });
      if (r.ok) {
        toast.success(r.message ?? "Prix mis à jour");
        setOpen(false);
        setError(null);
        setNote("");
      } else setError(r.error);
    });

  const reset = () =>
    start(async () => {
      const r = await resetPriceOverride({ itemType, itemId, zone });
      if (r.ok) {
        toast.success(r.message ?? "Prix par défaut rétabli");
        setOpen(false);
        setValue(toInput(defaultAmount, currency));
      } else setError(r.error);
    });

  return (
    <div className="flex items-center justify-end gap-1.5">
      <div className="text-right">
        <span className="tabular inline-flex items-center gap-1.5 text-ink">
          {overridden && <Badge tone="accent" className="!px-1.5 !py-0 text-[11px]">Modifié</Badge>}
          {fromPrice && <span className="text-xs text-ink-muted">dès</span>}
          {amount == null ? <span className="text-ink-muted">Sur devis</span> : formatMoney(amount, currency)}
        </span>
        {overridden && defaultAmount != null && <span className="block text-xs text-ink-faint line-through">{formatMoney(defaultAmount, currency)}</span>}
        {sub && <span className="block text-xs text-ink-muted">{sub}</span>}
      </div>
      {canEdit && (
        <button
          type="button"
          onClick={() => {
            setValue(toInput(amount, currency));
            setError(null);
            setOpen(true);
          }}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink sm:size-9"
          aria-label={`Modifier le prix ${itemName}, zone ${zoneLabel}`}
        >
          <Pencil className="size-3.5" aria-hidden />
        </button>
      )}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        size="sm"
        title={`Prix ${itemName}`}
        description={`Zone ${zoneLabel}. S'applique aux prochaines factures ; les factures déjà émises ne changent pas.`}
        footer={
          <>
            {overridden && (
              <Button variant="ghost" onClick={reset} disabled={pending} className="mr-auto">
                <RotateCcw className="size-4" aria-hidden /> Prix par défaut
              </Button>
            )}
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Annuler</Button>
            <Button onClick={save} loading={pending}>Enregistrer</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field id={`price-${itemId}-${zone}`} label={itemType === "plan" ? `Prix mensuel (${currency === "XOF" ? "FCFA" : "€"})` : `Prix (${currency === "XOF" ? "FCFA" : "€"})`} required error={error ?? undefined} hint={defaultAmount != null ? `Prix par défaut : ${formatMoney(defaultAmount, currency)}${itemType === "plan" ? ". L'annuel reste à 10 mois payés pour 12." : "."}` : undefined}>
            {(p) => <Input {...p} value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" autoComplete="off" className="tabular" />}
          </Field>
          <Field id={`note-${itemId}-${zone}`} label="Note interne" hint="Facultatif, visible dans l'historique (ex. : promotion de lancement).">
            {(p) => <Input {...p} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />}
          </Field>
        </div>
      </Dialog>
    </div>
  );
}
