import type { Metadata } from "next";
import { FlaskConical, Info } from "lucide-react";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { PageHeader, Alert, EmptyState } from "@/components/ui/misc";
import { Card, CardHeader } from "@/components/ui/card";
import { PlanGate } from "@/components/app/plan-gate";
import { publishedDocument } from "@/lib/theme/bootstrap";
import { editorDocument } from "@/lib/theme/bootstrap";
import { GOAL_LABELS } from "@/lib/experiments/assign";
import { experimentAllowance, STATUS_LABELS, STATUS_TONES, variantLabel } from "@/lib/experiments/rules";
import { experimentResults } from "@/lib/experiments/service";
import { MIN_DAYS, MIN_EXPOSURES_PER_VARIANT } from "@/lib/experiments/stats";
import { sectionOptions } from "./data";
import { ExperimentForm, ExperimentList, type ExperimentDTO } from "./tests-client";

export const metadata: Metadata = { title: "Tests A/B" };

/** Lot 4 §13 : écran des tests A/B de sections. */
export default async function ExperimentsPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const ctx = await getStoreContext(storeId, "theme.manage");
  const store = ctx.store;
  const allowance = experimentAllowance(ctx.planId);

  if (allowance === 0) {
    return (
      <>
        <PageHeader
          title="Tests A/B de sections"
          description="Comparez deux versions d'une section et gardez celle qui convertit le mieux."
          back={{ href: `/app/${storeId}/apparence`, label: "Apparence" }}
        />
        <PlanGate
          storeId={storeId}
          feature="abTests"
          description="Un test A/B montre deux versions d'une même section à des visiteurs différents, puis compare les ajouts au panier et les commandes. Vous décidez sur des chiffres, pas sur une impression."
          unlocks={["2 ou 3 variantes par section, dont « section masquée »", "Répartition stable : un visiteur voit toujours la même version", "Statistiques honnêtes, verdict après 7 jours et 200 affichages par variante", "« Appliquer la gagnante » écrit dans votre brouillon"]}
        />
      </>
    );
  }

  const now = new Date();
  const rows = await db.experiment.findMany({
    where: { storeId: store.id },
    orderBy: [{ createdAt: "desc" }],
    take: 50,
    select: { id: true, status: true, template: true, sectionId: true },
  });
  const results = (await Promise.all(rows.map((r) => experimentResults(store.id, r.id, now)))).filter((r): r is NonNullable<typeof r> => !!r);
  const running = rows.filter((r) => r.status === "RUNNING").length;
  const busyKeys = new Set(rows.filter((r) => r.status !== "COMPLETED").map((r) => `${r.template}|${r.sectionId}`));

  const doc = publishedDocument(store) ?? editorDocument(store).doc;
  const options = sectionOptions(doc, busyKeys);

  const experiments: ExperimentDTO[] = results.map((r) => {
    const option = options.find((o) => o.templateKey === r.template && o.sectionId === r.sectionId);
    return {
      id: r.id,
      name: r.name,
      status: r.status,
      statusLabel: STATUS_LABELS[r.status] ?? r.status,
      tone: STATUS_TONES[r.status] ?? "neutral",
      goalLabel: GOAL_LABELS[r.goal],
      sectionLabel: option ? `${option.templateLabel} · ${option.sectionName}` : `${r.template} · ${r.sectionId}`,
      sectionMissing: !option,
      startedAt: r.startedAt ? new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric", timeZone: store.timezone }).format(r.startedAt) : null,
      winnerKey: r.winnerKey,
      message: r.verdict.message,
      warning: r.verdict.warning,
      enoughData: r.verdict.enoughData,
      daysRunning: r.verdict.daysRunning,
      variants: r.verdict.variants.map((v) => {
        const variant = r.variants.find((x) => x.key === v.key);
        return {
          key: v.key,
          label: variant ? variantLabel(variant) : v.label,
          exposures: v.exposures,
          conversions: v.conversions,
          ratePct: Math.round(v.rate * 1000) / 10,
          probabilityPct: Math.round(v.probabilityBest * 100),
          liftPct: v.lift == null ? null : Math.round(v.lift * 1000) / 10,
          liftRange: v.liftInterval ? ([Math.round(v.liftInterval[0] * 1000) / 10, Math.round(v.liftInterval[1] * 1000) / 10] as [number, number]) : null,
          isWinner: r.verdict.winnerKey === v.key,
        };
      }),
    };
  });

  const canCreate = allowance == null || running < allowance;

  return (
    <>
      <PageHeader
        title="Tests A/B de sections"
        description="Comparez deux versions d'une section de votre boutique et gardez celle qui convertit le mieux."
        back={{ href: `/app/${storeId}/apparence`, label: "Apparence" }}
      />

      <div className="space-y-6">
        <Alert tone="info" title="Comment lire un test">
          Chaque visiteur est affecté une fois pour toutes à une variante : il voit toujours la même version.
          Un affichage n&apos;est compté que lorsque la section entre réellement à l&apos;écran. Aucun verdict
          n&apos;est donné avant {MIN_DAYS} jours et {MIN_EXPOSURES_PER_VARIANT} affichages par variante : avant cela,
          une avance peut s&apos;inverser.
          {allowance != null && (
            <>
              {" "}
              Votre plan permet {allowance} test{allowance > 1 ? "s" : ""} en cours ({running} en cours).
            </>
          )}
        </Alert>

        <Card>
          <CardHeader title="Nouveau test" description="Choisissez la section à tester, puis écrivez la variante B (et la variante C si vous voulez)." />
          {options.length === 0 ? (
            <EmptyState compact icon={FlaskConical} title="Aucune section à tester" description="Ajoutez d'abord des sections à votre thème dans « Apparence »." />
          ) : canCreate ? (
            <ExperimentForm storeId={store.id} options={options} />
          ) : (
            <div className="px-5 pb-6 sm:px-6">
              <Alert tone="warning" title="Limite de votre plan atteinte">
                Terminez un test en cours pour en démarrer un autre (10 tests simultanés à partir du plan Enterprise).
              </Alert>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Vos tests" description="Résultats mis à jour à chaque ouverture de la page." />
          {experiments.length === 0 ? (
            <EmptyState compact icon={FlaskConical} title="Aucun test" description="Créez votre premier test ci-dessus : par exemple deux titres différents pour votre bannière." />
          ) : (
            <ExperimentList storeId={store.id} experiments={experiments} />
          )}
        </Card>

        <p className="flex items-start gap-2 px-1 text-sm text-ink-muted">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          Les robots d&apos;indexation voient toujours la section actuelle : votre référencement n&apos;est pas affecté.
          Un test dont la section disparaît (thème programmé, section supprimée) est suspendu tout seul.
        </p>
      </div>
    </>
  );
}
