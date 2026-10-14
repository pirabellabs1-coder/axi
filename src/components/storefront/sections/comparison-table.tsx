import { Check, X } from "lucide-react";
import { S } from "@/lib/storefront/theme-doc";
import { cn } from "@/lib/utils";
import type { BlockInstance, Settings } from "@/lib/theme-engine/types";
import type { SectionProps } from "../render-context";
import { SectionHeading, SectionShell } from "../ui";

export type Cell = { kind: "yes" } | { kind: "no" } | { kind: "text"; text: string } | { kind: "empty" };

/** « oui » / « non » (insensible à la casse et aux accents simples) → coche / croix ; sinon texte. */
export function parseCell(v: string): Cell {
  const t = v.trim();
  if (!t) return { kind: "empty" };
  const k = t.toLowerCase();
  if (k === "oui" || k === "yes" || k === "✓") return { kind: "yes" };
  if (k === "non" || k === "no" || k === "✗") return { kind: "no" };
  return { kind: "text", text: t };
}

export function comparison(settings: Settings, blocks: BlockInstance[]) {
  const cols = [1, 2, 3].map((i) => ({ i, label: S.str(settings, `col_${i}`).trim() })).filter((c) => c.label);
  const rows = blocks
    .filter((b) => !b.disabled && b.type === "row" && S.str(b.settings, "label").trim())
    .map((b) => ({ id: b.id, label: S.str(b.settings, "label").trim(), cells: cols.map((c) => parseCell(S.str(b.settings, `v${c.i}`))) }));
  const h = S.str(settings, "highlight", "1");
  const highlight = h === "none" ? -1 : cols.findIndex((c) => String(c.i) === h);
  return { columns: cols.map((c) => c.label), rows, highlight };
}

function CellView({ cell }: { cell: Cell }) {
  if (cell.kind === "yes")
    return (
      <span className="inline-flex size-7 items-center justify-center rounded-full bg-[var(--store-primary)] text-[var(--store-primary-contrast)]">
        <Check className="size-4" aria-hidden />
        <span className="sr-only">Oui</span>
      </span>
    );
  if (cell.kind === "no")
    return (
      <span className="inline-flex size-7 items-center justify-center rounded-full bg-surface-2 text-ink-muted">
        <X className="size-4" aria-hidden />
        <span className="sr-only">Non</span>
      </span>
    );
  if (cell.kind === "empty") return <span className="sr-only">Non renseigné</span>;
  return <span>{cell.text}</span>;
}

/** Tableau comparatif (bibliothèque premium) : colonne mise en avant teintée, coches lisibles sans la couleur (icône + texte masqué). */
export default function ComparisonTable({ section, ctx }: SectionProps) {
  const c = comparison(section.settings, section.blocks);
  if (c.columns.length < 2 || !c.rows.length) return null;
  const headingId = `compare-${section.id}`;
  const hl = (i: number) => i === c.highlight && "bg-[var(--store-primary-soft)]";
  return (
    <SectionShell section={section} ctx={ctx}>
      <SectionHeading section={section} ctx={ctx} id={headingId} align="center" />
      <div className="mx-auto max-w-4xl overflow-x-auto rounded-[min(var(--store-card-radius),18px)] bg-surface ring-1 ring-line" tabIndex={0} role="region" aria-labelledby={S.str(section.settings, "heading") ? headingId : undefined} aria-label={S.str(section.settings, "heading") ? undefined : "Tableau comparatif"}>
        <table className="w-full min-w-[300px] border-collapse text-[14px] sm:text-[15px]">
          <thead>
            <tr>
              <td className="px-3 py-4 sm:px-4" />
              {c.columns.map((col, i) => (
                <th key={col} scope="col" className={cn("px-2 py-4 text-center font-semibold text-ink sm:px-4", hl(i))}>
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {c.rows.map((r) => (
              <tr key={r.id} className="border-t border-line">
                <th scope="row" className="w-1/2 px-3 py-3.5 text-left font-medium text-ink sm:px-4">
                  {r.label}
                </th>
                {r.cells.map((cell, i) => (
                  <td key={i} className={cn("px-2 py-3.5 text-center text-ink-muted sm:px-4", hl(i))}>
                    <CellView cell={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionShell>
  );
}
