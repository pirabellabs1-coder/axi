import { Plus } from "lucide-react";
import { S } from "@/lib/storefront/theme-doc";
import type { SectionProps } from "../render-context";
import { RichText } from "../rich-text";
import { headingClass, SectionShell } from "../ui";

export default function Faq({ section, ctx }: SectionProps) {
  const items = section.blocks.filter((b) => !b.disabled && S.str(b.settings, "question").trim());
  if (!items.length) return null;
  const heading = S.str(section.settings, "heading", "Questions fréquentes");
  // Données structurées FAQ (texte brut uniquement).
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((b) => ({ "@type": "Question", name: S.str(b.settings, "question"), acceptedAnswer: { "@type": "Answer", text: S.str(b.settings, "answer") } })),
  };
  return (
    <SectionShell section={section} ctx={ctx} label={heading}>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,360px)_1fr] lg:gap-14">
        {heading && <h2 className={headingClass(S.str(section.settings, "heading_size", "md"))}>{heading}</h2>}
        <div className="divide-y divide-line rounded-[var(--store-card-radius)] bg-surface ring-1 ring-line">
          {items.map((b) => (
            <details key={b.id} className="group px-5 sm:px-6">
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-4 text-[16px] font-medium text-ink [&::-webkit-details-marker]:hidden">
                {S.str(b.settings, "question")}
                <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2 transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] group-open:rotate-45" aria-hidden>
                  <Plus className="size-4" />
                </span>
              </summary>
              <RichText text={S.str(b.settings, "answer")} base={ctx.base} className="max-w-[65ch] space-y-3 pb-5 text-[15px] leading-relaxed text-ink-muted" />
            </details>
          ))}
        </div>
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
    </SectionShell>
  );
}
