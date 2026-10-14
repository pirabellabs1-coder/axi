import type { Metadata } from "next";
import { Bell, CheckCircle2, Download, Gauge, XCircle } from "lucide-react";
import { getStoreContext } from "@/lib/auth/permissions";
import { PLANS } from "@/config/plans";
import { pwaContextFor } from "@/lib/pwa/service";
import { readPwaConfig } from "@/lib/pwa/config";
import { planPushState, subscriptionCounts } from "@/lib/push/service";
import { platformVapidKeys } from "@/lib/push/vapid";
import { SITE } from "@/config/site";
import { PageHeader, Alert, Kpi } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PlanGate } from "@/components/app/plan-gate";
import { CopyButton } from "@/components/app/action-controls";
import { PwaSettingsForm, PushCampaignForm, PushTestButton } from "./pwa-forms";

export const metadata: Metadata = { title: "Boutique installable et notifications" };

/**
 * Écran marchand du lot 4D : boutique installable (§14) et notifications push (§19).
 * Lecture pour tout rôle ayant `theme.manage` ; les réglages sont enregistrés par `savePwaSettings`
 * et `sendPushCampaign`, qui revérifient plan et capacité côté serveur.
 */
export default async function PwaPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const ctx = await getStoreContext(storeId, "theme.manage");
  const store = ctx.store;
  const plan = PLANS[ctx.planId];
  const cfg = readPwaConfig(store.pwaConfig);
  const published = store.status === "PUBLISHED" || store.status === "CLOSED_TEMPORARILY";

  const [pwa, counts, pushState] = await Promise.all([
    published ? pwaContextFor(store.slug, null) : Promise.resolve(null),
    subscriptionCounts(store.id),
    planPushState(store.id),
  ]);
  const base = SITE.url.replace(/\/$/, "");
  const manifestUrl = `${base}/s/${store.slug}/manifest.webmanifest`;
  const swUrl = `${base}/s/${store.slug}/sw.js`;
  const vapidReady = !!platformVapidKeys();
  const issues = pwa?.issues ?? [];

  return (
    <>
      <PageHeader
        title="Boutique installable et notifications"
        description="Vos clients ajoutent la boutique à leur écran d'accueil : elle s'ouvre plus vite, même avec un réseau faible. Les notifications préviennent d'une commande ou d'une nouveauté."
        back={{ href: `/app/${store.id}/apparence`, label: "Apparence" }}
      />

      {!published && (
        <Alert tone="warning" className="mb-6" title="Boutique non publiée">
          Le manifeste et le service worker ne sont servis qu&apos;une fois la boutique publiée.
        </Alert>
      )}

      {!plan.features.pwa ? (
        <PlanGate
          storeId={store.id}
          feature="pwa"
          unlocks={["Icône sur l'écran d'accueil", "Ouverture hors ligne des pages déjà vues", "Mode économie de données", "Notifications (plan Business)"]}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
          <Card>
            <CardHeader title="Boutique installable (PWA)" description="Activez, choisissez le nom court et l'icône. Les icônes 192 et 512 pixels sont fabriquées depuis votre image, dans votre navigateur." />
            <CardBody>
              <PwaSettingsForm storeId={store.id} storeName={store.name} config={cfg} />
            </CardBody>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader title="Critères d'installation" description="Contrôlés à chaque chargement de la boutique." />
              <CardBody className="space-y-3">
                <ul className="space-y-2 text-sm">
                  {[
                    { ok: published, label: "Boutique publiée" },
                    { ok: cfg.enabled, label: "Option activée" },
                    { ok: !!cfg.icon192, label: "Icône 192 × 192" },
                    { ok: !!cfg.icon512, label: "Icône 512 × 512" },
                    { ok: issues.length === 0 && cfg.enabled && published, label: "Manifeste servi" },
                  ].map((c) => (
                    <li key={c.label} className="flex items-center gap-2 text-ink">
                      {c.ok ? <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden /> : <XCircle className="size-4 shrink-0 text-ink-faint" aria-hidden />}
                      <span>{c.label}</span>
                      <span className="sr-only">{c.ok ? " : conforme" : " : à compléter"}</span>
                    </li>
                  ))}
                </ul>
                <div className="space-y-2 border-t border-line pt-3">
                  <UrlRow url={manifestUrl} label="Adresse du manifeste" />
                  <UrlRow url={swUrl} label="Adresse du service worker" />
                </div>
                <p className="text-xs text-ink-muted">
                  Sur un sous-domaine ou votre domaine propre, la boutique s&apos;installe à la racine du site ; sur <code className="font-mono">{SITE.domain}</code>, la portée est <code className="font-mono">/s/{store.slug}/</code>.
                </p>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Mode économie de données" description="Toujours disponible, sur tous les plans." />
              <CardBody className="space-y-2 text-sm text-ink-muted">
                <p className="flex items-start gap-2">
                  <Gauge className="mt-0.5 size-4 shrink-0 text-ink" aria-hidden />
                  Activé automatiquement si le téléphone demande l&apos;économie de données, ou par l&apos;interrupteur en bas de votre boutique.
                </p>
                <p>Images allégées, aucune vidéo lancée seule, aucune animation, police du téléphone : la page d&apos;accueil reste sous 300 Ko.</p>
              </CardBody>
            </Card>
          </div>

          <Card className="lg:col-span-2">
            <CardHeader
              title="Notifications push"
              description="Un message court sur le téléphone de vos clients abonnés. Les offres ne partent qu'aux clients qui ont accepté."
              action={plan.features.webPush && vapidReady ? <PushTestButton storeId={store.id} /> : undefined}
            />
            <CardBody className="space-y-5">
              {!plan.features.webPush ? (
                <PlanGate storeId={store.id} feature="webPush" compact description="Les notifications push sont incluses à partir du plan Business." />
              ) : !vapidReady ? (
                <Alert tone="warning" title="Notifications non configurées sur ce serveur">
                  Les clés <code className="font-mono">VAPID_PUBLIC_KEY</code> et <code className="font-mono">VAPID_PRIVATE_KEY</code> doivent être définies (voir <code className="font-mono">docs/vague3/CAN-lot4d.md</code>).
                </Alert>
              ) : (
                <>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Kpi label="Abonnés" value={counts.total.toLocaleString("fr-FR")} icon={Bell} />
                    <Kpi label="Abonnés aux offres" value={counts.marketing.toLocaleString("fr-FR")} hint="Consentement accordé" />
                    <Kpi
                      label="Envoyées ce mois"
                      value={`${pushState.used.toLocaleString("fr-FR")}${pushState.monthlyLimit == null ? "" : ` / ${pushState.monthlyLimit.toLocaleString("fr-FR")}`}`}
                      icon={Download}
                    />
                  </div>
                  {counts.total === 0 ? (
                    <Alert tone="info">
                      Personne n&apos;est encore abonné. Ouvrez votre boutique et activez « Recevoir les notifications » en bas de page pour tester.
                    </Alert>
                  ) : (
                    <PushCampaignForm storeId={store.id} slug={store.slug} marketing={counts.marketing} />
                  )}
                </>
              )}
            </CardBody>
          </Card>
        </div>
      )}
    </>
  );
}

function UrlRow({ url, label }: { url: string; label: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-[var(--radius-md)] bg-surface-2 p-2 ring-1 ring-inset ring-line">
      <code className="min-w-0 flex-1 truncate px-1.5 font-mono text-[12.5px] text-ink" title={url}>
        {url}
      </code>
      <CopyButton value={url} label="Copier" className="h-11" />
      <span className="sr-only">{label}</span>
    </div>
  );
}
