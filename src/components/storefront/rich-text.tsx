import { Fragment } from "react";
import { safeLink } from "@/lib/storefront/theme-doc";

/**
 * Markdown limité du commerçant (gras, italique, liens, listes, paragraphes), rendu en éléments React.
 * Jamais de HTML interprété : le texte est échappé par React, les liens sont filtrés (https ou internes).
 */
export function RichText({ text, base, className }: { text: string; base?: string; className?: string }) {
  const blocks = text.replace(/\r\n/g, "\n").split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  if (!blocks.length) return null;
  return (
    <div className={className}>
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*[-*•]\s+/, ""), base)}</li>
              ))}
            </ul>
          );
        }
        if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
          return (
            <ol key={i} className="list-decimal space-y-1 pl-5">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*\d+[.)]\s+/, ""), base)}</li>
              ))}
            </ol>
          );
        }
        const h = /^(#{1,3})\s+(.+)$/.exec(b);
        if (h && lines.length === 1) {
          return (
            <h3 key={i} className="pt-2 text-[1.15em] font-semibold text-ink">
              {inline(h[2], base)}
            </h3>
          );
        }
        return (
          <p key={i}>
            {lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {inline(l, base)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

const TOKEN = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|_[^_\s][^_]*_|\[[^\]]{1,200}\]\([^)\s]{1,500}\))/g;

function inline(s: string, base?: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of s.matchAll(TOKEN)) {
    const t = m[0];
    if (m.index! > last) out.push(s.slice(last, m.index));
    if (t.startsWith("**") || t.startsWith("__")) out.push(<strong key={k++}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("[")) {
      const lm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(t)!;
      const url = safeLink(lm[2]);
      const resolved = url && base && url.startsWith("/") && !url.startsWith("/s/") ? `${base}${url === "/" ? "" : url}` : url;
      out.push(
        resolved ? (
          <a key={k++} href={resolved} className="underline underline-offset-2 hover:opacity-80" {...(resolved.startsWith("https://") ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
            {lm[1]}
          </a>
        ) : (
          lm[1]
        ),
      );
    } else out.push(<em key={k++}>{t.slice(1, -1)}</em>);
    last = m.index! + t.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}
