import type { Metadata } from "next";
import { getStoreContext } from "@/lib/auth/permissions";
import { PLANS } from "@/config/plans";
import { parseReturnPolicy } from "@/lib/returns/policy";
import { PageHeader, Alert } from "@/components/ui/misc";
import { Card, CardBody } from "@/components/ui/card";
import { PlanGate } from "@/components/app/plan-gate";
import { ReturnPolicyForm } from "./return-policy-form";

export const metadata: Metadata = { title: "Politique de retours" };

export default async function ReturnPolicyPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const ctx = await getStoreContext(storeId, "store.settings");
  const policy = parseReturnPolicy(ctx.store.returnPolicy);
  const hasFeature = PLANS[ctx.planId].features.returnsPortal;
  const back = { href: `/app/${ctx.store.id}/retours`, label: "Retours" };

  if (!hasFeature && !policy.enabled) {
    return (
      <>
        <PageHeader back={back} title="Politique de retours" />
        <PlanGate storeId={ctx.store.id} feature="returnsPortal" />
      </>
    );
  }
  return (
    <>
      <PageHeader back={back} title="Politique de retours" description="Délai, résolutions proposées et instructions. Le bouton « Retourner des articles » apparaît sur le suivi des commandes livrées." />
      {!hasFeature && (
        <Alert tone="warning" className="mb-5">
          Votre plan n'inclut plus les retours en libre-service : vous pouvez seulement les désactiver.
        </Alert>
      )}
      <Card>
        <CardBody>
          <ReturnPolicyForm storeId={ctx.store.id} policy={policy} locked={!hasFeature} />
        </CardBody>
      </Card>
    </>
  );
}
