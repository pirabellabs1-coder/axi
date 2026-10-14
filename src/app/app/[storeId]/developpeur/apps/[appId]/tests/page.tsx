import type { Metadata } from "next";
import { Store } from "lucide-react";
import { db } from "@/lib/db";
import { listTestStores } from "@/lib/apps/dev-queries";
import { isTestInstallConfig } from "@/lib/apps/dev-logic";
import { Alert, EmptyState } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { loadAppTab } from "../_data";
import { TestStoreRow, type TestRowState } from "./test-store-row";

export const metadata: Metadata = { title: "Tests" };

export default async function AppTestsPage({ params }: { params: Promise<{ storeId: string; appId: string }> }) {
  const { user, app } = await loadAppTab(params);
  const stores = await listTestStores(user.id);
  const installs = stores.length
    ? await db.appInstallation.findMany({
        where: { appId: app.id, storeId: { in: stores.map((s) => s.id) }, status: { not: "UNINSTALLED" } },
        select: { storeId: true, config: true, installedAt: true, grantedScopes: true },
      })
    : [];
  const byStore = new Map(installs.map((i) => [i.storeId, i]));

  return (
    <div className="space-y-6">
      <Alert tone="info" title="Installer en test">
        Installez votre application sur une boutique dont vous êtes propriétaire (ou sur laquelle un marchand vous a invité comme
        collaborateur), même si elle est en brouillon ou en revue. Une installation de test n&apos;est jamais facturée, n&apos;apparaît pas
        dans vos statistiques d&apos;installations et reste invisible des autres marchands.
      </Alert>

      {app.status === "SUSPENDED" ? (
        <Alert tone="danger">Application suspendue : l&apos;installation de test n&apos;est plus possible.</Alert>
      ) : stores.length === 0 ? (
        <EmptyState
          icon={Store}
          title="Aucune boutique de test disponible"
          description="Créez une boutique (gratuite) depuis votre espace marchand, ou demandez à un marchand de vous inviter comme collaborateur développeur."
        />
      ) : (
        <Card>
          <CardHeader title="Vos boutiques" description="Les autorisations accordées sont bornées par le plan de chaque boutique." />
          <CardBody>
            <ul className="divide-y divide-line">
              {stores.map((s) => {
                const inst = byStore.get(s.id);
                const state: TestRowState = !inst ? "none" : isTestInstallConfig(inst.config) ? "test" : "live";
                return (
                  <TestStoreRow
                    key={s.id}
                    appId={app.id}
                    appSlug={app.slug}
                    store={s}
                    state={state}
                    installedAt={inst?.installedAt.toISOString() ?? null}
                    grantedCount={inst?.grantedScopes.length ?? 0}
                    requestedCount={app.requestedScopes.length}
                  />
                );
              })}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
