import { ChevronDown } from "lucide-react";
import { S } from "@/lib/storefront/theme-doc";
import type { BlockInstance, Settings } from "@/lib/theme-engine/types";
import type { SectionProps } from "../render-context";
import { SectionShell, headingClass } from "../ui";

export type SizeTable = { columns: string[]; unit: string; rows: { id: string; size: string; values: string[] }[] };

/** Tableau du guide (pur) : colonnes nommées seulement, tailles sans libellé omises. */
export function sizeTable(settings: Settings, blocks: BlockInstance[]): SizeTable {
  const cols = [1, 2, 3, 4].map((i) => ({ i, label: S.str(settings, `col_${i}`).trim() })).filter((c) => c.label);
  const rows = blocks
    .filter((b) => !b.disabled && b.type === "size" && S.str(b.settings, "size").trim())
    .map((b) => ({ id: b.id, size: S.str(b.settings, "size").trim(), values: cols.map((c) => S.str(b.settings, `v${c.i}`).trim()) }));
  return { columns: cols.map((c) => c.label), unit: S.str(settings, "unit", "cm") === "in" ? "pouces" : "cm", rows };
}

/** Guide des tailles (bibliothèque premium) : vrai tableau (en-têtes de ligne et de colonne), défilement horizontal sur mobile. */
export default function SizeGuide({ section, ctx }: SectionProps) {
  const st = section.settings;
  const t = sizeTable(st, section.blocks);
  if (!t.rows.length) return null;
  const heading = S.str(st, "heading", "Guide des tailles") || "Guide des tailles";
  const intro = S.str(st, "intro").trim();
  const table = (
    <div className="overflow-x-auto rounded-[min(var(--store-card-radius),16px)] ring-1 ring-line" tabIndex={0} role="region" aria-label={`${heading}, tableau défilant`}>
      <table className="w-full min-w-[340px] border-collapse text-left text-[15px] tabular">
        <caption className="sr-only">
          {heading}, mesures en {t.unit}
        </caption>
        <thead className="bg-surface-2 text-ink">
          <tr>
            <th scope="col" className="px-3 py-3 sm:px-4 font-semibold">
              Taille
            </th>
            {t.columns.map((c) => (
              <th key={c} scope="col" className="px-3 py-3 sm:px-4 font-semibold">
                {c} <span className="font-normal text-ink-muted">({t.unit})</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {t.rows.map((r) => (
            <tr key={r.id} className="border-t border-line bg-surface">
              <th scope="row" className="px-3 py-3 sm:px-4 font-semibold text-ink">
                {r.size}
              </th>
              {r.values.map((v, i) => (
                <td key={i} className="px-3 py-3 sm:px-4 text-ink-muted">
                  {v || <span aria-label="non renseigné">-</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  const body = (
    <>
      {intro && <p className="mb-5 max-w-[60ch] whitespace-pre-line text-[15px] leading-relaxed text-ink-muted">{intro}</p>}
      {table}
    </>
  );
  return (
    <SectionShell section={section} ctx={ctx}>
      <div className="mx-auto max-w-4xl">
        {S.bool(st, "collapsible", false) ? (
          <details className="group rounded-[min(var(--store-card-radius),18px)] bg-surface p-1 ring-1 ring-line">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 rounded-[14px] px-4 py-3 font-semibold text-ink [&::-webkit-details-marker]:hidden">
              <h2 className="sf-heading text-lg">{heading}</h2>
              <ChevronDown className="size-5 shrink-0 transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
            </summary>
            <div className="px-4 pb-4 pt-1">{body}</div>
          </details>
        ) : (
          <>
            <h2 className={`${headingClass(S.str(st, "heading_size", "md"))} mb-5`}>{heading}</h2>
            {body}
          </>
        )}
      </div>
    </SectionShell>
  );
}
