import { S } from "@/lib/storefront/theme-doc";
import { href, type SectionProps } from "../render-context";
import { AnnouncementRotator } from "../announcement-rotator";
import { SectionShell } from "../ui";

export default function AnnouncementBar({ section, ctx }: SectionProps) {
  const items = section.blocks
    .filter((b) => !b.disabled && S.str(b.settings, "text").trim())
    .map((b) => ({ text: S.str(b.settings, "text").trim(), href: href(ctx, S.str(b.settings, "link") || null) }));
  if (!items.length) return null;
  const scheme = S.str(section.settings, "scheme", "default");
  const s = scheme === "default" ? { ...section, settings: { ...section.settings, scheme: "brand" } } : section;
  return (
    <SectionShell section={s} ctx={ctx} padded={false} full label="Annonces">
      <AnnouncementRotator items={items} autoplay={S.bool(section.settings, "autoplay", true)} />
    </SectionShell>
  );
}
