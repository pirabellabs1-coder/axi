import { S } from "@/lib/storefront/theme-doc";
import type { SectionProps } from "../render-context";

export default function CustomSpacer({ section }: SectionProps) {
  const h = S.num(section.settings, "height", 48);
  return (
    <div data-section-id={section.id} data-section-type={section.type} aria-hidden className="relative sf-container flex items-center" style={{ height: h }}>
      {S.bool(section.settings, "divider", false) && <hr className="w-full border-line" />}
    </div>
  );
}
