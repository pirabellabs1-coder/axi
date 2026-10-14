import type { Metadata } from "next";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { getAccountSettings, WELCOME_MAX } from "@/lib/buyer/settings";
import { freeDailyPerStore } from "@/lib/buyer/otp";
import { PageHeader, Kpi } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { KeyRound, Send, UserCheck, Users } from "lucide-react";
import { AccountsForm } from "./accounts-form";

export const metadata: Metadata = { title: "Comptes clients" };

/** Période « AAAA-MM-JJ » des compteurs UsageCounter, il y a `days` jours. */
function periodDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

export default async function AccountsSettingsPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const ctx = await getStoreContext(storeId, "store.settings");
  const sid = ctx.store.id;
  const sincePeriod = periodDaysAgo(30);

  const [settings, wa, counters, verifiedCustomers, activeSessions] = await Promise.all([
    getAccountSettings(sid),
    db.integration.findUnique({ where: { storeId_kind: { storeId: sid, kind: "whatsapp_cloud" } }, select: { status: true } }),
    db.usageCounter.findMany({ where: { storeId: sid, metric: { startsWith: "otp:" }, period: { gte: sincePeriod } }, select: { metric: true, value: true } }),
    db.customer.count({ where: { storeId: sid, phoneVerifiedAt: { not: null } } }),
    db.customerSession.count({ where: { storeId: sid, revokedAt: null, expiresAt: { gt: new Date() } } }),
  ]);
  const sum = (pred: (m: string) => boolean) => counters.filter((c) => pred(c.metric)).reduce((s, c) => s + c.value, 0);
  const sent = sum((m) => /^otp:(whatsapp|sms|email)$/.test(m));
  const failed = sum((m) => m.endsWith(":failed"));
  const verified = sum((m) => m === "otp:verified");
  const successRate = sent > 0 ? Math.min(100, Math.round((verified / sent) * 100)) : null;

  return (
    <>
      <PageHeader back={{ href: `/app/${sid}/parametres`, label: "Paramètres" }} title="Comptes clients" description="Connexion de vos clients par code WhatsApp : historique, adresses, favoris, points et avoir." />
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <Kpi label="Clients vérifiés" icon={UserCheck} value={verifiedCustomers.toLocaleString("fr-FR")} hint="Numéro confirmé par code" />
          <Kpi label="Sessions actives" icon={Users} value={activeSessions.toLocaleString("fr-FR")} hint="Appareils connectés" />
          <Kpi label="Codes envoyés" icon={Send} value={sent.toLocaleString("fr-FR")} hint={failed ? `${failed} échec${failed > 1 ? "s" : ""} d'envoi, 30 jours` : "30 derniers jours"} />
          <Kpi label="Connexions réussies" icon={KeyRound} value={verified.toLocaleString("fr-FR")} hint={successRate != null ? `${successRate} % des codes envoyés` : "30 derniers jours"} />
        </div>
        <Card as="section" aria-labelledby="accounts-title">
          <CardHeader title={<span id="accounts-title">Réglages</span>} description="Les codes ne sont jamais visibles par votre équipe ni enregistrés en clair." />
          <CardBody>
            <AccountsForm storeId={sid} paidPlan={ctx.planId !== "FREE"} freeDailyQuota={freeDailyPerStore()} whatsappActive={wa?.status === "active"} welcomeMax={WELCOME_MAX} initial={{ accountsEnabled: ctx.store.accountsEnabled, channel: settings.channel, welcomeText: settings.welcomeText }} />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
