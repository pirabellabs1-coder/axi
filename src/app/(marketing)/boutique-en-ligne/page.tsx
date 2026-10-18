import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Section, SectionHeading } from "@/components/marketing/section";
import { Shot } from "@/components/marketing/shot";
import { CapabilityGroupBlock, DomainLinks } from "@/components/marketing/capability-list";
import { CtaBand } from "@/components/marketing/cta-band";
import { Faq, FaqJsonLd } from "@/components/marketing/faq";
import { BreadcrumbJsonLd } from "@/components/marketing/structured-data";
import { getDomain, groupsForDomain, SHOTS } from "@/lib/marketing/positioning";
import { PLANS, TRIAL_DAYS } from "@/config/plans";
import { MEDIA, unsplash } from "@/config/media";

const DOMAIN = getDomain("boutique-en-ligne");
const GROUPS = groupsForDomain("boutique-en-ligne");

export const metadata: Metadata = {
  title: "Boutique en ligne et catalogue",
  description:
    "Éditeur à sections et blocs, modèles alternatifs, champs personnalisés, scores de qualité, animations. Catalogue à variantes, collections, inventaire et import CSV compatible Shopify.",
  alternates: { canonical: "/boutique-en-ligne" },
  openGraph: {
    title: "Boutique en ligne et catalogue | Axi",
    description: DOMAIN.lede,
    url: "/boutique-en-ligne",
    images: [{ url: unsplash(MEDIA.boutique.id, 1200, 630), width: 1200, height: 630, alt: MEDIA.boutique.alt }],
  },
};

/** Ce que l'éditeur sait faire, raconté comme une démarche plutôt que comme une liste. */
const STEPS = [
  { title: "Partez d'une base", text: "Un thème prêt, un modèle de secteur, ou une boutique générée par l'IA à partir d'une phrase. Une génération est offerte par boutique." },
  { title: "Composez par sections", text: "Bannière, collection en vedette, avis, texte enrichi, horaires, appel WhatsApp. Chaque section se déplace, se duplique et s'enregistre pour être réutilisée." },
  { title: "Branchez vos contenus", text: "Les champs personnalisés (matière, origine, délai) deviennent des sources que n'importe quel bloc peut afficher." },
  { title: "Vérifiez avant de publier", text: "Les scores d'accessibilité, de performance et de référencement se mettent à jour en direct, avec une correction en un clic." },
];

const FAQ = [
  {
    q: "Puis-je reprendre le catalogue d'une autre plateforme ?",
    a: "Oui. L'import CSV accepte le format des exports Shopify : produits, variantes, options, images et stock. Vous pouvez aussi passer par l'API REST pour une reprise automatisée.",
  },
  {
    q: "Ai-je besoin de savoir coder ?",
    a: "Non. L'éditeur fonctionne par sections et par blocs, avec un aperçu cliquable : vous voyez le résultat pendant que vous réglez. Les développeurs qui veulent aller plus loin disposent de l'API REST et des webhooks.",
  },
  {
    q: "Ma boutique sera-t-elle rapide sur une connexion lente ?",
    a: "C'est une contrainte de conception, pas une option : images redimensionnées et compressées, pages légères, animations désactivées si le visiteur les réduit, et boutique installable sur le téléphone avec un mode économie de données.",
  },
  {
    q: "Combien de produits puis-je publier ?",
    a: `Le plan Starter va jusqu'à ${PLANS.STARTER.limits.products} produits sans limite de commandes, et les plans Business et au-delà n'ont pas de limite de produits. Pendant les ${TRIAL_DAYS} jours d'essai gratuit, vous profitez du plan Business.`,
  },
];

export default function OnlineStorePage() {
  return (
    <>
      <BreadcrumbJsonLd items={[{ name: "Boutique en ligne et catalogue", path: "/boutique-en-ligne" }]} />
      <FaqJsonLd items={FAQ} />

      {/* En-tête : promesse + capture de l'éditeur en pleine largeur */}
      <section aria-labelledby="store-h1" className="pb-16 pt-8 md:pt-14">
        <div className="container-x">
          <div className="grid grid-cols-1 items-end gap-10 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="max-w-[640px]">
              <p className="eyebrow mb-6 animate-fade-up">Boutique et catalogue</p>
              <h1 id="store-h1" className="text-h1 font-semibold text-ink animate-fade-up [animation-delay:60ms]">
                {DOMAIN.title}
              </h1>
              <p className="mt-5 max-w-[54ch] text-lg leading-relaxed text-ink-muted animate-fade-up [animation-delay:120ms]">{DOMAIN.lede}</p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row animate-fade-up [animation-delay:180ms]">
                <ButtonLink href="/inscription" variant="accent" size="lg" trailing>
                  Créer ma boutique
                </ButtonLink>
                <ButtonLink href="/marketplace" variant="outline" size="lg">
                  Voir des boutiques réelles
                </ButtonLink>
              </div>
            </div>
            <nav aria-label="Sections de la page" className="animate-fade-up [animation-delay:240ms]">
              <ul className="flex flex-wrap gap-2 lg:justify-end">
                {GROUPS.map((g) => (
                  <li key={g.id}>
                    <a href={`#${g.id}`} className="inline-flex h-11 items-center rounded-full bg-surface px-4 text-sm font-medium text-ink ring-1 ring-line transition-colors duration-300 hover:bg-surface-2">
                      {g.title}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </div>

          <div className="mt-12 animate-fade-up [animation-delay:140ms]">
            <Shot shot={SHOTS.editeur} priority sizes="(min-width: 1280px) 1216px, 100vw" frame="window" />
          </div>
        </div>
      </section>

      {/* Démarche : quatre temps, en alternance avec une photo */}
      <Section labelledBy="steps-title" tone="surface" className="border-y border-line">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[1fr_1.15fr] lg:gap-20">
          <div className="lg:sticky lg:top-28 lg:self-start">
            <SectionHeading id="steps-title" title="De la page blanche à la boutique publiée." description="L'éditeur ne demande ni thème à installer, ni code à copier." />
            <div className="bezel reveal mt-10 hidden lg:block">
              <div className="bezel-core relative aspect-[4/3] overflow-hidden">
                <Image src={unsplash(MEDIA.laptopBraids.id, 1000, 750)} alt={MEDIA.laptopBraids.alt} fill sizes="40vw" className="object-cover" />
              </div>
            </div>
          </div>
          <ol className="space-y-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className="reveal rounded-[var(--radius-xl)] bg-canvas p-7 ring-1 ring-line sm:p-8" style={{ transitionDelay: `${i * 80}ms` }}>
                <h3 className="text-h3 font-semibold text-ink">{s.title}</h3>
                <p className="mt-2 max-w-[54ch] text-[15px] leading-relaxed text-ink-muted">{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </Section>

      {/* Capacités : design puis catalogue */}
      <Section>
        <div className="space-y-20">
          {GROUPS.map((g) => (
            <CapabilityGroupBlock key={g.id} group={g} columns={2} />
          ))}
        </div>
      </Section>

      {/* La vitrine côté acheteur : bloc forêt, deux captures */}
      <section aria-labelledby="front-title" className="bg-forest py-24 text-white md:py-32">
        <div className="container-x">
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-[1fr_1fr] lg:items-center lg:gap-16">
            <div>
              <SectionHeading
                id="front-title"
                light
                title="Ce que voit votre client."
                description="Une vitrine pensée pour le téléphone d'abord : photos plein cadre, panier en tiroir, paiement en une colonne, devise au choix et avis vérifiés."
              />
              <ul className="mt-10 space-y-3 text-[15.5px] text-white/80">
                {["Boutique installable sur le téléphone, mode économie de données", "Comptes acheteurs : historique, adresses, favoris, réachat", "Avis vérifiés demandés après livraison", "Blog intégré pour être trouvé sans publicité"].map((t) => (
                  <li key={t} className="reveal flex items-start gap-3 border-t border-white/15 pt-3">
                    {t}
                  </li>
                ))}
              </ul>
              <Link href="/marketplace" className="reveal mt-8 inline-flex min-h-11 items-center gap-1.5 text-[15px] font-medium text-lime underline-offset-4 hover:underline">
                Parcourir les boutiques publiées
                <ArrowUpRight className="size-4" aria-hidden />
              </Link>
            </div>
            <div className="grid grid-cols-2 items-start gap-5">
              <Shot shot={SHOTS.boutiqueMobile} sizes="(min-width: 1024px) 240px, 42vw" frame="phone" className="reveal [&_figcaption]:text-white/70" />
              <Shot shot={SHOTS.ficheProduit} sizes="(min-width: 1024px) 240px, 42vw" frame="phone" className="reveal mt-10 [&_figcaption]:text-white/70 [transition-delay:100ms]" />
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <Section labelledBy="store-faq-title" tone="deep">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
          <SectionHeading id="store-faq-title" title="Questions sur la boutique" />
          <Faq items={FAQ} name="store-faq" />
        </div>
      </Section>

      {/* Maillage interne */}
      <Section labelledBy="store-more-title">
        <SectionHeading id="store-more-title" title="La suite de la plateforme." description="La boutique n'est qu'un quart du produit." />
        <DomainLinks current="boutique-en-ligne" className="mt-12" />
      </Section>

      <CtaBand title={`Construisez votre boutique pendant ${TRIAL_DAYS} jours.`} secondaryLabel="Voir les tarifs" secondaryHref="/tarifs" />
    </>
  );
}
