import { S } from "@/lib/storefront/theme-doc";
import type { BlockInstance } from "@/lib/theme-engine/types";
import { cn } from "@/lib/utils";
import { href, type RenderCtx } from "../render-context";
import { RichText } from "../rich-text";
import { ButtonLink, headingClass } from "../ui";

/**
 * Blocs de contenu communs (titre, texte, bouton) rendus dans l'ordre du commerçant.
 * `tone="light"` : texte blanc sur image (bouton clair).
 */
export function ContentBlocks({ blocks, ctx, tone, align = "left", h1 = false, className }: { blocks: BlockInstance[]; ctx: RenderCtx; tone?: "light"; align?: "left" | "center"; h1?: boolean; className?: string }) {
  const visible = blocks.filter((b) => !b.disabled);
  const firstHeading = visible.find((b) => b.type === "heading")?.id;
  const buttons = visible.filter((b) => b.type === "button");
  const firstButton = buttons[0]?.id;
  return (
    <div className={cn("flex flex-col gap-4", align === "center" ? "items-center text-center" : "items-start", className)}>
      {visible.map((b) => {
        if (b.type === "heading") {
          const Tag = h1 && b.id === firstHeading ? "h1" : "h2";
          const text = S.str(b.settings, "text");
          if (!text) return null;
          return (
            <Tag key={b.id} className={cn(headingClass(S.str(b.settings, "size", "lg")), tone === "light" && "!text-white", "max-w-[22ch]")}>
              {text}
            </Tag>
          );
        }
        if (b.type === "text") {
          const text = S.str(b.settings, "text");
          if (!text) return null;
          return <RichText key={b.id} text={text} base={ctx.base} className={cn("max-w-[58ch] space-y-3 text-[calc(1.0625rem*var(--store-body-scale,var(--store-scale)))] leading-relaxed", tone === "light" ? "text-white/90" : "text-ink-muted")} />;
        }
        if (b.type === "button") {
          if (b.id !== firstButton) return null;
          return (
            <div key={b.id} className="mt-2 flex flex-wrap gap-2.5">
              {buttons.map((bb, i) => {
                const style = S.str(bb.settings, "button_style", "solid") as "solid" | "secondary" | "outline" | "link";
                const resolved =
                  tone === "light"
                    ? style === "solid"
                      ? i === 0
                        ? "light"
                        : "ghost-light"
                      : style === "link"
                        ? "link"
                        : "ghost-light"
                    : style;
                return <ButtonLink key={bb.id} href={href(ctx, S.str(bb.settings, "button_link"), "/catalogue")} label={S.str(bb.settings, "button_label")} style={resolved as "solid"} arrow={i === 0 && style !== "link"} className={tone === "light" && style === "link" ? "!text-white" : undefined} />;
              })}
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}
