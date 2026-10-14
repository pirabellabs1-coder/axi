import type { Metadata } from "next";
import { Megaphone } from "lucide-react";
import { getAdminContext } from "@/lib/admin/context";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/utils";
import { announcementState, AUDIENCE_LABEL, TONE_LABEL, type AnnouncementAudience, type AnnouncementTone } from "@/lib/admin/announcements";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { AnnouncementDialogButton, AnnouncementRowActions } from "@/components/admin/announcement-controls";

export const metadata: Metadata = { title: "Annonces" };

const STATE: Record<ReturnType<typeof announcementState>, { label: string; tone: BadgeTone }> = {
  live: { label: "En ligne", tone: "success" },
  scheduled: { label: "Programmée", tone: "info" },
  ended: { label: "Terminée", tone: "neutral" },
  paused: { label: "En pause", tone: "sun" },
};

export default async function AdminAnnouncements() {
  const ctx = await getAdminContext();
  const canEdit = ctx.can("announcements.manage");
  const now = new Date();
  const rows = await db.announcement.findMany({ orderBy: [{ active: "desc" }, { startsAt: "desc" }], take: 100 });
  const live = rows.filter((r) => announcementState(r, now) === "live").length;

  return (
    <>
      <PageHeader
        title="Annonces"
        description={`Messages affichés en haut de l'espace marchand, ciblés par plan ou par zone. ${live} en ligne actuellement.`}
        actions={<AnnouncementDialogButton canEdit={canEdit} />}
      />
      {rows.length === 0 ? (
        <EmptyState icon={Megaphone} title="Aucune annonce" description="Annoncez une nouveauté, une maintenance ou une offre à tous les marchands ou à un segment." action={<AnnouncementDialogButton canEdit={canEdit} />} />
      ) : (
        <Table minWidth={860}>
          <THead>
            <TR>
              <TH>Annonce</TH>
              <TH>Ton</TH>
              <TH>Audience</TH>
              <TH>Période</TH>
              <TH>État</TH>
              <TH align="right"><span className="sr-only">Actions</span></TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((a) => {
              const st = STATE[announcementState(a, now)];
              return (
                <TR key={a.id}>
                  <TD>
                    <span className="font-medium text-ink">{a.title}</span>
                    <span className="block max-w-[360px] truncate text-xs text-ink-muted">{a.body}</span>
                  </TD>
                  <TD>{TONE_LABEL[a.tone as AnnouncementTone] ?? a.tone}</TD>
                  <TD>{AUDIENCE_LABEL[a.audience as AnnouncementAudience] ?? a.audience}</TD>
                  <TD>
                    <span className="whitespace-nowrap text-ink-muted">{formatDateTime(a.startsAt)}</span>
                    <span className="block whitespace-nowrap text-xs text-ink-faint">{a.endsAt ? `au ${formatDateTime(a.endsAt)}` : "sans fin"}</span>
                  </TD>
                  <TD><Badge tone={st.tone} dot={st.tone === "success"}>{st.label}</Badge></TD>
                  <TD align="right">
                    <AnnouncementRowActions canEdit={canEdit} announcement={{ id: a.id, title: a.title, body: a.body, tone: a.tone, audience: a.audience, startsAt: a.startsAt.toISOString(), endsAt: a.endsAt?.toISOString() ?? null, active: a.active }} />
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}
      {!canEdit && <p className="mt-4 text-sm text-ink-muted">Lecture seule : les annonces sont gérées par les super-administrateurs.</p>}
    </>
  );
}
