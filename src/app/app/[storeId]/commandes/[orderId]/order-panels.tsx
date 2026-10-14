"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { OrderStatus, PaymentStatus, FulfillmentType } from "@prisma/client";
import { XCircle, CheckCircle2, Ban, Undo2, Save, ChevronDown, ArrowRight, Check } from "lucide-react";
import { changeOrderStatus, confirmPayment, failPayment, refundOrder, updateInternalNote, assignCourier } from "@/lib/orders/actions";
import { nextStatuses, ORDER_ACTION_LABELS } from "@/lib/commerce/order-state";
import { formatMoney } from "@/lib/money";
import { Button, buttonClasses } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { DropdownMenu, DropdownItem, DropdownLabel, DropdownSeparator } from "@/components/ui/dropdown-menu";
import { Field, Input, Textarea } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";
import type { ActionResult } from "@/lib/action";

function useAction() {
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (fn: () => Promise<ActionResult<unknown>>, onOk?: () => void) =>
    new Promise<boolean>((resolve) =>
      start(async () => {
        const res = await fn();
        if (res.ok) {
          if (res.message) toast.success(res.message);
          router.refresh();
          onOk?.();
          resolve(true);
        } else {
          toast.error("Action impossible", res.error);
          resolve(false);
        }
      }),
    );
  return { pending, run };
}

function availableNext(status: OrderStatus, fulfillmentType: FulfillmentType, intangible = false) {
  // « Remboursée » passe uniquement par le panneau Paiement (remboursement réel), jamais par un simple changement de statut.
  // Vague 2 : une commande sans expédition (numérique, service, carte cadeau) peut être marquée remise directement.
  const nexts = nextStatuses(status, { intangible }).filter((s) => !(s === "OUT_FOR_DELIVERY" && fulfillmentType !== "DELIVERY") && s !== "REFUNDED");
  return { nexts, forward: nexts.filter((s) => s !== "CANCELLED") };
}

/* ───────────── Annulation (dialogue partagé) ───────────── */

function CancelDialog({ open, onClose, storeId, orderId }: { open: boolean; onClose: () => void; storeId: string; orderId: string }) {
  const { pending, run } = useAction();
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | undefined>();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Annuler la commande"
      description="Le stock sera remis à disposition. Cette action est définitive."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Retour
          </Button>
          <Button
            variant="danger"
            loading={pending}
            onClick={async () => {
              if (reason.trim().length < 2) {
                setReasonError("Indiquez un motif (2 caractères minimum).");
                return;
              }
              const ok = await run(() => changeOrderStatus(storeId, orderId, "CANCELLED", reason.trim()));
              if (ok) onClose();
            }}
          >
            Confirmer l&apos;annulation
          </Button>
        </>
      }
    >
      <Field id={`cancel-reason-${orderId}`} label="Motif" required error={reasonError} hint="Communiqué au client s'il reçoit des notifications.">
        {(p) => (
          <Textarea
            {...p}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setReasonError(undefined);
            }}
            rows={3}
            maxLength={300}
            placeholder="Ex. Client injoignable, produit indisponible"
          />
        )}
      </Field>
    </Dialog>
  );
}

/* ───────────── Statuts : menu d'en-tête ───────────── */

export function StatusMenu({ storeId, orderId, status, fulfillmentType, intangible = false }: { storeId: string; orderId: string; status: OrderStatus; fulfillmentType: FulfillmentType; intangible?: boolean }) {
  const { pending, run } = useAction();
  const [cancelOpen, setCancelOpen] = useState(false);
  const { nexts, forward } = availableNext(status, fulfillmentType, intangible);
  if (nexts.length === 0) return null;

  return (
    <>
      <DropdownMenu
        label="Changer le statut"
        trigger={(p) => (
          <button {...p} disabled={pending} className={buttonClasses({ variant: "outline", size: "sm", className: "h-11 sm:h-9" })}>
            Changer le statut
            <ChevronDown className="size-3.5 text-ink-muted" aria-hidden />
          </button>
        )}
      >
        {forward.length > 0 && <DropdownLabel>Passer à</DropdownLabel>}
        {forward.map((to) => (
          <DropdownItem key={to} icon={ArrowRight} onSelect={() => run(() => changeOrderStatus(storeId, orderId, to))}>
            {ORDER_ACTION_LABELS[to]}
          </DropdownItem>
        ))}
        {nexts.includes("CANCELLED") && (
          <>
            {forward.length > 0 && <DropdownSeparator />}
            <DropdownItem icon={XCircle} tone="danger" onSelect={() => setCancelOpen(true)}>
              Annuler la commande
            </DropdownItem>
          </>
        )}
      </DropdownMenu>
      <CancelDialog open={cancelOpen} onClose={() => setCancelOpen(false)} storeId={storeId} orderId={orderId} />
    </>
  );
}

/* ───────────── Statuts : prochaine étape (colonne droite) ───────────── */

export function StatusActions({ storeId, orderId, status, fulfillmentType, intangible = false }: { storeId: string; orderId: string; status: OrderStatus; fulfillmentType: FulfillmentType; intangible?: boolean }) {
  const { pending, run } = useAction();
  const [cancelOpen, setCancelOpen] = useState(false);
  const { nexts, forward } = availableNext(status, fulfillmentType, intangible);

  if (nexts.length === 0)
    return (
      <p className="flex items-center gap-2 text-sm text-ink-muted">
        <Check className="size-4 text-primary" aria-hidden /> Commande clôturée : aucune action requise.
      </p>
    );

  return (
    <div className="flex flex-col gap-2">
      {forward.map((to, i) => (
        <Button
          key={to}
          variant={i === 0 ? "primary" : "outline"}
          size="sm"
          className="h-11 w-full"
          loading={pending && i === 0}
          disabled={pending}
          onClick={() => run(() => changeOrderStatus(storeId, orderId, to))}
        >
          {ORDER_ACTION_LABELS[to]}
        </Button>
      ))}
      {nexts.includes("CANCELLED") && (
        <>
          <Button variant="ghost" size="sm" className="h-11 w-full text-danger hover:bg-danger-soft" disabled={pending} onClick={() => setCancelOpen(true)}>
            <XCircle className="size-4" aria-hidden /> Annuler la commande
          </Button>
          <CancelDialog open={cancelOpen} onClose={() => setCancelOpen(false)} storeId={storeId} orderId={orderId} />
        </>
      )}
    </div>
  );
}

/* ───────────── Paiement ───────────── */

export function PaymentActions({ storeId, orderId, paymentStatus, total, currency }: { storeId: string; orderId: string; paymentStatus: PaymentStatus; total: number; currency: string }) {
  const { pending, run } = useAction();
  const [dialog, setDialog] = useState<null | "confirm" | "fail">(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | undefined>();
  const close = () => {
    setDialog(null);
    setNote("");
    setError(undefined);
  };
  const canConfirm = paymentStatus === "UNPAID" || paymentStatus === "PENDING" || paymentStatus === "FAILED";
  const canFail = paymentStatus === "UNPAID" || paymentStatus === "PENDING";
  if (!canConfirm && !canFail) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {canConfirm && (
        <Button size="sm" className="h-11 sm:h-9" onClick={() => setDialog("confirm")} disabled={pending}>
          <CheckCircle2 className="size-4" aria-hidden /> Confirmer le paiement
        </Button>
      )}
      {canFail && (
        <Button size="sm" variant="outline" className="h-11 sm:h-9" onClick={() => setDialog("fail")} disabled={pending}>
          <Ban className="size-4" aria-hidden /> Paiement échoué
        </Button>
      )}

      <Dialog
        open={dialog === "confirm"}
        onClose={close}
        title="Confirmer le paiement"
        description={`Vous attestez avoir reçu ${formatMoney(total, currency)}. Vérifiez votre compte Mobile Money ou bancaire avant de confirmer.`}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Annuler
            </Button>
            <Button
              loading={pending}
              onClick={async () => {
                if (await run(() => confirmPayment(storeId, orderId, note))) close();
              }}
            >
              Oui, paiement reçu
            </Button>
          </>
        }
      >
        <Field id="pay-note" label="Note (optionnel)" hint="Ex. numéro de transaction MoMo, nom de l'émetteur.">
          {(p) => <Input {...p} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />}
        </Field>
      </Dialog>

      <Dialog
        open={dialog === "fail"}
        onClose={close}
        title="Marquer le paiement en échec"
        description="La commande reste ouverte : vous pourrez confirmer un nouveau paiement plus tard."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Annuler
            </Button>
            <Button
              variant="danger"
              loading={pending}
              onClick={async () => {
                if (note.trim().length < 2) return setError("Indiquez un motif.");
                if (await run(() => failPayment(storeId, orderId, note.trim()))) close();
              }}
            >
              Marquer en échec
            </Button>
          </>
        }
      >
        <Field id="fail-reason" label="Motif" required error={error}>
          {(p) => (
            <Textarea
              {...p}
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                setError(undefined);
              }}
              rows={3}
              maxLength={300}
              placeholder="Ex. Référence introuvable, montant incorrect"
            />
          )}
        </Field>
      </Dialog>
    </div>
  );
}

/* ───────────── Remboursement ───────────── */

/**
 * Lot 1 : destination du remboursement. « original » : paiement externe (à virer par le commerçant), puis cartes
 * cadeaux et avoir utilisés, recrédités automatiquement ; « store_credit » : crédité en avoir du client
 * (`customers.manage`, fiche client requise).
 */
export function RefundAction({
  storeId,
  orderId,
  paymentStatus,
  total,
  refunded,
  currency,
  hasCustomer = false,
  canUseStoreCredit = false,
}: {
  storeId: string;
  orderId: string;
  paymentStatus: PaymentStatus;
  total: number;
  refunded: number;
  currency: string;
  hasCustomer?: boolean;
  canUseStoreCredit?: boolean;
}) {
  const { pending, run } = useAction();
  const remaining = total - refunded;
  const creditAllowed = hasCustomer && canUseStoreCredit;
  const [destination, setDestination] = useState<"original" | "store_credit">("original");
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState(String(remaining));
  const [error, setError] = useState<string | undefined>();
  const canRefund = (paymentStatus === "PAID" || paymentStatus === "PARTIALLY_REFUNDED") && remaining > 0;
  if (!canRefund) return null;
  const close = () => {
    setOpen(false);
    setNote("");
    setError(undefined);
    setDestination("original");
  };

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="h-11 w-full sm:h-9"
        onClick={() => {
          setAmount(String(remaining));
          setOpen(true);
        }}
        disabled={pending}
      >
        <Undo2 className="size-4" aria-hidden /> Enregistrer un remboursement
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title="Enregistrer un remboursement"
        description={
          destination === "store_credit"
            ? `Montant remboursable : ${formatMoney(remaining, currency)}. Le montant est crédité immédiatement sur l’avoir du client, utilisable sur ses prochaines commandes.`
            : `Montant remboursable : ${formatMoney(remaining, currency)}. Le virement externe est à effectuer par vos soins (Mobile Money, espèces) ; les cartes cadeaux et l’avoir utilisés sont recrédités automatiquement.`
        }
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Annuler
            </Button>
            <Button
              loading={pending}
              onClick={async () => {
                const n = Number(amount.replace(/\s/g, ""));
                if (!Number.isInteger(n) || n <= 0 || n > remaining) return setError(`Montant entre 1 et ${remaining}.`);
                if (await run(() => refundOrder(storeId, orderId, n, note, creditAllowed ? destination : "original"))) close();
              }}
            >
              Enregistrer
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {creditAllowed && (
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-ink">Rembourser vers</legend>
              <div className="grid gap-2">
                {(
                  [
                    { v: "original", label: "Moyen de paiement d’origine", hint: "Paiement externe, puis cartes cadeaux et avoir utilisés." },
                    { v: "store_credit", label: "Avoir client", hint: "Crédité sur le compte du client, sans virement." },
                  ] as const
                ).map((o) => (
                  <label key={o.v} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-[var(--radius-md)] border border-line px-3 py-2.5 has-[:checked]:border-primary has-[:checked]:bg-primary-soft">
                    <input type="radio" name="refund-destination" value={o.v} checked={destination === o.v} onChange={() => setDestination(o.v)} className="mt-0.5 size-5 shrink-0 accent-[var(--c-primary)]" />
                    <span className="text-sm">
                      <span className="block font-medium text-ink">{o.label}</span>
                      <span className="block text-ink-muted">{o.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <Field id="refund-amount" label={`Montant (${currency})`} required error={error}>
            {(p) => (
              <Input
                {...p}
                inputMode="numeric"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setError(undefined);
                }}
              />
            )}
          </Field>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setAmount(String(remaining))}>
              Total
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setAmount(String(Math.floor(remaining / 2)))}>
              Moitié
            </Button>
          </div>
          <Field id="refund-reason" label="Motif (optionnel)">
            {(p) => <Input {...p} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Ex. Article manquant" />}
          </Field>
        </div>
      </Dialog>
    </>
  );
}

/* ───────────── Note interne et livreur ───────────── */

export function InternalNoteForm({ storeId, orderId, note }: { storeId: string; orderId: string; note: string | null }) {
  const { pending, run } = useAction();
  const [value, setValue] = useState(note ?? "");
  const dirty = value !== (note ?? "");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(() => updateInternalNote(storeId, orderId, value));
      }}
      className="space-y-2"
    >
      <label htmlFor="internal-note" className="sr-only">
        Note interne
      </label>
      <Textarea id="internal-note" value={value} onChange={(e) => setValue(e.target.value)} rows={3} maxLength={2000} placeholder="Ex. Client préfère être livré après 18 h." className="min-h-24 text-sm" />
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-ink-faint tabular" aria-live="polite">
          {dirty ? "Modifications non enregistrées" : `${value.length} / 2000`}
        </span>
        <Button type="submit" size="sm" variant="secondary" loading={pending} disabled={!dirty} className="h-11 sm:h-9">
          <Save className="size-4" aria-hidden /> Enregistrer
        </Button>
      </div>
    </form>
  );
}

export function CourierForm({ storeId, orderId, courierName }: { storeId: string; orderId: string; courierName: string | null }) {
  const { pending, run } = useAction();
  const [value, setValue] = useState(courierName ?? "");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(() => assignCourier(storeId, orderId, value));
      }}
      className="flex items-end gap-2"
    >
      <Field id="courier" label="Livreur" className="flex-1">
        {(p) => <Input {...p} value={value} onChange={(e) => setValue(e.target.value)} maxLength={80} placeholder="Nom du livreur" className="h-11 text-sm" />}
      </Field>
      <Button type="submit" size="sm" variant="secondary" loading={pending} disabled={value === (courierName ?? "")} className="h-11">
        Assigner
      </Button>
    </form>
  );
}
