import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { debitCredits } from "@/lib/credits";
import { CreditError, ensureConversation, isWhatsappApiActive, queueOutboundMessage, scheduleDispatch } from "@/lib/inbox/service";
import { addDays } from "@/lib/utils";
import { ATTRIBUTION_DAYS, MAX_RECIPIENTS, firstName, parseSegment, renderCampaignMessage, type CampaignSegment, type SegmentKind } from "./segments";

export type Recipient = { customerId: string; name: string; phone: string };

/**
 * Clients joignables en marketing WhatsApp : le DERNIER consentement (canal WHATSAPP, finalité
 * MARKETING) doit être « accordé ». Un retrait postérieur l'emporte toujours.
 */
async function consentingCustomers(storeId: string) {
  const [customers, consents] = await Promise.all([
    db.customer.findMany({
      where: { storeId },
      select: { id: true, name: true, phone: true, ordersCount: true, lastOrderAt: true, createdAt: true, tags: true },
    }),
    db.consent.findMany({
      where: { customer: { storeId }, channel: "WHATSAPP", purpose: "MARKETING" },
      orderBy: { createdAt: "desc" },
      select: { customerId: true, granted: true },
    }),
  ]);
  const latest = new Map<string, boolean>();
  for (const c of consents) if (!latest.has(c.customerId)) latest.set(c.customerId, c.granted);
  return { all: customers.length, consenting: customers.filter((c) => latest.get(c.id) === true) };
}

type Cust = Awaited<ReturnType<typeof consentingCustomers>>["consenting"][number];

function matches(c: Cust, s: CampaignSegment, now = new Date()): boolean {
  switch (s.kind) {
    case "all":
      return true;
    case "loyal":
      return c.ordersCount >= 3;
    case "inactive":
      return !!c.lastOrderAt && c.lastOrderAt < addDays(now, -60);
    case "new":
      return c.createdAt >= addDays(now, -30);
    case "tag":
      return !!s.tag && c.tags.some((t) => t.toLowerCase() === s.tag!.toLowerCase());
  }
}

export async function resolveAudience(storeId: string, segment: CampaignSegment): Promise<Recipient[]> {
  const { consenting } = await consentingCustomers(storeId);
  return consenting.filter((c) => matches(c, segment)).map((c) => ({ customerId: c.id, name: c.name, phone: c.phone }));
}

/** Effectifs par segment pour l'assistant de création. */
export async function audienceOverview(storeId: string) {
  const { all, consenting } = await consentingCustomers(storeId);
  const kinds: Exclude<SegmentKind, "tag">[] = ["all", "loyal", "inactive", "new"];
  const counts = Object.fromEntries(kinds.map((k) => [k, consenting.filter((c) => matches(c, { kind: k })).length])) as Record<Exclude<SegmentKind, "tag">, number>;
  const tagCounts = new Map<string, number>();
  for (const c of consenting) for (const t of c.tags) tagCounts.set(t.toLowerCase(), (tagCounts.get(t.toLowerCase()) ?? 0) + 1);
  return {
    totalCustomers: all,
    consenting: consenting.length,
    counts,
    tags: Array.from(tagCounts, ([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count).slice(0, 30),
    sampleName: consenting[0] ? firstName(consenting[0].name) : null,
  };
}

/**
 * Exécute une campagne (DRAFT, SCHEDULED ou SENDING) :
 *  - API WhatsApp active : débit WA_MARKETING (1 crédit par destinataire) puis messages QUEUED ;
 *  - sinon : messages LINK_ONLY à envoyer depuis WhatsApp (aucun crédit débité).
 * Lève CreditError si le solde est insuffisant (rien n'est créé).
 */
export async function executeCampaign(storeId: string, campaignId: string, actorId: string | null) {
  const campaign = await db.campaign.findFirst({ where: { id: campaignId, storeId, status: { in: ["DRAFT", "SCHEDULED", "SENDING"] } }, include: { store: { select: { name: true, status: true } } } });
  if (!campaign) throw new Error("Campagne introuvable ou déjà envoyée");
  // Boutique en pause (abonnement) : aucune campagne ne part (contrôle serveur).
  if (campaign.store.status === "PAUSED") throw new CreditError("Boutique en pause : choisissez un plan pour envoyer vos campagnes.");
  const segment = parseSegment(campaign.segment);
  const recipients = (await resolveAudience(storeId, segment)).slice(0, MAX_RECIPIENTS);
  if (recipients.length === 0) throw new CreditError("Aucun destinataire : aucun client de ce segment n'a accepté vos messages marketing.");
  const apiActive = await isWhatsappApiActive(storeId);

  await db.$transaction(
    async (tx) => {
      // Verrou : la campagne ne peut partir qu'une fois
      const claimed = await tx.campaign.updateMany({ where: { id: campaign.id, storeId, status: { in: ["DRAFT", "SCHEDULED", "SENDING"] } }, data: { status: "SENDING" } });
      if (claimed.count === 0) throw new Error("Campagne déjà en cours d'envoi");
      if (apiActive) {
        const debit = await debitCredits(storeId, "WA_MARKETING", recipients.length, `campaign:${campaign.id}`, tx);
        if (!debit.ok) throw new CreditError(debit.error);
      }
      for (const r of recipients) {
        const conversation = await ensureConversation(tx, { storeId, phone: r.phone, name: r.name, customerId: r.customerId });
        await queueOutboundMessage(tx, {
          storeId,
          conversationId: conversation.id,
          phone: r.phone,
          body: renderCampaignMessage(campaign.message, { prenom: firstName(r.name), boutique: campaign.store.name }),
          authorId: actorId,
          apiActive,
          creditType: "WA_MARKETING",
          template: "campaign.message",
          campaignId: campaign.id,
          debitPerMessage: false,
        });
      }
      await tx.campaign.update({
        where: { id: campaign.id },
        data: {
          status: "SENT",
          sentAt: new Date(),
          recipients: recipients.length,
          creditsUsed: apiActive ? recipients.length : 0,
          segment: { ...segment, snapshot: recipients.map((r) => r.phone) } as Prisma.InputJsonValue,
        },
      });
      if (apiActive) await scheduleDispatch(storeId, tx);
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
  return { recipients: recipients.length, mode: apiActive ? ("api" as const) : ("link" as const) };
}

/**
 * Lance les campagnes planifiées arrivées à échéance. Appelée à l'ouverture de la page Campagnes ;
 * à brancher aussi sur le cron des jobs (point d'intégration : /api/jobs/run).
 */
export async function runDueCampaigns(storeId?: string) {
  // Boutiques en pause : campagnes planifiées laissées en attente (elles partent à la reprise si toujours planifiées).
  const due = await db.campaign.findMany({ where: { status: "SCHEDULED", scheduledAt: { lte: new Date() }, store: { status: { not: "PAUSED" } }, ...(storeId ? { storeId } : {}) }, select: { id: true, storeId: true, name: true }, take: 3 });
  for (const c of due) {
    try {
      await executeCampaign(c.storeId, c.id, null);
    } catch (e) {
      await db.campaign.updateMany({ where: { id: c.id, status: { in: ["SCHEDULED", "SENDING"] } }, data: { status: "DRAFT" } });
      await db.notification.create({
        data: {
          storeId: c.storeId,
          channel: "inapp",
          recipient: "store",
          template: "campaign.schedule_failed",
          status: "SENT",
          sentAt: new Date(),
          payload: { campaignId: c.id, title: `Campagne « ${c.name} » non envoyée`, text: e instanceof Error ? e.message : "Erreur inconnue" },
        },
      });
    }
  }
}

/** Commandes passées par les destinataires dans les 7 jours suivant l'envoi. Persiste le résultat. */
export async function refreshAttribution(storeId: string, campaignId: string) {
  const c = await db.campaign.findFirst({ where: { id: campaignId, storeId, status: "SENT" } });
  if (!c?.sentAt) return null;
  const phones = parseSegment(c.segment).snapshot ?? [];
  if (phones.length === 0) return { orders: 0, revenue: 0 };
  const agg = await db.order.aggregate({
    where: { storeId, customerPhone: { in: phones }, createdAt: { gte: c.sentAt, lte: addDays(c.sentAt, ATTRIBUTION_DAYS) }, status: { notIn: ["CANCELLED"] } },
    _count: { _all: true },
    _sum: { total: true },
  });
  const orders = agg._count._all;
  const revenue = agg._sum.total ?? 0;
  if (orders !== c.ordersAttributed || revenue !== c.revenueAttributed) {
    await db.campaign.update({ where: { id: c.id }, data: { ordersAttributed: orders, revenueAttributed: revenue } });
  }
  return { orders, revenue };
}
