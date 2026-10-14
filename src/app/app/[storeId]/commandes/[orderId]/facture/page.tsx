import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FileText, Clock } from "lucide-react";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { listOrderDocuments } from "@/lib/tax/invoice";
import { InvoiceDocument, INVOICE_PRINT_CSS } from "@/lib/tax/invoice-document";
import { EmptyState, Alert } from "@/components/ui/misc";
import { PlanGate } from "@/components/app/plan-gate";
import { InvoiceToolbar, IssueInvoiceButton, IssueCreditNotesButton } from "./invoice-actions";

export const metadata: Metadata = { title: "Facture", robots: { index: false, follow: false } };

const PAID = new Set(["PAID", "PARTIALLY_REFUNDED", "REFUNDED"]);

/** Facture et avoirs d'une commande : accès réservé aux membres de la boutique (orders.view). */
export default async function OrderInvoicePage({ params }: { params: Promise<{ storeId: string; orderId: string }> }) {
  const { storeId, orderId } = await params;
  const ctx = await getStoreContext(storeId, "orders.view");
  const order = await db.order.findFirst({ where: { id: orderId, storeId: ctx.store.id }, select: { id: true, reference: true, paymentStatus: true } });
  if (!order) notFound();

  const docs = await listOrderDocuments(ctx.store.id, order.id);
  const invoice = docs.find((d) => d.kind === "INVOICE") ?? null;
  const canManage = ctx.can("orders.manage");
  const hasPlan = PLANS[ctx.planId].features.invoices;
  const backHref = `/app/${ctx.store.id}/commandes/${order.id}`;

  let missingCreditNotes = 0;
  if (invoice) {
    const refunds = await db.refund.findMany({ where: { orderId: order.id, status: "DONE" }, select: { id: true } });
    const covered = new Set(docs.filter((d) => d.kind === "CREDIT_NOTE").map((d) => d.refundId));
    missingCreditNotes = refunds.filter((r) => !covered.has(r.id)).length;
  }

  return (
    <div className="invoice-root mx-auto max-w-3xl">
      <style>{INVOICE_PRINT_CSS}</style>
      <div data-print-hide className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.03em] text-ink">{invoice ? `Facture ${invoice.number}` : "Facture"}</h1>
          <p className="mt-0.5 text-sm text-ink-muted">
            Commande {order.reference}
            {docs.length > 1 ? ` · ${docs.length - 1} avoir${docs.length > 2 ? "s" : ""}` : ""}. Document non modifiable : une correction passe par un avoir.
          </p>
        </div>
        <InvoiceToolbar backHref={backHref} printable={!!invoice} />
      </div>

      {missingCreditNotes > 0 && (
        <div data-print-hide className="mb-5">
          <Alert tone="warning" title={`${missingCreditNotes} remboursement${missingCreditNotes > 1 ? "s" : ""} sans avoir`}>
            <p>Chaque remboursement d&apos;une commande facturée doit donner lieu à un avoir fiscal numéroté.</p>
            {canManage && (
              <div className="mt-3">
                <IssueCreditNotesButton storeId={ctx.store.id} orderId={order.id} />
              </div>
            )}
          </Alert>
        </div>
      )}

      {invoice ? (
        <div className="space-y-6">
          {docs.map((d) => (
            <InvoiceDocument key={d.id} doc={d.snapshot} />
          ))}
        </div>
      ) : !hasPlan ? (
        <PlanGate storeId={ctx.store.id} feature="invoices" />
      ) : PAID.has(order.paymentStatus) ? (
        <EmptyState
          icon={FileText}
          title="Aucune facture émise"
          description="La facture reçoit le prochain numéro de la boutique et ne pourra plus être modifiée."
          action={canManage ? <IssueInvoiceButton storeId={ctx.store.id} orderId={order.id} /> : undefined}
        />
      ) : (
        <EmptyState icon={Clock} title="Facture disponible après paiement" description="Confirmez le paiement de la commande : la facture est alors émise automatiquement (si l'option est active) ou depuis cette page." />
      )}
    </div>
  );
}
