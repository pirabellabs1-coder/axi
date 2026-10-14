import type { Metadata } from "next";
import { CalendarClock, Info } from "lucide-react";
import { getStoreContext } from "@/lib/auth/permissions";
import { PageHeader, Alert, EmptyState } from "@/components/ui/misc";
import { Card, CardHeader } from "@/components/ui/card";
import { PlanGate } from "@/components/app/plan-gate";
import { OCCASIONS, occasionName, suggestedRange } from "@/config/occasions";
import { effectiveStatus, localDay, STATUS_LABELS, STATUS_TONES, utcToLocalInput } from "@/lib/theme-schedules/rules";
import { listSchedules, scheduleAllowance } from "@/lib/theme-schedules/service";
import { publishedDocument } from "@/lib/theme/bootstrap";
import { ScheduleForm, ScheduleList, type OccasionOptionDTO, type ScheduleDTO } from "./programmations-client";

export const metadata: Metadata = { title: "Thèmes programmés" };

/**
 * Lot 4 §11 : écran des thèmes programmés.
 * Les dates sont saisies et affichées dans le FUSEAU DE LA BOUTIQUE (jamais celui du navigateur du commerçant).
 */
export default async function SchedulesPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const ctx = await getStoreContext(storeId, "theme.manage");
  const store = ctx.store;
  const tz = store.timezone || "Africa/Porto-Novo";
  const allowance = scheduleAllowance(ctx.planId);
  const now = new Date();

  const fmt = (d: Date) => new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: tz }).format(d);
  const tzLabel = new Intl.DateTimeFormat("fr-FR", { timeZoneName: "short", timeZone: tz }).formatToParts(now).find((p) => p.type === "timeZoneName")?.value ?? tz;

  if (allowance === 0) {
    return (
      <>
        <PageHeader
          title="Thèmes programmés"
          description="Habillez votre boutique pour une fête ou des soldes, avec retour automatique au thème normal."
          back={{ href: `/app/${storeId}/apparence`, label: "Apparence" }}
        />
        <PlanGate
          storeId={storeId}
          feature="scheduledThemes"
          description="Préparez à l'avance l'habillage d'une fête (Tabaski, Noël, Black Friday…). À la date prévue, la boutique change d'elle-même ; à la fin, elle revient exactement au thème normal."
          unlocks={["Préréglages d'occasion prêts à l'emploi", "Annonce, couleur d'accent, bannière et compte à rebours", "Aperçu « voir à la date » avant publication", "Retour au thème normal à la seconde"]}
        />
      </>
    );
  }

  const rows = await listSchedules(store.id);
  const live = rows.filter((r) => r.status !== "CANCELLED" && r.endsAt.getTime() > now.getTime()).length;
  const canCreate = allowance == null || live < allowance;

  const schedules: ScheduleDTO[] = rows.map((r) => {
    const status = effectiveStatus(r, now);
    const middle = new Date(Math.max(r.startsAt.getTime(), Math.min(now.getTime(), r.endsAt.getTime() - 1000)));
    return {
      id: r.id,
      name: r.name,
      occasionName: occasionName(r.occasion),
      status,
      statusLabel: STATUS_LABELS[status],
      tone: STATUS_TONES[status],
      startsAtLocal: utcToLocalInput(r.startsAt, tz),
      endsAtLocal: utcToLocalInput(r.endsAt, tz),
      startsLabel: fmt(r.startsAt),
      endsLabel: fmt(r.endsAt),
      previewHref: `/s/${store.slug}?preview=1&at=${encodeURIComponent(middle.toISOString())}`,
      afterHref: `/s/${store.slug}?preview=1&at=${encodeURIComponent(new Date(r.endsAt.getTime() + 60_000).toISOString())}`,
      editable: status === "SCHEDULED" || status === "ACTIVE",
    };
  });

  const today = localDay(now, tz);
  const occasions: OccasionOptionDTO[] = OCCASIONS.map((o) => {
    const range = suggestedRange(o, { todayLocal: today, country: store.country });
    return {
      id: o.id,
      name: o.name,
      description: o.description,
      movable: range === null,
      startsAt: range?.startsAt ?? null,
      endsAt: range?.endsAt ?? null,
      countdown: o.countdown,
      announcement: o.announcement,
    };
  });

  return (
    <>
      <PageHeader
        title="Thèmes programmés"
        description="Habillez votre boutique pour une fête ou des soldes. À la fin de la période, elle revient exactement au thème normal."
        back={{ href: `/app/${storeId}/apparence`, label: "Apparence" }}
      />

      <div className="space-y-6">
        <Alert tone="info" title={`Heures de ${store.city ?? store.name} (${tzLabel})`}>
          Les dates sont saisies et affichées dans le fuseau de votre boutique. Le changement de thème est résolu à
          chaque visite : aucune tâche de fond, aucun retard. Modifier votre thème principal pendant une programmation
          n&apos;interrompt pas celle-ci.
          {allowance != null && (
            <>
              {" "}
              Votre plan permet {allowance} programmation{allowance > 1 ? "s" : ""} à venir ({live} utilisée{live > 1 ? "s" : ""}).
            </>
          )}
        </Alert>

        <Card>
          <CardHeader title="Programmer un thème" description="Choisissez une occasion : l'annonce, la couleur d'accent, la bannière et le compte à rebours sont préparés sur une copie de votre thème." />
          {canCreate ? (
            <ScheduleForm
              storeId={store.id}
              occasions={occasions}
              hasPublished={!!publishedDocument(store)}
              defaultStart={`${today}T08:00`}
            />
          ) : (
            <div className="px-5 pb-6 sm:px-6">
              <Alert tone="warning" title="Limite de votre plan atteinte">
                Annulez une programmation à venir pour en créer une autre, ou passez au plan supérieur (programmations
                illimitées à partir du plan Scale).
              </Alert>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Vos programmations" description="Aperçu « voir à la date » pour vérifier l'habillage avant l'heure, et le retour au thème normal après." />
          {schedules.length === 0 ? (
            <EmptyState compact icon={CalendarClock} title="Aucune programmation" description="Choisissez une occasion ci-dessus pour préparer votre prochaine fête." />
          ) : (
            <ScheduleList storeId={store.id} schedules={schedules} />
          )}
        </Card>

        <p className="flex items-start gap-2 px-1 text-sm text-ink-muted">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          Les dates des fêtes mobiles (Tabaski, Korité, Ramadan) changent chaque année : saisissez-les vous-même, nous
          ne proposons jamais une date approximative.
        </p>
      </div>
    </>
  );
}
