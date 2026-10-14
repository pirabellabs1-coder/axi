import type { Metadata } from "next";
import Link from "next/link";
import { Clock, Mail, MapPin, MessageCircle, type LucideIcon } from "lucide-react";
import { ContactForm } from "@/components/marketing/contact-form";
import { NewsletterForm } from "@/components/marketing/newsletter-form";
import { PageHero } from "@/components/marketing/section";
import { SITE } from "@/config/site";
import { formatPhone } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Contact",
  description: "Une question sur Axi, votre boutique, les paiements ou l'offre Enterprise ? Écrivez-nous : réponse en français sous 24 h ouvrées.",
  alternates: { canonical: "/contact" },
};

const SUBJECT_FROM_PARAM: Record<string, string> = {
  enterprise: "Offre Enterprise",
  partenariat: "Partenariat",
  facturation: "Abonnement et facturation",
  paiements: "Paiements et Mobile Money",
  aide: "Aide pour ma boutique",
};

export default async function ContactPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const sujet = typeof sp.sujet === "string" ? SUBJECT_FROM_PARAM[sp.sujet] : undefined;

  const channels: { icon: LucideIcon; title: string; body: React.ReactNode; note?: string }[] = [
    {
      icon: MessageCircle,
      title: "WhatsApp",
      body: (
        <a href={`https://wa.me/${SITE.supportWhatsapp}`} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline underline-offset-4">
          {formatPhone(SITE.supportWhatsapp)}
        </a>
      ),
      note: "Pour une urgence sur une commande en cours.",
    },
    {
      icon: Mail,
      title: "E-mail",
      body: (
        <a href={`mailto:${SITE.supportEmail}`} className="font-medium text-primary underline underline-offset-4">
          {SITE.supportEmail}
        </a>
      ),
    },
    { icon: Clock, title: "Horaires", body: <span className="text-ink">Du lundi au samedi, de 8 h à 19 h</span>, note: "Heure de Cotonou (UTC+1)." },
    { icon: MapPin, title: SITE.company, body: <span className="text-ink">{SITE.address}</span> },
  ];

  return (
    <>
      <PageHero
        title={
          <>
            Parlons de votre boutique. <span className="text-ink-muted">Un humain vous répond.</span>
          </>
        }
        description="Une question, un blocage, un projet à plusieurs boutiques : écrivez-nous. Réponse en français sous 24 h ouvrées."
      />

      <div className="container-x grid grid-cols-1 gap-12 pb-24 lg:grid-cols-[minmax(0,1.6fr)_1fr] lg:gap-16 md:pb-32">
        <section aria-labelledby="form-title" className="bezel reveal">
          <div className="bezel-core p-6 sm:p-10">
            <h2 id="form-title" className="text-h3 font-semibold text-ink">
              Envoyer un message
            </h2>
            <p className="mt-1.5 text-sm text-ink-muted">Pas besoin de compte. Les champs marqués d&apos;une étoile sont obligatoires.</p>
            <div className="mt-8">
              <ContactForm defaultSubject={sujet} />
            </div>
          </div>
        </section>

        <aside aria-label="Autres moyens de nous joindre" className="space-y-10">
          <ul className="space-y-6">
            {channels.map((c, i) => (
              <li key={c.title} className="reveal flex gap-4" style={{ transitionDelay: `${i * 60}ms` }}>
                <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-surface text-primary ring-1 ring-line">
                  <c.icon className="size-5" aria-hidden />
                </span>
                <div className="text-[15px]">
                  <p className="text-sm text-ink-muted">{c.title}</p>
                  <p className="mt-0.5">{c.body}</p>
                  {c.note && <p className="mt-0.5 text-[13px] text-ink-faint">{c.note}</p>}
                </div>
              </li>
            ))}
          </ul>

          <div className="reveal border-t border-line pt-8">
            <p className="text-[15px] font-semibold text-ink">Avant d&apos;écrire</p>
            <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">
              Beaucoup de réponses sont dans le{" "}
              <Link href="/aide" className="font-medium text-primary underline underline-offset-4">
                centre d&apos;aide
              </Link>
              . Pour une commande précise, indiquez sa référence (par exemple AX-7K2M4).
            </p>
          </div>

          <div className="reveal rounded-[var(--radius-xl)] bg-surface p-6 ring-1 ring-line">
            <NewsletterForm source="contact" />
          </div>
        </aside>
      </div>
    </>
  );
}
