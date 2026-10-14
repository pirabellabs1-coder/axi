import type { Metadata } from "next";
import Link from "next/link";
import { Download, Globe2, AlertTriangle, BarChart3, ChevronRight, Coins, ListPlus, Receipt, Settings2, Undo2, UserRound, type LucideIcon } from "lucide-react";
import { getStoreContext } from "@/lib/auth/permissions";
import { PLANS } from "@/config/plans";
import { getCountry } from "@/config/site";
import { PageHeader } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { PlanGate } from "@/components/app/plan-gate";
import { SettingsForm } from "./settings-form";
import { DangerZone } from "./danger-zone";
import { TrackingForm } from "./tracking-form";
import { CurrencyForm } from "./currency-form";
import { db } from "@/lib/db";

export const metadata: Metadata = { title: "Paramètres" };

export default async function SettingsPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const ctx = await getStoreContext(storeId, "store.settings");
  const s = ctx.store;
  const country = getCountry(s.country);
  const canExport = PLANS[ctx.planId].features.csvExport;
  const canTrack = PLANS[ctx.planId].features.pixels;
  const hasTracking = !!(s.metaPixelId || s.gaMeasurementId);
  const base = `/app/${s.id}`;
  const [orderCount, giftCardCount] = await Promise.all([db.order.count({ where: { storeId: s.id } }), db.giftCard.count({ where: { storeId: s.id } })]);
  // Réglages détaillés (vague 2) : chaque écran revérifie lui-même la capacité ; on ne montre que les liens utilisables.
  const shortcuts: { href: string; title: string; description: string; icon: LucideIcon; show: boolean }[] = [
    { href: `${base}/parametres/comptes-clients`, title: "Comptes clients", description: "Connexion par code WhatsApp : historique, adresses, favoris, points et avoir.", icon: UserRound, show: true },
    { href: `${base}/parametres/taxes`, title: "Taxes et factures", description: "TVA par pays, prix TTC ou HT, identité fiscale et factures numérotées.", icon: Receipt, show: true },
    { href: `${base}/parametres/champs`, title: "Champs personnalisés", description: "Données en plus sur vos produits, collections, pages et clients.", icon: ListPlus, show: ctx.can("theme.manage") },
    { href: `${base}/parametres/retours`, title: "Politique de retours", description: "Délai, résolutions proposées et instructions de retour.", icon: Undo2, show: true },
    { href: `${base}/devises`, title: "Devises", description: "Devises d'affichage, taux de change et prix fixés.", icon: Coins, show: true },
  ];

  return (
    <>
      <PageHeader title="Paramètres" description="Identité, coordonnées, options de commande et gestion de la boutique." />

      <div className="space-y-6">
        <Card as="section" aria-labelledby="more-settings-title">
          <CardHeader title={<span id="more-settings-title" className="inline-flex items-center gap-2"><Settings2 className="size-4 text-primary" aria-hidden /> Autres réglages</span>} description="Les réglages détaillés de la boutique, chacun sur sa page." />
          <CardBody>
            <ul className="grid gap-2 sm:grid-cols-2">
              {shortcuts.filter((x) => x.show).map((x) => (
                <li key={x.href}>
                  <Link href={x.href} className="group flex min-h-14 items-center gap-3 rounded-[12px] px-3 py-2.5 ring-1 ring-inset ring-line transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-primary">
                    <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                      <x.icon className="size-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-ink">{x.title}</span>
                      <span className="block text-[13px] leading-snug text-ink-muted">{x.description}</span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-ink-faint transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        <SettingsForm
          storeId={s.id}
          currency={s.currency}
          dialCode={country.dialCode}
          data={{
            name: s.name,
            tagline: s.tagline ?? "",
            description: s.description ?? "",
            category: s.category,
            city: s.city ?? "",
            address: s.address ?? "",
            contactEmail: s.contactEmail ?? "",
            contactPhone: s.contactPhone ?? "",
            whatsappNumber: s.whatsappNumber ?? "",
            pickupEnabled: s.pickupEnabled,
            deliveryEnabled: s.deliveryEnabled,
            whatsappOrdering: s.whatsappOrdering,
            listedInMarketplace: s.listedInMarketplace,
            minOrderAmount: s.minOrderAmount,
            orderNotes: s.orderNotes ?? "",
          }}
        />

        <Card as="section" aria-labelledby="tracking-title">
          <CardHeader
            title={<span id="tracking-title" className="inline-flex items-center gap-2"><BarChart3 className="size-4 text-primary" aria-hidden /> Mesure publicitaire</span>}
            description="Mesurez les visites et les commandes issues de vos publicités Facebook, Instagram et Google."
          />
          {canTrack ? (
            <TrackingForm storeId={s.id} metaPixelId={s.metaPixelId ?? ""} gaMeasurementId={s.gaMeasurementId ?? ""} />
          ) : (
            <CardBody>
              <PlanGate
                compact
                storeId={s.id}
                feature="pixels"
                description={hasTracking ? "Vos identifiants sont conservés mais inactifs avec votre plan actuel. Inclus à partir du plan Business." : "Pixel Meta et Google Analytics 4 sur votre boutique, inclus à partir du plan Business."}
              />
            </CardBody>
          )}
        </Card>

        <Card as="section" aria-labelledby="locale-title">
          <CardHeader title={<span id="locale-title" className="inline-flex items-center gap-2"><Globe2 className="size-4 text-primary" aria-hidden /> Langue, devise et fuseau horaire</span>} description="Le pays et le fuseau sont fixés à la création ; la devise est modifiable tant que la boutique n'a pas de commande." />
          <CardBody>
            <CurrencyForm storeId={s.id} currency={s.currency} locked={orderCount + giftCardCount > 0} />
            <dl className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div><dt className="text-[13px] text-ink-muted">Pays</dt><dd className="mt-1 font-medium text-ink">{country.name}</dd></div>
              <div><dt className="text-[13px] text-ink-muted">Fuseau</dt><dd className="mt-1 font-medium text-ink">{s.timezone}</dd></div>
              <div><dt className="text-[13px] text-ink-muted">Langue</dt><dd className="mt-1 font-medium text-ink">Français</dd></div>
            </dl>
            <p className="mt-4 text-sm text-ink-muted">Changer de pays fausserait l'historique (taxes, fuseau, factures) : contactez le support si nécessaire.</p>
          </CardBody>
        </Card>

        <Card as="section" aria-labelledby="export-title">
          <CardHeader title={<span id="export-title" className="inline-flex items-center gap-2"><Download className="size-4 text-primary" aria-hidden /> Export de données</span>} description="Vos données vous appartiennent : téléchargez-les en CSV à tout moment." />
          <CardBody>
            {canExport ? (
              <div className="flex flex-wrap gap-2">
                <ButtonLink href={`${base}/commandes/export`} variant="outline" prefetch={false}>Commandes (CSV)</ButtonLink>
                <ButtonLink href={`${base}/produits/export`} variant="outline" prefetch={false}>Produits (CSV)</ButtonLink>
                <ButtonLink href={`${base}/clients/export`} variant="outline" prefetch={false}>Clients (CSV)</ButtonLink>
              </div>
            ) : (
              <PlanGate compact storeId={s.id} feature="csvExport" description="L'export CSV est inclus à partir du plan Business. En cas d'archivage, le support peut vous transmettre un export sur demande." />
            )}
          </CardBody>
        </Card>

        <Card as="section" aria-labelledby="danger-title" className="ring-danger/30">
          <CardHeader title={<span id="danger-title" className="inline-flex items-center gap-2 text-danger"><AlertTriangle className="size-4" aria-hidden /> Zone sensible</span>} description="Actions qui changent la disponibilité de la boutique." />
          <CardBody className="py-1">
            <DangerZone storeId={s.id} storeName={s.name} status={s.status} canArchive={ctx.can("store.delete")} />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
