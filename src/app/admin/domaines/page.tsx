import type { Metadata } from "next";
import { domainToUnicode } from "node:url";
import Link from "next/link";
import type { DomainRegistrationStatus } from "@prisma/client";
import { requirePlatformAdmin } from "@/lib/auth/permissions";
import { getAdminContext } from "@/lib/admin/context";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { PageHeader, Alert, EmptyState } from "@/components/ui/misc";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Table, THead, TH, TBody, TR, TD } from "@/components/ui/table";
import { getDomainMargin } from "@/lib/domains/service";
import { domainSalesEnabled, fakeRegistrarEnabled } from "@/lib/domains/registrar";
import { MarginForm, RetryChargeButton, RetryDnsButton } from "./domains-admin-client";

export const metadata: Metadata = { title: "Noms de domaine" };

const STATUS_LABEL: Record<DomainRegistrationStatus, string> = {
  AWAITING_PAYMENT: "En attente de paiement",
  PENDING: "En cours",
  REGISTERED: "Enregistré",
  FAILED: "Échec",
  EXPIRED: "Expiré",
  TRANSFERRED_OUT: "Transféré",
  CANCELLED: "Annulé",
};
const STATUS_TONE: Record<DomainRegistrationStatus, BadgeTone> = {
  AWAITING_PAYMENT: "neutral",
  PENDING: "info",
  REGISTERED: "success",
  FAILED: "danger",
  EXPIRED: "warning",
  TRANSFERRED_OUT: "neutral",
  CANCELLED: "neutral",
};

/** Domaines vendus via Route 53 : échéances, coûts, prix, commissions, relance des opérations échouées. */
export default async function AdminDomains() {
  await requirePlatformAdmin();
  const ctx = await getAdminContext();
  const canEdit = ctx.can("billing.manage");
  const [regs, commissions, failed, margin] = await Promise.all([
    db.domainRegistration.findMany({
      where: { status: { not: "CANCELLED" } },
      orderBy: [{ status: "asc" }, { expiresAt: "asc" }],
      take: 300,
      include: { store: { select: { id: true, name: true } }, charges: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, status: true, kind: true, lastError: true } } },
    }),
    db.domainCharge.groupBy({ by: ["currency"], where: { status: { in: ["PAID", "PROCESSING", "APPLIED"] } }, _sum: { margin: true, price: true, wholesaleCostUsdCents: true }, _count: { _all: true } }),
    db.domainCharge.findMany({ where: { status: "FAILED" }, orderBy: { updatedAt: "desc" }, take: 50, include: { registration: { select: { domainName: true } }, store: { select: { id: true, name: true } } } }),
    getDomainMargin(),
  ]);

  return (
    <>
      <PageHeader title="Noms de domaine" description="Domaines achetés par les boutiques via Axi (revendeur Amazon Route 53). Commission = prix facturé moins coût de gros converti." />
      {!domainSalesEnabled() && (
        <Alert tone="warning" className="mb-6" title="Vente désactivée">
          Posez <code>DOMAINS_ENABLED=1</code> (et <code>DOMAINS_TARGET_IPV4</code>) sur le serveur après avoir attaché la politique IAM au rôle de l&apos;instance. Voir <code>docs/DOMAINES.md</code>.
        </Alert>
      )}
      {fakeRegistrarEnabled() && (
        <Alert tone="info" className="mb-6" title="Registrar simulé">
          <code>DOMAINS_FAKE=1</code> : aucun achat réel (développement uniquement).
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card as="section" aria-labelledby="dom-commissions">
          <CardHeader title={<span id="dom-commissions">Commissions encaissées</span>} description="Achats et renouvellements payés, par devise de facturation." />
          <CardBody>
            {commissions.length === 0 ? (
              <p className="text-sm text-ink-muted">Aucune vente pour l&apos;instant.</p>
            ) : (
              <ul className="space-y-2">
                {commissions.map((c) => (
                  <li key={c.currency} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                    <span className="text-ink-muted">
                      {c._count._all} vente{c._count._all > 1 ? "s" : ""} en {c.currency} · chiffre {formatMoney(c._sum.price ?? 0, c.currency)} · coût {formatMoney(c._sum.wholesaleCostUsdCents ?? 0, "USD")}
                    </span>
                    <strong className="font-mono tabular text-ink">{formatMoney(c._sum.margin ?? 0, c.currency)}</strong>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card as="section" aria-labelledby="dom-margin">
          <CardHeader title={<span id="dom-margin">Marge appliquée</span>} description="Pourcentage du coût de gros, avec un minimum par année. S'applique aux prochaines factures." />
          <CardBody>
            <MarginForm percent={margin.percentBps / 100} minUsd={margin.minUsdCentsPerYear / 100} disabled={!canEdit} />
          </CardBody>
        </Card>
      </div>

      {failed.length > 0 && (
        <Card as="section" aria-labelledby="dom-failed" className="mt-4">
          <CardHeader title={<span id="dom-failed">Opérations en échec (payées)</span>} description="Vérifiez l'état du domaine dans la console Route 53 avant de relancer." />
          <Table bare minWidth={720}>
            <THead>
              <tr>
                <TH>Domaine</TH>
                <TH>Boutique</TH>
                <TH>Type</TH>
                <TH>Erreur</TH>
                <TH align="right">Action</TH>
              </tr>
            </THead>
            <TBody>
              {failed.map((c) => (
                <TR key={c.id}>
                  <TD className="font-mono text-[13px]">{c.registration.domainName}</TD>
                  <TD>
                    {c.store ? <Link href={`/admin/boutiques/${c.store.id}`} className="text-primary hover:underline">{c.store.name}</Link> : <span className="text-ink-muted">Boutique supprimée</span>}
                  </TD>
                  <TD>{c.kind === "REGISTER" ? "Achat" : "Renouvellement"}</TD>
                  <TD className="max-w-[320px] text-[13px] text-ink-muted">{c.lastError ?? "—"}</TD>
                  <TD align="right">{canEdit && <RetryChargeButton chargeId={c.id} />}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}

      <Card as="section" aria-labelledby="dom-list" className="mt-4">
        <CardHeader title={<span id="dom-list">Domaines vendus</span>} description={`${regs.length} domaine${regs.length > 1 ? "s" : ""}`} />
        {regs.length === 0 ? (
          <div className="px-5 pb-5 sm:px-6">
            <EmptyState title="Aucun domaine vendu" description="Les achats des boutiques apparaîtront ici." />
          </div>
        ) : (
          <Table bare minWidth={960}>
            <THead>
              <tr>
                <TH>Domaine</TH>
                <TH>Boutique</TH>
                <TH>Statut</TH>
                <TH>Échéance</TH>
                <TH align="right">Coût</TH>
                <TH align="right">Prix</TH>
                <TH align="right">Marge</TH>
                <TH>DNS</TH>
              </tr>
            </THead>
            <TBody>
              {regs.map((r) => (
                <TR key={r.id}>
                  <TD className="font-mono text-[13px]">
                    {r.domainName}
                    {r.domainName.includes("xn--") && <span className="ml-2 font-sans text-xs text-ink-muted">({domainToUnicode(r.domainName)})</span>}
                    {!r.autoRenew && r.status === "REGISTERED" && <span className="ml-2 text-xs text-ink-muted">(sans renouvellement auto)</span>}
                  </TD>
                  <TD>
                    {r.store ? <Link href={`/admin/boutiques/${r.store.id}`} className="text-primary hover:underline">{r.store.name}</Link> : <span className="text-ink-muted">Boutique supprimée</span>}
                  </TD>
                  <TD>
                    <Badge tone={STATUS_TONE[r.status]} dot>{STATUS_LABEL[r.status]}</Badge>
                  </TD>
                  <TD className="whitespace-nowrap text-ink-muted">{r.expiresAt ? formatDate(r.expiresAt) : "—"}</TD>
                  <TD align="right" className="font-mono text-[13px] tabular">{formatMoney(r.wholesaleCostUsdCents, "USD")}</TD>
                  <TD align="right" className="font-mono text-[13px] tabular">{formatMoney(r.price, r.currency)}</TD>
                  <TD align="right" className="font-mono text-[13px] tabular">{formatMoney(r.margin, r.currency)}</TD>
                  <TD>
                    {r.status !== "REGISTERED" ? "—" : r.dnsConfiguredAt ? <Badge tone="success">OK</Badge> : canEdit ? <RetryDnsButton registrationId={r.id} /> : <Badge tone="warning">En attente</Badge>}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
