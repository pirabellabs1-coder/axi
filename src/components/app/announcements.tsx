import { db } from "@/lib/db";
import type { PlanId, PricingZone } from "@/config/plans";
import { matchesAudience } from "@/lib/admin/announcements";
import { AnnouncementBanners } from "@/components/admin/announcement-banners";

/**
 * Annonces de la plateforme dans l'espace marchand (composant serveur).
 * Usage : <PlatformAnnouncements planId={ctx.planId} zone={zone} /> en haut du contenu.
 * Bandeau discret, fermable (mémorisé dans localStorage par identifiant d'annonce).
 */
export async function PlatformAnnouncements({ planId, zone }: { planId: PlanId; zone: PricingZone }) {
  const now = new Date();
  let rows: { id: string; title: string; body: string; tone: string; audience: string }[] = [];
  try {
    rows = await db.announcement.findMany({
      where: { active: true, startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
      orderBy: { startsAt: "desc" },
      take: 5,
      select: { id: true, title: true, body: true, tone: true, audience: true },
    });
  } catch {
    // Les annonces ne doivent jamais casser l'espace marchand.
    return null;
  }
  const items = rows.filter((a) => matchesAudience(a.audience, planId, zone)).slice(0, 3);
  if (items.length === 0) return null;
  return <AnnouncementBanners items={items.map((a) => ({ id: a.id, title: a.title, body: a.body, tone: a.tone === "success" || a.tone === "warning" ? a.tone : "info" }))} />;
}
