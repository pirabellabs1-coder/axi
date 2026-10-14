import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, Stethoscope } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Section, SectionHeading } from "@/components/marketing/section";
import { CapabilityList } from "@/components/marketing/capability-list";
import { Shot } from "@/components/marketing/shot";
import { CtaBand } from "@/components/marketing/cta-band";
import { BreadcrumbJsonLd } from "@/components/marketing/structured-data";
import { CAPABILITY_GROUPS, CHANNELS, DOMAINS, PAYMENT_FAMILIES, SHOTS, type DomainSlug } from "@/lib/marketing/positioning";
import { ADD_ONS, TRIAL_DAYS } from "@/config/plans";
import { MEDIA, PRODUCT_PHOTOS, unsplash } from "@/config/media";
import { formatPrice } from "@/lib/marketing/pricing";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Fonctionnalités",
  description:
    "Tout ce que fait Axi, par domaine : éditeur de boutique, catalogue et stock, ventes et fidélité, WhatsApp et canaux, paiements et livraison, international, intelligence artificielle, équipe et intégrations. Chaque fonction indique le plan qui l'inclut.",
  alternates: { canonical: "/fonctionnalites" },
  openGraph: {
    title: "Fonctionnalités | Axi",
    description: "Tout ce que fait Axi, domaine par domaine, avec le plan qui inclut chaque fonction.",
    url: "/fonctionnalites",
    images: [{ url: unsplash(MEDIA.shopCounter.id, 1200, 630), width: 1200, height: 630, alt: MEDIA.shopCounter.alt }],
  },
};

const SHOT_BY_DOMAIN: Record<DomainSlug, (typeof SHOTS)[keyof typeof SHOTS]> = {
  "boutique-en-ligne": SHOTS.editeur,
  paiements: SHOTS.paiements,
  whatsapp: SHOTS.conversations,
  ia: SHOTS.connecteurIa,
};

const SECTORS: { title: string; text: string; img: string; alt: string; className: string }[] = [
  { title: "Restaurant", text: "Menu par catégories, suppléments, créneaux de retrait.", img: MEDIA.chef.id, alt: MEDIA.chef.alt, className: "lg:col-span-2 lg:row-span-2 min-h-[420px]" },
  { title: "Pâtisserie", text: "Commandes planifiées et messages sur gâteau.", img: MEDIA.bakery.id, alt: MEDIA.bakery.alt, className: "min-h-[240px]" },
  { title: "Beauté", text: "Cosmétiques, coffrets, conseils d'usage.", img: PRODUCT_PHOTOS.sheaButter, alt: "Beurre de karité et soins naturels", className: "min-h-[240px]" },
  { title: "Mode", text: "Tailles, couleurs, guide des tailles et modèles de fiche alternatifs.", img: MEDIA.boutique.id, alt: MEDIA.boutique.alt, className: "lg:col-span-2 min-h-[240px]" },
  { title: "Salon", text: "Prestations, tarifs et produits de soin à emporter.", img: MEDIA.braids.id, alt: MEDIA.braids.alt, className: "min-h-[240px]" },
  { title: "Commerce général", text: "Épicerie, téléphonie, maison : catalogue large et stock suivi.", img: MEDIA.market.id, alt: MEDIA.market.alt, className: "min-h-[240px]" },
];

export default function FeaturesPage() {
  const template = ADD_ONS.find((a) => a.id === "SECTOR_TEMPLATE");

  return (
    <>
      <BreadcrumbJsonLd items={[{ name: "Fonctionnalités", path: "/fonctionnalites" }]} />

      {/* En-tête */}
      <section aria-labelledby="features-h1" className="pb-16 pt-8 md:pt-14">
        <div className="container-x">
          <div className="max-w-[760px]">
            <h1 id="features-h1" className="text-h1 font-semibold text-ink animate-fade-up">
              Tout le commerce, <span className="text-ink-muted">dans un seul produit.</span>
            </h1>
            <p className="mt-5 max-w-[60ch] text-lg leading-relaxed text-ink-muted animate-fade-up [animation-delay:80ms]">
              Neuf domaines, le même jeu de données et un seul abonnement. Chaque fonction indique le plan qui l&apos;inclut ; ce qui n&apos;est pas encore livré porte la mention « Bientôt ».
            </p>
          </div>
          <nav aria-label="Domaines" className="mt-10 animate-fade-up [animation-delay:160ms]">
            <ul className="flex flex-wrap gap-2">
              {CAPABILITY_GROUPS.map((g) => (
                <li key={g.id}>
                  <a href={`#${g.id}`} className="inline-flex h-11 items-center rounded-full bg-surface px-4 text-sm font-medium text-ink ring-1 ring-line transition-colors duration-300 hover:bg-surface-2">
                    {g.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </section>

      {/* Les quatre pages de domaine : maillage interne en tête de page */}
      <Section labelledBy="domains-title" tone="surface" className="border-y border-line">
        <SectionHeading id="domains-title" title="Quatre portes d'entrée." description="Chaque domaine a sa page, avec ses captures et ses réponses." />
        <ul className="mt-14 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {DOMAINS.map((d, i) => (
            <li key={d.slug} className="reveal" style={{ transitionDelay: `${(i % 2) * 80}ms` }}>
              <article className="group/card relative flex h-full flex-col overflow-hidden rounded-[var(--radius-2xl)] bg-canvas ring-1 ring-line transition-[transform,box-shadow] duration-500 ease-spring focus-within:shadow-[var(--shadow-md)] hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)]">
                <div className="flex flex-1 flex-col p-7 sm:p-9">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-[1.5rem] font-semibold tracking-[-0.035em] text-ink">
                      {/* Lien étendu à toute la carte : une seule cible, une seule annonce. */}
                      <Link href={`/${d.slug}`} className="after:absolute after:inset-0 after:content-['']">
                        {d.label}
                      </Link>
                    </h3>
                    <ArrowUpRight className="mt-1 size-5 shrink-0 text-ink-faint transition-transform duration-500 ease-spring group-hover/card:-translate-y-0.5 group-hover/card:translate-x-0.5" aria-hidden />
                  </div>
                  <p className="mt-3 text-[15.5px] leading-relaxed text-ink-muted">{d.summary}</p>
                </div>
                <div className="px-7 pb-7 sm:px-9 sm:pb-9">
                  <Shot shot={SHOT_BY_DOMAIN[d.slug]} sizes="(min-width: 640px) 44vw, 90vw" frame="plain" captionHidden />
                </div>
              </article>
            </li>
          ))}
        </ul>
      </Section>

      {/* Toutes les capacités, domaine par domaine */}
      {CAPABILITY_GROUPS.map((g, i) => {
        const dark = i % 3 === 2;
        if (dark) {
          return (
            <section key={g.id} id={g.id} aria-labelledby={`cap-${g.id}`} className="scroll-mt-28 bg-forest py-24 text-white md:py-32">
              <div className="container-x">
                <div className="reveal max-w-2xl">
                  <h2 id={`cap-${g.id}`} className="text-h2 font-semibold text-white">
                    {g.title}
                  </h2>
                  <p className="mt-4 max-w-[60ch] text-[17px] leading-relaxed text-white/75">{g.description}</p>
                </div>
                <CapabilityList items={g.items} light columns={2} className="mt-12" />
                <Link href={`/${g.domain}`} className="reveal mt-10 inline-flex min-h-11 items-center gap-1.5 text-[15px] font-medium text-lime underline-offset-4 hover:underline">
                  Tout sur {DOMAINS.find((d) => d.slug === g.domain)?.label.toLowerCase()}
                  <ArrowUpRight className="size-4" aria-hidden />
                </Link>
              </div>
            </section>
          );
        }
        return (
          <Section key={g.id} id={g.id} labelledBy={`cap-${g.id}`} tone={i % 3 === 1 ? "deep" : "canvas"}>
            <div className="reveal max-w-2xl">
              <h2 id={`cap-${g.id}`} className="text-h2 font-semibold text-ink">
                {g.title}
              </h2>
              <p className="mt-4 max-w-[60ch] text-[17px] leading-relaxed text-ink-muted">{g.description}</p>
            </div>
            <CapabilityList items={g.items} columns={2} className="mt-12" />
            <Link href={`/${g.domain}`} className="reveal mt-10 inline-flex min-h-11 items-center gap-1.5 text-[15px] font-medium text-primary underline-offset-4 hover:underline">
              Tout sur {DOMAINS.find((d) => d.slug === g.domain)?.label.toLowerCase()}
              <ArrowUpRight className="size-4" aria-hidden />
            </Link>
          </Section>
        );
      })}

      {/* Paiements et canaux : repère rapide */}
      <Section id="moyens" labelledBy="means-title" tone="surface" className="border-y border-line">
        <div className="grid grid-cols-1 gap-14 lg:grid-cols-2 lg:gap-20">
          <div>
            <SectionHeading id="means-title" title="Les moyens de paiement acceptés." description="Selon votre pays et le prestataire chez qui vous ouvrez un compte." />
            <dl className="mt-10 divide-y divide-line border-y border-line">
              {PAYMENT_FAMILIES.map((f) => (
                <div key={f.title} className="reveal py-5">
                  <dt className="text-[16px] font-semibold text-ink">{f.title}</dt>
                  <dd className="mt-2 text-[15px] leading-relaxed text-ink-muted">{f.methods.join(", ")}.</dd>
                </div>
              ))}
            </dl>
          </div>
          <div>
            <h2 className="reveal text-h2 font-semibold text-ink">Les canaux de vente.</h2>
            <p className="reveal mt-4 max-w-[60ch] text-[17px] leading-relaxed text-ink-muted">Un seul catalogue, plusieurs vitrines, et toutes les commandes au même endroit.</p>
            <dl className="mt-10 divide-y divide-line border-y border-line">
              {CHANNELS.map((c) => (
                <div key={c.title} className="reveal flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-5">
                  <dt className="text-[16px] font-semibold text-ink">{c.title}</dt>
                  <dd className="max-w-[36ch] text-[14.5px] leading-relaxed text-ink-muted">{c.text}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </Section>

      {/* Modèles par secteur : bento */}
      <Section id="secteurs" labelledBy="secteurs-title">
        <SectionHeading
          id="secteurs-title"
          title="Un modèle prêt pour votre métier."
          description={
            template
              ? `Pages, catégories et réglages adaptés à votre secteur. En option : ${formatPrice(template.price.WORLD, "EUR")} ou ${formatPrice(template.price.AFRICA, "XOF")}, une seule fois.`
              : undefined
          }
        />
        <ul className="mt-14 grid grid-cols-1 grid-flow-dense gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SECTORS.map((s, i) => (
            <li key={s.title} className={cn("reveal relative overflow-hidden rounded-[var(--radius-xl)] bg-forest", s.className)} style={{ transitionDelay: `${(i % 4) * 60}ms` }}>
              <Image src={unsplash(s.img, 900, 900)} alt={s.alt} fill sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw" className="object-cover" />
              <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-6 text-white">
                <h3 className="text-xl font-semibold tracking-[-0.02em]">{s.title}</h3>
                <p className="mt-1 max-w-[36ch] text-[14px] leading-relaxed text-white/80">{s.text}</p>
              </div>
            </li>
          ))}
          <li className="reveal flex min-h-[240px] flex-col justify-between rounded-[var(--radius-xl)] bg-accent p-6 text-on-accent sm:col-span-2">
            <Stethoscope className="size-7" aria-hidden />
            <div>
              <h3 className="text-xl font-semibold tracking-[-0.02em]">Clinique et cabinet</h3>
              <p className="mt-1 max-w-[44ch] text-[14px] leading-relaxed text-on-accent/80">Prestations, horaires et produits de soin présentés clairement.</p>
            </div>
          </li>
        </ul>
        <div className="reveal mt-12">
          <ButtonLink href="/tarifs" variant="outline" trailing>
            Comparer les plans en détail
          </ButtonLink>
        </div>
      </Section>

      <CtaBand title={`Essayez toutes ces fonctions pendant ${TRIAL_DAYS} jours.`} secondaryLabel="Comparer les plans" secondaryHref="/tarifs" />
    </>
  );
}
