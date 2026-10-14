import type { Metadata } from "next";
import Image from "next/image";
import { ButtonLink } from "@/components/ui/button";
import { Section, SectionHeading } from "@/components/marketing/section";
import { Shot } from "@/components/marketing/shot";
import { CapabilityGroupBlock, DomainLinks } from "@/components/marketing/capability-list";
import { CtaBand } from "@/components/marketing/cta-band";
import { Faq, FaqJsonLd } from "@/components/marketing/faq";
import { BreadcrumbJsonLd } from "@/components/marketing/structured-data";
import { getDomain, groupsForDomain, PAYMENT_FAMILIES, SHOTS } from "@/lib/marketing/positioning";
import { COUNTRIES } from "@/config/site";
import { TRIAL_DAYS } from "@/config/plans";
import { MEDIA, unsplash } from "@/config/media";

const DOMAIN = getDomain("paiements");
const GROUPS = groupsForDomain("paiements");
const AFRICA = COUNTRIES.filter((c) => c.currency === "XOF" || c.currency === "XAF");

export const metadata: Metadata = {
  title: "Paiements, livraison et international",
  description:
    "Wave, Orange Money, MTN MoMo, Moov Money, carte bancaire et paiement à la livraison, sur vos propres comptes. Zones de livraison, créneaux, suivi, multi-devises, TVA et factures numérotées. 0 % de commission.",
  alternates: { canonical: "/paiements" },
  openGraph: {
    title: "Paiements, livraison et international | Axi",
    description: DOMAIN.lede,
    url: "/paiements",
    images: [{ url: unsplash(MEDIA.delivery.id, 1200, 630), width: 1200, height: 630, alt: MEDIA.delivery.alt }],
  },
};

const FAQ = [
  {
    q: "Axi touche-t-il une part de mes paiements ?",
    a: "Non. L'argent ne transite jamais par Axi : vous connectez votre propre compte chez un prestataire de paiement, les fonds y arrivent directement. Seuls les frais de ce prestataire s'appliquent, selon son barème.",
  },
  {
    q: "Quels prestataires puis-je utiliser ?",
    a: "Selon votre pays et vos comptes : Paystack, pawaPay, CinetPay, FedaPay ou KkiaPay pour le Mobile Money, Stripe pour la carte bancaire. Les clés se collent dans vos réglages, et Axi rapproche automatiquement chaque transaction de sa commande.",
  },
  {
    q: "Et si mon client veut payer en espèces ?",
    a: "Le paiement à la livraison est un moyen de paiement à part entière dans Axi, pas un contournement : la commande suit son cycle normal, et elle n'est marquée payée qu'après votre confirmation ou celle de votre livreur.",
  },
  {
    q: "Puis-je afficher mes prix dans une autre devise ?",
    a: "Oui, dès le plan Starter. Vous choisissez les devises affichées, la règle d'arrondi, une marge de change éventuelle, et vous pouvez fixer un prix précis dans une devise plutôt que de laisser la conversion décider.",
  },
  {
    q: "La TVA et les factures sont-elles gérées ?",
    a: "Oui : taux par pays, prix affichés TTC ou HT selon votre choix, mentions correctes au panier et sur la facture. Les factures et les avoirs portent une numérotation continue, sans trou, exportable pour votre comptabilité.",
  },
];

export default function PaymentsPage() {
  return (
    <>
      <BreadcrumbJsonLd items={[{ name: "Paiements et livraison", path: "/paiements" }]} />
      <FaqJsonLd items={FAQ} />

      {/* En-tête : split texte + capture des réglages de paiement */}
      <section aria-labelledby="pay-h1" className="pb-16 pt-8 md:pt-14">
        <div className="container-x grid grid-cols-1 items-center gap-12 lg:grid-cols-[1fr_1.1fr] lg:gap-16">
          <div>
            <p className="eyebrow mb-6 animate-fade-up">Paiements et livraison</p>
            <h1 id="pay-h1" className="text-h1 font-semibold text-ink animate-fade-up [animation-delay:60ms]">
              {DOMAIN.title}
            </h1>
            <p className="mt-5 max-w-[50ch] text-lg leading-relaxed text-ink-muted animate-fade-up [animation-delay:120ms]">{DOMAIN.lede}</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row animate-fade-up [animation-delay:180ms]">
              <ButtonLink href="/inscription" variant="accent" size="lg" trailing>
                Créer ma boutique
              </ButtonLink>
              <ButtonLink href="/tarifs" variant="outline" size="lg">
                Voir les tarifs
              </ButtonLink>
            </div>
          </div>
          <div className="animate-fade-up [animation-delay:140ms]">
            <Shot shot={SHOTS.paiements} priority sizes="(min-width: 1024px) 56vw, 100vw" frame="window" />
          </div>
        </div>
      </section>

      {/* Familles de paiement : trois colonnes inégales */}
      <Section labelledBy="families-title" tone="surface" className="border-y border-line">
        <SectionHeading id="families-title" title="Trois façons d'être payé, toutes natives." description="Aucune n'est une extension à installer : elles font partie du produit, et aucune ne nous reverse de commission." />
        <ul className="mt-14 grid grid-cols-1 gap-4 lg:grid-cols-3">
          {PAYMENT_FAMILIES.map((f, i) => (
            <li
              key={f.title}
              className="reveal flex flex-col rounded-[var(--radius-2xl)] bg-canvas p-7 ring-1 ring-line sm:p-9"
              style={{ transitionDelay: `${i * 80}ms` }}
            >
              <h3 className="text-[1.5rem] font-semibold tracking-[-0.035em] text-ink">{f.title}</h3>
              <p className="mt-3 text-[15px] leading-relaxed text-ink-muted">{f.text}</p>
              <ul className="mt-7 flex flex-wrap gap-2" aria-label={`Moyens : ${f.title}`}>
                {f.methods.map((m) => (
                  <li key={m} className="rounded-full bg-surface px-3 py-1.5 text-[13.5px] font-medium text-ink ring-1 ring-line">
                    {m}
                  </li>
                ))}
              </ul>
              {f.note && <p className="mt-auto pt-7 text-[13.5px] leading-relaxed text-ink-faint">{f.note}</p>}
            </li>
          ))}
        </ul>
        <p className="reveal mt-8 max-w-[76ch] text-[14px] leading-relaxed text-ink-faint">
          La disponibilité exacte dépend de votre pays et du prestataire chez qui vous ouvrez un compte. Nous indiquons dans vos réglages ce qui est réellement activable pour vous.
        </p>
      </Section>

      {/* Capacités : paiements, livraison, international */}
      <Section>
        <div className="space-y-20">
          {GROUPS.map((g) => (
            <CapabilityGroupBlock key={g.id} group={g} columns={2} />
          ))}
        </div>
      </Section>

      {/* Bloc forêt : international + capture multi-devises */}
      <section aria-labelledby="intl-title" className="bg-forest py-24 text-white md:py-32">
        <div className="container-x grid grid-cols-1 gap-12 lg:grid-cols-[1fr_1.15fr] lg:items-center lg:gap-16">
          <div>
            <SectionHeading
              id="intl-title"
              light
              title="Local et international, sans deux boutiques."
              description={`Tarifs Axi en FCFA pour les boutiques des zones XOF et XAF (${AFRICA.length} pays), en euros partout ailleurs. Et pour vos acheteurs, un affichage dans la devise qu'ils connaissent.`}
            />
            <dl className="mt-12 grid grid-cols-1 gap-8 sm:grid-cols-3">
              {[
                { t: "0 %", d: "de commission sur vos ventes, sur tous les plans" },
                { t: "Vos comptes", d: "les fonds arrivent chez votre prestataire, pas chez nous" },
                { t: "TVA et factures", d: "numérotation continue, prix TTC ou HT" },
              ].map((s, i) => (
                <div key={s.t} className="reveal" style={{ transitionDelay: `${i * 90}ms` }}>
                  <dt className="text-[1.75rem] font-semibold leading-tight tracking-[-0.04em] text-lime">{s.t}</dt>
                  <dd className="mt-2 text-[15px] leading-relaxed text-white/75">{s.d}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="reveal">
            <Shot shot={SHOTS.ficheProduit} sizes="(min-width: 1024px) 300px, 60vw" frame="phone" className="mx-auto max-w-[300px] [&_figcaption]:text-white/70" />
          </div>
        </div>
      </section>

      {/* Livraison : photo + rappel */}
      <Section labelledBy="ship-title" tone="deep">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[1fr_1fr] lg:items-center lg:gap-20">
          <div className="bezel reveal">
            <div className="bezel-core relative aspect-[4/3] overflow-hidden">
              <Image src={unsplash(MEDIA.delivery.id, 1000, 750)} alt={MEDIA.delivery.alt} fill sizes="(min-width: 1024px) 45vw, 100vw" className="object-cover" />
            </div>
          </div>
          <div>
            <SectionHeading id="ship-title" title="Promettez seulement ce que vous pouvez livrer." description="Zones tarifées, créneaux avec capacité, livreurs internes et lien de suivi : le client sait où en est sa commande sans vous écrire." />
            <div className="reveal mt-8">
              <ButtonLink href="/aide#livraison" variant="outline" trailing>
                Guide de la livraison
              </ButtonLink>
            </div>
          </div>
        </div>
      </Section>

      <Section labelledBy="pay-faq-title">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
          <SectionHeading id="pay-faq-title" title="Questions sur les paiements" />
          <Faq items={FAQ} name="payments-faq" />
        </div>
      </Section>

      <Section labelledBy="pay-more-title" tone="surface" className="border-y border-line">
        <SectionHeading id="pay-more-title" title="La suite de la plateforme." />
        <DomainLinks current="paiements" className="mt-12" />
      </Section>

      <CtaBand title={`Testez l'encaissement pendant ${TRIAL_DAYS} jours.`} secondaryLabel="Voir les tarifs" secondaryHref="/tarifs" />
    </>
  );
}
