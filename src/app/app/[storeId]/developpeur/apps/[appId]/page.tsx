import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, FlaskConical, KeyRound, Send, Settings2, Store } from "lucide-react";
import { db } from "@/lib/db";
import { isTestInstallConfig } from "@/lib/apps/dev-logic";
import { lastReviewDecision } from "@/lib/apps/dev-queries";
import { formatAppPrice } from "@/lib/apps/types";
import { formatDate, formatDateTime } from "@/lib/utils";
import { Alert, KeyValue, Stat } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { APP_STATUS_META } from "../app-status";
import { loadAppTab } from "./_data";

export const metadata: Metadata = { title: "Application" };

export default async function AppOverviewPage({ params }: { params: Promise<{ storeId: string; appId: string }> }) {
  const { app, client, dev } = await loadAppTab(params);
  const [installs, review] = await Promise.all([
    db.appInstallation.findMany({ where: { appId: app.id, status: "ACTIVE" }, select: { config: true } }),
    lastReviewDecision(app.id),
  ]);
  const test = installs.filter((i) => isTestInstallConfig(i.config)).length;
  const live = installs.length - test;
  const base = `${dev}/apps/${app.id}`;

  const checks = [
    { ok: (client?.redirectUris.length ?? 0) > 0, label: "Adresse de redirection OAuth déclarée", href: `${base}/configuration`, icon: KeyRound },
    { ok: !!app.appUrl, label: "URL de l'application (page embarquée) renseignée", href: `${base}/configuration`, icon: Settings2 },
    { ok: test > 0, label: "Installée en test sur une boutique", href: `${base}/tests`, icon: FlaskConical },
    { ok: app.status === "IN_REVIEW" || app.status === "PUBLISHED", label: "Soumise à la revue", href: `${base}/revue`, icon: Send },
  ];

  return (
    <div className="space-y-6">
      {review?.action === "reject" && app.status === "DRAFT" && (
        <Alert tone="warning" title="Revue : application renvoyée en brouillon">
          {review.reason ? <>Motif : « {review.reason} »</> : "Aucun motif précisé."} Corrigez puis soumettez à nouveau depuis l&apos;onglet Statut et revue.
        </Alert>
      )}
      {app.status === "SUSPENDED" && (
        <Alert tone="danger" title="Application suspendue">
          {review?.reason ? <>Motif : « {review.reason} ». </> : null}Elle est retirée du catalogue et ne peut plus être installée. Contactez le support Axi.
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Statut" value={<span className="text-[22px]">{APP_STATUS_META[app.status].label}</span>} hint={app.listed ? "Visible au catalogue" : "Non visible au catalogue"} />
        <Stat label="Installations" value={live} icon={Store} hint="Boutiques réelles (hors test)" />
        <Stat label="Installations de test" value={test} icon={FlaskConical} hint="Jamais facturées" />
      </div>

      <Card>
        <CardHeader title="Prochaines étapes" description="Ce qu'il reste à faire pour que des marchands puissent installer votre application." />
        <CardBody>
          <ul className="divide-y divide-line">
            {checks.map((c) => (
              <li key={c.label} className="flex items-center justify-between gap-3 py-2">
                <span className="flex min-w-0 items-center gap-2.5 text-sm">
                  <c.icon className={c.ok ? "size-4 shrink-0 text-primary" : "size-4 shrink-0 text-ink-faint"} aria-hidden />
                  <span className={c.ok ? "text-ink" : "text-ink-muted"}>{c.label}</span>
                  <span className="sr-only">{c.ok ? "(fait)" : "(à faire)"}</span>
                </span>
                {!c.ok && (
                  <Link href={c.href} className="inline-flex min-h-11 shrink-0 items-center gap-1 text-sm font-medium text-primary-deep hover:underline">
                    Faire <ArrowRight className="size-4" aria-hidden />
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Résumé" />
        <CardBody>
          <KeyValue
            items={[
              { label: "Tarif", value: formatAppPrice(app.pricingType, app.priceAmount, app.priceInterval, app.trialDays) },
              { label: "Autorisations", value: `${app.requestedScopes.length} scope(s)` },
              { label: "Dernier appel OAuth", value: client?.lastUsedAt ? formatDateTime(client.lastUsedAt) : "Jamais" },
              { label: "Créée le", value: formatDate(app.createdAt) },
              { label: "Modifiée le", value: formatDate(app.updatedAt) },
            ]}
          />
        </CardBody>
      </Card>
    </div>
  );
}
