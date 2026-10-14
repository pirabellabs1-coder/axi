import type { Metadata } from "next";
import { getStoreContext } from "@/lib/auth/permissions";
import { PLANS } from "@/config/plans";
import { getBalances } from "@/lib/credits";
import { isWhatsappApiActive } from "@/lib/inbox/service";
import { audienceOverview } from "@/lib/campaigns/service";
import { PageHeader } from "@/components/ui/misc";
import { PlanGate } from "@/components/app/plan-gate";
import { CampaignWizard } from "./campaign-wizard";

export const metadata: Metadata = { title: "Nouvelle campagne" };

export default async function NewCampaignPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const ctx = await getStoreContext(storeId, "customers.manage");
  const store = ctx.store;
  const back = { href: `/app/${store.id}/campagnes`, label: "Campagnes" };

  if (!PLANS[ctx.planId].features.campaigns) {
    return (
      <>
        <PageHeader title="Nouvelle campagne" back={back} />
        <PlanGate storeId={store.id} feature="campaigns" />
      </>
    );
  }

  const [overview, balances, apiActive] = await Promise.all([audienceOverview(store.id), getBalances(store.id), isWhatsappApiActive(store.id)]);

  return (
    <>
      <PageHeader title="Nouvelle campagne" description="Trois étapes : l'audience, le message, puis l'envoi. Le coût s'affiche avant de confirmer." back={back} />
      <CampaignWizard
        storeId={store.id}
        storeName={store.name}
        overview={overview}
        balance={balances.WA_MARKETING}
        apiActive={apiActive}
        canBuyCredits={ctx.can("billing.manage")}
      />
    </>
  );
}
