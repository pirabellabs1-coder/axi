import * as React from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export type FaqItem = { q: string; a: React.ReactNode };

/**
 * Accordéon natif (details/summary) : accessible au clavier sans JavaScript.
 * `name` groupe les items (un seul ouvert à la fois, navigateurs récents).
 */
export function Faq({ items, name, className }: { items: FaqItem[]; name?: string; className?: string }) {
  return (
    <div className={cn("border-t border-line", className)}>
      {items.map((item, i) => (
        <details key={i} name={name} className="reveal group border-b border-line" style={{ transitionDelay: `${Math.min(i, 6) * 50}ms` }}>
          <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-6 py-5 text-left text-[17px] font-medium tracking-[-0.01em] text-ink marker:content-none [&::-webkit-details-marker]:hidden">
            <span>{item.q}</span>
            <span aria-hidden className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-surface ring-1 ring-line transition-[transform,background-color] duration-500 ease-spring group-open:rotate-45 group-open:bg-accent group-open:text-on-accent group-open:ring-transparent">
              <Plus className="size-4" />
            </span>
          </summary>
          <div className="max-w-[68ch] pb-6 pr-14 text-[15.5px] leading-relaxed text-ink-muted">{item.a}</div>
        </details>
      ))}
    </div>
  );
}

/** Script JSON-LD FAQPage pour le SEO (uniquement pour des réponses en texte brut). */
export function FaqJsonLd({ items }: { items: { q: string; a: string }[] }) {
  const data = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((i) => ({ "@type": "Question", name: i.q, acceptedAnswer: { "@type": "Answer", text: i.a } })),
  };
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}
