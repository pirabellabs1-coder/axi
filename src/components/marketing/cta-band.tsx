import Image from "next/image";
import { ButtonLink } from "@/components/ui/button";
import { TRIAL_DAYS } from "@/config/plans";
import { MEDIA, unsplash } from "@/config/media";

/** Appel à l'action final : bloc forêt avec photo, réutilisé en bas des pages marketing. */
export function CtaBand({
  title = "Ouvrez votre boutique aujourd'hui.",
  description = `${TRIAL_DAYS} jours d'essai gratuit de Business, sans carte bancaire.`,
  primaryLabel = "Créer ma boutique",
  primaryHref = "/inscription",
  secondaryLabel = "Voir les tarifs",
  secondaryHref = "/tarifs",
}: {
  title?: string;
  description?: string;
  primaryLabel?: string;
  primaryHref?: string;
  secondaryLabel?: string;
  secondaryHref?: string;
}) {
  return (
    <section aria-labelledby="cta-final" className="pb-24 pt-8 md:pb-32">
      <div className="container-x">
        <div className="reveal grid grid-cols-1 overflow-hidden rounded-[var(--radius-2xl)] bg-forest-deep text-white md:grid-cols-[1.25fr_1fr]">
          <div className="flex flex-col justify-center px-6 py-14 sm:px-12 md:py-20">
            <h2 id="cta-final" className="max-w-[16ch] text-h1 font-semibold text-white">
              {title}
            </h2>
            <p className="mt-5 max-w-[42ch] text-lg leading-relaxed text-white/75">{description}</p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
              <ButtonLink href={primaryHref} variant="accent" size="lg" trailing>
                {primaryLabel}
              </ButtonLink>
              <ButtonLink href={secondaryHref} variant="ghost" size="lg" className="text-white hover:bg-white/10">
                {secondaryLabel}
              </ButtonLink>
            </div>
          </div>
          <div className="relative min-h-64 md:min-h-full">
            <Image src={unsplash(MEDIA.market.id, 900, 900)} alt={MEDIA.market.alt} fill sizes="(min-width: 768px) 40vw, 100vw" className="object-cover" />
            <div aria-hidden className="absolute inset-0 bg-gradient-to-r from-forest-deep/60 via-transparent to-transparent max-md:bg-gradient-to-b" />
          </div>
        </div>
      </div>
    </section>
  );
}
