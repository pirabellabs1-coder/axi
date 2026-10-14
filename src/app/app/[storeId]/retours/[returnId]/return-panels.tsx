"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X, Ban, PackageCheck, Scale } from "lucide-react";
import type { ReturnStatus } from "@prisma/client";
import type { ActionResult } from "@/lib/action";
import { approveReturn, cancelReturn, quoteReturnAction, receiveReturn, rejectReturn, resolveReturn, type QuoteView } from "@/lib/returns/actions";
import { ITEM_CONDITIONS, RESOLUTION_LABELS, type ResolutionKind } from "@/lib/returns/policy";
import { formatMoney } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea, Checkbox } from "@/components/ui/field";
import { Alert } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { ActionButton, ConfirmActionButton } from "@/components/app/action-controls";
import { FormMessage, fieldError } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";

export type PanelItem = {
  id: string;
  name: string;
  variantName: string | null;
  quantity: number;
  exchangeVariantId: string | null;
  variants: { id: string; name: string }[];
};

function useRefreshOnSuccess(state: ActionResult | undefined, after?: () => void) {
  const router = useRouter();
  useEffect(() => {
    if (state?.ok) {
      after?.();
      router.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
}

/** Actions de la fiche selon la machine d'états (le serveur revérifie tout). */
export function ReturnActions(props: {
  storeId: string;
  returnId: string;
  status: ReturnStatus;
  canManage: boolean;
  canReceive: boolean;
  canRefund: boolean;
  items: PanelItem[];
  currency: string;
  desired: ResolutionKind;
  policy: { allowRefund: boolean; allowStoreCredit: boolean; allowExchange: boolean; storeCreditBonusPercent: number; restockingFeePercent: number };
  initialQuote: QuoteView;
  deliveryFee: number;
}) {
  const { storeId, returnId, status, canManage, canReceive } = props;
  const router = useRouter();
  if (status === "REQUESTED" && canManage) {
    return (
      <div className="flex flex-col gap-2">
        <ActionButton action={() => approveReturn(storeId, returnId)} onDone={(r) => r.ok && router.refresh()} className="h-11 w-full">
          <Check className="size-4" aria-hidden /> Approuver le retour
        </ActionButton>
        <RejectButton storeId={storeId} returnId={returnId} />
        <CancelButton storeId={storeId} returnId={returnId} />
      </div>
    );
  }
  if (status === "APPROVED" && (canReceive || canManage)) {
    return (
      <div className="space-y-4">
        {canReceive && <ReceiveForm storeId={storeId} returnId={returnId} items={props.items} />}
        {canManage && <CancelButton storeId={storeId} returnId={returnId} />}
      </div>
    );
  }
  if (status === "RECEIVED" && canManage) return <ResolveForm {...props} />;
  return <p className="text-sm text-ink-muted">Aucune action disponible pour ce retour.</p>;
}

function CancelButton({ storeId, returnId }: { storeId: string; returnId: string }) {
  const router = useRouter();
  return (
    <ConfirmActionButton
      action={async () => {
        const r = await cancelReturn(storeId, returnId);
        if (r.ok) router.refresh();
        return r;
      }}
      title="Annuler ce retour ?"
      description="Les articles redeviennent disponibles pour une autre demande. Le client est prévenu."
      confirmLabel="Annuler le retour"
      className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full px-4 text-sm font-medium text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
    >
      <Ban className="size-4" aria-hidden /> Annuler le retour
    </ConfirmActionButton>
  );
}

function RejectButton({ storeId, returnId }: { storeId: string; returnId: string }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(rejectReturn, undefined);
  useRefreshOnSuccess(state, () => setOpen(false));
  return (
    <>
      <Button variant="outline" className="h-11 w-full" onClick={() => setOpen(true)}>
        <X className="size-4" aria-hidden /> Refuser
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Refuser le retour" description="Le motif est communiqué au client." size="sm">
        <form action={action} className="space-y-4">
          <input type="hidden" name="storeId" value={storeId} />
          <input type="hidden" name="returnId" value={returnId} />
          <FormMessage state={state} />
          <Field id="reject-reason" label="Motif du refus" required error={fieldError(state, "reason")}>
            {(p) => <Textarea {...p} name="reason" rows={3} maxLength={1000} placeholder="Ex. article porté, délai dépassé" />}
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Fermer
            </Button>
            <SubmitButton variant="danger">Refuser le retour</SubmitButton>
          </div>
        </form>
      </Dialog>
    </>
  );
}

type ReceiveLine = { returnItemId: string; receivedQty: number; condition: keyof typeof ITEM_CONDITIONS; restock: boolean };

function ReceiveForm({ storeId, returnId, items }: { storeId: string; returnId: string; items: PanelItem[] }) {
  const [lines, setLines] = useState<ReceiveLine[]>(() => items.map((i) => ({ returnItemId: i.id, receivedQty: i.quantity, condition: "neuf", restock: true })));
  const [state, action] = useActionState(receiveReturn, undefined);
  useRefreshOnSuccess(state);
  const set = (id: string, patch: Partial<ReceiveLine>) => setLines((ls) => ls.map((l) => (l.returnItemId === id ? { ...l, ...patch } : l)));
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="storeId" value={storeId} />
      <input type="hidden" name="returnId" value={returnId} />
      <input type="hidden" name="lines" value={JSON.stringify(lines)} />
      <FormMessage state={state} />
      <p className="flex items-center gap-2 text-sm font-semibold text-ink">
        <PackageCheck className="size-4 text-primary" aria-hidden /> Réception des articles
      </p>
      <ul className="space-y-4">
        {items.map((it) => {
          const l = lines.find((x) => x.returnItemId === it.id)!;
          return (
            <li key={it.id} className="rounded-[var(--radius-md)] bg-surface-2/60 p-3.5 ring-1 ring-inset ring-line">
              <p className="text-sm font-medium text-ink">
                {it.name}
                {it.variantName && <span className="text-ink-muted"> · {it.variantName}</span>}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Field id={`rq-${it.id}`} label={`Reçu (sur ${it.quantity})`}>
                  {(p) => (
                    <Input
                      {...p}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={it.quantity}
                      value={l.receivedQty}
                      onChange={(e) => set(it.id, { receivedQty: Math.max(0, Math.min(it.quantity, Number(e.target.value) || 0)) })}
                    />
                  )}
                </Field>
                <Field id={`rc-${it.id}`} label="État">
                  {(p) => (
                    <Select {...p} value={l.condition} onChange={(e) => set(it.id, { condition: e.target.value as ReceiveLine["condition"], restock: e.target.value === "abime" ? false : l.restock })}>
                      {Object.entries(ITEM_CONDITIONS).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>
              <Checkbox className="mt-3" label="Remettre en stock" checked={l.restock} onChange={(e) => set(it.id, { restock: e.target.checked })} />
            </li>
          );
        })}
      </ul>
      <Field id="receive-note" label="Note (facultatif)">
        {(p) => <Textarea {...p} name="note" rows={2} maxLength={1000} />}
      </Field>
      <SubmitButton className="h-11 w-full">Enregistrer la réception</SubmitButton>
    </form>
  );
}

function ResolveForm(props: Parameters<typeof ReturnActions>[0]) {
  const { storeId, returnId, currency, policy, items, canRefund } = props;
  const options: ResolutionKind[] = ["STORE_CREDIT", "REFUND", "EXCHANGE", "NONE"];
  const [resolution, setResolution] = useState<ResolutionKind>(props.desired !== "NONE" ? props.desired : "STORE_CREDIT");
  const [refundShipping, setRefundShipping] = useState(false);
  const [waive, setWaive] = useState(false);
  const [quote, setQuote] = useState<QuoteView>(props.initialQuote);
  const [amount, setAmount] = useState("");
  const [variants, setVariants] = useState<Record<string, string | null>>(() => Object.fromEntries(items.map((i) => [i.id, i.exchangeVariantId])));
  const [loading, start] = useTransition();
  const [state, action] = useActionState(resolveReturn, undefined);
  useRefreshOnSuccess(state);

  const requote = (ship: boolean, w: boolean) =>
    start(async () => {
      const r = await quoteReturnAction(storeId, returnId, { refundShipping: ship, waiveRestockingFee: w });
      if (r.ok && r.data) setQuote(r.data);
      else if (!r.ok) toast.error(r.error);
    });

  const effective = amount.trim() ? Number(amount.replace(/\s/g, "")) : quote.amount;
  const credit = Number.isFinite(effective) ? effective + Math.round((effective * policy.storeCreditBonusPercent) / 100) : 0;
  const disabledReason = resolution === "REFUND" && !quote.paid ? "La commande n'est pas payée : remboursement impossible." : resolution === "REFUND" && !canRefund ? "Votre rôle ne permet pas d'enregistrer un remboursement." : null;

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="storeId" value={storeId} />
      <input type="hidden" name="returnId" value={returnId} />
      <input type="hidden" name="resolution" value={resolution} />
      <input type="hidden" name="exchangeVariants" value={JSON.stringify(variants)} />
      <FormMessage state={state} />
      <p className="flex items-center gap-2 text-sm font-semibold text-ink">
        <Scale className="size-4 text-primary" aria-hidden /> Résolution
      </p>
      <fieldset>
        <legend className="sr-only">Type de résolution</legend>
        <div className="grid grid-cols-2 gap-2">
          {options.map((o) => (
            <label
              key={o}
              className={`flex min-h-11 cursor-pointer items-center justify-center rounded-[var(--radius-md)] px-3 text-sm font-medium ring-1 ring-inset transition-colors ${resolution === o ? "bg-primary-soft text-primary-deep ring-primary" : "bg-surface text-ink ring-line hover:bg-surface-2"}`}
            >
              <input type="radio" className="sr-only" name="resolutionChoice" value={o} checked={resolution === o} onChange={() => setResolution(o)} />
              {RESOLUTION_LABELS[o]}
            </label>
          ))}
        </div>
      </fieldset>

      {resolution !== "NONE" && (
        <>
          <dl className="space-y-1.5 rounded-[var(--radius-md)] bg-surface-2/60 p-3.5 text-sm ring-1 ring-inset ring-line" aria-busy={loading}>
            <Row label="Valeur des articles" value={formatMoney(quote.merchandise, currency)} />
            {quote.restockingFee > 0 && <Row label={`Frais de remise en stock (${policy.restockingFeePercent} %)`} value={`-${formatMoney(quote.restockingFee, currency)}`} />}
            {quote.shipping > 0 && <Row label="Livraison remboursée" value={formatMoney(quote.shipping, currency)} />}
            {quote.capped && <Row label="Plafond restant sur la commande" value={formatMoney(quote.cap, currency)} />}
            <div className="flex items-baseline justify-between border-t border-line pt-2 font-semibold text-ink">
              <dt>Montant suggéré</dt>
              <dd className="font-mono tabular">{formatMoney(quote.amount, currency)}</dd>
            </div>
          </dl>
          {policy.restockingFeePercent > 0 && (
            <Checkbox
              label="Ne pas appliquer les frais de remise en stock"
              description="Par exemple pour un article défectueux."
              name="waiveRestockingFee"
              checked={waive}
              onChange={(e) => {
                setWaive(e.target.checked);
                requote(refundShipping, e.target.checked);
              }}
            />
          )}
          {props.deliveryFee > 0 && (
            <Checkbox
              label="Rembourser la livraison"
              description={quote.fullReturn ? "Retour total : les frais de livraison s'ajoutent." : "Uniquement pour un retour total de la commande."}
              name="refundShipping"
              checked={refundShipping}
              disabled={!quote.fullReturn}
              onChange={(e) => {
                setRefundShipping(e.target.checked);
                requote(e.target.checked, waive);
              }}
            />
          )}
          <Field id="resolve-amount" label={`Montant retenu (${currency})`} hint={`Laissez vide pour le montant suggéré (${formatMoney(quote.amount, currency)} maximum).`} error={fieldError(state, "amount")}>
            {(p) => <Input {...p} name="amount" inputMode="numeric" placeholder={String(quote.amount)} value={amount} onChange={(e) => setAmount(e.target.value)} />}
          </Field>
          {resolution === "STORE_CREDIT" && (
            <p className="text-sm text-ink-muted">
              Avoir accordé : <span className="font-semibold text-ink">{formatMoney(Number.isFinite(credit) ? credit : 0, currency)}</span>
              {policy.storeCreditBonusPercent > 0 && ` (bonus de ${policy.storeCreditBonusPercent} % inclus)`}. La fiche client est créée si nécessaire.
            </p>
          )}
          {resolution === "EXCHANGE" && (
            <div className="space-y-3">
              <p className="text-sm text-ink-muted">Une commande d'échange est créée au prix actuel ; la valeur retournée est déduite. Une différence positive reste due par le client, un excédent va en avoir.</p>
              {items
                .filter((i) => i.variants.length > 0)
                .map((i) => (
                  <Field key={i.id} id={`xv-${i.id}`} label={`Remplacement : ${i.name}`}>
                    {(p) => (
                      <Select {...p} value={variants[i.id] ?? ""} onChange={(e) => setVariants((v) => ({ ...v, [i.id]: e.target.value || null }))}>
                        <option value="">Même article ({i.variantName ?? "identique"})</option>
                        {i.variants.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                ))}
            </div>
          )}
        </>
      )}
      <Field id="resolve-note" label="Note (facultatif)">
        {(p) => <Textarea {...p} name="note" rows={2} maxLength={1000} />}
      </Field>
      {disabledReason && <Alert tone="warning">{disabledReason}</Alert>}
      <SubmitButton className="h-11 w-full" disabled={!!disabledReason}>
        {resolution === "NONE" ? "Clôturer sans remboursement" : `Valider : ${RESOLUTION_LABELS[resolution].toLowerCase()}`}
      </SubmitButton>
    </form>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="font-mono tabular text-ink">{value}</dd>
    </div>
  );
}
