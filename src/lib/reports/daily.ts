import "server-only";
import { db } from "@/lib/db";
import { enqueue, queueNotification } from "@/lib/jobs";
import { formatMoney } from "@/lib/money";
import { SITE } from "@/config/site";
import { getStorePrefs, getPrefsForStores, updateStorePrefs } from "@/lib/notifications/prefs";
import { lowStockItems } from "@/lib/inventory/service";

/**
 * Récapitulatif quotidien par e-mail au propriétaire : ventes de la veille, commandes à traiter,
 * stock bas. Envoyé une fois par jour (date locale de la boutique), à partir de 7 h, par le
 * balayage de /api/jobs/run. Désactivable depuis la page Notifications.
 */

const SEND_FROM_HOUR = 7;

/** Date (AAAA-MM-JJ) et heure locales d'un instant dans un fuseau. */
export function localParts(d: Date, timeZone: string): { date: string; hour: number } {
  let tz = timeZone;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
  } catch {
    tz = "UTC";
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

/** Instant UTC correspondant à minuit local du jour `date` (AAAA-MM-JJ) dans `timeZone`. */
export function zonedMidnight(date: string, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  // Décalage du fuseau à cet instant (deux passes pour les changements d'heure)
  let ts = guess;
  for (let i = 0; i < 2; i++) {
    const p = localParts(new Date(ts), timeZone);
    const local = Date.UTC(Number(p.date.slice(0, 4)), Number(p.date.slice(5, 7)) - 1, Number(p.date.slice(8, 10)), p.hour);
    const offset = local - Math.floor(ts / 3_600_000) * 3_600_000;
    ts = guess - offset;
  }
  return new Date(ts);
}

export type DailySummary = {
  yesterday: { orders: number; revenue: number };
  toProcess: number;
  toVerify: number;
  lowStock: { name: string; stock: number }[];
};

export async function buildDailySummary(storeId: string, from: Date, to: Date, threshold: number): Promise<DailySummary> {
  const [sales, toProcess, toVerify, items] = await Promise.all([
    db.order.aggregate({ where: { storeId, createdAt: { gte: from, lt: to }, status: { notIn: ["CANCELLED", "REFUNDED"] } }, _count: { _all: true }, _sum: { total: true } }),
    db.order.count({ where: { storeId, status: { in: ["NEW", "CONFIRMED", "PREPARING", "READY", "OUT_FOR_DELIVERY"] } } }),
    db.order.count({ where: { storeId, paymentStatus: "PENDING", status: { notIn: ["CANCELLED", "REFUNDED"] } } }),
    // `threshold` = seuil par défaut de la boutique ; un produit peut avoir le sien.
    lowStockItems(storeId, { storeThreshold: threshold, scope: "active", limit: 10 }),
  ]);
  const lowStock = items.map((i) => ({ name: i.variantName ? `${i.name} (${i.variantName})` : i.name, stock: i.stock }));
  return { yesterday: { orders: sales._count._all, revenue: sales._sum.total ?? 0 }, toProcess, toVerify, lowStock };
}

export function renderDailyEmail(p: { storeName: string; storeId: string; currency: string; dateLabel: string; s: DailySummary }): { subject: string; text: string } {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? SITE.url).replace(/\/$/, "");
  const { s } = p;
  const lines = [
    `Bonjour,`,
    ``,
    `Voici le récapitulatif de ${p.storeName} pour ${p.dateLabel}.`,
    ``,
    `Ventes de la veille : ${s.yesterday.orders} commande${s.yesterday.orders > 1 ? "s" : ""}, ${formatMoney(s.yesterday.revenue, p.currency)}`,
    `Commandes à traiter : ${s.toProcess}`,
  ];
  if (s.toVerify) lines.push(`Paiements à vérifier : ${s.toVerify}`);
  if (s.lowStock.length) {
    lines.push(``, `Stock bas :`);
    for (const x of s.lowStock) lines.push(`- ${x.name} : ${x.stock < 0 ? `survente (${x.stock})` : x.stock === 0 ? "rupture" : `${x.stock} restant${x.stock > 1 ? "s" : ""}`}`);
  }
  lines.push(``, `Ouvrir votre tableau de bord : ${base}/app/${p.storeId}`, ``, `Vous recevez cet e-mail car le récapitulatif quotidien est activé. Pour le désactiver : ${base}/app/${p.storeId}/notifications`);
  const subject = `${p.storeName} : ${s.yesterday.orders} commande${s.yesterday.orders > 1 ? "s" : ""} hier, ${s.toProcess} à traiter`;
  return { subject, text: lines.join("\n") };
}

/** Envoie les récapitulatifs dus. Idempotent par boutique et par jour local. */
export async function runDailyReports(now = new Date(), maxStores = 150) {
  const stores = await db.store.findMany({
    where: { status: { in: ["PUBLISHED", "CLOSED_TEMPORARILY", "DRAFT"] }, onboardingCompleted: true },
    select: { id: true, name: true, currency: true, timezone: true, contactEmail: true },
    orderBy: { createdAt: "asc" },
    take: 2000,
  });
  if (!stores.length) return { sent: 0 };
  const prefs = await getPrefsForStores(stores.map((s) => s.id));
  let sent = 0;
  for (const store of stores) {
    if (sent >= maxStores) break;
    const p = prefs.get(store.id)!;
    if (!p.dailyReport) continue;
    const local = localParts(now, store.timezone);
    if (local.hour < SEND_FROM_HOUR || p.lastDailyReport === local.date) continue;
    try {
      const claimed = await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`daily-report:${store.id}`}))`;
        const fresh = await getStorePrefs(store.id, tx);
        if (!fresh.dailyReport || fresh.lastDailyReport === local.date) return null;
        await updateStorePrefs(store.id, { lastDailyReport: local.date }, tx);
        return fresh;
      });
      if (!claimed) continue;
      const owner = await db.membership.findFirst({ where: { storeId: store.id, role: "OWNER" }, select: { user: { select: { email: true } } } });
      const to = owner?.user.email ?? store.contactEmail;
      if (!to) continue;
      const today = zonedMidnight(local.date, store.timezone);
      const yesterday = new Date(today.getTime() - 86_400_000);
      const summary = await buildDailySummary(store.id, yesterday, today, claimed.lowStockThreshold);
      // Rien à dire : pas d'e-mail (le jour est quand même marqué comme traité).
      if (summary.yesterday.orders === 0 && summary.toProcess === 0 && summary.toVerify === 0 && summary.lowStock.length === 0) continue;
      const dateLabel = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(yesterday.getTime() + 12 * 3_600_000));
      const mail = renderDailyEmail({ storeName: store.name, storeId: store.id, currency: store.currency, dateLabel, s: summary });
      await queueNotification(store.id, "email", to, "merchant.daily_report", mail);
      sent++;
    } catch (e) {
      console.error("[daily-report]", store.id, e);
    }
  }
  if (sent) await enqueue("notification.send", {});
  return { sent };
}
