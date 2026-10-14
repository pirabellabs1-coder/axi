import type { Metadata } from "next";
import Link from "next/link";
import { Store as StoreIcon, Truck, Bike, Lock, ArrowRight, Scale } from "lucide-react";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { zoneLimit, planForMoreZones } from "@/lib/delivery/limits";
import { PageHeader, Alert } from "@/components/ui/misc";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { PlanGate } from "@/components/app/plan-gate";
import { ZonesList, ZoneDialog, SlotsList, SlotDialog, HoursGrid, FulfillmentToggle } from "./livraison-client";

export const metadata: Metadata = { title: "Livraison et retrait" };

function ModeCard({
  icon: Icon,
  title,
  description,
  summary,
  toggle,
  enabled,
}: {
  icon: typeof Truck;
  title: string;
  description: string;
  summary: string;
  toggle: React.ReactNode;
  enabled: boolean;
}) {
  return (
    <div className="bezel">
      <div className="bezel-core flex h-full flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <span className={`inline-flex size-10 items-center justify-center rounded-full ring-1 ring-inset ring-line ${enabled ? "bg-primary-soft text-primary" : "bg-surface-2 text-ink-muted"}`}>
            <Icon className="size-[18px]" aria-hidden />
          </span>
          {toggle}
        </div>
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
          <p className="mt-1 text-sm text-ink-muted">{description}</p>
        </div>
        <p className="mt-auto text-sm font-medium text-ink">{summary}</p>
      </div>
    </div>
  );
}

export default async function DeliveryPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const ctx = await getStoreContext(storeId, "delivery.manage");
  const store = ctx.store;
  const plan = PLANS[ctx.planId];
  const hasSlots = plan.features.pickupSlots;
  const hasCouriers = plan.features.couriers;

  const [zones, slots] = await Promise.all([
    db.deliveryZone.findMany({ where: { storeId: store.id }, orderBy: [{ position: "asc" }, { name: "asc" }] }),
    hasSlots ? db.pickupSlot.findMany({ where: { storeId: store.id }, orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }] }) : Promise.resolve([]),
  ]);

  const hours = (store.openingHours ?? {}) as Record<string, [string, string][]>;
  const limit = zoneLimit(ctx.planId);
  const canAddZone = limit == null || zones.length < limit;
  const overLimit = limit != null && zones.length > limit;
  const activeZones = zones.filter((z) => z.active).length;
  const activeSlots = slots.filter((s) => s.active).length;
  const openDays = Object.values(hours).filter((r) => Array.isArray(r) && r.length > 0).length;
  const plural = (n: number, w: string) => `${n} ${w}${n > 1 ? "s" : ""}`;

  return (
    <>
      <PageHeader
        title="Livraison et retrait"
        description="Modes de remise proposés au moment de commander, zones desservies et horaires d'ouverture."
        actions={
          <div className="flex flex-wrap gap-2">
            {/* Lot 3 : tarifs d'expédition par poids et montant, et comptes transporteurs. */}
            <ButtonLink href={`/app/${store.id}/livraison/tarifs`} variant="secondary" size="sm" className="h-11 sm:h-9">
              <Scale className="size-4" aria-hidden /> Tarifs d&apos;expédition
            </ButtonLink>
            <ButtonLink href={`/app/${store.id}/livraison/transporteurs`} variant="secondary" size="sm" className="h-11 sm:h-9">
              <Truck className="size-4" aria-hidden /> Transporteurs
            </ButtonLink>
          </div>
        }
      />

      <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ModeCard
          icon={StoreIcon}
          title="Retrait en boutique"
          description="Le client vient chercher sa commande à votre adresse."
          enabled={store.pickupEnabled}
          summary={hasSlots ? `${activeSlots} créneau${activeSlots > 1 ? "x" : ""} proposé${activeSlots > 1 ? "s" : ""}` : `${plural(openDays, "jour")} d'ouverture`}
          toggle={<FulfillmentToggle storeId={store.id} option="pickupEnabled" checked={store.pickupEnabled} />}
        />
        <ModeCard
          icon={Truck}
          title="Livraison"
          description="Vous livrez dans les zones listées, avec leurs frais."
          enabled={store.deliveryEnabled}
          summary={`${plural(activeZones, "zone")} proposée${activeZones > 1 ? "s" : ""}`}
          toggle={<FulfillmentToggle storeId={store.id} option="deliveryEnabled" checked={store.deliveryEnabled} />}
        />
      </div>

      <div className="space-y-6">
        <Card as="section" aria-labelledby="zones-title">
          <CardHeader
            className="pb-4"
            title={
              <span id="zones-title" className="inline-flex flex-wrap items-center gap-2">
                Zones de livraison
                <Badge tone={canAddZone ? "neutral" : "sun"}>
                  <span className="tabular">{limit == null ? `${zones.length} zone${zones.length > 1 ? "s" : ""}, sans limite` : `${zones.length} / ${limit} zone${limit > 1 ? "s" : ""}`}</span>
                </Badge>
              </span>
            }
            description="Frais, seuil de gratuité et délai affiché. Les clients voient les zones dans cet ordre."
            action={zones.length > 0 && canAddZone ? <ZoneDialog storeId={store.id} currency={store.currency} city={store.city} /> : undefined}
          />
          {store.deliveryEnabled && activeZones === 0 && zones.length > 0 && (
            <div className="px-5 pb-4 sm:px-6">
              <Alert tone="warning">Toutes les zones sont masquées : la livraison n'est pas proposée aux clients.</Alert>
            </div>
          )}
          <div className="border-t border-line">
            <ZonesList storeId={store.id} currency={store.currency} city={store.city} canAdd={canAddZone} zones={zones.map((z) => ({ id: z.id, name: z.name, fee: z.fee, freeAbove: z.freeAbove, etaLabel: z.etaLabel, active: z.active }))} />
          </div>
          {!canAddZone && limit != null && (
            <div className="border-t border-line p-4 sm:p-5">
              <PlanGate
                compact
                storeId={store.id}
                plan={planForMoreZones(ctx.planId)}
                title="Plus de zones de livraison"
                limit={{ label: limit > 1 ? "zones" : "zone", used: zones.length, max: limit }}
                description={
                  overLimit
                    ? `Votre plan ${plan.name} inclut ${limit} zone${limit > 1 ? "s" : ""}. Vos ${zones.length} zones existantes sont conservées, mais vous ne pouvez plus en ajouter.`
                    : `Votre plan ${plan.name} inclut ${limit} zone${limit > 1 ? "s" : ""} de livraison. Passez au plan ${PLANS[planForMoreZones(ctx.planId)].name} pour en ajouter sans limite.`
                }
              />
            </div>
          )}
        </Card>

        <Card as="section" aria-labelledby="slots-title">
          <CardHeader
            className="pb-4"
            title={<span id="slots-title">Créneaux de retrait</span>}
            description="Jours, heures et capacité pour étaler les retraits. Sans créneau, le client retire aux horaires d'ouverture."
            action={hasSlots && slots.length > 0 ? <SlotDialog storeId={store.id} /> : undefined}
          />
          {!store.address && (
            <div className="px-5 pb-4 sm:px-6">
              <Alert tone="warning">
                Aucune adresse renseignée.{" "}
                <Link href={`/app/${store.id}/parametres`} className="font-medium underline underline-offset-4">
                  Ajoutez-la dans les paramètres
                </Link>{" "}
                pour que le client sache où venir.
              </Alert>
            </div>
          )}
          <div className="border-t border-line">
            {hasSlots ? (
              <SlotsList storeId={store.id} slots={slots.map((s) => ({ id: s.id, dayOfWeek: s.dayOfWeek, startTime: s.startTime, endTime: s.endTime, capacity: s.capacity, active: s.active }))} />
            ) : (
              <div className="p-4 sm:p-5">
                <PlanGate compact storeId={store.id} feature="pickupSlots" description={`Les créneaux de retrait (jour, heure, capacité) sont inclus à partir du plan Starter. Votre plan actuel : ${plan.name}.`} />
              </div>
            )}
          </div>
        </Card>

        <Card as="section" aria-labelledby="couriers-title" className="flex flex-wrap items-center gap-4 px-5 py-4 sm:px-6">
          <span className={`inline-flex size-10 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ring-line ${hasCouriers ? "bg-primary-soft text-primary" : "bg-surface-2 text-ink-muted"}`}>
            {hasCouriers ? <Bike className="size-[18px]" aria-hidden /> : <Lock className="size-[18px]" aria-hidden />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="couriers-title" className="text-[15px] font-semibold tracking-tight text-ink">Livreurs internes</h2>
              {!hasCouriers && <Badge tone="sun">Plan Business</Badge>}
            </div>
            <p className="mt-0.5 text-sm text-ink-muted">
              {hasCouriers ? "Assignez un livreur depuis le détail de chaque commande, il apparaît dans le suivi." : "Assignez vos livreurs aux commandes et suivez les remises. Inclus à partir du plan Business."}
            </p>
          </div>
          <Link
            href={hasCouriers ? `/app/${store.id}/commandes` : `/app/${store.id}/abonnement#plans`}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-primary hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {hasCouriers ? "Voir les commandes" : "Voir les plans"} <ArrowRight className="size-4" aria-hidden />
          </Link>
        </Card>

        <Card as="section" aria-labelledby="hours-title">
          <CardHeader className="pb-4" title={<span id="hours-title">Horaires d'ouverture</span>} description="Affichés dans la boutique. Jusqu'à deux plages par jour, par exemple avec une pause déjeuner." />
          <div className="border-t border-line">
            <HoursGrid storeId={store.id} initial={hours} />
          </div>
        </Card>
      </div>
    </>
  );
}
