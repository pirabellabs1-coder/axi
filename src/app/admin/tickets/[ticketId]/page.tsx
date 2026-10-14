import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Mail } from "lucide-react";
import { requirePlatformAdmin } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/utils";
import { PageHeader } from "@/components/ui/misc";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { TICKET_STATUS, StatusBadge, DL } from "@/components/app/admin-bits";
import { TicketStatusSelect } from "../ticket-status";

export const metadata: Metadata = { title: "Ticket" };

export default async function AdminTicketDetail({ params }: { params: Promise<{ ticketId: string }> }) {
  await requirePlatformAdmin();
  const { ticketId } = await params;
  const t = await db.supportTicket.findUnique({ where: { id: ticketId }, include: { store: { select: { id: true, name: true, slug: true } }, user: { select: { id: true, name: true, email: true } } } });
  if (!t) notFound();

  return (
    <>
      <PageHeader
        title={t.subject}
        description={<span className="inline-flex items-center gap-2"><StatusBadge map={TICKET_STATUS} value={t.status} /> Créé le {formatDateTime(t.createdAt)}</span>}
        back={{ href: "/admin/tickets", label: "Tickets" }}
        actions={
          <>
            <TicketStatusSelect ticketId={t.id} status={t.status} />
            <ButtonLink href={`mailto:${t.email}?subject=${encodeURIComponent(`Re: ${t.subject}`)}`} variant="primary" size="sm">
              <Mail className="size-4" aria-hidden /> Répondre par e-mail
            </ButtonLink>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader title="Message" />
          <CardBody>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{t.message}</p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Contexte" />
          <CardBody>
            <DL
              items={[
                { label: "E-mail", value: <a href={`mailto:${t.email}`} className="text-primary hover:underline">{t.email}</a> },
                { label: "Utilisateur", value: t.user ? <Link href={`/admin/utilisateurs/${t.user.id}`} className="text-primary hover:underline">{t.user.name}</Link> : "Visiteur (sans compte)" },
                { label: "Boutique", value: t.store ? <Link href={`/admin/boutiques/${t.store.id}`} className="text-primary hover:underline">{t.store.name}</Link> : null },
                { label: "Dernière mise à jour", value: formatDateTime(t.updatedAt) },
              ]}
            />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
