import { db } from "@/lib/db";
import { requireStore, planFeature, AuthError } from "@/lib/auth/permissions";
import { audit } from "@/lib/audit";
import { toCsv, csvResponse } from "@/lib/csv";

export async function GET(_req: Request, { params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  try {
    const ctx = await requireStore(storeId, "export");
    if (!planFeature(ctx.planId, "csvExport")) return new Response("L'export CSV est disponible à partir du plan Business.", { status: 403 });
    const customers = await db.customer.findMany({
      where: { storeId: ctx.store.id },
      orderBy: { createdAt: "desc" },
      take: 10000,
      include: { consents: { orderBy: { createdAt: "desc" } } },
    });
    const latestConsent = (c: (typeof customers)[number], purpose: "MARKETING" | "TRANSACTIONAL") => {
      const last = c.consents.find((x) => x.channel === "WHATSAPP" && x.purpose === purpose);
      return last ? (last.granted ? "oui" : "non") : "";
    };
    const rows = customers.map((c) => [c.name, c.phone, c.email ?? "", c.address ?? "", c.ordersCount, c.totalSpent, c.lastOrderAt ?? "", c.tags.join(", "), latestConsent(c, "MARKETING"), c.loyaltyPoints, c.createdAt, c.notes ?? ""]);
    const csv = toCsv(["Nom", "Téléphone", "E-mail", "Adresse", "Commandes", "Total dépensé", "Dernier achat", "Tags", "Consentement marketing WhatsApp", "Points fidélité", "Créé le", "Notes"], rows);
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "customers.exported", metadata: { count: customers.length } });
    return csvResponse(`clients-${ctx.store.slug}-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  } catch (e) {
    if (e instanceof AuthError) return new Response(e.message, { status: e.code === "UNAUTHENTICATED" ? 401 : 403 });
    throw e;
  }
}
