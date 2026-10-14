"use client";

import * as React from "react";
import { BadgeCheck, Film, LayoutTemplate, Mail, Rows3, Search, ShoppingBag, Sparkles, Type, type LucideIcon } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import { Tabs } from "@/components/ui/tabs";
import { SECTION_CATEGORIES, sectionsForTemplate } from "@/lib/theme-engine/schemas";
import { canAddSection } from "@/lib/theme-engine/operations";
import type { SectionSchema, SectionType, TemplateId, ThemeDocument } from "@/lib/theme-engine/types";
import { cn } from "@/lib/utils";
import { LibraryList, SavedSectionList, type SavedSectionsProps } from "./saved-sections";

const CATEGORY_ICONS: Record<SectionSchema["category"], LucideIcon> = {
  "Mise en avant": Sparkles,
  Produits: ShoppingBag,
  Texte: Type,
  Médias: Film,
  Confiance: BadgeCheck,
  Contact: Mail,
  Structure: Rows3,
  Modèle: LayoutTemplate,
};

export function AddSectionDialog({
  open,
  onClose,
  doc,
  template,
  onAdd,
  saved,
}: {
  open: boolean;
  onClose: () => void;
  doc: ThemeDocument;
  template: TemplateId;
  onAdd: (type: SectionType) => void;
  /** Lot 4 : onglets « Mes sections » et « Bibliothèque ». */
  saved?: SavedSectionsProps;
}) {
  const [tab, setTab] = React.useState("sections");
  const [q, setQ] = React.useState("");
  const [cat, setCat] = React.useState<string>("all");
  const builtins = <BuiltinSections doc={doc} template={template} onAdd={onAdd} onClose={onClose} q={q} setQ={setQ} cat={cat} setCat={setCat} />;

  return (
    <Dialog open={open} onClose={onClose} title="Ajouter une section" description="Choisissez un type de section : vous pourrez ensuite la personnaliser et la déplacer." size="lg">
      {saved ? (
        <Tabs
          label="Origine de la section"
          value={tab}
          onChange={setTab}
          panelClassName="pt-4"
          items={[
            { id: "sections", label: "Sections", content: builtins },
            { id: "saved", label: "Mes sections", count: saved.items.length, content: <SavedSectionList {...saved} doc={doc} template={template} onDone={onClose} /> },
            { id: "library", label: "Bibliothèque", content: <LibraryList {...saved} doc={doc} template={template} onDone={onClose} /> },
          ]}
        />
      ) : (
        builtins
      )}
    </Dialog>
  );
}

function BuiltinSections({ doc, template, onAdd, onClose, q, setQ, cat, setCat }: { doc: ThemeDocument; template: TemplateId; onAdd: (type: SectionType) => void; onClose: () => void; q: string; setQ: (v: string) => void; cat: string; setCat: (v: string) => void }) {
  const available = sectionsForTemplate(template);
  const cats = SECTION_CATEGORIES.filter((c) => available.some((s) => s.category === c));
  const query = q.trim().toLowerCase();
  const list = available.filter((s) => (cat === "all" || s.category === cat) && (!query || s.name.toLowerCase().includes(query)));
  return (
      <div className="space-y-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-faint" aria-hidden />
          <Input fieldSize="sm" className="pl-10" placeholder="Rechercher une section" aria-label="Rechercher une section" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div role="group" aria-label="Catégories" className="flex flex-wrap gap-1.5">
          {["all", ...cats].map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={cat === c}
              onClick={() => setCat(c)}
              className={cn(
                "h-9 rounded-full px-3.5 text-[13px] font-medium transition-colors",
                cat === c ? "bg-primary text-on-primary" : "bg-surface-2 text-ink-muted hover:text-ink",
              )}
            >
              {c === "all" ? "Toutes" : c}
            </button>
          ))}
        </div>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {list.map((s) => {
            const check = canAddSection(doc, template, s.type);
            const Icon = CATEGORY_ICONS[s.category];
            return (
              <li key={s.type}>
                <button
                  type="button"
                  disabled={!check.ok}
                  onClick={() => {
                    onAdd(s.type);
                    onClose();
                  }}
                  className="flex min-h-16 w-full items-center gap-3 rounded-[var(--radius-md)] p-3 text-left ring-1 ring-line transition-[background-color,box-shadow,transform] duration-150 hover:bg-surface-2 hover:ring-line-strong active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-55"
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-primary-soft text-primary-deep">
                    <Icon className="size-[18px]" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink">{s.name}</span>
                    <span className="block truncate text-[12px] text-ink-muted">
                      {check.ok ? `${s.category}${s.blocks?.length ? ` · ${s.blocks.length} types de blocs` : ""}` : check.reason}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {!list.length && <p className="py-6 text-center text-sm text-ink-muted">Aucune section ne correspond à « {q} ».</p>}
      </div>
  );
}
