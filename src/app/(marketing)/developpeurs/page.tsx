import type { Metadata } from "next";
import Link from "next/link";
import { Bot, Eye, KeyRound, Lock, MousePointerClick, PencilLine, RefreshCcw, ScrollText, ShieldCheck, ShoppingBag, Terminal, Webhook } from "lucide-react";
import { Section, SectionHeading } from "@/components/marketing/section";
import { CtaBand } from "@/components/marketing/cta-band";
import { Faq, FaqJsonLd } from "@/components/marketing/faq";
import { BreadcrumbJsonLd } from "@/components/marketing/structured-data";
import { ButtonLink } from "@/components/ui/button";
import { MCP_TIER_LABEL, PLAN_ORDER, PLANS, REST_API_ACCESS } from "@/config/plans";
import { SITE } from "@/config/site";
import { SCOPES, SCOPE_LABELS } from "@/lib/mcp/scopes";
import { MERCHANT_TOOL_REFERENCE, PUBLIC_TOOL_REFERENCE, type ToolGroup } from "@/lib/mcp/reference";
import { ogImage } from "@/lib/marketing/seo";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Développeurs : API REST, webhooks et connecteur IA",
  description:
    "Branchez Axi à vos outils : API REST /api/v1 (OpenAPI 3.1), webhooks sortants signés HMAC, et serveur MCP pour piloter une boutique depuis Claude, ChatGPT ou Cursor. Jetons par boutique, scopes et quotas.",
  alternates: { canonical: "/developpeurs" },
  openGraph: {
    title: "Développeurs : API REST, webhooks et connecteur IA | Axi",
    description: "API REST /api/v1, webhooks sortants signés et serveur MCP pour les assistants IA.",
    url: "/developpeurs",
    images: ogImage("laptopBraids"),
  },
};

const ORIGIN = SITE.url.replace(/\/$/, "");
const MCP_URL = `${ORIGIN}/api/mcp`;

const ANCHORS = [
  { id: "api", label: "API REST" },
  { id: "webhooks", label: "Webhooks" },
  { id: "outils", label: "Outils MCP" },
  { id: "compatibilite", label: "Compatibilité" },
  { id: "vitrine", label: "Commerce agentique" },
  { id: "securite", label: "Sécurité" },
];

/** Ressources de `/api/v1` (`docs/API-REST.md` §3). */
const RESOURCES: { methods: string; path: string; scope: string }[] = [
  { methods: "GET", path: "/products, /products/{id}", scope: "catalog:read" },
  { methods: "POST, PATCH", path: "/products, /products/{id}", scope: "catalog:write" },
  { methods: "POST", path: "/inventory/adjustments", scope: "inventory:write" },
  { methods: "GET", path: "/orders, /orders/{id}", scope: "orders:read" },
  { methods: "POST", path: "/orders/{id}/transitions", scope: "orders:write" },
  { methods: "GET", path: "/customers, /customers/{id}", scope: "customers:read" },
  { methods: "GET, POST, DELETE", path: "/webhooks, /webhooks/{id}", scope: "webhooks:write" },
];

const API_RULES: { icon: typeof KeyRound; title: string; text: string }[] = [
  { icon: KeyRound, title: "Jeton porteur, boutique déduite", text: "Authorization: Bearer axi_live_… La boutique vient du jeton : aucun paramètre ne permet d'en viser une autre." },
  { icon: ShieldCheck, title: "Portée effective", text: "Scopes du jeton, croisés avec votre plan et le rôle de son créateur, recalculés à chaque requête." },
  { icon: RefreshCcw, title: "Idempotence obligatoire sur POST", text: "Idempotency-Key conservée 24 h : la même requête rejoue la réponse enregistrée au lieu de s'exécuter deux fois." },
  { icon: ScrollText, title: "Erreurs RFC 9457", text: "application/problem+json avec un code stable, le scope requis et un request_id à transmettre au support." },
];

/** Événements des webhooks sortants (`docs/API-REST.md` §4). */
const EVENT_GROUPS: { title: string; events: string[] }[] = [
  { title: "Commandes", events: ["order.created", "order.updated", "order.status_changed", "order.paid", "order.refunded", "order.cancelled"] },
  { title: "Catalogue", events: ["product.created", "product.updated", "product.deleted", "inventory.updated"] },
  { title: "Clients et après-vente", events: ["customer.created", "customer.updated", "return.created", "return.status_changed", "giftcard.issued"] },
  { title: "Service", events: ["app.ping"] },
];

const PROMPTS = [
  { q: "Quels produits sont en rupture ?", a: "Liste des articles épuisés, replacés dans vos ventes du mois." },
  { q: "Crée un code promo de 10 % pour ce week-end.", a: "Code créé avec sa fenêtre et sa limite d'usage, plus un message prêt à envoyer." },
  { q: "Résume les ventes de la semaine.", a: "Évolution du chiffre d'affaires, panier moyen et commandes à préparer en priorité." },
  { q: "Passe la commande AX-7K3P9Q en préparation.", a: "Transition appliquée par la machine d'états, le client est prévenu." },
];

const CLIENTS = [
  { name: "Claude.ai", how: "Connecteur personnalisé, connexion en un clic (OAuth 2.1 + PKCE)", plan: "BUSINESS" as const, icon: MousePointerClick, wide: true },
  { name: "ChatGPT", how: "Mode développeur, connecteur MCP avec OAuth", plan: "BUSINESS" as const, icon: MousePointerClick, wide: false },
  { name: "Claude Desktop et Claude Code", how: "Jeton API, une commande à coller", plan: "FREE" as const, icon: Terminal, wide: false },
  { name: "Cursor, VS Code, Windsurf", how: "Fichier mcp.json avec votre jeton", plan: "FREE" as const, icon: Terminal, wide: false },
  { name: "Vos agents et automatisations", how: "Tout client MCP en HTTP : n8n, Make, scripts maison", plan: "FREE" as const, icon: Bot, wide: true },
];

const GROUPS: ToolGroup[] = ["Boutique", "Catalogue", "Stock", "Commandes", "Clients", "Marketing", "Cartes cadeaux", "Retours", "Analyses"];

const FAQ = [
  {
    q: "Quelle est la différence entre l'API REST et le serveur MCP ?",
    a: "Les deux parlent à la même boutique avec les mêmes règles métier et les mêmes jetons. L'API REST est faite pour vos serveurs : routes stables, pagination par curseur, idempotence, spécification OpenAPI. Le serveur MCP est fait pour les assistants IA : il expose des outils décrits en langage naturel, que Claude ou ChatGPT choisissent eux-mêmes.",
  },
  {
    q: "Quels plans donnent accès à l'API REST ?",
    a: "Lecture seule (GET) à partir du plan Business, lecture et écriture à partir de Scale. Les webhooks sortants suivent la même logique : 2 points sur Business, 10 sur Scale, illimités sur Enterprise. Le connecteur MCP, lui, est inclus dans tous les plans, en lecture seule dès le plan Gratuit.",
  },
  {
    q: "Comment vérifier la signature d'un webhook ?",
    a: "Chaque envoi porte un en-tête Axi-Signature au format t=horodatage,v1=signature, où v1 est le HMAC-SHA256 de « horodatage.corps_brut » avec votre secret whsec_. Calculez sur le corps brut reçu, comparez en temps constant, et refusez au-delà de 300 secondes d'écart. Pendant une rotation de secret, deux v1 sont envoyés pendant 24 heures.",
  },
  {
    q: "Qu'est-ce que MCP ?",
    a: "Le Model Context Protocol est un standard ouvert qui permet à un assistant IA d'utiliser des outils externes. Axi expose un serveur MCP en Streamable HTTP sans état : Claude, ChatGPT ou Cursor peuvent consulter et gérer votre boutique à votre demande.",
  },
  {
    q: "Un assistant peut-il passer commande à la place d'un client ?",
    a: "Non. Sur la vitrine publique, un assistant prépare au mieux un lien de panier : c'est toujours l'acheteur qui ouvre le lien, choisit la livraison et valide sa commande.",
  },
  {
    q: "Mes données clients sont-elles protégées ?",
    a: "Les noms, téléphones et adresses ne sont transmis qu'avec l'autorisation « données clients ». Les webhooks n'envoient aucune donnée personnelle par défaut. Chaque appel est journalisé, chaque accès se révoque en un clic, et les secrets sont stockés hachés ou chiffrés : Axi ne peut pas les relire.",
  },
];

function ScopePill({ write }: { write: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-medium ring-1 ring-inset", write ? "bg-sun-soft text-ink ring-sun/30" : "bg-surface-2 text-ink-muted ring-line")}>
      {write ? <PencilLine className="size-3" aria-hidden /> : <Eye className="size-3" aria-hidden />}
      {write ? "Écriture" : "Lecture"}
    </span>
  );
}

function Code({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <pre className={cn("scrollbar-none overflow-x-auto rounded-[var(--radius-md)] bg-forest-deep p-5 font-mono text-[12.5px] leading-relaxed text-white/85", className)}>
      <code>{children}</code>
    </pre>
  );
}

export default function DevelopersPage() {
  return (
    <>
      <BreadcrumbJsonLd items={[{ name: "Développeurs", path: "/developpeurs" }]} />
      <FaqJsonLd items={FAQ} />

      {/* En-tête : trois façons de brancher Axi */}
      <section aria-labelledby="dev-h1" className="pb-16 pt-8 md:pt-14">
        <div className="container-x">
          <div className="max-w-[720px]">
            <p className="eyebrow mb-6 animate-fade-up">Développeurs</p>
            <h1 id="dev-h1" className="text-h1 font-semibold text-ink animate-fade-up [animation-delay:60ms]">
              Branchez Axi <span className="text-ink-muted">au reste de vos outils.</span>
            </h1>
            <p className="mt-5 max-w-[56ch] text-lg leading-relaxed text-ink-muted animate-fade-up [animation-delay:120ms]">
              Une API REST versionnée, des webhooks sortants signés, et un serveur MCP pour les assistants IA. Mêmes jetons, mêmes règles métier, même isolation par boutique.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row animate-fade-up [animation-delay:180ms]">
              <ButtonLink href="/inscription" variant="accent" size="lg" trailing>
                Créer un compte
              </ButtonLink>
              <ButtonLink href="/api/openapi-2026-10.json" variant="outline" size="lg">
                Spécification OpenAPI
              </ButtonLink>
            </div>
          </div>

          <nav aria-label="Sections de la page" className="mt-10 animate-fade-up [animation-delay:240ms]">
            <ul className="flex flex-wrap gap-2">
              {ANCHORS.map((a) => (
                <li key={a.id}>
                  <a href={`#${a.id}`} className="inline-flex h-11 items-center rounded-full bg-surface px-4 text-sm font-medium text-ink ring-1 ring-line transition-colors duration-300 hover:bg-surface-2">
                    {a.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <ul className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-3">
            {[
              { icon: Terminal, t: "API REST", d: "/api/v1, OpenAPI 3.1, pagination par curseur, idempotence sur POST.", href: "#api" },
              { icon: Webhook, t: "Webhooks sortants", d: "HMAC-SHA256, relances jusqu'à 24 h, rotation de secret, protection SSRF.", href: "#webhooks" },
              { icon: Bot, t: "Serveur MCP", d: `${MERCHANT_TOOL_REFERENCE.length} outils marchands et une vitrine publique lisible par les IA.`, href: "#outils" },
            ].map((c, i) => (
              <li key={c.t} className="reveal" style={{ transitionDelay: `${i * 70}ms` }}>
                <a href={c.href} className="flex h-full flex-col rounded-[var(--radius-xl)] bg-surface p-6 ring-1 ring-line shadow-[var(--shadow-card)] transition-[transform,box-shadow] duration-500 ease-spring hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)]">
                  <span className="inline-flex size-10 items-center justify-center rounded-2xl bg-primary-soft text-primary" aria-hidden>
                    <c.icon className="size-5" />
                  </span>
                  <span className="mt-5 text-[17px] font-semibold text-ink">{c.t}</span>
                  <span className="mt-1.5 text-[15px] leading-relaxed text-ink-muted">{c.d}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* API REST */}
      <Section id="api" labelledBy="api-title" tone="surface" className="border-y border-line">
        <SectionHeading
          id="api-title"
          title="API REST /api/v1"
          description="Lire et modifier produits, stock, commandes, clients et points de webhook. Montants entiers dans la plus petite unité, dates ISO 8601 UTC, CORS fermé : l'API est faite pour vos serveurs."
        />

        <div className="mt-14 grid grid-cols-1 gap-12 lg:grid-cols-[1.15fr_1fr] lg:gap-16">
          <div>
            <h3 className="reveal text-[15px] font-semibold text-ink">Ressources</h3>
            <ul className="reveal mt-4 divide-y divide-line border-y border-line">
              {RESOURCES.map((r) => (
                <li key={`${r.methods} ${r.path}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3.5">
                  <span className="min-w-0">
                    <code className="font-mono text-[12px] font-semibold uppercase tracking-wide text-ink-muted">{r.methods}</code>{" "}
                    <code className="font-mono text-[13px] text-ink">{r.path}</code>
                  </span>
                  <code className="font-mono text-[12px] text-ink-faint">{r.scope}</code>
                </li>
              ))}
            </ul>
            <p className="reveal mt-5 max-w-[62ch] text-[14px] leading-relaxed text-ink-muted">
              Pagination <code className="font-mono text-[13px] text-ink">?limit=1..100</code> et{" "}
              <code className="font-mono text-[13px] text-ink">?cursor=</code>, tri stable du plus récent au plus ancien. Les écritures exécutent exactement les mêmes règles métier que
              l&apos;espace marchand : quotas du plan, stock jamais négatif, transitions de commande contrôlées, journal d&apos;audit.
            </p>
          </div>

          <div className="reveal">
            <Code>{`TOKEN=axi_live_…
BASE=${ORIGIN}/api/v1

curl -s "$BASE/orders?status=NEW,CONFIRMED" \\
  -H "Authorization: Bearer $TOKEN"

curl -s -X POST "$BASE/products" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -d '{"name":"Bissap 1 L","price":1500}'`}</Code>
            <p className="mt-4 text-[13.5px] leading-relaxed text-ink-faint">
              Chaque réponse porte <code className="font-mono text-[12.5px]">Axi-Api-Version</code> et <code className="font-mono text-[12.5px]">X-Request-Id</code>.
            </p>
          </div>
        </div>

        <ul className="mt-16 grid grid-cols-1 gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
          {API_RULES.map((r, i) => (
            <li key={r.title} className="reveal border-t border-line pt-5" style={{ transitionDelay: `${(i % 4) * 60}ms` }}>
              <r.icon className="size-5 text-primary" aria-hidden />
              <h3 className="mt-4 text-[16px] font-semibold text-ink">{r.title}</h3>
              <p className="mt-2 text-[14.5px] leading-relaxed text-ink-muted">{r.text}</p>
            </li>
          ))}
        </ul>

        <div className="reveal mt-12 overflow-hidden rounded-[var(--radius-xl)] bg-canvas ring-1 ring-line">
          <table className="w-full text-left text-[14px]">
            <caption className="sr-only">Accès à l&apos;API REST et nombre de points de webhook selon le plan</caption>
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="px-4 py-3 font-semibold text-ink sm:px-5">
                  Plan
                </th>
                <th scope="col" className="px-4 py-3 font-semibold text-ink sm:px-5">
                  API REST
                </th>
                <th scope="col" className="px-4 py-3 font-semibold text-ink sm:px-5">
                  Webhooks
                </th>
              </tr>
            </thead>
            <tbody>
              {PLAN_ORDER.map((p) => {
                const access = REST_API_ACCESS[p];
                const hooks = PLANS[p].limits.webhookEndpoints;
                return (
                  <tr key={p} className="border-b border-line last:border-b-0">
                    <th scope="row" className="px-4 py-3 font-medium text-ink sm:px-5">
                      {PLANS[p].name}
                    </th>
                    <td className="px-4 py-3 text-ink-muted sm:px-5">{access === "none" ? "Non incluse" : access === "read" ? "Lecture seule (GET)" : "Lecture et écriture"}</td>
                    <td className="px-4 py-3 text-ink-muted sm:px-5">{hooks == null ? "Illimités" : hooks === 0 ? "Non inclus" : `${hooks} points`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Webhooks */}
      <section id="webhooks" aria-labelledby="hooks-title" className="scroll-mt-28 bg-forest py-24 text-white md:py-32">
        <div className="container-x">
          <SectionHeading
            id="hooks-title"
            light
            title="Webhooks sortants signés"
            description="Axi appelle votre serveur à chaque événement. Charge utile minimale, signature HMAC, relances jusqu'à 24 heures, et vérification anti-SSRF avant chaque envoi."
          />

          <div className="mt-14 grid grid-cols-1 gap-12 lg:grid-cols-[1fr_1.1fr] lg:gap-16">
            <div>
              <h3 className="reveal text-[15px] font-semibold text-white">Événements</h3>
              <dl className="reveal mt-4 space-y-5">
                {EVENT_GROUPS.map((g) => (
                  <div key={g.title}>
                    <dt className="text-[14px] font-medium text-white/60">{g.title}</dt>
                    <dd className="mt-2 flex flex-wrap gap-1.5">
                      {g.events.map((e) => (
                        <code key={e} className="rounded-full bg-white/[0.08] px-2.5 py-1 font-mono text-[12px] text-white/85">
                          {e}
                        </code>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="reveal">
              <Code className="bg-black/40 ring-1 ring-inset ring-white/10">{`Axi-Event: order.created
Axi-Webhook-Id: evt_3f2a…
Axi-Signature: t=1760184000,v1=5f2b…

v1 = hex(HMAC-SHA256(secret, t + "." + corps_brut))`}</Code>
              <ul className="mt-6 space-y-2.5 text-[14.5px] leading-relaxed text-white/75">
                {[
                  "Répondez 2xx en moins de 10 secondes, traitez en arrière-plan.",
                  "Relances à 1 min, 5 min, 30 min, 2 h, 6 h, 12 h puis 24 h.",
                  "Dédupliquez sur Axi-Webhook-Id : la livraison est garantie au moins une fois.",
                  "Rotation de secret : deux signatures envoyées pendant 24 heures.",
                  "HTTPS uniquement, adresses privées et noms internes refusés.",
                ].map((t) => (
                  <li key={t} className="border-t border-white/15 pt-2.5">
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Outils MCP */}
      <Section id="outils" labelledBy="tools-title">
        <SectionHeading
          id="tools-title"
          title={`${MERCHANT_TOOL_REFERENCE.length} outils MCP pour gérer une boutique.`}
          description="Chaque outil vérifie l'autorisation du jeton, les limites du plan, et ne voit qu'une seule boutique. Toute modification est inscrite au journal d'audit."
        />
        <div className="mt-14 grid grid-cols-1 gap-x-12 gap-y-10 lg:grid-cols-2">
          {GROUPS.map((g) => (
            <section key={g} aria-labelledby={`g-${g}`} className="reveal">
              <h3 id={`g-${g}`} className="border-b border-line pb-3 text-[15px] font-semibold text-ink">
                {g}
              </h3>
              <ul className="divide-y divide-line">
                {MERCHANT_TOOL_REFERENCE.filter((t) => t.group === g).map((t) => (
                  <li key={t.name} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1.5 py-3.5">
                    <div className="min-w-0 flex-1">
                      <code className="font-mono text-[13px] text-ink">{t.name}</code>
                      <p className="mt-1 text-[14px] leading-relaxed text-ink-muted">{t.description}</p>
                    </div>
                    <ScopePill write={t.write} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </Section>

      {/* Exemples de demandes */}
      <Section labelledBy="ask-title" tone="deep">
        <SectionHeading id="ask-title" title="Demandez, l'assistant agit." description="Il lit vos vraies données Axi, propose, puis agit seulement avec les autorisations que vous lui avez données." />
        <ul className="mt-14 grid grid-cols-1 gap-4 md:grid-cols-2">
          {PROMPTS.map((p, i) => (
            <li key={p.q} className="reveal rounded-[var(--radius-xl)] bg-surface p-6 ring-1 ring-line shadow-[var(--shadow-card)]" style={{ transitionDelay: `${(i % 2) * 80}ms` }}>
              <p className="text-[17px] font-medium text-ink">« {p.q} »</p>
              <p className="mt-3 text-[15px] leading-relaxed text-ink-muted">{p.a}</p>
            </li>
          ))}
        </ul>
        <p className="reveal mt-6 text-[13px] text-ink-faint">Réponses illustratives : chaque assistant formule à sa manière.</p>
      </Section>

      {/* Compatibilité */}
      <Section id="compatibilite" labelledBy="clients-title" tone="surface" className="border-y border-line">
        <SectionHeading id="clients-title" title="Avec l'assistant que vous utilisez déjà." description={`Une seule adresse à retenir : ${MCP_URL.replace(/^https?:\/\//, "")}.`} />
        <ul className="mt-14 grid grid-cols-1 gap-4 md:grid-cols-3">
          {CLIENTS.map((c, i) => {
            const Icon = c.icon;
            return (
              <li key={c.name} className={cn("reveal flex flex-col rounded-[var(--radius-xl)] bg-canvas p-6 ring-1 ring-line", c.wide && "md:col-span-2")} style={{ transitionDelay: `${(i % 3) * 70}ms` }}>
                <span className="inline-flex size-10 items-center justify-center rounded-2xl bg-primary-soft text-primary" aria-hidden>
                  <Icon className="size-5" />
                </span>
                <h3 className="mt-5 text-[17px] font-semibold text-ink">{c.name}</h3>
                <p className="mt-1.5 text-[15px] leading-relaxed text-ink-muted">{c.how}</p>
                <p className="mt-auto pt-5 text-[13px] font-medium text-ink-muted">{c.plan === "FREE" ? "Tous les plans" : `Dès ${PLANS[c.plan].name}`}</p>
              </li>
            );
          })}
        </ul>
      </Section>

      {/* Commerce agentique */}
      <Section id="vitrine" labelledBy="agentic-title">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[1.1fr_1fr] lg:gap-20">
          <div>
            <SectionHeading
              id="agentic-title"
              title="Vitrine publique lisible par les IA."
              description="Chaque boutique publiée peut ouvrir son catalogue aux assistants : ils trouvent les produits, vérifient la disponibilité et la livraison, puis préparent un panier que l'acheteur valide lui-même."
            />
            <ul className="reveal mt-10 divide-y divide-line border-y border-line">
              {PUBLIC_TOOL_REFERENCE.map((t) => (
                <li key={t.name} className="flex items-start justify-between gap-4 py-3.5">
                  <div className="min-w-0">
                    <code className="font-mono text-[13px] text-ink">{t.name}</code>
                    <p className="mt-1 text-[14px] leading-relaxed text-ink-muted">{t.description}</p>
                  </div>
                  {t.write ? <ShoppingBag className="mt-1 size-4 shrink-0 text-ink-faint" aria-label="Prépare un panier" /> : <Eye className="mt-1 size-4 shrink-0 text-ink-faint" aria-label="Lecture" />}
                </li>
              ))}
            </ul>
          </div>
          <div className="reveal lg:sticky lg:top-28 lg:self-start">
            <Code>{`POST /api/mcp/store/{slug}
GET  /s/{slug}/llms.txt`}</Code>
            <p className="mt-5 text-[14.5px] leading-relaxed text-ink-muted">
              Sans authentification, limitée par adresse IP, désactivable à tout moment. Aucune donnée client, aucune commande, aucun paiement. Le détail du positionnement est sur la page{" "}
              <Link href="/ia" className="font-medium text-primary underline underline-offset-4">
                intelligence artificielle
              </Link>
              .
            </p>
          </div>
        </div>
      </Section>

      {/* Sécurité */}
      <Section id="securite" labelledBy="security-title" tone="deep">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
          <div>
            <SectionHeading id="security-title" title="Des accès que vous maîtrisez." description="Les mêmes règles que pour votre équipe : chacun ne voit que ce dont il a besoin." />
            <ul className="mt-10 space-y-5">
              {[
                { icon: KeyRound, title: "Jetons API par boutique", text: "Affichés une seule fois, stockés hachés, avec expiration, rotation et révocation immédiate." },
                { icon: Lock, title: "OAuth 2.1 pour la connexion en un clic", text: "PKCE obligatoire, jetons d'une heure renouvelés par rotation, page de consentement Axi." },
                { icon: ShieldCheck, title: "Isolation stricte", text: "Un accès est lié à une seule boutique. Votre plan et votre rôle limitent ce qu'il peut faire." },
                { icon: ScrollText, title: "Journal et quotas", text: "Chaque appel est journalisé 30 jours ; les quotas par minute et par jour protègent votre boutique." },
              ].map((s) => (
                <li key={s.title} className="reveal flex gap-4">
                  <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-2xl bg-surface text-primary ring-1 ring-line" aria-hidden>
                    <s.icon className="size-5" />
                  </span>
                  <div>
                    <h3 className="text-[16px] font-semibold text-ink">{s.title}</h3>
                    <p className="mt-1 text-[15px] leading-relaxed text-ink-muted">{s.text}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div className="reveal space-y-4">
            <div className="rounded-[var(--radius-xl)] bg-surface p-6 ring-1 ring-line shadow-[var(--shadow-card)]">
              <h3 className="text-[15px] font-semibold text-ink">Connecteur IA inclus dans chaque plan</h3>
              <dl className="mt-3 divide-y divide-line text-sm">
                {PLAN_ORDER.map((p) => (
                  <div key={p} className="flex items-baseline justify-between gap-4 py-2.5">
                    <dt className="font-medium text-ink">{PLANS[p].name}</dt>
                    <dd className="text-right text-ink-muted">{MCP_TIER_LABEL[p]}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="rounded-[var(--radius-xl)] bg-surface p-6 ring-1 ring-line">
              <h3 className="text-[15px] font-semibold text-ink">Autorisations</h3>
              <ul className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                {SCOPES.map((s) => (
                  <li key={s} className="flex items-center justify-between gap-2">
                    <span className="text-ink-muted">{SCOPE_LABELS[s].label}</span>
                    <code className="font-mono text-[11px] text-ink-faint">{s}</code>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </Section>

      <Section labelledBy="dev-faq-title">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
          <SectionHeading id="dev-faq-title" title="Questions fréquentes" description="La référence complète (outils, OAuth, exemples, codes d'erreur) est fournie avec votre compte." />
          <Faq items={FAQ} name="faq-dev" />
        </div>
      </Section>

      <CtaBand
        title="Essayez avec votre propre boutique."
        description="Créez un jeton en deux minutes depuis Connecteurs IA, ou connectez Claude.ai en un clic dès le plan Business."
        primaryLabel="Créer ma boutique"
        secondaryLabel="Voir les tarifs"
      />
    </>
  );
}
