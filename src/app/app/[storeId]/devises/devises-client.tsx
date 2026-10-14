"use client";

import { useActionState, useState } from "react";
import { Pencil, Plus, Trash2, Tag } from "lucide-react";
import { addStoreCurrency, deleteProductPrice, removeStoreCurrency, updateStoreCurrency, upsertProductPrice } from "@/lib/currency/actions";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/misc";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage, fieldError } from "@/components/forms/form-message";
import { ConfirmActionButton } from "@/components/app/action-controls";
import { formatMoney, currencyDecimals } from "@/lib/money";
import { ROUNDING_LABELS, ROUNDING_RULES, ruleAllowedFor, type RoundingRuleId } from "@/lib/currency/rounding";

const iconBtn = "inline-flex size-11 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-danger-soft hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2";
const short = (c: string) => (c === "XOF" || c === "XAF" ? "FCFA" : c);

export type CurrencyRowDTO = {
  currency: string;
  name: string;
  enabled: boolean;
  rateMode: "auto" | "manual";
  manualRate: string;
  markupPercent: string;
  rounding: RoundingRuleId;
  roundingLabel: string;
  status: { tone: "success" | "warning" | "neutral" | "danger"; text: string };
  rateLine: string;
  example: string | null;
};

export function AddCurrencyForm({ storeId, options }: { storeId: string; options: { code: string; label: string }[] }) {
  const [state, action] = useActionState(addStoreCurrency, undefined);
  if (options.length === 0) return <p className="text-sm text-ink-muted">Toutes les devises proposées sont déjà ajoutées.</p>;
  return (
    <form action={action} noValidate className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <FormMessage state={state} toastSuccess />
      <input type="hidden" name="storeId" value={storeId} />
      <Field id="add-currency" label="Ajouter une devise" error={fieldError(state, "currency")} className="flex-1">
        {(p) => (
          <Select {...p} name="currency" defaultValue={options[0]?.code}>
            {options.map((o) => (
              <option key={o.code} value={o.code}>
                {o.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <SubmitButton variant="secondary" className="h-12 sm:h-11">
        <Plus className="size-4" aria-hidden /> Ajouter
      </SubmitButton>
    </form>
  );
}

export function CurrencyRow({ storeId, storeCurrency, row }: { storeId: string; storeCurrency: string; row: CurrencyRowDTO }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 sm:px-6">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[15px] font-semibold text-ink">
            {row.currency} <span className="font-normal text-ink-muted">· {row.name}</span>
          </span>
          <Badge tone={row.status.tone}>{row.status.text}</Badge>
        </div>
        <p className="mt-1 text-sm text-ink-muted">{row.rateLine}</p>
        <p className="mt-0.5 text-sm text-ink-muted">
          {row.markupPercent !== "0" ? `Marge ${row.markupPercent} %, ` : "Sans marge, "}
          {row.roundingLabel.charAt(0).toLowerCase() + row.roundingLabel.slice(1)}
          {row.example ? <span className="tabular"> · {row.example}</span> : null}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <CurrencyDialog storeId={storeId} storeCurrency={storeCurrency} row={row} />
        <ConfirmActionButton
          action={() => removeStoreCurrency(storeId, row.currency)}
          title={`Retirer ${row.currency} ?`}
          description="La boutique ne s'affichera plus dans cette devise. Les commandes déjà passées ne changent pas."
          confirmLabel="Retirer"
          className={iconBtn}
        >
          <Trash2 className="size-4" aria-hidden />
          <span className="sr-only">Retirer {row.currency}</span>
        </ConfirmActionButton>
      </div>
    </li>
  );
}

function CurrencyDialog({ storeId, storeCurrency, row }: { storeId: string; storeCurrency: string; row: CurrencyRowDTO }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(updateStoreCurrency, undefined);
  const [enabled, setEnabled] = useState(row.enabled);
  const [mode, setMode] = useState<"auto" | "manual">(row.rateMode);
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state?.ok) setOpen(false);
  }
  const decimals = currencyDecimals(row.currency);
  return (
    <>
      <Button variant="ghost" size="icon" aria-label={`Régler ${row.currency}`} onClick={() => setOpen(true)}>
        <Pencil className="size-4" aria-hidden />
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`${row.currency} · ${row.name}`} description="Taux, marge de change et arrondi des prix affichés.">
        <form action={action} noValidate className="space-y-4">
          <FormMessage state={state} />
          <input type="hidden" name="storeId" value={storeId} />
          <input type="hidden" name="currency" value={row.currency} />
          <input type="hidden" name="enabled" value={enabled ? "true" : "false"} />
          <div className="flex min-h-11 items-center">
            <Switch checked={enabled} onChange={setEnabled} label="Proposée aux clients" />
          </div>
          <Field id={`mode-${row.currency}`} label="Taux" error={fieldError(state, "rateMode")}>
            {(p) => (
              <Select {...p} name="rateMode" value={mode} onChange={(e) => setMode(e.target.value === "manual" ? "manual" : "auto")}>
                <option value="auto">Automatique (BCE quotidien, parité fixe FCFA/euro)</option>
                <option value="manual">Manuel (je saisis mon taux)</option>
              </Select>
            )}
          </Field>
          {mode === "manual" && (
            <Field id={`rate-${row.currency}`} label={`1 ${short(row.currency)} = combien de ${short(storeCurrency)} ?`} required error={fieldError(state, "manualRate")} hint="Jusqu'à 10 décimales. Un taux manuel ne périme pas : mettez-le à jour vous-même.">
              {(p) => <Input {...p} name="manualRate" inputMode="decimal" defaultValue={row.manualRate.replace(/\.?0+$/, "")} placeholder="655,957" className="tabular" />}
            </Field>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id={`markup-${row.currency}`} label="Marge de change (%)" error={fieldError(state, "markupPercent")} hint="De 0 à 5 %. Couvre vos frais de change.">
              {(p) => <Input {...p} name="markupPercent" inputMode="decimal" defaultValue={row.markupPercent} className="tabular" />}
            </Field>
            <Field id={`round-${row.currency}`} label="Arrondi des prix" error={fieldError(state, "rounding")}>
              {(p) => (
                <Select {...p} name="rounding" defaultValue={row.rounding}>
                  {ROUNDING_RULES.filter((r) => ruleAllowedFor(r, decimals)).map((r) => (
                    <option key={r} value={r}>
                      {ROUNDING_LABELS[r]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <p className="text-xs text-ink-muted">L&apos;arrondi s&apos;applique aux prix et à la livraison, jamais aux remises ni aux taxes.</p>
          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <SubmitButton>Enregistrer</SubmitButton>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export type FixedPriceDTO = { id: string; productName: string; currency: string; price: number; compareAtPrice: number | null; basePrice: number; baseCurrency: string };

export function FixedPricesList({ storeId, prices }: { storeId: string; prices: FixedPriceDTO[] }) {
  if (prices.length === 0) return <EmptyState compact icon={Tag} title="Aucun prix fixé" description="Sans prix fixé, le prix converti et arrondi s'applique." />;
  return (
    <ul className="divide-y divide-line">
      {prices.map((p) => (
        <li key={p.id} className="flex items-center gap-4 px-5 py-3.5 sm:px-6">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink">{p.productName}</p>
            <p className="text-sm text-ink-muted tabular">
              {formatMoney(p.price, p.currency)}
              {p.compareAtPrice != null && (
                <>
                  {" "}
                  <s>{formatMoney(p.compareAtPrice, p.currency)}</s>
                </>
              )}{" "}
              · prix boutique {formatMoney(p.basePrice, p.baseCurrency)}
            </p>
          </div>
          <ConfirmActionButton action={() => deleteProductPrice(storeId, p.id)} title="Supprimer ce prix fixé ?" description="Le prix converti s'appliquera de nouveau." confirmLabel="Supprimer" className={iconBtn}>
            <Trash2 className="size-4" aria-hidden />
            <span className="sr-only">Supprimer le prix fixé de {p.productName}</span>
          </ConfirmActionButton>
        </li>
      ))}
    </ul>
  );
}

export function FixedPriceForm({ storeId, currencies, products }: { storeId: string; currencies: string[]; products: { id: string; name: string; price: string }[] }) {
  const [state, action] = useActionState(upsertProductPrice, undefined);
  return (
    <form action={action} noValidate className="space-y-4">
      <FormMessage state={state} />
      <input type="hidden" name="storeId" value={storeId} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Field id="fp-product" label="Produit" error={fieldError(state, "productId")}>
          {(p) => (
            <Select {...p} name="productId" defaultValue={products[0]?.id}>
              {products.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name} ({x.price})
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id="fp-currency" label="Devise" error={fieldError(state, "currency")}>
          {(p) => (
            <Select {...p} name="currency" defaultValue={currencies[0]}>
              {currencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="fp-price" label="Prix" required error={fieldError(state, "price")} hint="Par exemple 15 ou 14,99.">
          {(p) => <Input {...p} name="price" inputMode="decimal" className="tabular" />}
        </Field>
        <Field id="fp-compare" label="Prix barré (facultatif)" error={fieldError(state, "compareAtPrice")}>
          {(p) => <Input {...p} name="compareAtPrice" inputMode="decimal" className="tabular" />}
        </Field>
      </div>
      <div className="flex justify-end">
        <SubmitButton variant="secondary">Fixer le prix</SubmitButton>
      </div>
    </form>
  );
}
