import Link from "next/link";
import { S } from "@/lib/storefront/theme-doc";
import { cn } from "@/lib/utils";
import type { RenderData } from "@/lib/storefront/render-types";
import type { BlockInstance, Settings } from "@/lib/theme-engine/types";
import type { SectionProps } from "../render-context";
import type { RenderMetafield } from "../lot4-types";
import { ProductImage } from "../product-image";
import { SectionHeading, SectionShell } from "../ui";

/** Ligne affichable : texte, et selon le type un lien, une pastille de couleur ou une vignette. */
export type SpecRow = { id: string; label: string; text: string; href?: string | null; color?: string | null; image?: { url: string; alt?: string } | null };

/** Champ personnalisé public → ligne (null si vide). */
export function metafieldRow(id: string, m: RenderMetafield): SpecRow | null {
  const color = m.type === "color" && typeof m.value === "string" && /^#[0-9a-f]{6}$/i.test(m.value) ? m.value : null;
  const text = (m.text || (color ?? "")).trim();
  if (!text && !m.image) return null;
  return { id, label: m.name, text, href: m.url, color, image: m.type === "image" ? m.image : null };
}

/**
 * Lignes de la section (pur, testable) : champs personnalisés du produit (mode automatique), puis lignes manuelles
 * (valeur déjà résolue si elle était liée à une source dynamique). Lignes vides omises.
 */
export function specRows(settings: Settings, blocks: BlockInstance[], data: Pick<RenderData, "metafields">): SpecRow[] {
  const rows: SpecRow[] = [];
  if (S.bool(settings, "auto", true)) {
    for (const [k, m] of Object.entries(data.metafields?.product ?? {})) {
      const r = metafieldRow(`mf-${k}`, m);
      if (r) rows.push(r);
    }
  }
  for (const b of blocks) {
    if (b.disabled || b.type !== "row") continue;
    const label = S.str(b.settings, "label").trim();
    const text = S.str(b.settings, "value").trim();
    if (label && text) rows.push({ id: b.id, label, text });
  }
  return rows;
}

function Value({ row }: { row: SpecRow }) {
  const content = (
    <span className="inline-flex flex-wrap items-center gap-2">
      {row.color && <span aria-hidden className="inline-block size-4 rounded-full ring-1 ring-line" style={{ background: row.color }} />}
      {row.image && <ProductImage src={row.image.url} alt={row.image.alt ?? row.label} ratio="aspect-square" className="w-14 rounded-[10px]" sizes="56px" />}
      {row.text && <span className="whitespace-pre-line">{row.text}</span>}
    </span>
  );
  if (!row.href) return content;
  return row.href.startsWith("https://") ? (
    <a href={row.href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-ink">
      {content}
    </a>
  ) : (
    <Link href={row.href} className="underline underline-offset-4 hover:text-ink">
      {content}
    </Link>
  );
}

export default function ProductSpecs({ section, ctx }: SectionProps) {
  const rows = specRows(section.settings, section.blocks, ctx.data);
  // Rien à montrer : masquée en boutique (« hide_empty » ou non, un tableau vide n'a pas de sens) ; note dans l'aperçu.
  if (!rows.length && !ctx.preview) return null;
  const grid = S.str(section.settings, "layout", "table") === "grid";
  const headingId = `specs-${section.id}`;
  return (
    <SectionShell section={section} ctx={ctx} label={S.str(section.settings, "heading") ? undefined : "Caractéristiques"}>
      <SectionHeading section={section} ctx={ctx} id={headingId} />
      {!rows.length ? (
        <p className="text-sm text-ink-muted">Aucune caractéristique pour ce produit : renseignez ses champs personnalisés ou ajoutez des lignes. Section masquée sur la boutique.</p>
      ) : grid ? (
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => (
            <div key={r.id} className="rounded-[min(var(--store-card-radius),16px)] bg-surface p-4 ring-1 ring-line">
              <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-muted">{r.label}</dt>
              <dd className="mt-1.5 text-[15px] font-medium text-ink">
                <Value row={r} />
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <div className="max-w-3xl overflow-hidden rounded-[min(var(--store-card-radius),16px)] ring-1 ring-line">
          <table className="w-full border-collapse text-left text-[15px]" aria-labelledby={S.str(section.settings, "heading") ? headingId : undefined}>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} className={cn(i % 2 === 0 ? "bg-surface" : "bg-surface-2")}>
                  <th scope="row" className="w-[38%] px-4 py-3 align-top font-semibold text-ink">
                    {r.label}
                  </th>
                  <td className="px-4 py-3 align-top text-ink-muted">
                    <Value row={r} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionShell>
  );
}
