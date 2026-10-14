import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Eye, PencilLine, ShieldCheck, Sparkles } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Section, SectionHeading } from "@/components/marketing/section";
import { Shot } from "@/components/marketing/shot";
import { CapabilityGroupBlock, DomainLinks } from "@/components/marketing/capability-list";
import { CtaBand } from "@/components/marketing/cta-band";
import { Faq, FaqJsonLd } from "@/components/marketing/faq";
import { BreadcrumbJsonLd } from "@/components/marketing/structured-data";
import { getDomain, groupsForDomain, SHOTS } from "@/lib/marketing/positioning";
import { MERCHANT_TOOL_REFERENCE, PUBLIC_TOOL_REFERENCE } from "@/lib/mcp/reference";
import { MCP_TIER_LABEL, PLANS, PLAN_ORDER, TRIAL_DAYS } from "@/config/plans";
import { MEDIA, unsplash } from "@/config/media";

const DOMAIN = getDomain("ia");
const GROUPS = groupsForDomain("ia");

export const metadata: Metadata = {
  title: "Intelligence artificielle et connecteur IA",
  description:
    "Pilotez votre boutique Axi depuis Claude, ChatGPT ou Cursor grâce au connecteur MCP, et laissez les assistants de vos acheteurs lire votre vitrine. Génération de boutique, traduction et rédaction assistées.",
  alternates: { canonical: "/ia" },
  openGraph: {
    title: "Intelligence artificielle | Axi",
    description: DOMAIN.lede,
    url: "/ia",
    images: [{ url: unsplash(MEDIA.laptopBraids.id, 1200, 630), width: 1200, height: 630, alt: MEDIA.laptopBraids.alt }],
  },
};

const PROMPTS = [
  { q: "Quels produits sont en rupture ?", a: "Trois articles épuisés, dont votre deuxième meilleure vente du mois." },
  { q: "Crée un code promo de 10 % pour ce week-end.", a: "Code créé, limité à un usage par client, avec un message WhatsApp pour l'annoncer." },
  { q: "Passe la commande AX-7K3P9Q en préparation.", a: "Statut mis à jour, le client est prévenu automatiquement." },
  { q: "Traduis mes dix meilleures fiches en anglais.", a: "Brouillons proposés, que vous relisez avant publication." },
];

const FAQ = [
  {
    q: "Faut-il être développeur pour utiliser le connecteur IA ?",
    a: "Non. Dès le plan Business, vous reliez Claude.ai ou ChatGPT à votre boutique en un clic, depuis la page Connecteurs IA : vous choisissez la boutique, vous autorisez, c'est terminé. Les jetons à copier existent pour ceux qui veulent brancher un outil local ou une automatisation.",
  },
  {
    q: "L'assistant peut-il tout faire dans ma boutique ?",
    a: "Non. Chaque accès porte des autorisations : lecture seule, catalogue, commandes, données clients. Les paiements, l'équipe, l'abonnement et la suppression de la boutique ne sont jamais accessibles à une IA. Chaque appel est journalisé et tout accès se révoque en un clic.",
  },
  {
    q: "Une IA peut-elle acheter à la place de mon client ?",
    a: "Non. Sur la vitrine publique, un assistant peut au mieux préparer un lien de panier : c'est toujours l'acheteur qui ouvre ce lien, choisit sa livraison, valide et paie.",
  },
  {
    q: "Mes données clients sont-elles envoyées à l'IA ?",
    a: "Seulement si vous accordez l'autorisation « données clients » à cet accès précis. La vitrine publique, elle, n'expose aucune donnée client, aucune commande et aucun paiement.",
  },
  {
    q: "Qu'est-ce qui est inclus dans mon plan ?",
    a: `Le connecteur est inclus partout : ${MCP_TIER_LABEL.FREE.toLowerCase()} sur le plan Gratuit, ${MCP_TIER_LABEL.STARTER.toLowerCase()} sur Starter, puis l'accès complet et la connexion en un clic dès Business. L'abonnement à Claude ou ChatGPT reste le vôtre.`,
  },
];

export default function AiPage() {
  return (
    <>
      <BreadcrumbJsonLd items={[{ name: "Intelligence artificielle", path: "/ia" }]} />
      <FaqJsonLd items={FAQ} />

      {/* En-tête */}
      <section aria-labelledby="ia-h1" className="pb-16 pt-8 md:pt-14">
        <div className="container-x">
          <div className="max-w-[720px]">
            <p className="eyebrow mb-6 animate-fade-up">Intelligence artificielle</p>
            <h1 id="ia-h1" className="text-h1 font-semibold text-ink animate-fade-up [animation-delay:60ms]">
              {DOMAIN.title}
            </h1>
            <p className="mt-5 max-w-[56ch] text-lg leading-relaxed text-ink-muted animate-fade-up [animation-delay:120ms]">{DOMAIN.lede}</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row animate-fade-up [animation-delay:180ms]">
              <ButtonLink href="/inscription" variant="accent" size="lg" trailing>
                Créer ma boutique
              </ButtonLink>
              <ButtonLink href="/developpeurs" variant="outline" size="lg">
                Documentation technique
              </ButtonLink>
            </div>
          </div>
          <div className="mt-12 animate-fade-up [animation-delay:140ms]">
            <Shot shot={SHOTS.connecteurIa} priority sizes="(min-width: 1280px) 1216px, 100vw" frame="window" />
          </div>
        </div>
      </section>

      {/* Sens 1 : vous pilotez */}
      <section aria-labelledby="ask-title" className="bg-forest py-24 text-white md:py-32">
        <div className="container-x">
          <SectionHeading
            id="ask-title"
            light
            title="Demandez, l'assistant agit."
            description={`${MERCHANT_TOOL_REFERENCE.length} outils reliés à vos vraies données Axi : il propose, puis il agit seulement dans les limites que vous avez fixées.`}
          />
          <ul className="mt-14 grid grid-cols-1 gap-4 md:grid-cols-2">
            {PROMPTS.map((p, i) => (
              <li key={p.q} className="reveal rounded-[var(--radius-xl)] bg-white/[0.06] p-6 ring-1 ring-inset ring-white/10" style={{ transitionDelay: `${(i % 2) * 80}ms` }}>
                <p className="text-[17px] font-medium text-white">« {p.q} »</p>
                <p className="mt-3 flex items-start gap-2.5 text-[15px] leading-relaxed text-white/70">
                  <Sparkles className="mt-0.5 size-4 shrink-0 text-lime" aria-hidden />
                  {p.a}
                </p>
              </li>
            ))}
          </ul>
          <p className="reveal mt-6 text-[13px] text-white/65">Réponses illustratives : chaque assistant formule à sa manière.</p>
          <div className="reveal mt-10">
            <ButtonLink href="/developpeurs#outils" variant="inverse" trailing>
              Voir les {MERCHANT_TOOL_REFERENCE.length} outils
            </ButtonLink>
          </div>
        </div>
      </section>

      {/* Sens 2 : vos acheteurs */}
      <Section labelledBy="agentic-title">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[1.1fr_1fr] lg:gap-20">
          <div>
            <SectionHeading
              id="agentic-title"
              title="Et vos produits, trouvés par les assistants des acheteurs."
              description="Chaque boutique publiée peut ouvrir son catalogue aux IA : un assistant trouve vos produits, vérifie la disponibilité et la livraison, puis prépare un panier que l'acheteur valide lui-même."
            />
            <ul className="reveal mt-10 divide-y divide-line border-y border-line">
              {PUBLIC_TOOL_REFERENCE.map((t) => (
                <li key={t.name} className="flex items-start justify-between gap-4 py-3.5">
                  <div className="min-w-0">
                    <code className="font-mono text-[13px] text-ink">{t.name}</code>
                    <p className="mt-1 text-[14px] leading-relaxed text-ink-muted">{t.description}</p>
                  </div>
                  {t.write ? <PencilLine className="mt-1 size-4 shrink-0 text-ink-faint" aria-label="Prépare un panier" /> : <Eye className="mt-1 size-4 shrink-0 text-ink-faint" aria-label="Lecture seule" />}
                </li>
              ))}
            </ul>
            <p className="reveal mt-6 max-w-[62ch] text-[14px] leading-relaxed text-ink-muted">
              Sans authentification, limitée par adresse IP, désactivable à tout moment. Aucune donnée client, aucune commande, aucun paiement n&apos;y sont exposés.
            </p>
          </div>
          <div className="reveal rounded-[var(--radius-2xl)] bg-surface p-7 ring-1 ring-line shadow-[var(--shadow-card)] sm:p-9 lg:sticky lg:top-28 lg:self-start">
            <span className="inline-flex size-11 items-center justify-center rounded-2xl bg-primary-soft text-primary" aria-hidden>
              <ShieldCheck className="size-5" />
            </span>
            <h2 className="mt-5 text-h3 font-semibold text-ink">Ce qu&apos;une IA ne fera jamais sur Axi</h2>
            <ul className="mt-5 space-y-3 text-[15px] leading-relaxed text-ink-muted">
              {["Déclencher un paiement ou un remboursement à votre place", "Modifier votre équipe, votre abonnement ou vos clés de paiement", "Supprimer votre boutique", "Accéder à une autre boutique que celle de l'accès utilisé"].map((t) => (
                <li key={t} className="border-t border-line pt-3">
                  {t}
                </li>
              ))}
            </ul>
            <Link href="/developpeurs#securite" className="mt-6 inline-flex min-h-11 items-center gap-1.5 text-[15px] font-medium text-primary underline-offset-4 hover:underline">
              Le détail des autorisations
              <ArrowUpRight className="size-4" aria-hidden />
            </Link>
          </div>
        </div>
      </Section>

      {/* Capacités IA et pilotage */}
      <Section tone="surface" className="border-y border-line">
        <div className="space-y-20">
          {GROUPS.map((g) => (
            <CapabilityGroupBlock key={g.id} group={g} columns={2} />
          ))}
        </div>
      </Section>

      {/* Inclus par plan */}
      <Section labelledBy="ia-plans-title" tone="deep">
        <SectionHeading id="ia-plans-title" title="Inclus dans chaque plan." description="Le connecteur n'est pas une option à acheter : seul son niveau d'accès change." />
        <ul className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {PLAN_ORDER.map((p, i) => (
            <li key={p} className="reveal rounded-[var(--radius-xl)] bg-surface p-6 ring-1 ring-line" style={{ transitionDelay: `${(i % 5) * 60}ms` }}>
              <p className="text-[16px] font-semibold text-ink">{PLANS[p].name}</p>
              <p className="mt-2 text-[14.5px] leading-relaxed text-ink-muted">{MCP_TIER_LABEL[p]}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section labelledBy="ia-faq-title">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
          <SectionHeading id="ia-faq-title" title="Questions sur l'IA" />
          <Faq items={FAQ} name="ia-faq" />
        </div>
      </Section>

      <Section labelledBy="ia-more-title" tone="surface" className="border-y border-line">
        <SectionHeading id="ia-more-title" title="La suite de la plateforme." />
        <DomainLinks current="ia" className="mt-12" />
      </Section>

      <CtaBand title={`Connectez votre assistant pendant ${TRIAL_DAYS} jours.`} secondaryLabel="Documentation technique" secondaryHref="/developpeurs" />
    </>
  );
}
