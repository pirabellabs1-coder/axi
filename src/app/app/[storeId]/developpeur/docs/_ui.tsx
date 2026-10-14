import { DevLink } from "@/app/app/[storeId]/developpeur/_components/dev-link";
import { ArrowRight, Info } from "lucide-react";
import { CodeBlock } from "@/app/app/[storeId]/integrations/ia/code-block";
import { Breadcrumbs } from "../_components/breadcrumbs";

/** Briques de mise en page des guides (serveur). Les blocs de code ont un bouton Copier. */

export const DOC_PAGES = [
  { slug: "demarrage", title: "Démarrage rapide", description: "Le modèle Axi et vos premiers pas, de la création à l'installation de test." },
  { slug: "oauth", title: "Authentification OAuth", description: "URL d'autorisation, PKCE, échange du code, rafraîchissement, scopes." },
  { slug: "api", title: "API", description: "Serveur MCP (jetons OAuth) et API REST /api/v1 : ressources et conventions." },
  { slug: "webhooks", title: "Webhooks", description: "Événements, en-têtes, vérification de signature et relances." },
  { slug: "embarquees", title: "Applications embarquées", description: "Afficher votre app dans l'admin du marchand (URL de l'app + jeton de session)." },
  { slug: "exemple-node", title: "Exemple Node complet", description: "Serveur Express minimal : OAuth, stockage des jetons, appel d'API." },
  { slug: "facturation", title: "Facturation et revue", description: "Modèles tarifaires, commission, installations de test et processus de revue." },
] as const;

export function DocTitle({ title, lead }: { title: string; lead: React.ReactNode }) {
  return (
    <header className="mb-6">
      <Breadcrumbs items={[{ to: "", label: "Espace développeur" }, { to: "/docs", label: "Documentation" }, ...(title === "Documentation développeur" ? [] : [{ label: title }])]} />
      <h1 className="text-[26px] font-semibold tracking-[-0.035em] text-ink sm:text-[30px]">{title}</h1>
      <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-ink-muted">{lead}</p>
    </header>
  );
}

export function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mt-10 mb-3 scroll-mt-24 text-xl font-semibold tracking-[-0.02em] text-ink">
      {children}
    </h2>
  );
}

export function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-6 mb-2 font-semibold text-ink">{children}</h3>;
}

export function P({ children }: { children: React.ReactNode }) {
  return <p className="my-3 max-w-3xl text-[15px] leading-relaxed text-ink">{children}</p>;
}

export function UL({ children }: { children: React.ReactNode }) {
  return <ul className="my-3 max-w-3xl list-disc space-y-1.5 pl-5 text-[15px] leading-relaxed text-ink marker:text-ink-faint">{children}</ul>;
}

export function OL({ children }: { children: React.ReactNode }) {
  return <ol className="my-3 max-w-3xl list-decimal space-y-1.5 pl-5 text-[15px] leading-relaxed text-ink marker:text-ink-muted">{children}</ol>;
}

export function C({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[13px] text-ink ring-1 ring-inset ring-line [overflow-wrap:anywhere]">{children}</code>;
}

export function Code({ code, label }: { code: string; label?: string }) {
  return <CodeBlock code={code} label={label} className="my-4 max-w-4xl" />;
}

export function Note({ title, tone = "info", children }: { title?: string; tone?: "info" | "warning"; children: React.ReactNode }) {
  const cls = tone === "warning" ? "border-warning/30 bg-warning-soft" : "border-info/25 bg-info-soft";
  return (
    <aside className={`my-4 max-w-3xl rounded-[var(--radius-md)] border px-4 py-3 text-sm text-ink ${cls}`}>
      <p className="flex items-start gap-2">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          {title && <strong className="font-semibold">{title} </strong>}
          {children}
        </span>
      </p>
    </aside>
  );
}

/** Encart « contrat en cours de livraison » : fonctionnalités construites par l'équipe Intégration. */
export function Pending({ children }: { children: React.ReactNode }) {
  return (
    <Note tone="warning" title="En cours de déploiement.">
      {children}
    </Note>
  );
}

export function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="my-4 max-w-4xl overflow-x-auto rounded-[var(--radius-md)] ring-1 ring-line">
      <table className="w-full min-w-[520px] text-sm">
        <thead>
          <tr className="border-b border-line bg-surface-2 text-left text-xs text-ink-muted">
            {head.map((h) => (
              <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line align-top last:border-0">
              {r.map((c, j) => (
                <td key={j} className="px-3 py-2 text-ink">{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function NextLink({ slug }: { slug: (typeof DOC_PAGES)[number]["slug"] }) {
  const p = DOC_PAGES.find((d) => d.slug === slug)!;
  return (
    <DevLink to={`/docs/${p.slug}`} className="mt-10 flex max-w-3xl items-center justify-between gap-3 rounded-[var(--radius-lg)] bg-surface p-4 ring-1 ring-line hover:ring-primary/30">
      <span>
        <span className="block text-xs text-ink-muted">Guide suivant</span>
        <span className="block font-medium text-ink">{p.title}</span>
      </span>
      <ArrowRight className="size-5 text-primary" aria-hidden />
    </DevLink>
  );
}
