import type { Metadata } from "next";
import { ArrowDownUp, BadgePercent, CalendarClock, LifeBuoy, RotateCcw, ShieldCheck, Timer, type LucideIcon } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Section, SectionHeading, Eyebrow } from "@/components/marketing/section";
import { PricingProvider, type EffectiveMonthly, ZoneSwitch, IntervalSwitch, AfricaShortcut, PricingAnnouncer } from "@/components/marketing/pricing-context";
import { PricingCards } from "@/components/marketing/pricing-cards";
import { PricingComparison } from "@/components/marketing/pricing-comparison";
import { PricingAddOns } from "@/components/marketing/pricing-addons";
import { Faq, FaqJsonLd } from "@/components/marketing/faq";
import { CtaBand } from "@/components/marketing/cta-band";
import { PLANS, PUBLIC_PLANS, TRIAL_DAYS, PAST_DUE_GRACE_DAYS, YEARLY_MONTHS_PAID } from "@/config/plans";
import { effectiveFromRows, loadActiveOverrides } from "@/lib/pricing/catalog";
import { formatPrice } from "@/lib/marketing/pricing";
import { ogImage } from "@/lib/marketing/seo";

const BUSINESS_EUR = formatPrice(PLANS.BUSINESS.price.WORLD ?? 0, "EUR");
const BUSINESS_XOF = formatPrice(PLANS.BUSINESS.price.AFRICA ?? 0, "XOF");
const ENTERPRISE_EUR = formatPrice(PLANS.ENTERPRISE.price.WORLD ?? 0, "EUR");
const ENTERPRISE_XOF = formatPrice(PLANS.ENTERPRISE.price.AFRICA ?? 0, "XOF");

export const metadata: Metadata = {
  title: "Tarifs",
  description: `${TRIAL_DAYS} jours d'essai gratuit, sans carte bancaire. Business à ${BUSINESS_EUR} ou ${BUSINESS_XOF} par mois, ${12 - YEARLY_MONTHS_PAID} mois offerts en annuel, 0 % de commission sur vos ventes. Deux grilles : euros pour le monde, FCFA pour l'Afrique francophone.`,
  alternates: { canonical: "/tarifs" },
  openGraph: {
    title: "Tarifs | Axi",
    description: "Un prix fixe par mois, 0 % de commission. Prix en euros ou en FCFA selon le pays de votre boutique.",
    url: "/tarifs",
    images: ogImage("blazer"),
  },
};

const RULES: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: BadgePercent, title: "0 % de commission", text: "Sur tous les plans. Vos clients vous paient directement, Axi ne touche pas à vos ventes." },
  { icon: Timer, title: `${TRIAL_DAYS} jours d'essai gratuit`, text: "Toutes les fonctions Business à l'inscription, sans carte bancaire. Vous choisissez votre plan quand vous voulez." },
  { icon: ShieldCheck, title: "Rien n'est jamais supprimé", text: "Sans plan à la fin de l'essai, la boutique est mise en pause : produits, clients et commandes restent là, et elle rouvre dès le paiement." },
  { icon: ArrowDownUp, title: "Montée immédiate, au prorata", text: "Un plan supérieur s'active tout de suite. Vous ne payez que la différence sur la période en cours." },
  { icon: CalendarClock, title: "Descente en fin de période", text: "Un plan inférieur prend effet à la fin de la période déjà payée. Pas de remboursement partiel." },
  { icon: RotateCcw, title: `${PAST_DUE_GRACE_DAYS} jours de grâce`, text: `Si un paiement échoue, vous gardez toutes vos fonctions pendant ${PAST_DUE_GRACE_DAYS} jours, le temps de régulariser.` },
];

const FAQ = [
  {
    q: "Le prix dépend-il de mon chiffre d'affaires ?",
    a: "Non. Le prix de votre plan est fixe et ne bouge pas quand vos ventes augmentent. Axi ne prélève aucune commission, sur aucun plan, essai compris : si vous vendez dix fois plus le mois prochain, votre facture Axi est la même.",
  },
  {
    q: "Qu'est-ce qui est vraiment inclus dans tous les plans ?",
    a: "La boutique en ligne et son éditeur à sections, le catalogue à variantes et collections, les comptes acheteurs, la commande par lien WhatsApp, le paiement à la livraison, la marketplace Axi, le connecteur IA et la vitrine lisible par les assistants. Les plans supérieurs ouvrent les volumes, l'encaissement en ligne, l'équipe, l'international et l'automatisation.",
  },
  {
    q: "Pourquoi deux grilles, en euros et en FCFA ?",
    a: `Le prix dépend du pays de votre boutique. En Afrique francophone (zones XOF et XAF), vous payez en FCFA : ${BUSINESS_XOF} par mois pour Business. Ailleurs, en euros : ${BUSINESS_EUR} par mois. La zone est fixée à la création de la boutique.`,
  },
  {
    q: "Comment fonctionne l'essai ?",
    a: `Votre boutique démarre avec toutes les fonctions du plan Business pendant ${TRIAL_DAYS} jours, sans carte bancaire ni engagement. Vous êtes prévenu par e-mail 3 jours puis 1 jour avant la fin, et vous pouvez souscrire à tout moment.`,
  },
  {
    q: "Et si je ne choisis pas de plan à la fin de l'essai ?",
    a: "Votre boutique est mise en pause : vos clients voient « Boutique momentanément fermée » et ne peuvent plus commander. Votre espace reste accessible et rien n'est supprimé. Dès que vous choisissez un plan et que le paiement est confirmé, la boutique rouvre automatiquement.",
  },
  {
    q: "Comment payer mon abonnement ?",
    a: `Par Mobile Money ou carte bancaire, au mois ou à l'année. L'annuel revient à ${YEARLY_MONTHS_PAID} mois payés pour 12. Une facture est disponible après chaque paiement.`,
  },
  {
    q: "Que sont les crédits WhatsApp et IA ?",
    a: "Business et Scale incluent chaque mois des messages WhatsApp officiels et des crédits IA. Si vous en voulez plus, des packs valables 12 mois sont disponibles dans les options. Les messages de commande par lien wa.me restent gratuits et illimités.",
  },
  {
    q: "Et pour plusieurs boutiques ou une franchise ?",
    a: `Scale couvre 3 boutiques et 10 membres. Au-delà, l'offre Enterprise démarre à ${ENTERPRISE_EUR} ou ${ENTERPRISE_XOF} par mois, sur devis, avec revendeurs, marque blanche et engagement de service.`,
  },
];

/** Prix effectifs (surcharges /admin/tarifs) : recalculés au plus toutes les 5 minutes. */
export const revalidate = 300;

async function effectivePrices(): Promise<EffectiveMonthly | undefined> {
  try {
    const rows = await loadActiveOverrides();
    return Object.fromEntries(
      PUBLIC_PLANS.map((id) => [id, { WORLD: effectiveFromRows(rows, "plan", id, "WORLD").amount, AFRICA: effectiveFromRows(rows, "plan", id, "AFRICA").amount }]),
    ) as EffectiveMonthly;
  } catch {
    return undefined; // base indisponible (build hors ligne) : prix du catalogue
  }
}

export default async function PricingPage() {
  const prices = await effectivePrices();
  return (
    <PricingProvider prices={prices}>
      <section aria-labelledby="pricing-h1" className="pb-20 pt-12 md:pb-24 md:pt-20">
        <div className="container-x">
          <div className="flex flex-col gap-10 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <Eyebrow className="mb-6 animate-fade-up">Tarifs</Eyebrow>
              <h1 id="pricing-h1" className="text-h1 font-semibold text-ink animate-fade-up [animation-delay:60ms]">
                Un prix fixe par mois. <span className="text-ink-muted">Zéro commission.</span>
              </h1>
              <p className="mt-5 max-w-[52ch] text-lg leading-relaxed text-ink-muted animate-fade-up [animation-delay:120ms]">
                Toute la plateforme pour un seul abonnement, de la boutique aux paiements, de WhatsApp au connecteur IA. {TRIAL_DAYS} jours d&apos;essai gratuit, sans carte bancaire.
              </p>
            </div>
            <div className="flex flex-col items-start gap-3 animate-fade-up [animation-delay:180ms] lg:items-end">
              <div className="flex flex-wrap gap-3">
                <ZoneSwitch />
                <IntervalSwitch />
              </div>
              <AfricaShortcut className="-ml-3 lg:ml-0 lg:-mr-3" />
            </div>
          </div>

          <PricingAnnouncer />
          <h2 className="sr-only">Plans</h2>
          <PricingCards className="mt-14" />
          <p className="reveal mt-6 text-[13px] text-ink-faint">Prix hors taxes. L&apos;abonnement annuel est facturé en une fois et correspond à {YEARLY_MONTHS_PAID} mois sur 12.</p>

          <div className="reveal mt-10 grid grid-cols-1 gap-6 rounded-[var(--radius-xl)] bg-forest p-7 text-white sm:p-9 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <p className="text-[13px] font-medium text-white/60">Enterprise</p>
              <p className="mt-2 text-h3 font-semibold text-white">
                À partir de {ENTERPRISE_EUR} ou {ENTERPRISE_XOF} par mois, sur devis.
              </p>
              <p className="mt-2 max-w-[60ch] text-[15px] text-white/70">Boutiques et membres illimités, revendeurs et marque blanche, engagement de service et gestionnaire dédié.</p>
            </div>
            <ButtonLink href="/contact?sujet=enterprise" variant="inverse" size="lg" trailing>
              Demander un devis
            </ButtonLink>
          </div>
        </div>
      </section>

      <Section id="comparatif" labelledBy="compare-title" tone="surface" className="border-y border-line">
        <SectionHeading id="compare-title" title="Tout ce que chaque plan comprend." description="Les limites ci-dessous sont celles réellement appliquées par la plateforme." />
        <div className="mt-12">
          <PricingComparison />
        </div>
      </Section>

      <Section id="options" labelledBy="options-title">
        <SectionHeading id="options-title" title="Des options, seulement si vous en avez besoin." description="Un membre, un numéro, des messages ou une boutique clé en main, en complément de votre plan." />
        <div className="mt-14">
          <PricingAddOns />
        </div>
      </Section>

      <Section id="regles" labelledBy="rules-title" tone="deep">
        <SectionHeading id="rules-title" title="Des règles claires, écrites à l'avance." />
        <ul className="mt-14 grid grid-cols-1 gap-x-12 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {RULES.map((r, i) => (
            <li key={r.title} className="reveal border-t border-line pt-6" style={{ transitionDelay: `${(i % 3) * 80}ms` }}>
              <r.icon className="size-6 text-primary" aria-hidden />
              <h3 className="mt-4 text-[17px] font-semibold text-ink">{r.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">{r.text}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="faq" labelledBy="pricing-faq-title">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
          <div className="lg:sticky lg:top-28 lg:self-start">
            <SectionHeading id="pricing-faq-title" title="Questions sur les tarifs" />
            <div className="reveal mt-8">
              <ButtonLink href="/contact?sujet=facturation" variant="outline">
                <LifeBuoy className="size-4" aria-hidden />
                Poser une question
              </ButtonLink>
            </div>
          </div>
          <Faq items={FAQ} name="pricing-faq" />
        </div>
        <FaqJsonLd items={FAQ} />
      </Section>

      <CtaBand secondaryLabel="Voir les fonctionnalités" secondaryHref="/fonctionnalites" />
    </PricingProvider>
  );
}

