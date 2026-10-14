import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { BadgePercent, Database, Heart, Smartphone, type LucideIcon } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Section, SectionHeading } from "@/components/marketing/section";
import { NewsletterForm } from "@/components/marketing/newsletter-form";
import { CtaBand } from "@/components/marketing/cta-band";
import { SITE } from "@/config/site";
import { MEDIA, unsplash } from "@/config/media";

export const metadata: Metadata = {
  title: "À propos",
  description: "Pourquoi Axi existe : une plateforme de commerce complète, née au Bénin, pensée pour le Mobile Money, la conversation et les connexions lentes, et ouverte au reste du monde.",
  alternates: { canonical: "/a-propos" },
};

const PRINCIPLES: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: BadgePercent, title: "Pas de commission sur vos ventes", text: "Vous encaissez directement vos clients. Axi vit de ses abonnements, jamais d'un pourcentage sur votre travail." },
  { icon: Database, title: "Vos données vous appartiennent", text: "Chaque boutique est cloisonnée. Vous exportez tout quand vous voulez, rien n'est effacé sans votre demande." },
  { icon: Smartphone, title: "Mobile et petite connexion d'abord", text: "Conçu pour un Android d'entrée de gamme en 3G, en plein soleil. Si ça ne marche pas là, ça ne marche pas." },
  { icon: Heart, title: "Honnêteté avant tout", text: "Pas de chiffres inventés. Ce qui n'est pas prêt est annoncé « Bientôt », et ce qui est promis est livré." },
];

export default function AboutPage() {
  return (
    <>
      <section aria-labelledby="about-h1" className="pb-20 pt-8 md:pt-14">
        <div className="container-x grid grid-cols-1 items-end gap-12 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
          <div>
            <h1 id="about-h1" className="text-h1 font-semibold text-ink animate-fade-up">
              Le marché a changé de place. <span className="text-ink-muted">L&apos;outil devait suivre.</span>
            </h1>
            <p className="mt-6 max-w-[54ch] text-lg leading-relaxed text-ink-muted animate-fade-up [animation-delay:80ms]">
              Les commerçants vendent chaque jour sur WhatsApp, Facebook et Instagram, entre messages vocaux, captures d&apos;écran et carnets. Axi leur donne une plateforme de commerce complète, rapide, et qui respecte leur argent.
            </p>
          </div>
          <div className="bezel animate-fade-up [animation-delay:120ms]">
            <div className="bezel-core relative aspect-[4/3] overflow-hidden">
              <Image src={unsplash(MEDIA.seamstresses.id, 1200, 900)} alt={MEDIA.seamstresses.alt} fill priority sizes="(min-width: 1024px) 45vw, 100vw" className="object-cover" />
            </div>
          </div>
        </div>
      </section>

      <Section labelledBy="mission-title" tone="surface" className="border-y border-line">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[1fr_1fr] lg:gap-20">
          <div>
            <SectionHeading id="mission-title" title="Rendre la vente en ligne aussi naturelle qu'une conversation." />
            <div className="reveal mt-8 space-y-5 text-[17px] leading-relaxed text-ink-muted">
              <p>Les grandes plateformes ont été pensées pour des pays où chacun a une carte bancaire, une adresse postale et la fibre. Ici, on commande par message, on paie en Mobile Money, on se fait livrer « au carrefour, près de la pharmacie ».</p>
              <p>Axi part de cette réalité, sans rien retirer au reste : une boutique en ligne qu&apos;on dessine soi-même, un catalogue à variantes et collections, des paiements par les opérateurs que tout le monde utilise déjà, la TVA et les factures quand il en faut, et la conversation intégrée au parcours plutôt que posée à côté.</p>
              <p>Et parce que le commerce ne s&apos;arrête pas aux frontières, Axi facture aussi en euros, affiche plusieurs devises, accepte la carte bancaire et expose une API : pour la diaspora, pour l&apos;export, et pour les marques qui vendent ailleurs.</p>
              <p>
                Cet ancrage reste un avantage, pas une limite. Ce qui a été construit pour une 3G à Cotonou tient aussi très bien à Paris ou à Montréal.
              </p>
            </div>
          </div>

          <div className="reveal self-start rounded-[var(--radius-2xl)] bg-forest p-8 text-white sm:p-10">
            <p className="text-[13px] font-medium text-white/60">Pourquoi « Axi » ?</p>
            <p className="mt-4 text-[2.5rem] font-semibold leading-none tracking-[-0.045em]">
              Axi <span className="text-[1.25rem] font-normal tracking-normal text-white/60">/a.ʃi/</span>
            </p>
            <p className="mt-2 text-sm text-white/60">nom, en fon (sud du Bénin)</p>
            <p className="mt-6 text-[17px] leading-relaxed text-white/85">
              <strong className="font-semibold text-lime">Le marché.</strong> Le lieu où l&apos;on vend, où l&apos;on négocie, où l&apos;on se retrouve. Un clin d&apos;œil à Dantokpa, le grand marché de Cotonou, et à tous les marchés où le commerce se fait de personne à personne.
            </p>
          </div>
        </div>
      </Section>

      <Section labelledBy="principles-title">
        <SectionHeading id="principles-title" title="Ce qu'on s'engage à ne jamais changer." />
        <ul className="mt-14 grid grid-cols-1 gap-x-12 gap-y-10 md:grid-cols-2">
          {PRINCIPLES.map((p, i) => (
            <li key={p.title} className="reveal flex gap-5 border-t border-line pt-7" style={{ transitionDelay: `${(i % 2) * 80}ms` }}>
              <p.icon className="mt-1 size-6 shrink-0 text-primary" aria-hidden />
              <div>
                <h3 className="text-[18px] font-semibold text-ink">{p.title}</h3>
                <p className="mt-2 text-[15.5px] leading-relaxed text-ink-muted">{p.text}</p>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section labelledBy="team-title" tone="deep">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-20">
          <div>
            <SectionHeading id="team-title" title="Une petite équipe à Cotonou, proche du terrain." />
            <div className="reveal mt-8 space-y-5 text-[17px] leading-relaxed text-ink-muted">
              <p>
                Axi est développé par {SITE.company}, à {SITE.address}. Nous construisons le produit avec les commerçants qui l&apos;utilisent : leurs retours passent avant nos idées.
              </p>
              <p>Support francophone, développement, partenariats avec les opérateurs de Mobile Money et les livreurs : si vous voulez nous rejoindre, écrivez-nous.</p>
            </div>
            <div className="reveal mt-8">
              <ButtonLink href="/contact?sujet=partenariat" variant="outline" trailing>
                Nous contacter
              </ButtonLink>
            </div>
          </div>
          <div className="reveal bezel">
            <div className="bezel-core p-7 sm:p-9">
              <NewsletterForm source="a-propos" />
              <p className="mt-6 text-sm text-ink-muted">
                Suivez aussi la{" "}
                <Link href="/statut" className="font-medium text-primary underline underline-offset-4">
                  page de statut
                </Link>{" "}
                et le{" "}
                <Link href="/aide" className="font-medium text-primary underline underline-offset-4">
                  centre d&apos;aide
                </Link>
                .
              </p>
            </div>
          </div>
        </div>
      </Section>

      <CtaBand />
    </>
  );
}
