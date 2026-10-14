import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, BookOpen, Blocks, CheckCircle2, Circle, Code2, FlaskConical, KeyRound, Plus, Send, Server, Wallet, Webhook } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { listDeveloperApps } from "@/lib/apps/dev-queries";
import { developerJourney, type JourneyStepId } from "@/lib/apps/dev-logic";
import { computeDeveloperEarnings } from "@/lib/apps/billing";
import { APP_PLATFORM_FEE_PCT } from "@/lib/apps/types";
import { PageHeader, Stat, Money } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { devBase } from "@/app/app/[storeId]/developpeur/_components/dev-base";

export const metadata: Metadata = { title: "Vue d'ensemble" };

const STEP_COPY: Record<JourneyStepId, { title: string; body: string; icon: typeof Plus }> = {
  create: { title: "Créer une application", body: "Vous recevez un client_id et un client_secret OAuth (le secret ne s'affiche qu'une fois).", icon: Plus },
  configure: { title: "Configurer OAuth et l'URL de l'app", body: "Déclarez l'URL de votre app hébergée chez vous (affichée dans l'admin) et l'adresse de redirection OAuth.", icon: KeyRound },
  test: { title: "Installer en test sur votre boutique", body: "Installez l'app, même en brouillon, sur une boutique dont vous êtes propriétaire. Aucune facturation.", icon: FlaskConical },
  submit: { title: "Soumettre à la revue", body: "L'équipe Axi vérifie l'app avant sa publication au catalogue des marchands.", icon: Send },
};

export default async function DeveloperHomePage({ params }: { params: Promise<{ storeId: string }> }) {
  const dev = devBase((await params).storeId);
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");

  const apps = await listDeveloperApps(user.id);
  const steps = developerJourney(apps);
  const doneCount = steps.filter((s) => s.done).length;
  const target = apps[0];

  const liveInstalls = apps.reduce((n, a) => n + a.liveInstallCount, 0);
  const testInstalls = apps.reduce((n, a) => n + a.testInstallCount, 0);
  const earnings = computeDeveloperEarnings(
    apps.flatMap((a) => a.realInstalls.map((i) => ({ billingStatus: i.billingStatus, priceAmount: i.priceAmount, pricingType: a.pricingType, priceInterval: a.priceInterval }))),
    APP_PLATFORM_FEE_PCT,
  );

  const stepHref = (id: JourneyStepId) => {
    if (!target || id === "create") return `${dev}/apps/nouvelle`;
    if (id === "configure") return `${dev}/apps/${target.id}/configuration`;
    if (id === "test") return `${dev}/apps/${target.id}/tests`;
    return `${dev}/apps/${target.id}/revue`;
  };
  const nextStep = steps.find((s) => !s.done);

  return (
    <>
      <PageHeader
        title="Espace développeur"
        description="Construisez des applications pour les marchands Axi. Votre application tourne sur VOTRE serveur : vous la connectez à Axi par OAuth, l'API REST et les webhooks, et elle s'affiche dans l'admin des boutiques qui l'installent."
        actions={
          <ButtonLink href={`${dev}/apps/nouvelle`}>
            <Plus className="size-4" aria-hidden /> Créer une application
          </ButtonLink>
        }
      />

      <section aria-labelledby="chiffres" className="mb-8">
        <h2 id="chiffres" className="sr-only">Chiffres clés</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat label="Applications" value={apps.length} icon={Blocks} hint={`${apps.filter((a) => a.status === "PUBLISHED").length} publiée(s)`} />
          <Stat label="Installations" value={liveInstalls} icon={Server} hint={`${testInstalls} installation(s) de test`} />
          <Stat label="Revenu net / mois" value={<Money amount={earnings.netMonthly} currency="XOF" />} icon={Wallet} hint={`${earnings.activePaidInstalls} abonnement(s) actif(s)`} />
        </div>
      </section>

      <Card className="mb-8">
        <CardHeader
          title="Votre parcours"
          description={target ? `Étapes calculées sur vos applications (${doneCount}/4 terminées).` : "Quatre étapes pour publier votre première application."}
        />
        <CardBody>
          <ol className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {steps.map((s, i) => {
              const copy = STEP_COPY[s.id];
              const isNext = nextStep?.id === s.id;
              return (
                <li key={s.id} className={cn("flex gap-3 rounded-[var(--radius-md)] p-3 ring-1", s.done ? "bg-primary-soft/50 ring-primary/20" : isNext ? "ring-primary/40" : "ring-line")}>
                  {s.done ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden /> : <Circle className="mt-0.5 size-5 shrink-0 text-ink-faint" aria-hidden />}
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink">
                      <span className="text-ink-muted">{i + 1}. </span>
                      {copy.title}
                      <span className="sr-only">{s.done ? " (terminé)" : " (à faire)"}</span>
                    </p>
                    <p className="mt-0.5 text-sm text-ink-muted">{copy.body}</p>
                    {!s.done && (
                      <Link href={stepHref(s.id)} className="mt-2 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary-deep hover:underline">
                        {isNext ? "Faire maintenant" : "Ouvrir"} <ArrowRight className="size-4" aria-hidden />
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </CardBody>
      </Card>

      <section aria-labelledby="docs-raccourcis">
        <h2 id="docs-raccourcis" className="mb-3 text-lg font-semibold text-ink">Documentation</h2>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { href: `${dev}/docs/demarrage`, title: "Démarrage rapide", body: "De zéro à un premier appel d'API.", icon: BookOpen },
            { href: `${dev}/docs/oauth`, title: "Authentification OAuth", body: "Autorisation, jetons, PKCE, scopes.", icon: KeyRound },
            { href: `${dev}/docs/webhooks`, title: "Webhooks", body: "Événements et vérification de signature.", icon: Webhook },
            { href: `${dev}/docs/exemple-node`, title: "Exemple Node complet", body: "Serveur Express prêt à adapter.", icon: Code2 },
          ].map((d) => (
            <li key={d.href}>
              <Link href={d.href} className="flex h-full gap-3 rounded-[var(--radius-lg)] bg-surface p-4 ring-1 ring-line transition-shadow hover:ring-primary/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                <d.icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
                <span>
                  <span className="block font-medium text-ink">{d.title}</span>
                  <span className="block text-sm text-ink-muted">{d.body}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
