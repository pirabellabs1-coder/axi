import type { Metadata } from "next";
import Image from "next/image";
import { ButtonLink } from "@/components/ui/button";
import { Section, SectionHeading } from "@/components/marketing/section";
import { Shot } from "@/components/marketing/shot";
import { CapabilityGroupBlock, DomainLinks } from "@/components/marketing/capability-list";
import { CtaBand } from "@/components/marketing/cta-band";
import { Faq, FaqJsonLd } from "@/components/marketing/faq";
import { BreadcrumbJsonLd } from "@/components/marketing/structured-data";
import { getDomain, groupsForDomain, SHOTS } from "@/lib/marketing/positioning";
import { TRIAL_DAYS, PLANS } from "@/config/plans";
import { MEDIA, unsplash } from "@/config/media";
import { formatMoney } from "@/lib/money";

const DOMAIN = getDomain("whatsapp");
const GROUPS = groupsForDomain("whatsapp");

export const metadata: Metadata = {
  title: "WhatsApp, clients et fidélité",
  description:
    "Commande par lien WhatsApp, boîte de réception partagée, entonnoir de vente, campagnes, catalogue synchronisé, paniers abandonnés, comptes acheteurs, remises automatiques, cartes cadeaux et fidélité.",
  alternates: { canonical: "/whatsapp" },
  openGraph: {
    title: "WhatsApp, clients et fidélité | Axi",
    description: DOMAIN.lede,
    url: "/whatsapp",
    images: [{ url: unsplash(MEDIA.apronPhone.id, 1200, 630), width: 1200, height: 630, alt: MEDIA.apronPhone.alt }],
  },
};

function Bubble({ from, children }: { from: "client" | "shop"; children: React.ReactNode }) {
  return (
    <div
      className={
        from === "shop"
          ? "ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-accent-soft px-4 py-2.5 text-ink ring-1 ring-accent/30"
          : "w-fit max-w-[85%] rounded-2xl rounded-bl-md bg-surface-2 px-4 py-2.5 text-ink"
      }
    >
      {children}
    </div>
  );
}

const STEPS = [
  {
    title: "Le client écrit, vous répondez par un lien.",
    text: "Fini les photos envoyées une par une : votre catalogue s'ouvre en un clic, avec prix, variantes et stock à jour.",
    visual: (
      <div className="space-y-2 text-[14px]" role="img" aria-label="Exemple de conversation WhatsApp : un client demande si un pagne est disponible, la boutique répond par le lien du catalogue">
        <Bubble from="client">Bonsoir, le pagne bleu est encore disponible ?</Bubble>
        <Bubble from="shop">
          Oui, tout est ici : <span className="font-medium underline underline-offset-2">axi.africa/s/chez-aicha</span>
        </Bubble>
      </div>
    ),
  },
  {
    title: "Il commande seul, en trois écrans.",
    text: "Panier, coordonnées, livraison ou retrait, puis le moyen de paiement qui lui convient. Le récapitulatif arrive avec sa référence.",
    visual: (
      <div className="rounded-[var(--radius-md)] bg-surface-2 p-4 text-[13.5px]" role="img" aria-label="Exemple de récapitulatif de commande avec deux lignes et un total">
        <p className="font-mono text-[12px] text-ink-muted">Commande AX-7K2M4</p>
        <dl className="mt-2 space-y-1.5">
          <div className="flex justify-between gap-4">
            <dt className="text-ink">2 × Pagne wax 6 yards</dt>
            <dd className="tabular text-ink">{formatMoney(23500, "XOF")}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">Livraison Calavi</dt>
            <dd className="tabular text-ink-muted">{formatMoney(1500, "XOF")}</dd>
          </div>
          <div className="flex justify-between gap-4 border-t border-line pt-1.5 font-semibold">
            <dt className="text-ink">Total</dt>
            <dd className="tabular text-ink">{formatMoney(25000, "XOF")}</dd>
          </div>
        </dl>
      </div>
    ),
  },
  {
    title: "Vous encaissez et livrez, il suit.",
    text: "Paiement vérifié, statut mis à jour, lien de suivi envoyé automatiquement : plus de « c'est où ma commande ? ».",
    visual: (
      <ol className="grid grid-cols-4 gap-2 text-[12px]" aria-label="Suivi d'une commande : confirmée, payée, en route, livrée">
        {["Confirmée", "Payée", "En route", "Livrée"].map((s, i) => (
          <li key={s} className="flex flex-col gap-2">
            <span aria-hidden className={i < 3 ? "h-1 rounded-full bg-primary" : "h-1 rounded-full bg-line-strong"} />
            <span className={i < 3 ? "font-medium text-ink" : "text-ink-faint"}>{s}</span>
          </li>
        ))}
      </ol>
    ),
  },
];

const FAQ = [
  {
    q: "Ai-je besoin d'un compte Meta Business pour commencer ?",
    a: "Non. La commande par lien WhatsApp fonctionne sur votre numéro habituel, sans compte Meta ni API : le client valide son panier et le récapitulatif vous arrive en message. Le WhatsApp officiel (boîte partagée, messages automatiques, campagnes) demande un compte Meta Business, que nous vous aidons à configurer.",
  },
  {
    q: "Combien de messages sont inclus ?",
    a: `Le plan Business inclut ${PLANS.BUSINESS.limits.whatsappMessagesPerMonth} messages WhatsApp officiels par mois, le plan Scale ${PLANS.SCALE.limits.whatsappMessagesPerMonth?.toLocaleString("fr-FR")}. Des packs valables 12 mois existent en option. Les messages de commande par lien, eux, ne sont pas décomptés : ils passent par votre application WhatsApp.`,
  },
  {
    q: "Puis-je utiliser Axi sans WhatsApp ?",
    a: "Oui. La boutique, le catalogue, les paiements, la livraison, les comptes acheteurs et la fidélité fonctionnent indépendamment. WhatsApp est un canal de plus, pas une condition.",
  },
  {
    q: "Mon catalogue peut-il apparaître dans WhatsApp lui-même ?",
    a: "Oui, dès le plan Business : Axi synchronise votre catalogue avec le Commerce Manager de Meta, et un panier constitué dans WhatsApp est converti en lien de commande Axi. La synchronisation demande une intégration WhatsApp Cloud active.",
  },
  {
    q: "Et les clients qui n'ont pas terminé leur commande ?",
    a: "Le plan Scale relance automatiquement les paniers abandonnés. Sur les plans inférieurs, l'entonnoir de vente vous montre les conversations arrêtées en chemin, à relancer à la main.",
  },
];

export default function WhatsappPage() {
  return (
    <>
      <BreadcrumbJsonLd items={[{ name: "WhatsApp et clients", path: "/whatsapp" }]} />
      <FaqJsonLd items={FAQ} />

      {/* En-tête : texte + photo réelle */}
      <section aria-labelledby="wa-h1" className="pb-16 pt-8 md:pt-14">
        <div className="container-x grid grid-cols-1 items-center gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
          <div>
            <p className="eyebrow mb-6 animate-fade-up">WhatsApp et clients</p>
            <h1 id="wa-h1" className="text-h1 font-semibold text-ink animate-fade-up [animation-delay:60ms]">
              {DOMAIN.title}
            </h1>
            <p className="mt-5 max-w-[50ch] text-lg leading-relaxed text-ink-muted animate-fade-up [animation-delay:120ms]">{DOMAIN.lede}</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row animate-fade-up [animation-delay:180ms]">
              <ButtonLink href="/inscription" variant="accent" size="lg" trailing>
                Créer ma boutique
              </ButtonLink>
              <ButtonLink href="#parcours" variant="outline" size="lg">
                Voir le parcours
              </ButtonLink>
            </div>
          </div>
          <div className="bezel animate-fade-up [animation-delay:140ms]">
            <div className="bezel-core relative aspect-[4/3] overflow-hidden lg:aspect-[5/4]">
              <Image src={unsplash(MEDIA.apronPhone.id, 1200, 1000)} alt={MEDIA.apronPhone.alt} fill priority sizes="(min-width: 1024px) 46vw, 100vw" className="object-cover" />
            </div>
          </div>
        </div>
      </section>

      {/* Du chat à la commande */}
      <Section id="parcours" labelledBy="chat-title" tone="deep">
        <div className="grid grid-cols-1 gap-14 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
          <div className="lg:sticky lg:top-28 lg:self-start">
            <SectionHeading id="chat-title" title="Du chat à la commande, sans rien ressaisir." description="Vos clients continuent de vous écrire. La différence : la commande se fait toute seule, et elle est suivie." />
          </div>
          <ol className="space-y-5">
            {STEPS.map((s, i) => (
              <li key={s.title} className="reveal rounded-[var(--radius-xl)] bg-surface p-7 ring-1 ring-line shadow-[var(--shadow-card)] sm:p-8" style={{ transitionDelay: `${i * 90}ms` }}>
                <h3 className="text-h3 font-semibold text-ink">{s.title}</h3>
                <p className="mt-2 max-w-[52ch] text-[15px] leading-relaxed text-ink-muted">{s.text}</p>
                <div className="mt-6">{s.visual}</div>
              </li>
            ))}
          </ol>
        </div>
      </Section>

      {/* La boîte partagée : capture réelle */}
      <section aria-labelledby="inbox-title" className="bg-forest py-24 text-white md:py-32">
        <div className="container-x grid grid-cols-1 gap-12 lg:grid-cols-[1fr_1.15fr] lg:items-center lg:gap-16">
          <div>
            <SectionHeading
              id="inbox-title"
              light
              title="Une équipe, un numéro, aucune conversation perdue."
              description="La boîte partagée réunit les conversations de votre numéro professionnel. Chacune porte son client, ses commandes et son étape dans l'entonnoir de vente."
            />
            <ul className="mt-10 space-y-3 text-[15.5px] text-white/80">
              {["Attribution à un membre de l'équipe, réponses rapides enregistrées", "Entonnoir : de « nouveau contact » à « commande payée »", "Campagnes aux clients qui ont accepté de les recevoir", "Messages Instagram et Facebook au même endroit (bientôt)"].map((t) => (
                <li key={t} className="reveal border-t border-white/15 pt-3">
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="reveal">
            <Shot shot={SHOTS.conversations} sizes="(min-width: 1024px) 54vw, 92vw" frame="window" className="[&_figcaption]:text-white/70" />
          </div>
        </div>
      </section>

      {/* Capacités : ventes et fidélité, puis canaux */}
      <Section>
        <div className="space-y-20">
          {GROUPS.map((g) => (
            <CapabilityGroupBlock key={g.id} group={g} columns={2} />
          ))}
        </div>
      </Section>

      <Section labelledBy="wa-faq-title" tone="surface" className="border-y border-line">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
          <SectionHeading id="wa-faq-title" title="Questions sur WhatsApp" />
          <Faq items={FAQ} name="whatsapp-faq" />
        </div>
      </Section>

      <Section labelledBy="wa-more-title">
        <SectionHeading id="wa-more-title" title="La suite de la plateforme." />
        <DomainLinks current="whatsapp" className="mt-12" />
      </Section>

      <CtaBand title={`Essayez la boîte partagée ${TRIAL_DAYS} jours.`} secondaryLabel="Voir les tarifs" secondaryHref="/tarifs" />
    </>
  );
}
