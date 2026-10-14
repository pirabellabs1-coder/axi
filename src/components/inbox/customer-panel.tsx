import Link from "next/link";
import { ExternalLink, UserRound } from "lucide-react";
import type { ConversationStage, ConversationStatus, OrderStatus } from "@prisma/client";
import { ORDER_STATUS_LABELS, ORDER_STATUS_TONE } from "@/lib/commerce/order-state";
import { Avatar, Money } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { formatPhone, formatDate, relativeTime } from "@/lib/utils";
import { AssignSelect, EstimatedValueForm, LabelsEditor, StageSelect } from "./panel-controls";

export type PanelData = {
  storeId: string;
  currency: string;
  conversation: {
    id: string;
    name: string;
    phone: string;
    stage: ConversationStage;
    status: ConversationStatus;
    labels: string[];
    estimatedValue: number | null;
    assignedToId: string | null;
    createdAt: Date;
  };
  customer: { id: string; name: string; email: string | null; address: string | null; ordersCount: number; totalSpent: number; lastOrderAt: Date | null; loyaltyPoints: number; createdAt: Date } | null;
  orders: { id: string; reference: string; total: number; currency: string; status: OrderStatus; createdAt: Date }[];
  members: { id: string; name: string }[];
  labelSuggestions: string[];
  currentUserId: string;
  canAssign: boolean;
  canEdit: boolean;
  canViewCustomer: boolean;
  pipeline: boolean;
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line px-5 py-4 first:border-t-0">
      <h3 className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-ink-faint">{title}</h3>
      {children}
    </section>
  );
}

export function CustomerPanel(d: PanelData) {
  const c = d.conversation;
  const base = `/app/${d.storeId}`;
  return (
    <div className="pb-4">
      <div className="flex flex-col items-center px-5 pb-4 pt-6 text-center">
        <Avatar name={c.name} size={56} />
        <p className="mt-3 font-semibold text-ink">{d.customer?.name ?? c.name}</p>
        <p className="text-sm text-ink-muted tabular">{formatPhone(c.phone)}</p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {d.customer && d.canViewCustomer && (
            <Link href={`${base}/clients/${d.customer.id}`} className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-ink ring-1 ring-inset ring-line-strong hover:bg-surface-2">
              <UserRound className="size-4" aria-hidden /> Fiche client
            </Link>
          )}
          <a href={`https://wa.me/${c.phone}`} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-ink ring-1 ring-inset ring-line-strong hover:bg-surface-2">
            WhatsApp <ExternalLink className="size-3.5" aria-hidden />
          </a>
        </div>
      </div>

      {d.customer ? (
        <dl className="mx-5 grid grid-cols-3 divide-x divide-line rounded-[var(--radius-md)] bg-surface-2/60 py-3 text-center">
          <div>
            <dt className="text-[11px] text-ink-muted">Commandes</dt>
            <dd className="mt-0.5 font-semibold text-ink tabular">{d.customer.ordersCount}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-ink-muted">Valeur</dt>
            <dd className="mt-0.5 text-sm font-semibold text-ink">
              <Money amount={d.customer.totalSpent} currency={d.currency} />
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-ink-muted">Points</dt>
            <dd className="mt-0.5 font-semibold text-ink tabular">{d.customer.loyaltyPoints}</dd>
          </div>
        </dl>
      ) : (
        <p className="mx-5 rounded-[var(--radius-md)] bg-surface-2/60 px-3 py-2.5 text-center text-sm text-ink-muted">Ce numéro n&apos;a pas encore commandé.</p>
      )}

      <div className="mt-2">
        {d.pipeline && (
          <Section title="Entonnoir">
            <StageSelect key={c.stage} storeId={d.storeId} conversationId={c.id} value={c.stage} disabled={!d.canEdit} />
            <p className="mb-1.5 mt-3 text-xs font-medium text-ink-muted">Valeur estimée</p>
            <EstimatedValueForm storeId={d.storeId} conversationId={c.id} value={c.estimatedValue} currency={d.currency} disabled={!d.canEdit} />
          </Section>
        )}
        <Section title="Attribution">
          <AssignSelect key={c.assignedToId ?? "none"} storeId={d.storeId} conversationId={c.id} value={c.assignedToId} members={d.members} canAssign={d.canAssign} currentUserId={d.currentUserId} />
        </Section>
        <Section title="Étiquettes">
          <LabelsEditor key={c.labels.join("|")} storeId={d.storeId} conversationId={c.id} labels={c.labels} suggestions={d.labelSuggestions} disabled={!d.canEdit} />
        </Section>
        <Section title="Dernières commandes">
          {d.orders.length === 0 ? (
            <p className="text-sm text-ink-muted">Aucune commande pour ce numéro.</p>
          ) : (
            <ul className="space-y-1">
              {d.orders.map((o) => (
                <li key={o.id}>
                  <Link href={`${base}/commandes/${o.id}`} className="-mx-2 flex items-center gap-2 rounded-[var(--radius-sm)] px-2 py-2 hover:bg-surface-2">
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono text-xs font-semibold text-ink">{o.reference}</span>
                      <span className="block text-xs text-ink-faint">{formatDate(o.createdAt)}</span>
                    </span>
                    <span className="text-right">
                      <Money amount={o.total} currency={o.currency} className="block text-sm font-medium text-ink" />
                      <Badge tone={ORDER_STATUS_TONE[o.status]} className="mt-0.5 px-2 py-0 text-[11px] leading-[18px]">{ORDER_STATUS_LABELS[o.status]}</Badge>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
        {d.customer && (
          <Section title="Informations">
            <dl className="space-y-1.5 text-sm">
              {d.customer.email && (
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 text-ink-muted">E-mail</dt>
                  <dd className="min-w-0 break-words text-ink">{d.customer.email}</dd>
                </div>
              )}
              {d.customer.address && (
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 text-ink-muted">Adresse</dt>
                  <dd className="min-w-0 text-ink">{d.customer.address}</dd>
                </div>
              )}
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-ink-muted">Client depuis</dt>
                <dd className="text-ink">{formatDate(d.customer.createdAt)}</dd>
              </div>
              {d.customer.lastOrderAt && (
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 text-ink-muted">Dernière</dt>
                  <dd className="text-ink">{relativeTime(d.customer.lastOrderAt)}</dd>
                </div>
              )}
            </dl>
          </Section>
        )}
      </div>
    </div>
  );
}
