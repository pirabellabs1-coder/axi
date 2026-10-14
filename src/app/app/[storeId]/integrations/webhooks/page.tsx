import type { Metadata } from "next";
import Link from "next/link";
import { Activity, BookOpen, History, RotateCcw, ShieldCheck, Zap } from "lucide-react";
import type { WebhookDeliveryStatus } from "@prisma/client";
import { getStoreContext } from "@/lib/auth/permissions";
import { PLANS, REST_API_ACCESS } from "@/config/plans";
import { appBaseUrl } from "@/lib/mcp/runtime";
import { listDeliveries, listEndpoints } from "@/lib/webhooks/service";
import { replayWebhookDelivery } from "@/lib/webhooks/actions";
import { WEBHOOK_EVENT_LABELS, isWebhookEvent } from "@/lib/webhooks/events";
import { formatDateTime } from "@/lib/utils";
import { PageHeader, EmptyState, Alert, Kpi } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Segmented } from "@/components/ui/segmented";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { ActionButton } from "@/components/app/action-controls";
import { PlanGate } from "@/components/app/plan-gate";
import { CodeBlock } from "../ia/code-block";
import { EndpointManager, type EndpointRow } from "./endpoint-manager";

export const metadata: Metadata = { title: "Webhooks et API" };

const STATUS_TONE: Record<WebhookDeliveryStatus, BadgeTone> = { PENDING: "info", SUCCEEDED: "success", FAILED: "warning", DEAD: "danger" };
const STATUS_LABEL: Record<WebhookDeliveryStatus, string> = { PENDING: "En attente", SUCCEEDED: "Livré", FAILED: "Nouvel essai prévu", DEAD: "Abandonné" };
const FILTERS = [
  { value: "tous", label: "Toutes", statuses: undefined },
  { value: "echecs", label: "En échec", statuses: ["FAILED", "DEAD"] as WebhookDeliveryStatus[] },
  { value: "livrees", label: "Livrées", statuses: ["SUCCEEDED"] as WebhookDeliveryStatus[] },
  { value: "attente", label: "En attente", statuses: ["PENDING"] as WebhookDeliveryStatus[] },
] as const;

const VERIFY_SNIPPET = `import crypto from "node:crypto";

// rawBody : corps BRUT reçu (chaîne), avant tout JSON.parse
export function verifyAxiSignature(rawBody, header, secret, toleranceSec = 300) {
  const parts = header.split(",").map((p) => p.split("="));
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  if (!t || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = Buffer.from(crypto.createHmac("sha256", secret).update(\`\${t}.\${rawBody}\`).digest("hex"), "hex");
  return parts.filter(([k]) => k === "v1").some(([, v]) => {
    const sig = Buffer.from(v ?? "", "hex");
    return sig.length === expected.length && crypto.timingSafeEqual(sig, expected);
  });
}`;

export default async function WebhooksPage({ params, searchParams }: { params: Promise<{ storeId: string }>; searchParams: Promise<{ statut?: string; point?: string; apres?: string }> }) {
  const { storeId } = await params;
  const sp = await searchParams;
  const ctx = await getStoreContext(storeId, "integrations.manage");
  const store = ctx.store;
  const plan = PLANS[ctx.planId];
  const base = appBaseUrl();
  const restAccess = REST_API_ACCESS[ctx.planId];

  const restCard = (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <BookOpen className="size-4 text-primary" aria-hidden /> API REST
          </span>
        }
        description={
          restAccess === "none"
            ? "L'API REST est incluse à partir du plan Business (lecture) et Scale (lecture et écriture)."
            : restAccess === "read"
              ? `Plan ${plan.name} : lecture seule (produits, commandes, clients). Écriture à partir du plan Scale.`
              : `Plan ${plan.name} : lecture et écriture (produits, stock, commandes, webhooks).`
        }
      />
      <CardBody className="space-y-3">
        <CodeBlock code={`${base}/api/v1`} label="Adresse de base" />
        <CodeBlock code={`curl ${base}/api/v1/orders?limit=10 -H "Authorization: Bearer axi_live_…"`} label="Exemple" />
        <p className="text-sm text-ink-muted">
          L&apos;authentification utilise les jetons API de la page{" "}
          <Link className="font-medium text-primary underline-offset-2 hover:underline" href={`/app/${store.id}/integrations/ia`}>Connecteurs IA</Link>
          , avec les mêmes autorisations. Spécification OpenAPI :{" "}
          <a className="font-medium text-primary underline-offset-2 hover:underline" href="/api/openapi-2026-10.json" target="_blank" rel="noopener">openapi-2026-10.json</a>.
        </p>
      </CardBody>
    </Card>
  );

  if (!plan.features.webhooks) {
    return (
      <>
        <PageHeader title="Webhooks et API" description="Connectez Axi à vos logiciels : chaque commande, produit ou client peut être transmis en temps réel à votre serveur." />
        <PlanGate
          storeId={store.id}
          feature="webhooks"
          unlocks={["Webhooks signés vers vos logiciels (ERP, comptabilité, logistique)", "Relances automatiques pendant 24 h", "Historique des livraisons et rejeu", "API REST (lecture dès Business)"]}
        />
        <div className="mt-8">{restCard}</div>
      </>
    );
  }

  const filter = FILTERS.find((f) => f.value === sp.statut) ?? FILTERS[0];
  const endpointsRaw = await listEndpoints(store.id);
  const pointFilter = sp.point && endpointsRaw.some((e) => e.id === sp.point) ? sp.point : undefined;
  const cursor = sp.apres && /^[A-Za-z0-9_-]{8,64}$/.test(sp.apres) ? sp.apres : undefined;
  const listArgs = { status: filter.statuses ? [...filter.statuses] : undefined, endpointId: pointFilter, limit: 30 };
  // Curseur périmé (livraison purgée) ou copié d'ailleurs : première page, jamais d'erreur de page.
  const deliveries = await listDeliveries(store.id, { ...listArgs, cursor }).catch(() => listDeliveries(store.id, listArgs));

  const endpoints: EndpointRow[] = endpointsRaw.map((e) => ({
    id: e.id,
    url: e.url,
    description: e.description,
    events: e.events,
    secretPrefix: e.secretPrefix,
    includePersonalData: e.includePersonalData,
    active: e.active,
    consecutiveFailures: e.consecutiveFailures,
    disabledAt: e.disabledAt?.toISOString() ?? null,
    disabledReason: e.disabledReason,
    lastSuccessAt: e.lastSuccessAt?.toISOString() ?? null,
    lastFailureAt: e.lastFailureAt?.toISOString() ?? null,
    createdAt: e.createdAt.toISOString(),
  }));
  const urlOf = new Map(endpointsRaw.map((e) => [e.id, e.url]));
  const disabled = endpointsRaw.filter((e) => !e.active && e.disabledAt);
  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { statut: filter.value === "tous" ? undefined : filter.value, point: pointFilter, ...extra };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return `/app/${store.id}/integrations/webhooks${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <PageHeader title="Webhooks et API" description="Recevez en temps réel sur votre serveur les commandes, produits, stocks et clients de la boutique, avec une signature à vérifier." />

      {disabled.length > 0 && (
        <Alert tone="danger" className="mb-6" title={`${disabled.length} point${disabled.length > 1 ? "s" : ""} désactivé${disabled.length > 1 ? "s" : ""} automatiquement`}>
          Après 50 échecs consécutifs sur plus de 72 h, Axi arrête d&apos;envoyer. Corrigez votre serveur, réactivez le point, puis rejouez les livraisons abandonnées.
        </Alert>
      )}

      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Points actifs" value={plan.limits.webhookEndpoints == null ? endpointsRaw.filter((e) => e.active).length : `${endpointsRaw.filter((e) => e.active).length} / ${plan.limits.webhookEndpoints}`} hint={`Plan ${plan.name}`} icon={Zap} />
        <Kpi label="Relances" value="8 essais" hint="De 1 min à 24 h" icon={RotateCcw} />
        <Kpi label="Signature" value="HMAC-SHA256" hint="En-tête Axi-Signature" icon={ShieldCheck} />
        <Kpi label="Délai de réponse" value="10 s" hint="Réponse 2xx attendue" icon={Activity} />
      </div>

      <section aria-labelledby="endpoints-title" className="mb-10">
        <div className="mb-3">
          <h2 id="endpoints-title" className="text-lg font-semibold tracking-[-0.02em] text-ink">Points de webhook</h2>
          <p className="mt-0.5 text-sm text-ink-muted">Adresses https de vos serveurs. Chaque point a son propre secret de signature et sa liste d&apos;événements.</p>
        </div>
        <EndpointManager storeId={store.id} endpoints={endpoints} max={plan.limits.webhookEndpoints} planName={plan.name} canSendPersonalData={ctx.can("customers.view")} />
      </section>

      <section aria-labelledby="deliveries-title" className="mb-10">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="deliveries-title" className="text-lg font-semibold tracking-[-0.02em] text-ink">Livraisons</h2>
            <p className="mt-0.5 text-sm text-ink-muted">Chaque envoi, son statut et la réponse de votre serveur (4 Ko maximum conservés).</p>
          </div>
          <Segmented label="Filtrer les livraisons" size="sm" value={filter.value} options={FILTERS.map((f) => ({ value: f.value, label: f.label, href: qs({ statut: f.value === "tous" ? undefined : f.value, apres: undefined }) }))} />
        </div>
        {pointFilter && (
          <p className="mb-3 text-sm text-ink-muted">
            Point : <span className="font-mono">{urlOf.get(pointFilter)}</span> ·{" "}
            <Link className="font-medium text-primary hover:underline" href={qs({ point: undefined, apres: undefined })}>tous les points</Link>
          </p>
        )}
        {deliveries.items.length === 0 ? (
          <EmptyState
            icon={History}
            title={cursor ? "Plus de livraison plus ancienne" : "Aucune livraison"}
            description={endpoints.length ? "Les envois apparaîtront ici. Utilisez « Envoyer un test » pour vérifier votre serveur." : "Ajoutez d'abord un point de webhook."}
          />
        ) : (
          <>
            <Table minWidth={860}>
              <THead>
                <tr>
                  <TH>Date</TH>
                  <TH>Événement</TH>
                  <TH>Point</TH>
                  <TH>Statut</TH>
                  <TH>Réponse</TH>
                  <TH align="right"><span className="sr-only">Actions</span></TH>
                </tr>
              </THead>
              <TBody>
                {deliveries.items.map((d) => (
                  <TR key={d.id}>
                    <TD className="whitespace-nowrap text-ink-muted">{formatDateTime(d.createdAt)}</TD>
                    <TD>
                      <span className="font-medium text-ink">{isWebhookEvent(d.event) ? WEBHOOK_EVENT_LABELS[d.event] : d.event}</span>
                      <span className="block font-mono text-xs text-ink-muted">{d.event} · {d.eventId.slice(0, 16)}…</span>
                    </TD>
                    <TD className="max-w-[16rem]">
                      <Link className="block truncate font-mono text-xs text-ink-muted hover:text-ink hover:underline" href={qs({ point: d.endpointId, apres: undefined })} title={urlOf.get(d.endpointId)}>
                        {urlOf.get(d.endpointId) ?? d.endpointId}
                      </Link>
                    </TD>
                    <TD>
                      <Badge tone={STATUS_TONE[d.status]} dot>{STATUS_LABEL[d.status]}</Badge>
                      <span className="mt-0.5 block text-xs text-ink-muted">
                        {d.attempts} essai{d.attempts > 1 ? "s" : ""}
                        {d.status === "FAILED" ? ` · prochain ${formatDateTime(d.nextAttemptAt)}` : ""}
                      </span>
                    </TD>
                    <TD className="max-w-[18rem]">
                      {d.lastStatusCode != null && <span className="font-mono text-xs text-ink">HTTP {d.lastStatusCode}</span>}
                      {d.durationMs != null && <span className="text-xs text-ink-muted"> · {d.durationMs} ms</span>}
                      {d.lastError && <span className="block truncate text-xs text-danger" title={d.lastError}>{d.lastError}</span>}
                      {d.responseSnippet && (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-xs text-ink-muted">Corps de la réponse</summary>
                          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-surface-2 p-2 font-mono text-[11px] text-ink">{d.responseSnippet}</pre>
                        </details>
                      )}
                    </TD>
                    <TD align="right">
                      {d.status !== "PENDING" && (
                        <ActionButton action={replayWebhookDelivery.bind(null, store.id, d.id)} variant="ghost" size="sm" className="min-h-11">
                          <RotateCcw className="size-4" aria-hidden /> Rejouer
                        </ActionButton>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {deliveries.nextCursor && (
              <div className="mt-3 flex justify-end">
                <Link className="inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium text-primary hover:bg-surface-2" href={qs({ apres: deliveries.nextCursor })}>
                  Livraisons plus anciennes
                </Link>
              </div>
            )}
          </>
        )}
      </section>

      <div className="mb-10 grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <section aria-labelledby="verify-title">
          <Card>
            <CardHeader
              title={
                <span id="verify-title" className="inline-flex items-center gap-2">
                  <ShieldCheck className="size-4 text-primary" aria-hidden /> Vérifier la signature
                </span>
              }
              description="Chaque requête porte Axi-Signature: t=…,v1=… (HMAC-SHA256 du texte « t.corps » avec votre secret). Refusez toute requête non signée ou de plus de 5 minutes."
            />
            <CardBody>
              <CodeBlock code={VERIFY_SNIPPET} label="Node.js" />
            </CardBody>
          </Card>
        </section>
        <section aria-label="API REST">{restCard}</section>
      </div>
    </>
  );
}
