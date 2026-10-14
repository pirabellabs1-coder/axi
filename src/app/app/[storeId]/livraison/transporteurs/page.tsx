import type { Metadata } from "next";
import { Truck } from "lucide-react";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { PageHeader, Alert, EmptyState } from "@/components/ui/misc";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PlanGate } from "@/components/app/plan-gate";
import { CARRIER_LABELS, CARRIERS_PENDING_INTEGRATION, type CarrierId } from "@/lib/carriers/types";
import { CarrierDialog, CarrierDelete } from "./transporteurs-client";

export const metadata: Metadata = { title: "Transporteurs" };

/**
 * Comptes transporteurs (lot 3 §1.2). « Livreur interne » couvre tout le besoin sans API : étiquette
 * A6 imprimable, page livreur avec code de remise, suivi acheteur. Les intégrations d'API
 * (Gozem, Yango, DHL, La Poste) sont des points d'intégration : le contrat, le mapping des statuts et
 * la vérification des webhooks sont en place, les appels réels attendent les comptes du porteur.
 */
export default async function CarriersPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const ctx = await getStoreContext(storeId, "delivery.manage");
  const plan = PLANS[ctx.planId];
  const accounts = await db.carrierAccount.findMany({
    where: { storeId: ctx.store.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, carrier: true, name: true, active: true, credentialsEncrypted: true, _count: { select: { shipments: true } } },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Transporteurs"
        description="Vos livreurs et transporteurs. Un livreur interne suffit pour imprimer les étiquettes et suivre les livraisons."
        back={{ href: `/app/${storeId}/livraison`, label: "Livraison et retrait" }}
        actions={plan.features.couriers ? <CarrierDialog storeId={storeId} canUseApi={plan.features.carriers} /> : undefined}
      />

      {!plan.features.couriers && <PlanGate feature="couriers" storeId={storeId} />}

      <Card>
        <CardBody>
          {accounts.length === 0 ? (
            <EmptyState icon={Truck} title="Aucun transporteur" description="Ajoutez votre livreur interne pour imprimer des étiquettes et suivre les livraisons." action={plan.features.couriers ? <CarrierDialog storeId={storeId} canUseApi={plan.features.carriers} /> : undefined} />
          ) : (
            <ul className="divide-y divide-line">
              {accounts.map((account) => {
                const carrier = account.carrier as CarrierId;
                const pending = CARRIERS_PENDING_INTEGRATION.includes(carrier);
                return (
                  <li key={account.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="font-medium text-ink">
                        {account.name} {!account.active && <Badge tone="neutral">Inactif</Badge>}
                      </p>
                      <p className="text-sm text-ink-muted">
                        {CARRIER_LABELS[carrier] ?? carrier}
                        {account.credentialsEncrypted ? " · identifiants enregistrés" : " · aucun identifiant"}
                        {account._count.shipments > 0 ? ` · ${account._count.shipments} expédition${account._count.shipments > 1 ? "s" : ""}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {pending && <Badge tone="warning">API à activer</Badge>}
                      <CarrierDialog storeId={storeId} canUseApi={plan.features.carriers} account={{ id: account.id, carrier, name: account.name, active: account.active }} />
                      <CarrierDelete storeId={storeId} id={account.id} name={account.name} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      <Alert tone="info" title="Webhooks des transporteurs">
        Adresse à communiquer au transporteur : <code className="rounded bg-surface-2 px-1">/api/webhooks/carriers/&lt;transporteur&gt;</code>. Les événements sont signés (HMAC), vérifiés et idempotents ; un
        événement tardif ne fait jamais reculer le suivi d&apos;une expédition.
      </Alert>
    </div>
  );
}
