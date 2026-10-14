"use client";

import { useState } from "react";
import { Minus, Plus, ArrowUpRight } from "lucide-react";
import { purchaseAddOn, cancelAddOn, resumeAddOn } from "@/lib/addons/actions";
import { formatMoney } from "@/lib/money";
import { ActionButton, ConfirmActionButton } from "@/components/app/action-controls";

/** Bouton Acheter : quantité (options récurrentes et packs), prix recalculé côté serveur. */
export function BuyAddOn({ storeId, addOnId, unitPrice, currency, allowQuantity, cadence }: { storeId: string; addOnId: string; unitPrice: number; currency: string; allowQuantity: boolean; cadence: string }) {
  const [qty, setQty] = useState(1);
  return (
    <div className="flex flex-wrap items-center gap-3">
      {allowQuantity && (
        <div className="inline-flex items-center rounded-full bg-surface-2 p-1 ring-1 ring-inset ring-line" role="group" aria-label="Quantité">
          <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1} className="inline-flex size-9 items-center justify-center rounded-full text-ink transition-colors hover:bg-surface disabled:opacity-40" aria-label="Diminuer la quantité">
            <Minus className="size-4" aria-hidden />
          </button>
          <output className="w-8 text-center text-sm font-medium tabular" aria-live="polite">{qty}</output>
          <button type="button" onClick={() => setQty((q) => Math.min(20, q + 1))} disabled={qty >= 20} className="inline-flex size-9 items-center justify-center rounded-full text-ink transition-colors hover:bg-surface disabled:opacity-40" aria-label="Augmenter la quantité">
            <Plus className="size-4" aria-hidden />
          </button>
        </div>
      )}
      <ActionButton size="sm" variant="primary" trailing={ArrowUpRight} action={() => purchaseAddOn(storeId, addOnId, qty)} aria-label={`Acheter pour ${formatMoney(unitPrice * qty, currency)} ${cadence}`}>
        Acheter {qty > 1 ? `· ${formatMoney(unitPrice * qty, currency)}` : ""}
      </ActionButton>
    </div>
  );
}

export function CancelAddOnButton({ storeId, purchaseId, pending, endsAt }: { storeId: string; purchaseId: string; pending: boolean; endsAt: string | null }) {
  return (
    <ConfirmActionButton
      title={pending ? "Annuler cette commande d'option ?" : "Résilier cette option ?"}
      description={pending ? "La facture associée sera annulée. Aucun paiement n'est attendu." : `L'option reste active jusqu'au ${endsAt ? new Date(endsAt).toLocaleDateString("fr-FR") : "terme de la période"}, puis elle ne sera pas renouvelée.`}
      confirmLabel={pending ? "Annuler la commande" : "Résilier en fin de période"}
      action={() => cancelAddOn(storeId, purchaseId)}
      className="inline-flex h-11 items-center rounded-full px-4 text-sm font-medium text-danger transition-colors hover:bg-danger-soft"
    >
      {pending ? "Annuler" : "Résilier"}
    </ConfirmActionButton>
  );
}

export function ResumeAddOnButton({ storeId, purchaseId }: { storeId: string; purchaseId: string }) {
  return (
    <ActionButton size="sm" variant="outline" action={() => resumeAddOn(storeId, purchaseId)}>
      Reprendre
    </ActionButton>
  );
}
