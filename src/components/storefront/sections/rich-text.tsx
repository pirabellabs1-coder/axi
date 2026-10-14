import { S } from "@/lib/storefront/theme-doc";
import { cn } from "@/lib/utils";
import type { SectionProps } from "../render-context";
import { SectionShell } from "../ui";
import { ContentBlocks } from "./blocks";

export default function RichTextSection({ section, ctx }: SectionProps) {
  const center = S.str(section.settings, "align", "left") === "center";
  if (!section.blocks.some((b) => !b.disabled)) return null;
  return (
    <SectionShell section={section} ctx={ctx}>
      <div className={cn("max-w-3xl", center && "mx-auto")}>
        <ContentBlocks blocks={section.blocks} ctx={ctx} align={center ? "center" : "left"} h1={ctx.template === "not_found" && ctx.first} />
      </div>
    </SectionShell>
  );
}
