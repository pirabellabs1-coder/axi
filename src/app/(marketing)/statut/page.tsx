import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Bell, CheckCircle2, CreditCard, Globe, Store, type LucideIcon } from "lucide-react";
import { db } from "@/lib/db";
import { cn, formatDateTime } from "@/lib/utils";
import { SITE } from "@/config/site";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Statut du service",
  description: "État en temps réel des composants Axi : site, boutiques, paiements, notifications.",
  alternates: { canonical: "/statut" },
  robots: { index: false },
};

type Status = "ok" | "incident";

async function checkDatabase(): Promise<{ status: Status; latencyMs: number | null }> {
  const started = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    return { status: "ok", latencyMs: Date.now() - started };
  } catch (e) {
    console.error("[statut] database", e);
    return { status: "incident", latencyMs: null };
  }
}

export default async function StatusPage() {
  const dbCheck = await checkDatabase();
  const now = new Date();
  const allOk = dbCheck.status === "ok";

  const components: { icon: LucideIcon; name: string; description: string; status: Status; detail?: string }[] = [
    { icon: Globe, name: "Site et espace marchand", description: "axi.africa, connexion, tableau de bord", status: "ok" },
    { icon: Store, name: "Boutiques publiques", description: "Pages boutique, panier, commande, suivi", status: dbCheck.status, detail: dbCheck.latencyMs !== null ? `Base de données : ${dbCheck.latencyMs} ms` : "Base de données injoignable" },
    { icon: CreditCard, name: "Paiements", description: "Enregistrement des paiements et webhooks de passerelles", status: dbCheck.status },
    { icon: Bell, name: "Notifications", description: "E-mails et messages WhatsApp", status: "ok" },
  ];

  return (
    <div className="container-x pb-24 pt-12 md:pb-32 md:pt-20">
      <div className="mx-auto max-w-3xl">
        <p className="eyebrow animate-fade-up">Statut du service</p>
        <h1 className="mt-6 text-h1 font-semibold text-ink animate-fade-up [animation-delay:60ms]">État des services Axi</h1>

        <div className="bezel mt-10 animate-fade-up [animation-delay:120ms]">
          <div role="status" className={cn("bezel-core flex items-center gap-5 p-6 sm:p-8", !allOk && "bg-danger-soft")}>
            <span className={cn("inline-flex size-12 shrink-0 items-center justify-center rounded-full", allOk ? "bg-accent text-on-accent" : "bg-danger text-canvas")}>
              {allOk ? <CheckCircle2 className="size-6" aria-hidden /> : <AlertTriangle className="size-6" aria-hidden />}
            </span>
            <div>
              <p className={cn("text-xl font-semibold tracking-[-0.02em]", allOk ? "text-ink" : "text-danger")}>{allOk ? "Tous les services fonctionnent" : "Incident sur la base de données"}</p>
              <p className="mt-1 text-sm text-ink-muted">
                Vérifié le {formatDateTime(now)}. {allOk ? "Aucun incident signalé." : "Les boutiques et les commandes peuvent être indisponibles. Nous rétablissons le service."}
              </p>
            </div>
          </div>
        </div>

        <ul className="mt-6 divide-y divide-line rounded-[var(--radius-xl)] bg-surface ring-1 ring-line shadow-[var(--shadow-card)]">
          {components.map((c, i) => (
            <li key={c.name} className="reveal flex items-center gap-4 px-5 py-5 sm:px-6" style={{ transitionDelay: `${i * 60}ms` }}>
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-muted">
                <c.icon className="size-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink">{c.name}</p>
                <p className="text-sm text-ink-muted">{c.description}</p>
                {c.detail && <p className="mt-0.5 font-mono text-xs text-ink-faint">{c.detail}</p>}
              </div>
              <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium", c.status === "ok" ? "bg-primary-soft text-primary-deep" : "bg-danger-soft text-danger")}>
                {c.status === "ok" ? <CheckCircle2 className="size-3.5" aria-hidden /> : <AlertTriangle className="size-3.5" aria-hidden />}
                {c.status === "ok" ? "Opérationnel" : "Incident"}
              </span>
            </li>
          ))}
        </ul>

        <p className="mt-10 text-[15px] leading-relaxed text-ink-muted">
          Cette page interroge la base de données à chaque chargement. Pour signaler un problème, écrivez à{" "}
          <Link href={`mailto:${SITE.supportEmail}`} className="font-medium text-primary underline underline-offset-4">
            {SITE.supportEmail}
          </Link>{" "}
          ou passez par le{" "}
          <Link href="/contact" className="font-medium text-primary underline underline-offset-4">
            formulaire de contact
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
