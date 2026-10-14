import type { Metadata } from "next";
import { CheckCircle2, Circle } from "lucide-react";
import { canSubmitApp } from "@/lib/apps/dev-logic";
import { lastReviewDecision } from "@/lib/apps/dev-queries";
import { formatDateTime } from "@/lib/utils";
import { Alert } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { APP_STATUS_META, AppStatusBadge } from "../../app-status";
import { SubmitAppButton } from "../app-actions-panel";
import { loadAppTab } from "../_data";

export const metadata: Metadata = { title: "Statut et revue" };

const DECISION_LABEL = { publish: "Publiée", reject: "Renvoyée en brouillon", suspend: "Suspendue" } as const;

export default async function AppReviewPage({ params }: { params: Promise<{ storeId: string; appId: string }> }) {
  const { app, client } = await loadAppTab(params);
  const review = await lastReviewDecision(app.id);

  const checks = [
    { ok: app.requestedScopes.length > 0, label: "Au moins une autorisation demandée", required: true },
    { ok: (client?.redirectUris.length ?? 0) > 0, label: "Adresse de redirection OAuth", required: true },
    { ok: !!app.appUrl, label: "URL de l'application (page embarquée)", required: false },
    { ok: !!app.tagline && !!app.description, label: "Accroche et description renseignées", required: false },
    { ok: !!app.iconUrl, label: "Icône", required: false },
    { ok: !!app.supportUrl, label: "URL de support", required: false },
  ];
  const blocking = checks.some((c) => c.required && !c.ok);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Statut actuel" />
        <CardBody className="space-y-4">
          <p className="flex flex-wrap items-center gap-2 text-sm text-ink">
            <AppStatusBadge status={app.status} />
            {app.status === "DRAFT" && "Votre application est en brouillon : vous pouvez la modifier et l'installer en test."}
            {app.status === "IN_REVIEW" && "L'équipe Axi examine votre application. La configuration est verrouillée pendant la revue ; l'installation de test reste possible."}
            {app.status === "PUBLISHED" && (app.listed ? "Publiée et visible au catalogue des marchands." : "Publiée, mais non visible au catalogue.")}
            {app.status === "SUSPENDED" && "Retirée du catalogue par la plateforme."}
          </p>

          {review && (
            <div className="rounded-[var(--radius-md)] bg-surface-2 p-3 text-sm ring-1 ring-inset ring-line">
              <p className="font-medium text-ink">
                Dernière décision : {DECISION_LABEL[review.action]} <span className="font-normal text-ink-muted">· {formatDateTime(review.at)}</span>
              </p>
              <p className="mt-1 text-ink-muted">{review.reason ? <>Motif : « {review.reason} »</> : "Aucun motif précisé."}</p>
            </div>
          )}

          {canSubmitApp(app.status) && (
            <div className="flex flex-col gap-2 border-t border-line pt-4">
              {blocking && <Alert tone="warning">Complétez les éléments obligatoires ci-dessous avant de soumettre.</Alert>}
              <div>
                <SubmitAppButton appId={app.id} disabled={blocking} />
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Liste de contrôle avant revue" description="Ce que l'équipe Axi vérifie : les éléments marqués « obligatoire » bloquent la soumission." />
        <CardBody>
          <ul className="divide-y divide-line">
            {checks.map((c) => (
              <li key={c.label} className="flex items-center gap-2.5 py-2 text-sm">
                {c.ok ? <CheckCircle2 className="size-4 shrink-0 text-primary" aria-hidden /> : <Circle className="size-4 shrink-0 text-ink-faint" aria-hidden />}
                <span className={c.ok ? "text-ink" : "text-ink-muted"}>{c.label}</span>
                <span className="sr-only">{c.ok ? "(fait)" : "(à faire)"}</span>
                {c.required && <span className="text-xs text-ink-faint">obligatoire</span>}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Cycle de vie" />
        <CardBody>
          <ol className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            {(["DRAFT", "IN_REVIEW", "PUBLISHED", "SUSPENDED"] as const).map((s) => (
              <li key={s} className={s === app.status ? "rounded-[var(--radius-md)] bg-primary-soft p-2.5 font-medium text-primary-deep" : "rounded-[var(--radius-md)] p-2.5 text-ink-muted ring-1 ring-inset ring-line"}>
                {APP_STATUS_META[s].label}
                {s === app.status && <span className="sr-only"> (statut actuel)</span>}
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-ink-muted">
            Brouillon → En revue (soumission) → Publiée (validation) ; un refus renvoie en brouillon avec un motif. Une app publiée qui change ses autorisations ou ses redirections repasse en revue.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
