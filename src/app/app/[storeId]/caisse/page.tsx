import type { Metadata } from "next";
import { Calculator, WifiOff, Warehouse, ScrollText } from "lucide-react";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { PageHeader, Alert, EmptyState, Money } from "@/components/ui/misc";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Table, THead, TH, TBody, TR, TD } from "@/components/ui/table";
import { PlanGate } from "@/components/app/plan-gate";
import { listLocations } from "@/lib/locations/service";
import { MAX_DISCOUNT_PERCENT, type PosRole, type ZReport } from "@/lib/pos/cash";
import { OFFLINE_MAX_HOURS } from "@/lib/pos/sync";
import { formatDateTime } from "@/lib/utils";
import { DevicesPanel, ManagerCodeCard, type DeviceRow } from "./caisse-reglages-client";

export const metadata: Metadata = { title: "Caisse en magasin" };

const REPORTS_LIMIT = 12;

/**
 * Caisse en magasin, page de RÉGLAGE ET DE SUIVI, dans l'espace marchand (barre latérale conservée).
 *
 * C'est la cible du lien « Caisse » de la barre latérale : le porteur se retrouvait auparavant projeté
 * dans l'écran de vente plein écran, sans menu ni en-tête. La vente garde son écran dédié
 * (`/caisse/[storeId]`, plein écran pour la tablette du comptoir), accessible par un bouton explicite.
 *
 * Capacité `pos.sell` pour consulter ; les réglages sensibles (appareils, code du gérant) exigent
 * `store.settings`, vérifié ici pour l'affichage ET dans chaque action côté serveur.
 */
export default async function PosSettingsPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const ctx = await getStoreContext(storeId, "pos.sell");
  const plan = PLANS[ctx.planId];
  const canManage = ctx.can("store.settings");
  const posHref = `/caisse/${ctx.store.id}`;

  if (plan.limits.posDevices === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Caisse en magasin"
          description="Encaissez au comptoir, même sans réseau : les ventes sont mises en file puis synchronisées au retour de la connexion."
        />
        <PlanGate
          feature="pos"
          storeId={storeId}
          title="Caisse en magasin"
          description={`La caisse en magasin est incluse à partir du plan Business (plan actuel : ${plan.name}). Vos données restent intactes.`}
        />
      </div>
    );
  }

  const [devices, locations, sessions] = await Promise.all([
    db.posDevice.findMany({
      where: { storeId: ctx.store.id, revokedAt: null },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, tokenPrefix: true, locationId: true, lastSeenAt: true, lastSyncAt: true },
    }),
    listLocations(ctx.store.id),
    db.posSession.findMany({
      where: { storeId: ctx.store.id },
      orderBy: { openedAt: "desc" },
      take: REPORTS_LIMIT + 10,
      select: {
        id: true,
        status: true,
        deviceId: true,
        openedAt: true,
        closedAt: true,
        openingFloat: true,
        countedCash: true,
        expectedCash: true,
        discrepancy: true,
        report: true,
      },
    }),
  ]);

  const deviceName = (id: string) => devices.find((d) => d.id === id)?.name ?? "Appareil révoqué";
  const locationName = (id: string) => locations.find((l) => l.id === id)?.name ?? "Dépôt supprimé";
  const openSessions = sessions.filter((s) => s.status === "OPEN");
  const closedSessions = sessions.filter((s) => s.status === "CLOSED").slice(0, REPORTS_LIMIT);

  const deviceRows: DeviceRow[] = devices.map((d) => ({
    id: d.id,
    name: d.name,
    tokenPrefix: d.tokenPrefix,
    locationName: locationName(d.locationId),
    lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
    lastSyncAt: d.lastSyncAt?.toISOString() ?? null,
    openSession: openSessions.some((s) => s.deviceId === d.id),
  }));

  const cap = MAX_DISCOUNT_PERCENT[ctx.role as PosRole] ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Caisse en magasin"
        description="Réglez vos appareils, suivez les sessions ouvertes et relisez vos rapports Z. La vente se fait sur l'écran de caisse, en plein écran."
      />

      <Card>
        <CardHeader title="Comment ça marche" description="La caisse se met en route en 4 étapes. À faire une seule fois pour les étapes 1 et 2." />
        <CardBody>
          <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { n: 1, t: "Enregistrer l'appareil", d: "Ajoutez la tablette ou le téléphone du comptoir ci-dessous. Vous obtenez un jeton." },
              { n: 2, t: "Associer l'appareil", d: "Ouvrez la caisse sur cet appareil et collez le jeton. Il y reste enregistré." },
              { n: 3, t: "Ouvrir une session", d: "Saisissez le fond de caisse, puis encaissez (espèces ou Mobile Money) et imprimez le reçu." },
              { n: 4, t: "Clôturer (rapport Z)", d: "En fin de journée, comptez la caisse : l'écart et le rapport Z sont calculés." },
            ].map((s) => (
              <li key={s.n} className="rounded-[var(--radius-md)] bg-surface-2 p-3 ring-1 ring-inset ring-line">
                <span className="inline-flex size-7 items-center justify-center rounded-full bg-primary text-[13px] font-semibold text-on-primary">{s.n}</span>
                <p className="mt-2 text-sm font-semibold text-ink">{s.t}</p>
                <p className="mt-0.5 text-[13px] text-ink-muted">{s.d}</p>
              </li>
            ))}
          </ol>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Écran de vente"
          description="À utiliser sur la tablette du comptoir : il s'affiche en plein écran, sans barre latérale, et fonctionne hors réseau. Un bouton « Espace marchand » y ramène ici à tout moment."
        />
        <CardBody className="space-y-4">
          <ButtonLink href={posHref} variant="accent" size="lg" className="h-12 w-full sm:w-auto">
            <Calculator className="size-4" aria-hidden /> Ouvrir la caisse
          </ButtonLink>
          {devices.length === 0 && (
            <p className="text-sm text-ink-muted">
              Aucun appareil n&apos;est encore enregistré : enregistrez-en un ci-dessous, puis collez son jeton dans l&apos;écran de vente ouvert
              sur la tablette.
            </p>
          )}
          <p className="text-sm text-ink-muted">
            Votre rôle permet une remise jusqu&apos;à {cap} %
            {cap < 100 ? " ; au-delà, le code du gérant est demandé au comptoir." : "."}
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Sessions ouvertes"
          description="Une session par appareil : fond de caisse à l'ouverture, comptage et rapport Z à la clôture. La clôture se fait depuis l'écran de vente de l'appareil concerné."
        />
        <CardBody>
          {openSessions.length === 0 ? (
            <EmptyState
              icon={Calculator}
              title="Aucune caisse ouverte"
              description="Ouvrez l'écran de vente sur la tablette du comptoir et saisissez le fond de caisse pour démarrer une session."
              action={
                <ButtonLink href={posHref} variant="accent" size="sm" className="h-11 sm:h-9">
                  Ouvrir la caisse
                </ButtonLink>
              }
            />
          ) : (
            <Table minWidth={560}>
              <THead>
                <TR>
                  <TH>Appareil</TH>
                  <TH>Ouverte le</TH>
                  <TH align="right">Fond de caisse</TH>
                </TR>
              </THead>
              <TBody>
                {openSessions.map((s) => (
                  <TR key={s.id}>
                    <TD>
                      <span className="font-medium text-ink">{deviceName(s.deviceId)}</span>
                      <Badge tone="success" className="ml-2">
                        Ouverte
                      </Badge>
                    </TD>
                    <TD>{formatDateTime(s.openedAt)}</TD>
                    <TD align="right" className="tabular">
                      <Money amount={s.openingFloat} currency={ctx.store.currency} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Rapports Z"
          description="Figés à la clôture, jamais modifiables. L'écart compare les espèces comptées aux espèces attendues (fond + encaissements espèces − remboursements espèces − sorties + entrées)."
        />
        <CardBody>
          {closedSessions.length === 0 ? (
            <EmptyState
              icon={ScrollText}
              title="Aucun rapport Z"
              description="Le premier rapport apparaîtra ici dès la première clôture de caisse."
            />
          ) : (
            <Table minWidth={760}>
              <THead>
                <TR>
                  <TH>Appareil</TH>
                  <TH>Clôturée le</TH>
                  <TH align="right">Ventes</TH>
                  <TH align="right">Encaissé</TH>
                  <TH align="right">Espèces comptées</TH>
                  <TH align="right">Écart</TH>
                </TR>
              </THead>
              <TBody>
                {closedSessions.map((s) => {
                  const report = (s.report ?? null) as ZReport | null;
                  const gap = s.discrepancy ?? report?.discrepancy ?? 0;
                  return (
                    <TR key={s.id}>
                      <TD>
                        <span className="font-medium text-ink">{deviceName(s.deviceId)}</span>
                        {(report?.offlinePriceMismatches ?? 0) > 0 && (
                          <Badge tone="warning" className="ml-2">
                            {report?.offlinePriceMismatches} prix hors ligne
                          </Badge>
                        )}
                      </TD>
                      <TD>{s.closedAt ? formatDateTime(s.closedAt) : "—"}</TD>
                      <TD align="right" className="tabular">
                        {report?.salesCount ?? 0}
                      </TD>
                      <TD align="right" className="tabular">
                        <Money amount={report?.grossTotal ?? 0} currency={ctx.store.currency} />
                      </TD>
                      <TD align="right" className="tabular">
                        <Money amount={s.countedCash ?? 0} currency={ctx.store.currency} />
                      </TD>
                      <TD align="right" className={`tabular ${gap === 0 ? "" : gap > 0 ? "text-warning" : "text-danger"}`}>
                        {gap > 0 ? "+" : ""}
                        <Money amount={gap} currency={ctx.store.currency} />
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <DevicesPanel
        storeId={ctx.store.id}
        devices={deviceRows}
        locations={locations.filter((l) => l.active).map((l) => ({ id: l.id, name: l.name }))}
        limit={plan.limits.posDevices}
        planName={plan.name}
        canManage={canManage}
      />

      <ManagerCodeCard
        storeId={ctx.store.id}
        isSet={!!ctx.store.posManagerCodeHash}
        setAt={ctx.store.posManagerCodeSetAt?.toISOString() ?? null}
        canManage={canManage}
      />

      <Card>
        <CardHeader title="Dépôts associés" description="Le stock du dépôt lié à l'appareil est décrémenté à chaque vente au comptoir." />
        <CardBody className="space-y-3">
          {deviceRows.length === 0 ? (
            <p className="text-sm text-ink-muted">Aucun appareil, donc aucun dépôt associé pour l&apos;instant.</p>
          ) : (
            <ul className="space-y-1 text-sm text-ink-muted">
              {deviceRows.map((d) => (
                <li key={d.id}>
                  <span className="font-medium text-ink">{d.name}</span> vend sur le stock de <span className="font-medium text-ink">{d.locationName}</span>
                </li>
              ))}
            </ul>
          )}
          <ButtonLink href={`/app/${storeId}/depots`} variant="secondary" size="sm" className="h-11 sm:h-9">
            <Warehouse className="size-4" aria-hidden /> Gérer les dépôts
          </ButtonLink>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Fonctionnement hors réseau" description="La caisse continue de vendre quand la connexion tombe." />
        <CardBody className="space-y-3 text-sm text-ink-muted">
          <ul className="space-y-2">
            <li className="flex gap-2">
              <WifiOff className="mt-0.5 size-4 shrink-0 text-ink-faint" aria-hidden />
              <span>
                L&apos;écran de vente garde une copie de votre catalogue sur l&apos;appareil, rafraîchie toutes les quinze minutes quand le réseau
                est là.
              </span>
            </li>
            <li className="flex gap-2">
              <WifiOff className="mt-0.5 size-4 shrink-0 text-ink-faint" aria-hidden />
              <span>
                Hors réseau, chaque vente est mise en file sur l&apos;appareil, puis envoyée automatiquement au retour de la connexion. Le stock et
                les prix sont recalculés par le serveur à ce moment-là.
              </span>
            </li>
            <li className="flex gap-2">
              <WifiOff className="mt-0.5 size-4 shrink-0 text-ink-faint" aria-hidden />
              <span>
                Au-delà de {OFFLINE_MAX_HOURS} heures sans synchronisation, la vente est bloquée : reconnectez l&apos;appareil pour reprendre.
              </span>
            </li>
            <li className="flex gap-2">
              <WifiOff className="mt-0.5 size-4 shrink-0 text-ink-faint" aria-hidden />
              <span>
                Une vente refusée par le serveur après encaissement reste visible sur l&apos;appareil, dans « Ventes à régulariser » : elle
                n&apos;est jamais supprimée sans action du gérant.
              </span>
            </li>
          </ul>
          <Alert tone="info" title="Une session se clôture depuis son appareil">
            Le rapport Z est figé par l&apos;appareil qui a ouvert la session, une fois sa file de ventes vidée. C&apos;est ce qui garantit
            qu&apos;aucune vente n&apos;échappe au comptage.
          </Alert>
        </CardBody>
      </Card>
    </div>
  );
}
