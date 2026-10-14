import { MessageCircle } from "lucide-react";
import { S } from "@/lib/storefront/theme-doc";
import { waLink } from "@/lib/whatsapp";
import type { SectionProps } from "../render-context";
import { headingClass, SectionShell } from "../ui";

export default function WhatsappCta({ section, ctx }: SectionProps) {
  const store = ctx.data.store;
  if (!store.whatsappNumber) return null;
  const heading = S.str(section.settings, "heading", "Une question ? Écrivez-nous");
  const text = S.str(section.settings, "text");
  const prefill = S.str(section.settings, "prefill", "Bonjour, j'ai une question.") || "Bonjour";
  return (
    <SectionShell section={section} ctx={ctx} label={heading}>
      <div className="flex flex-col items-start justify-between gap-6 rounded-[calc(var(--store-card-radius)+6px)] md:flex-row md:items-center">
        <div className="max-w-2xl">
          <h2 className={headingClass(S.str(section.settings, "heading_size", "md"))}>{heading}</h2>
          {text && <p className="mt-3 text-[16px] leading-relaxed text-ink-muted">{text}</p>}
        </div>
        <a href={waLink(store.whatsappNumber, prefill)} target="_blank" rel="noopener noreferrer" className="sf-btn sf-btn-whatsapp h-14 shrink-0 px-7 text-base shadow-[0_16px_36px_-16px_rgb(15_122_92/0.8)]">
          <MessageCircle className="size-5" aria-hidden />
          Écrire sur WhatsApp
          <span className="sr-only"> (nouvel onglet)</span>
        </a>
      </div>
    </SectionShell>
  );
}
