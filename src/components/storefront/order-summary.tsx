import { Money } from "@/components/ui/misc";

type Item = { id: string; name: string; variantName: string | null; options: unknown; quantity: number; lineTotal: number };

function optionNames(options: unknown): string[] {
  if (!Array.isArray(options)) return [];
  return options.map((o) => (o && typeof o === "object" && typeof (o as { name?: unknown }).name === "string" ? (o as { name: string }).name : null)).filter((x): x is string => !!x);
}

type Lot1Amounts = {
  /** Lot 1 : réglé par cartes cadeaux / avoir, reste à payer (null = commandes antérieures). */
  giftCardAmount?: number;
  storeCreditAmount?: number;
  amountDue?: number | null;
};

/**
 * Récapitulatif d'une commande (lignes + totaux). Server Component.
 * `discounts` (lot 1, OrderDiscount) : détail des remises appliquées ; sinon une ligne « Remise » globale.
 */
export function OrderSummary({ order, discounts }: { order: { items: Item[]; currency: string; subtotal: number; discount: number; deliveryFee: number; total: number; fulfillmentType: "PICKUP" | "DELIVERY" | "WHATSAPP" | "DIGITAL"; couponCode: string | null } & Lot1Amounts; discounts?: { label: string; amount: number }[] }) {
  const detail = (discounts ?? []).filter((d) => d.amount > 0);
  const tendered = (order.giftCardAmount ?? 0) + (order.storeCreditAmount ?? 0);
  return (
    <div>
      <ul className="divide-y divide-line text-sm">
        {order.items.map((it) => {
          const opts = optionNames(it.options);
          return (
            <li key={it.id} className="flex justify-between gap-3 py-2.5">
              <span className="min-w-0">
                <span className="block text-ink">
                  {it.quantity} × {it.name}
                </span>
                {(it.variantName || opts.length > 0) && <span className="block text-xs text-ink-muted">{[it.variantName, ...opts].filter(Boolean).join(" · ")}</span>}
              </span>
              <span className="shrink-0 tabular text-ink">
                <Money amount={it.lineTotal} currency={order.currency} />
              </span>
            </li>
          );
        })}
      </ul>
      <dl className="mt-3 space-y-1.5 border-t border-line pt-3 text-sm">
        <div className="flex justify-between">
          <dt className="text-ink-muted">Sous-total</dt>
          <dd className="tabular text-ink">
            <Money amount={order.subtotal} currency={order.currency} />
          </dd>
        </div>
        {detail.length > 0
          ? detail.map((d, i) => (
              <div key={i} className="flex justify-between gap-3">
                <dt className="min-w-0 text-ink-muted">{d.label}</dt>
                <dd className="shrink-0 tabular text-primary-deep">
                  −<Money amount={d.amount} currency={order.currency} />
                </dd>
              </div>
            ))
          : order.discount > 0 && (
          <div className="flex justify-between">
            <dt className="text-ink-muted">Remise{order.couponCode ? ` (${order.couponCode})` : ""}</dt>
            <dd className="tabular text-primary-deep">
              −<Money amount={order.discount} currency={order.currency} />
            </dd>
          </div>
        )}
        {order.fulfillmentType === "DELIVERY" && (
          <div className="flex justify-between">
            <dt className="text-ink-muted">Livraison</dt>
            <dd className="tabular text-ink">{order.deliveryFee === 0 ? "Offerte" : <Money amount={order.deliveryFee} currency={order.currency} />}</dd>
          </div>
        )}
        <div className="flex justify-between border-t border-line pt-2 text-base font-bold text-ink">
          <dt>Total</dt>
          <dd className="tabular">
            <Money amount={order.total} currency={order.currency} />
          </dd>
        </div>
        {(order.giftCardAmount ?? 0) > 0 && (
          <div className="flex justify-between">
            <dt className="text-ink-muted">Carte cadeau</dt>
            <dd className="tabular text-primary-deep">
              −<Money amount={order.giftCardAmount!} currency={order.currency} />
            </dd>
          </div>
        )}
        {(order.storeCreditAmount ?? 0) > 0 && (
          <div className="flex justify-between">
            <dt className="text-ink-muted">Avoir</dt>
            <dd className="tabular text-primary-deep">
              −<Money amount={order.storeCreditAmount!} currency={order.currency} />
            </dd>
          </div>
        )}
        {tendered > 0 && (
          <div className="flex justify-between border-t border-line pt-2 font-semibold text-ink">
            <dt>Reste à payer</dt>
            <dd className="tabular">
              <Money amount={order.amountDue ?? Math.max(0, order.total - tendered)} currency={order.currency} />
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}
