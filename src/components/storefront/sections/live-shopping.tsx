import { S } from "@/lib/storefront/theme-doc";
import type { SectionProps } from "../render-context";
import { SectionHeading, SectionShell } from "../ui";
import { LiveLoader } from "../live/live-panel";

/**
 * Direct / live shopping (lot 4 §18, équipe CAN). La section reste PURE (aucun accès base) comme toutes les
 * sections : le direct, ses produits épinglés et leur rafraîchissement viennent de `/api/live/{slug}`.
 * « Masquer la section si aucun direct n'est prévu » est respecté en boutique ; dans l'aperçu de l'éditeur,
 * une note explique quoi faire pour la voir.
 */
export default function LiveShopping({ section, ctx }: SectionProps) {
  const st = section.settings;
  const text = S.str(st, "text").trim();
  return (
    <SectionShell section={section} ctx={ctx}>
      <SectionHeading section={section} ctx={ctx} fallback="En direct" />
      {text && <p className="-mt-2 mb-6 max-w-[60ch] whitespace-pre-line text-[15px] leading-relaxed text-ink-muted">{text}</p>}
      <LiveLoader
        slug={ctx.data.store.slug}
        base={ctx.base}
        showReminder={S.bool(st, "show_reminder", true) && !!ctx.data.store.whatsappNumber}
        hideWhenNone={S.bool(st, "hide_when_none", true)}
        preview={ctx.preview}
        note={text}
      />
    </SectionShell>
  );
}
