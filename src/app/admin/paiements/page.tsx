import type { Metadata } from "next";
import Link from "next/link";
import { Webhook, CreditCard, ShieldAlert, ShieldCheck } from "lucide-react";
import type { PaymentAttemptStatus } from "@prisma/client";
import { requirePlatformAdmin } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/utils";
import { PageHeader, EmptyState, Stat } from "@/components/ui/misc";
import { Select } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ATTEMPT_STATUS, StatusBadge, Pagination, PAGE_SIZE, pageParam, str, JsonDetails } from "@/components/app/admin-bits";
import { ReconcileButton } from "./reconcile-button";

export const metadata: Metadata = { title: "Paiements" };

const ATTEMPT_STATUSES: PaymentAttemptStatus[] = ["CREATED", "PENDING", "INITIATED", "CONFIRMED", "FAILED", "EXPIRED"];

export default async function AdminPayments({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const status = str(sp.status);
  const page = pageParam(sp.page);
  const where = status && ATTEMPT_STATUSES.includes(status as PaymentAttemptStatus) ? { status: status as PaymentAttemptStatus } : {};

  const [events, counts, total, attempts] = await Promise.all([
    db.providerEvent.findMany({ orderBy: { receivedAt: "desc" }, take: 30, include: { paymentAttempt: { select: { id: true, orderId: true, order: { select: { reference: true, storeId: true } } } } } }),
    db.paymentAttempt.groupBy({ by: ["status"], _count: { _all: true } }),
    db.paymentAttempt.count({ where }),
    db.paymentAttempt.findMany({ where, orderBy: { updatedAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { order: { select: { reference: true, storeId: true, store: { select: { name: true } } } } } }),
  ]);
  const countOf = (s: PaymentAttemptStatus) => counts.find((c) => c.status === s)?._count._all ?? 0;
  const invalidSignatures = events.filter((e) => !e.signatureValid).length;

  return (
    <>
      <PageHeader
        title="Paiements"
        description="Événements reçus des passerelles et tentatives de paiement. Le rapprochement interroge les fournisseurs pour les tentatives initiées depuis plus de 10 minutes."
        actions={<ReconcileButton />}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="En attente / initiées" value={countOf("PENDING") + countOf("INITIATED")} icon={CreditCard} />
        <Stat label="Confirmées" value={countOf("CONFIRMED")} icon={ShieldCheck} />
        <Stat label="Échecs / expirées" value={countOf("FAILED") + countOf("EXPIRED")} icon={ShieldAlert} />
        <Stat label="Signatures invalides (30 derniers)" value={invalidSignatures} icon={Webhook} />
      </div>

      <section className="mt-8" aria-labelledby="events">
        <h2 id="events" className="mb-3 font-display text-lg font-semibold">Événements fournisseurs (webhooks)</h2>
        {events.length === 0 ? (
          <EmptyState icon={Webhook} title="Aucun événement reçu" description="Les webhooks des passerelles (FedaPay, KkiaPay, PayDunya, Stripe) apparaîtront ici une fois les intégrations configurées." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Reçu</TH>
                <TH>Fournisseur</TH>
                <TH>Type</TH>
                <TH>Signature</TH>
                <TH>Traité</TH>
                <TH>Commande</TH>
                <TH>Erreur / payload</TH>
              </TR>
            </THead>
            <TBody>
              {events.map((e) => (
                <TR key={e.id}>
                  <TD><span className="text-ink-muted">{formatDateTime(e.receivedAt)}</span></TD>
                  <TD>{e.provider}</TD>
                  <TD><span className="font-mono text-xs">{e.type}</span><span className="block text-[11px] text-ink-faint">{e.eventId}</span></TD>
                  <TD><Badge tone={e.signatureValid ? "success" : "danger"}>{e.signatureValid ? "Valide" : "Invalide"}</Badge></TD>
                  <TD>{e.processedAt ? <span className="text-ink-muted">{formatDateTime(e.processedAt)}</span> : <Badge tone="sun">Non traité</Badge>}</TD>
                  <TD>{e.paymentAttempt ? <Link href={`/admin/boutiques/${e.paymentAttempt.order.storeId}`} className="font-mono text-xs hover:text-primary">{e.paymentAttempt.order.reference}</Link> : "-"}</TD>
                  <TD>
                    {e.error && <p className="mb-1 text-xs text-danger">{e.error}</p>}
                    <JsonDetails value={e.payload} summary="Payload" />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </section>

      <section className="mt-8" aria-labelledby="attempts">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="attempts" className="font-display text-lg font-semibold">Tentatives de paiement <span className="text-sm font-normal text-ink-muted">({total})</span></h2>
          <form method="get" className="flex items-center gap-2" aria-label="Filtrer les tentatives">
            <Select fieldSize="sm" name="status" defaultValue={status} aria-label="Statut" className="">
              <option value="">Tous statuts</option>
              {ATTEMPT_STATUSES.map((s) => (
                <option key={s} value={s}>{ATTEMPT_STATUS[s].label} ({countOf(s)})</option>
              ))}
            </Select>
            <Button type="submit" variant="secondary" size="sm">Filtrer</Button>
          </form>
        </div>
        {attempts.length === 0 ? (
          <EmptyState icon={CreditCard} title="Aucune tentative" />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Commande</TH>
                <TH>Boutique</TH>
                <TH>Fournisseur</TH>
                <TH>Statut</TH>
                <TH align="right">Montant</TH>
                <TH>Référence</TH>
                <TH align="right">Mis à jour</TH>
              </TR>
            </THead>
            <TBody>
              {attempts.map((a) => (
                <TR key={a.id}>
                  <TD><span className="font-mono text-xs">{a.order.reference}</span></TD>
                  <TD><Link href={`/admin/boutiques/${a.order.storeId}`} className="hover:text-primary">{a.order.store.name}</Link></TD>
                  <TD>{a.provider}</TD>
                  <TD><StatusBadge map={ATTEMPT_STATUS} value={a.status} />{a.failureReason && <span className="block text-[11px] text-danger">{a.failureReason}</span>}</TD>
                  <TD align="right">{formatMoney(a.amount, a.currency)}</TD>
                  <TD><span className="font-mono text-xs text-ink-muted">{a.providerRef ?? a.customerRef ?? "-"}</span></TD>
                  <TD align="right"><span className="text-ink-muted">{formatDateTime(a.updatedAt)}</span></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        <Pagination page={page} total={total} basePath="/admin/paiements" params={{ status }} />
      </section>
    </>
  );
}
