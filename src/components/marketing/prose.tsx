import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Typographie longue (pages légales, aide) sans plugin : variantes Tailwind arbitraires.
 */
export function Prose({ children, className, as: Tag = "div" }: { children: React.ReactNode; className?: string; as?: "div" | "article" }) {
  return (
    <Tag
      className={cn(
        "max-w-none text-[16px] leading-[1.75] text-ink-muted",
        "[&_h2]:mt-14 [&_h2]:scroll-mt-28 [&_h2]:text-[1.6rem] [&_h2]:font-semibold [&_h2]:leading-tight [&_h2]:tracking-[-0.03em] [&_h2]:text-ink [&>h2:first-child]:mt-0",
        "[&_h3]:mt-8 [&_h3]:scroll-mt-28 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-ink",
        "[&_p]:mt-4",
        "[&_ul]:mt-4 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6 [&_ol]:mt-4 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-6 [&_li]:marker:text-ink-faint",
        "[&_li]:pl-1 [&_li>p]:mt-1",
        "[&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4 hover:[&_a]:text-primary-hover",
        "[&_strong]:font-semibold [&_strong]:text-ink",
        "[&_table]:mt-6 [&_table]:w-full [&_table]:text-sm [&_th]:border-b [&_th]:border-line [&_th]:py-3 [&_th]:pr-4 [&_th]:text-left [&_th]:font-semibold [&_th]:text-ink [&_td]:border-b [&_td]:border-line [&_td]:py-3 [&_td]:pr-4 [&_td]:align-top",
        "[&_hr]:my-12 [&_hr]:border-line",
        className,
      )}
    >
      {children}
    </Tag>
  );
}
