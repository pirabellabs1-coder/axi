import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, Check, Store } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Section, SectionHeading } from "@/components/marketing/section";
import { Shot } from "@/components/marketing/shot";
import { StoreCard, type MarketplaceStore } from "@/components/marketing/store-card";
import { PricingProvider, ZoneSwitch, IntervalSwitch, PricingAnnouncer } from "@/components/marketing/pricing-context";
import { PricingCards } from "@/components/marketing/pricing-cards";
import { Faq, FaqJsonLd } from "@/components/marketing/faq";
import { CtaBand } from "@/components/marketing/cta-band";
import { OrganizationJsonLd, SoftwareApplicationJsonLd } from "@/components/marketing/structured-data";
import { listMarketplaceStores } from "@/lib/storefront/data";
import { formatPrice } from "@/lib/marketing/pricing";
import { CHANNELS, DIFFERENTIATORS, DOMAINS, PAYMENT_FAMILIES, PROFILES, PROMISE, SHOTS } from "@/lib/marketing/positioning";
import { PLANS, TRIAL_DAYS, YEARLY_MONTHS_PAID } from "@/config/plans";
import { COUNTRIES, SITE } from "@/config/site";
import { MEDIA, unsplash } from "@/config/media";
import { ogImage } from "@/lib/marketing/seo";

const TITLE = `${SITE.name} | Plateforme e-commerce et commerce conversationnel`;

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: PROMISE.short,
  alternates: { canonical: "/" },
  openGraph: { title: TITLE, description: PROMISE.short, url: "/", images: ogImage("heroMerchant") },
};

const AFRICA_COUNTRIES = COUNTRIES.filter((c) => c.currency === "XOF" || c.currency === "XAF");

const SHOWCASE = [SHOTS.produits, SHOTS.commandes, SHOTS.entonnoir, SHOTS.conversations, SHOTS.paiements] as const;

const FAQ = [
  {
    q: "Axi, c'est une boutique en ligne ou un outil WhatsApp ?",
    a: "Les deux, et c'est le même produit. Vous obtenez une vraie boutique en ligne (éditeur à sections, catalogue à variantes, collections, inventaire, paiement en ligne, TVA et factures) et la conversation est intégrée au parcours de vente plutôt que posée à côté. Vous pouvez très bien utiliser Axi sans jamais activer WhatsApp.",
  },
  {
    q: "Est-ce réservé à l'Afrique francophone ?",
    a: `Non. Axi est né au Bénin et garde cet ancrage, parce que le Mobile Money et le paiement à la livraison y sont la norme. Mais la facturation existe en euros comme en FCFA, la carte bancaire et le multi-devises sont inclus, et rien n'empêche une marque européenne d'ouvrir sa boutique. Les tarifs en FCFA s'appliquent aux boutiques des zones XOF et XAF (${AFRICA_COUNTRIES.length} pays), les tarifs en euros partout ailleurs.`,
  },
  {
    q: "Puis-je reprendre un catalogue existant ?",
    a: "Oui. L'import CSV accepte le format des exports Shopify (produits, variantes, options, images, stock). Côté technique, l'API REST et les webhooks signés permettent de synchroniser Axi avec vos outils, et le connecteur IA de piloter la boutique depuis Claude ou ChatGPT.",
  },
  {
    q: "Axi prend-il une commission sur mes ventes ?",
    a: "Non, sur aucun plan, essai compris. Vos clients vous paient directement : Mobile Money, carte via votre propre compte de paiement, espèces ou virement. Axi se finance uniquement par les abonnements et les options. Restent les frais de votre opérateur ou de votre prestataire de paiement, qui ne passent jamais par nous.",
  },
  {
    q: "Puis-je essayer avant de payer ?",
    a: `Oui. À l'inscription, vous profitez de ${TRIAL_DAYS} jours d'essai gratuit du plan Business, sans carte bancaire. Vous êtes prévenu 3 jours puis 1 jour avant la fin. Sans plan choisi, la boutique est mise en pause (vitrine fermée) sans perdre aucune donnée, et rouvre dès le paiement.`,
  },
  {
    q: "Pourquoi des prix en euros et en FCFA ?",
    a: `Le tarif dépend du pays de votre boutique : en FCFA pour l'Afrique francophone (zones XOF et XAF), en euros ailleurs. Le plan Business coûte ${formatPrice(PLANS.BUSINESS.price.AFRICA ?? 0, "XOF")} ou ${formatPrice(PLANS.BUSINESS.price.WORLD ?? 0, "EUR")} par mois. L'abonnement annuel offre ${12 - YEARLY_MONTHS_PAID} mois.`,
  },
  {
    q: "Qu'est-ce que le connecteur IA change pour moi ?",
    a: "Deux choses, dans les deux sens. Vous pouvez gérer votre boutique en langage naturel depuis Claude, ChatGPT ou Cursor, avec des autorisations que vous choisissez et révoquez. Et votre vitrine publique est lisible par les assistants de vos acheteurs : ils trouvent vos produits et préparent un panier que l'acheteur valide lui-même. Jamais de paiement déclenché par une IA.",
  },
  {
    q: "Et si je veux arrêter ?",
    a: "Vous résiliez en un clic : votre plan reste actif jusqu'à la fin de la période payée, puis la boutique est mise en pause. Vos données s'exportent en CSV (commandes dès Starter, produits et clients dès Business, sur demande au support sinon), et rien n'est supprimé sans votre demande.",
  },
];

export default function HomePage() {
  return (
    <>
      <OrganizationJsonLd />
      <SoftwareApplicationJsonLd />

      <Hero />
      <TrustBand />
      <Platform />
      <Profiles />
      <ProductTour />
      <PaymentsAndChannels />
      <AiBlock />
      <PricingSummary />
      <MarketplacePreview />

      <Section id="faq" labelledBy="faq-title">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
          <div className="lg:sticky lg:top-28 lg:self-start">
            <SectionHeading id="faq-title" title="Les questions qu'on nous pose avant de commencer" />
            <p className="reveal mt-6 text-[15px] text-ink-muted">
              Une autre question ?{" "}
              <Link href="/aide" className="font-medium text-primary underline underline-offset-4">
                Centre d&apos;aide
              </Link>{" "}
              ou{" "}
              <Link href="/contact" className="font-medium text-primary underline underline-offset-4">
                écrivez-nous
              </Link>
              .
            </p>
          </div>
          <Faq items={FAQ} name="home-faq" />
        </div>
        <FaqJsonLd items={FAQ} />
      </Section>

      <CtaBand />
    </>
  );
}

/* ───────────────────────── Hero : promesse + preuve par le produit ───────────────────────── */

function Hero() {
  return (
    <section aria-labelledby="hero-title" className="pb-16 pt-6 md:pt-10 lg:pb-24">
      <div className="container-x">
        <div className="grid grid-cols-1 items-end gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:gap-14">
          <div className="max-w-[640px]">
            <p className="mb-5 inline-flex items-center gap-2 rounded-full bg-surface px-3.5 py-1.5 text-[12.5px] font-medium uppercase tracking-[0.12em] text-ink-muted ring-1 ring-inset ring-line animate-fade-up">
              <span className="size-1.5 rounded-full bg-primary" aria-hidden /> Commerce · Boutique · WhatsApp · IA
            </p>
            <h1 id="hero-title" className="text-[clamp(2.4rem,4.6vw,4rem)] font-semibold leading-[1.02] tracking-[-0.045em] text-ink animate-fade-up">
              {PROMISE.h1[0]} <span className="text-ink-muted">{PROMISE.h1[1]}</span>
            </h1>
            <p className="mt-6 max-w-[52ch] text-lg leading-relaxed text-ink-muted animate-fade-up [animation-delay:80ms]">{PROMISE.lede}</p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center animate-fade-up [animation-delay:160ms]">
              <ButtonLink href="/inscription" variant="accent" size="lg" trailing>
                Créer ma boutique
              </ButtonLink>
              <ButtonLink href="/fonctionnalites" variant="outline" size="lg">
                Voir la plateforme
              </ButtonLink>
            </div>
          </div>

          <ul className="grid grid-cols-1 gap-x-8 gap-y-3 animate-fade-up [animation-delay:220ms] sm:grid-cols-2 lg:grid-cols-1 lg:pb-2" aria-label="Ce qui est inclus">
            {["0 % de commission, sur tous les plans", "Boutique, WhatsApp et IA dans un seul produit", "Paiements du monde entier : carte, Mobile Money, à la livraison", `${TRIAL_DAYS} jours offerts, sans carte bancaire`].map((t) => (
              <li key={t} className="flex items-start gap-2.5 text-[15px] text-ink">
                <Check className="mt-0.5 size-[18px] shrink-0 text-primary" aria-hidden />
                {t}
              </li>
            ))}
          </ul>
        </div>

        {/* Capture réelle de l'éditeur : image principale de la page (LCP), chargée en priorité. */}
        <div className="mt-12 animate-fade-up [animation-delay:120ms] lg:mt-16">
          <Shot shot={SHOTS.editeur} priority sizes="(min-width: 1280px) 1216px, 100vw" frame="window" captionHidden />
          <p className="mt-4 max-w-[70ch] text-[14px] leading-relaxed text-ink-muted">
            L&apos;éditeur de thème d&apos;Axi : sections, blocs, aperçu cliquable, score de qualité en direct.{" "}
            <Link href="/boutique-en-ligne" className="font-medium text-primary underline underline-offset-4">
              Voir la boutique en détail
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── Bande de confiance ───────────────────────── */

function TrustBand() {
  return (
    <section aria-label="Commission, paiements et couverture" className="border-y border-line bg-surface/60">
      <div className="container-x grid grid-cols-1 gap-8 py-10 md:grid-cols-[auto_1fr] md:gap-14 lg:grid-cols-[auto_1.4fr_1fr] lg:items-center">
        <div className="reveal">
          <p className="text-[2.6rem] font-semibold leading-none tracking-[-0.045em] text-ink">0 %</p>
          <p className="mt-2 text-sm text-ink-muted">de commission sur vos ventes</p>
        </div>
        <div className="reveal [transition-delay:80ms]">
          <p className="text-[13px] text-ink-muted">Vos clients paient avec</p>
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2" aria-label="Moyens de paiement">
            {["Carte bancaire", "Wave", "Orange Money", "MTN MoMo", "Moov Money", "À la livraison"].map((m) => (
              <li key={m} className="text-[15px] font-semibold tracking-[-0.01em] text-ink/80">
                {m}
              </li>
            ))}
          </ul>
        </div>
        <div className="reveal [transition-delay:160ms] md:col-span-2 lg:col-span-1">
          <p className="text-[13px] text-ink-muted">Où que soit votre boutique</p>
          <p className="mt-3 text-[15px] leading-relaxed text-ink">
            De l&apos;Europe à l&apos;Afrique de l&apos;Ouest : facturation en euros ou en FCFA selon votre pays, et affichage multi-devises pour vos acheteurs partout dans le monde.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── La plateforme : quatre domaines ───────────────────────── */

function Platform() {
  const shots = [SHOTS.boutiqueBureau, SHOTS.paiements, SHOTS.conversations, SHOTS.connecteurIa] as const;
  return (
    <Section id="plateforme" labelledBy="platform-title">
      <SectionHeading
        id="platform-title"
        title="Une plateforme complète, pas un catalogue de liens."
        description="Boutique, catalogue, paiements, livraison, conversation, fidélité, international et IA : le même produit, les mêmes données, un seul abonnement."
      />

      <ul className="mt-14 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {DOMAINS.map((d, i) => (
          <li key={d.slug} className="reveal" style={{ transitionDelay: `${(i % 2) * 90}ms` }}>
            <article className="flex h-full flex-col overflow-hidden rounded-[var(--radius-2xl)] bg-surface ring-1 ring-line shadow-[var(--shadow-card)]">
              <div className="p-7 sm:p-9">
                <h3 className="text-[1.6rem] font-semibold tracking-[-0.035em] text-ink">{d.label}</h3>
                <p className="mt-3 max-w-[48ch] text-[15.5px] leading-relaxed text-ink-muted">{d.summary}</p>
                <ul className="mt-6 flex flex-wrap gap-2" aria-label={`Points clés : ${d.label}`}>
                  {d.proofs.map((p) => (
                    <li key={p} className="rounded-full bg-surface-2 px-3 py-1.5 text-[13px] font-medium text-ink">
                      {p}
                    </li>
                  ))}
                </ul>
                <Link href={`/${d.slug}`} className="mt-7 inline-flex min-h-11 items-center gap-1.5 text-[15px] font-medium text-primary underline-offset-4 hover:underline">
                  {d.title.replace(/\.$/, "")}
                  <ArrowUpRight className="size-4" aria-hidden />
                </Link>
              </div>
              <div className="mt-auto px-7 pb-7 sm:px-9 sm:pb-9">
                <Shot shot={shots[i]} sizes="(min-width: 1024px) 46vw, 92vw" frame="plain" captionHidden />
              </div>
            </article>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/* ───────────────────────── Parcours par profil ───────────────────────── */

function Profiles() {
  return (
    <Section id="profils" labelledBy="profiles-title" tone="deep">
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:gap-20">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <SectionHeading id="profiles-title" title="Par où commencer, selon d'où vous partez." description="Quatre situations courantes, et le chemin le plus court pour chacune." />
          <div className="reveal relative mt-10 hidden aspect-[4/3] overflow-hidden rounded-[var(--radius-2xl)] lg:block">
            <Image src={unsplash(MEDIA.apronPhone.id, 1000, 750)} alt={MEDIA.apronPhone.alt} fill sizes="38vw" className="object-cover" />
          </div>
        </div>
        <ol className="space-y-4">
          {PROFILES.map((p, i) => (
            <li key={p.title} className="reveal rounded-[var(--radius-xl)] bg-surface p-7 ring-1 ring-line shadow-[var(--shadow-card)] sm:p-8" style={{ transitionDelay: `${i * 80}ms` }}>
              <h3 className="text-h3 font-semibold text-ink">{p.title}</h3>
              <p className="mt-2 max-w-[56ch] text-[15px] leading-relaxed text-ink-muted">{p.need}</p>
              <p className="mt-3 max-w-[56ch] text-[15px] leading-relaxed text-ink">{p.answer}</p>
              <Link href={p.href} className="mt-5 inline-flex min-h-11 items-center gap-1.5 text-[15px] font-medium text-primary underline-offset-4 hover:underline">
                {p.cta}
                <ArrowUpRight className="size-4" aria-hidden />
              </Link>
            </li>
          ))}
        </ol>
      </div>
    </Section>
  );
}

/* ───────────────────────── Visite du produit (captures réelles) ───────────────────────── */

function ProductTour() {
  return (
    <section id="produit" aria-labelledby="tour-title" className="scroll-mt-28 overflow-hidden bg-forest py-24 text-white md:py-32">
      <div className="container-x">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <SectionHeading
            id="tour-title"
            light
            title="Le produit, pas une maquette."
            description="Ces captures viennent de deux boutiques de démonstration réelles. Vous pouvez les visiter sur la marketplace avant même de créer un compte."
          />
          <div className="reveal shrink-0">
            <ButtonLink href="/marketplace" variant="inverse" trailing>
              Visiter une boutique
            </ButtonLink>
          </div>
        </div>
      </div>

      <ul
        className="scrollbar-none mt-14 flex snap-x snap-mandatory gap-5 overflow-x-auto px-4 pb-4 sm:px-6 lg:px-[max(2rem,calc((100vw-1280px)/2+2rem))]"
        aria-label="Captures de l'espace marchand"
      >
        {SHOWCASE.map((shot, i) => (
          <li key={shot.src} className="reveal w-[min(86vw,760px)] shrink-0 snap-start" style={{ transitionDelay: `${Math.min(i, 3) * 70}ms` }}>
            <Shot shot={shot} sizes="(min-width: 900px) 760px, 86vw" frame="window" className="[&_figcaption]:text-white/70" />
          </li>
        ))}
        <li className="w-[min(86vw,420px)] shrink-0 snap-start">
          <div className="reveal flex h-full min-h-56 flex-col justify-between rounded-[var(--radius-xl)] bg-white/[0.06] p-7 ring-1 ring-inset ring-white/10">
            <p className="text-[17px] leading-relaxed text-white">Et la vitrine que voient vos clients, sur mobile comme sur grand écran.</p>
            <ButtonLink href="/boutique-en-ligne" variant="ghost" className="mt-6 self-start text-white hover:bg-white/10" trailing>
              Voir la boutique
            </ButtonLink>
          </div>
        </li>
      </ul>
    </section>
  );
}

/* ───────────────────────── Paiements et canaux ───────────────────────── */

function PaymentsAndChannels() {
  return (
    <Section id="paiements-canaux" labelledBy="pay-title">
      <div className="grid grid-cols-1 gap-14 lg:grid-cols-2 lg:gap-16">
        <div>
          <SectionHeading id="pay-title" title="Encaissez comme vos clients paient." description="Mobile Money, carte bancaire ou espèces à la livraison. L'argent arrive sur vos propres comptes." />
          <ul className="mt-10 space-y-4">
            {PAYMENT_FAMILIES.map((f, i) => (
              <li key={f.title} className="reveal rounded-[var(--radius-xl)] bg-surface p-6 ring-1 ring-line shadow-[var(--shadow-card)]" style={{ transitionDelay: `${i * 70}ms` }}>
                <h3 className="text-[17px] font-semibold text-ink">{f.title}</h3>
                <p className="mt-1.5 text-[15px] leading-relaxed text-ink-muted">{f.text}</p>
                <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-2" aria-label={`Moyens : ${f.title}`}>
                  {f.methods.map((m) => (
                    <li key={m} className="text-[14px] font-medium text-ink/80">
                      {m}
                    </li>
                  ))}
                </ul>
                {f.note && <p className="mt-3 text-[13px] leading-relaxed text-ink-faint">{f.note}</p>}
              </li>
            ))}
          </ul>
          <div className="reveal mt-8">
            <ButtonLink href="/paiements" variant="outline" trailing>
              Tout sur les paiements
            </ButtonLink>
          </div>
        </div>

        <div className="lg:pt-4">
          <h2 className="reveal text-h3 font-semibold text-ink">Et vendez là où on vous cherche.</h2>
          <p className="reveal mt-2 max-w-[52ch] text-[15.5px] leading-relaxed text-ink-muted">Un seul catalogue, plusieurs vitrines. Les commandes reviennent toutes au même endroit.</p>
          <ul className="reveal mt-8 divide-y divide-line border-y border-line">
            {CHANNELS.map((c) => (
              <li key={c.title} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-4">
                <h3 className="text-[16px] font-semibold text-ink">{c.title}</h3>
                <p className="max-w-[34ch] text-[14.5px] leading-relaxed text-ink-muted">{c.text}</p>
              </li>
            ))}
          </ul>
          <div className="reveal mt-10">
            <Shot shot={SHOTS.ficheProduit} sizes="(min-width: 1024px) 300px, 60vw" frame="phone" className="mx-auto max-w-[300px]" />
          </div>
        </div>
      </div>
    </Section>
  );
}

/* ───────────────────────── IA ───────────────────────── */

function AiBlock() {
  return (
    <Section id="ia" labelledBy="ai-title" tone="deep">
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-[1fr_1.1fr] lg:items-center lg:gap-16">
        <div>
          <SectionHeading
            id="ai-title"
            title="Votre boutique parle aux assistants IA."
            description="Dans les deux sens : vous la pilotez depuis Claude, ChatGPT ou Cursor, et les assistants de vos acheteurs savent lire votre vitrine publique."
          />
          <ul className="mt-10 space-y-5">
            {[
              { t: "Gérez en langage naturel", d: "« Quels produits sont en rupture ? », « Crée un code promo pour ce week-end » : l'assistant agit sur vos vraies données." },
              { t: "Des autorisations que vous choisissez", d: "Lecture seule, catalogue, commandes : chaque jeton a ses droits, chaque appel est journalisé, tout se révoque en un clic." },
              { t: "Une vitrine lisible par les IA", d: "Un assistant trouve vos produits, vérifie la disponibilité et prépare un panier. C'est toujours l'acheteur qui valide et paie." },
            ].map((s, i) => (
              <li key={s.t} className="reveal border-t border-line pt-5" style={{ transitionDelay: `${i * 70}ms` }}>
                <h3 className="text-[16px] font-semibold text-ink">{s.t}</h3>
                <p className="mt-1.5 max-w-[52ch] text-[15px] leading-relaxed text-ink-muted">{s.d}</p>
              </li>
            ))}
          </ul>
          <div className="reveal mt-9 flex flex-col gap-3 sm:flex-row">
            <ButtonLink href="/ia" variant="primary" trailing>
              Découvrir le connecteur IA
            </ButtonLink>
            <ButtonLink href="/developpeurs" variant="ghost">
              Documentation technique
            </ButtonLink>
          </div>
        </div>
        <div className="reveal">
          <Shot shot={SHOTS.connecteurIa} sizes="(min-width: 1024px) 52vw, 92vw" frame="window" />
        </div>
      </div>
    </Section>
  );
}

/* ───────────────────────── Tarifs résumés ───────────────────────── */

function PricingSummary() {
  return (
    <Section id="tarifs" labelledBy="pricing-title">
      <PricingProvider>
        <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <SectionHeading
            id="pricing-title"
            eyebrow="Tarifs"
            title="Un prix fixe. Aucune commission."
            description={`${TRIAL_DAYS} jours d'essai gratuit, sans carte bancaire. Prix en euros, ou en FCFA pour l'Afrique francophone.`}
          />
          <div className="reveal flex flex-wrap gap-3">
            <ZoneSwitch />
            <IntervalSwitch />
          </div>
        </div>
        <PricingAnnouncer />
        <PricingCards compact className="mt-12" />
        <p className="reveal mt-10 text-[15px] text-ink-muted">
          <Link href="/tarifs" className="font-medium text-primary underline underline-offset-4">
            Comparer tous les plans et les options
          </Link>
          <span aria-hidden> · </span>
          Réseaux et franchises :{" "}
          <Link href="/contact?sujet=enterprise" className="font-medium text-primary underline underline-offset-4">
            offre Enterprise
          </Link>
        </p>
      </PricingProvider>
    </Section>
  );
}

/* ───────────────────────── Preuve : boutiques réelles ───────────────────────── */

async function MarketplacePreview() {
  let stores: MarketplaceStore[] = [];
  try {
    stores = await listMarketplaceStores({ take: 8 });
  } catch (e) {
    console.error("[home] marketplace preview", e);
  }

  return (
    <Section id="marketplace" labelledBy="mk-title" className="overflow-hidden" tone="deep">
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <SectionHeading
          id="mk-title"
          title="Des boutiques ouvertes, pas des témoignages."
          description="Nous ne publierons ni avis fabriqués ni chiffres d'usage que nous n'avons pas mesurés. À la place : les boutiques publiées sur Axi, que vous pouvez ouvrir et parcourir maintenant."
        />
        <div className="reveal shrink-0">
          <ButtonLink href="/marketplace" variant="outline" trailing>
            Voir la marketplace
          </ButtonLink>
        </div>
      </div>

      {stores.length === 0 ? (
        <div className="reveal mt-12 flex flex-col items-start gap-4 rounded-[var(--radius-xl)] bg-surface p-8 ring-1 ring-line sm:flex-row sm:items-center">
          <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
            <Store className="size-5" aria-hidden />
          </span>
          <p className="flex-1 text-[15px] text-ink-muted">Les premières boutiques arrivent. Ouvrez la vôtre pour y figurer dès sa publication.</p>
        </div>
      ) : (
        <ul
          className="scrollbar-none -mx-4 mt-12 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-px-4 px-4 pb-4 sm:-mx-6 sm:scroll-px-6 sm:px-6 lg:-mx-8 lg:scroll-px-8 lg:px-8"
          aria-label="Boutiques de la marketplace"
        >
          {stores.map((s, i) => (
            <li key={s.id} className="reveal w-[280px] shrink-0 snap-start" style={{ transitionDelay: `${Math.min(i, 4) * 60}ms` }}>
              <StoreCard store={s} className="h-full" />
            </li>
          ))}
        </ul>
      )}

      <ul className="mt-16 grid grid-cols-1 gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
        {DIFFERENTIATORS.map((d, i) => (
          <li key={d.title} className="reveal border-t border-line pt-5" style={{ transitionDelay: `${(i % 3) * 70}ms` }}>
            <h3 className="text-[16px] font-semibold text-ink">
              <Link href={d.href} className="underline-offset-4 hover:underline">
                {d.title}
              </Link>
            </h3>
            <p className="mt-2 max-w-[40ch] text-[15px] leading-relaxed text-ink-muted">{d.text}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}
