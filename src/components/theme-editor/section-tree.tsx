"use client";

import * as React from "react";
import { AlertCircle, ArrowDown, ArrowUp, ChevronRight, Copy, Eye, EyeOff, GripVertical, Lock, MoreHorizontal, PanelBottom, PanelTop, Plus, Trash2, Users } from "lucide-react";
import { SECTION_SCHEMAS } from "@/lib/theme-engine/schemas";
import { canAddBlock, isRequiredSection } from "@/lib/theme-engine/operations";
import type { BlockInstance, SectionInstance, TemplateId, ThemeDocument } from "@/lib/theme-engine/types";
import { DropdownItem, DropdownLabel, DropdownMenu, DropdownSeparator } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useSortable } from "./use-sortable";
import type { Selection } from "./types";

export type TreeActions = {
  select: (s: Selection) => void;
  moveSection: (id: string, to: number) => void;
  toggleSection: (id: string) => void;
  duplicateSection: (id: string) => void;
  removeSection: (id: string) => void;
  addBlock: (sectionId: string, type: string) => void;
  moveBlock: (sectionId: string, blockId: string, to: number) => void;
  toggleBlock: (sectionId: string, blockId: string) => void;
  duplicateBlock: (sectionId: string, blockId: string) => void;
  removeBlock: (sectionId: string, blockId: string) => void;
  openAddSection: (index?: number) => void;
};

const iconBtn =
  "grid size-11 shrink-0 place-items-center rounded-[10px] text-ink-muted transition-[background-color,color,opacity] duration-150 hover:bg-surface-2 hover:text-ink sm:size-8";
const revealOnHover = "opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 [@media(hover:none)]:opacity-100";

/** Libellé lisible d'une section : nom du schéma + titre saisi s'il existe. */
export function sectionLabel(s: SectionInstance): { name: string; detail: string } {
  const schema = SECTION_SCHEMAS[s.type];
  const heading = typeof s.settings.heading === "string" ? s.settings.heading : "";
  const firstBlockText = s.blocks.find((b) => typeof b.settings.text === "string" && b.settings.text)?.settings.text;
  return { name: schema?.name ?? s.type, detail: heading || (typeof firstBlockText === "string" ? firstBlockText : "") };
}

function blockLabel(section: SectionInstance, b: BlockInstance): { name: string; detail: string } {
  const bs = SECTION_SCHEMAS[section.type]?.blocks?.find((x) => x.type === b.type);
  const pick = ["text", "title", "heading", "question", "author", "button_label", "caption"].map((k) => b.settings[k]).find((v) => typeof v === "string" && v);
  return { name: bs?.name ?? b.type, detail: typeof pick === "string" ? pick.replace(/[*_[\]()#]/g, "").slice(0, 60) : "" };
}

export function SectionTree({
  doc,
  template,
  selection,
  errors,
  actions,
  announce,
}: {
  doc: ThemeDocument;
  template: TemplateId;
  selection: Selection;
  errors: Record<string, string>;
  actions: TreeActions;
  announce: (m: string) => void;
}) {
  const t = doc.templates[template];
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set());
  const ids = t.order;
  const sortable = useSortable({
    ids,
    onMove: actions.moveSection,
    label: (id) => sectionLabel(t.sections[id]).name,
    announce,
  });

  // Dépli automatique de la section dont un bloc est sélectionné.
  const selectedSection = selection?.kind === "block" ? selection.sectionId : null;
  if (selectedSection && !expanded.has(selectedSection)) setExpanded(new Set(expanded).add(selectedSection));

  const errorIn = (sid: string) => Object.keys(errors).some((k) => k === `section:${sid}` || k.startsWith(`section:${sid}:`) || k.startsWith(`block:${sid}:`));
  const isSel = (s: Selection) => JSON.stringify(s) === JSON.stringify(selection);

  return (
    <nav aria-label="Sections de la page" className="p-2">
      <PinnedRow icon={PanelTop} label="En-tête" active={isSel({ kind: "global", group: "header" })} onClick={() => actions.select({ kind: "global", group: "header" })} />
      <ul className="mt-1 space-y-0.5" aria-label="Sections, dans l'ordre d'affichage">
        {ids.map((id, index) => {
          const s = t.sections[id];
          if (!s) return null;
          const schema = SECTION_SCHEMAS[s.type];
          const { name, detail } = sectionLabel(s);
          const required = isRequiredSection(s);
          const hasBlocks = !!schema?.blocks?.length;
          const open = expanded.has(id);
          const active = selection?.kind === "section" && selection.id === id;
          return (
            <li key={id} ref={sortable.itemRef(id)} style={sortable.itemStyle(id)} className={cn("rounded-[12px]", sortable.draggingId === id && "bg-surface shadow-[var(--shadow-md)] ring-1 ring-line")}>
              <div className={cn("group flex items-center gap-0.5 rounded-[12px] pr-1", active ? "bg-primary-soft" : "hover:bg-surface-2", sortable.grabbedId === id && "ring-2 ring-primary")}>
                <button type="button" className={cn(iconBtn, "cursor-grab active:cursor-grabbing")} {...sortable.handleProps(id)}>
                  <GripVertical className="size-4" aria-hidden />
                </button>
                {hasBlocks ? (
                  <button
                    type="button"
                    className={iconBtn}
                    aria-expanded={open}
                    aria-label={open ? `Replier les blocs de ${name}` : `Déplier les blocs de ${name}`}
                    onClick={() => {
                      const next = new Set(expanded);
                      if (open) next.delete(id);
                      else next.add(id);
                      setExpanded(next);
                    }}
                  >
                    <ChevronRight className={cn("size-4 transition-transform duration-200 ease-out", open && "rotate-90")} aria-hidden />
                  </button>
                ) : (
                  <span className="size-11 shrink-0 sm:size-8" aria-hidden />
                )}
                <button
                  type="button"
                  onClick={() => actions.select({ kind: "section", id })}
                  aria-current={active ? "true" : undefined}
                  className={cn("flex min-h-11 min-w-0 flex-1 flex-col justify-center py-1 text-left sm:min-h-10", s.disabled && "opacity-55")}
                >
                  <span className="flex items-center gap-1.5 truncate text-[13.5px] font-medium text-ink">
                    <span className="truncate">{name}</span>
                    {required && <Lock className="size-3 shrink-0 text-ink-faint" aria-label="obligatoire" />}
                    {s.disabled && <EyeOff className="size-3 shrink-0 text-ink-faint" aria-label="masquée" />}
                    {!!s.visibility?.rules.length && <Users className="size-3 shrink-0 text-primary" aria-label="visible selon l'audience" />}
                    {errorIn(id) && <AlertCircle className="size-3.5 shrink-0 text-danger" aria-label="à corriger" />}
                  </span>
                  {detail && <span className="truncate text-[12px] text-ink-muted">{detail}</span>}
                </button>
                {!required && (
                  <button type="button" className={cn(iconBtn, revealOnHover)} onClick={() => actions.toggleSection(id)} aria-label={s.disabled ? `Afficher ${name}` : `Masquer ${name}`}>
                    {s.disabled ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                  </button>
                )}
                <DropdownMenu
                  label={`Actions : ${name}`}
                  trigger={(p) => (
                    <button {...p} className={cn(iconBtn, revealOnHover, "aria-expanded:opacity-100")} aria-label={`Plus d'actions : ${name}`}>
                      <MoreHorizontal className="size-4" aria-hidden />
                    </button>
                  )}
                >
                  <DropdownItem icon={ArrowUp} disabled={index === 0} onSelect={() => actions.moveSection(id, index - 1)}>
                    Monter
                  </DropdownItem>
                  <DropdownItem icon={ArrowDown} disabled={index === ids.length - 1} onSelect={() => actions.moveSection(id, index + 1)}>
                    Descendre
                  </DropdownItem>
                  <DropdownItem icon={Plus} onSelect={() => actions.openAddSection(index + 1)}>
                    Ajouter une section en dessous
                  </DropdownItem>
                  {!required && (
                    <>
                      <DropdownItem icon={Copy} onSelect={() => actions.duplicateSection(id)}>
                        Dupliquer
                      </DropdownItem>
                      <DropdownSeparator />
                      <DropdownItem icon={Trash2} tone="danger" onSelect={() => actions.removeSection(id)}>
                        Supprimer
                      </DropdownItem>
                    </>
                  )}
                </DropdownMenu>
              </div>
              {hasBlocks && open && <BlockList section={s} selection={selection} errors={errors} actions={actions} announce={announce} />}
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={() => actions.openAddSection()}
        className="mt-1 flex min-h-11 w-full items-center gap-2 rounded-[12px] px-3 text-[13.5px] font-medium text-primary transition-colors hover:bg-primary-soft sm:min-h-10"
      >
        <Plus className="size-4" aria-hidden /> Ajouter une section
      </button>
      <div className="mt-1 border-t border-line pt-1">
        <PinnedRow icon={PanelBottom} label="Pied de page" active={isSel({ kind: "global", group: "footer" })} onClick={() => actions.select({ kind: "global", group: "footer" })} />
      </div>
    </nav>
  );
}

function PinnedRow({ icon: Icon, label, active, onClick }: { icon: typeof PanelTop; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={cn("flex min-h-11 w-full items-center gap-2.5 rounded-[12px] px-3 text-left text-[13.5px] font-medium text-ink transition-colors sm:min-h-10", active ? "bg-primary-soft" : "hover:bg-surface-2")}
    >
      <Icon className="size-4 text-ink-muted" aria-hidden />
      {label}
    </button>
  );
}

function BlockList({ section, selection, errors, actions, announce }: { section: SectionInstance; selection: Selection; errors: Record<string, string>; actions: TreeActions; announce: (m: string) => void }) {
  const schema = SECTION_SCHEMAS[section.type];
  const ids = section.blocks.map((b) => b.id);
  const byId = new Map(section.blocks.map((b) => [b.id, b]));
  const sortable = useSortable({
    ids,
    onMove: (bid, to) => actions.moveBlock(section.id, bid, to),
    label: (bid) => blockLabel(section, byId.get(bid)!).name,
    announce,
  });
  const full = schema.maxBlocks != null && section.blocks.length >= schema.maxBlocks;

  return (
    <div className="pb-1 pl-6">
      <ul className="space-y-0.5 border-l border-line pl-1.5" aria-label={`Blocs de ${schema.name}`}>
        {section.blocks.map((b, i) => {
          const { name, detail } = blockLabel(section, b);
          const active = selection?.kind === "block" && selection.blockId === b.id;
          const hasError = Object.keys(errors).some((k) => k.startsWith(`block:${section.id}:${i}:`));
          return (
            <li key={b.id} ref={sortable.itemRef(b.id)} style={sortable.itemStyle(b.id)} className={cn("rounded-[10px]", sortable.draggingId === b.id && "bg-surface shadow-[var(--shadow-md)] ring-1 ring-line")}>
              <div className={cn("group flex items-center gap-0.5 rounded-[10px] pr-1", active ? "bg-primary-soft" : "hover:bg-surface-2", sortable.grabbedId === b.id && "ring-2 ring-primary")}>
                <button type="button" className={cn(iconBtn, "cursor-grab active:cursor-grabbing")} {...sortable.handleProps(b.id)}>
                  <GripVertical className="size-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => actions.select({ kind: "block", sectionId: section.id, blockId: b.id })}
                  aria-current={active ? "true" : undefined}
                  className={cn("flex min-h-11 min-w-0 flex-1 items-center gap-1.5 text-left text-[13px] sm:min-h-9", b.disabled && "opacity-55")}
                >
                  <span className="shrink-0 font-medium text-ink">{name}</span>
                  {detail && <span className="truncate text-ink-muted">{detail}</span>}
                  {b.disabled && <EyeOff className="size-3 shrink-0 text-ink-faint" aria-label="masqué" />}
                  {hasError && <AlertCircle className="size-3.5 shrink-0 text-danger" aria-label="à corriger" />}
                </button>
                <button type="button" className={cn(iconBtn, revealOnHover)} onClick={() => actions.toggleBlock(section.id, b.id)} aria-label={b.disabled ? `Afficher le bloc ${name}` : `Masquer le bloc ${name}`}>
                  {b.disabled ? <EyeOff className="size-3.5" aria-hidden /> : <Eye className="size-3.5" aria-hidden />}
                </button>
                <DropdownMenu
                  label={`Actions : bloc ${name}`}
                  trigger={(p) => (
                    <button {...p} className={cn(iconBtn, revealOnHover, "aria-expanded:opacity-100")} aria-label={`Plus d'actions : bloc ${name}`}>
                      <MoreHorizontal className="size-3.5" aria-hidden />
                    </button>
                  )}
                >
                  <DropdownItem icon={ArrowUp} disabled={i === 0} onSelect={() => actions.moveBlock(section.id, b.id, i - 1)}>
                    Monter
                  </DropdownItem>
                  <DropdownItem icon={ArrowDown} disabled={i === ids.length - 1} onSelect={() => actions.moveBlock(section.id, b.id, i + 1)}>
                    Descendre
                  </DropdownItem>
                  <DropdownItem icon={Copy} disabled={!canAddBlock(section, b.type).ok} onSelect={() => actions.duplicateBlock(section.id, b.id)}>
                    Dupliquer
                  </DropdownItem>
                  <DropdownSeparator />
                  <DropdownItem icon={Trash2} tone="danger" onSelect={() => actions.removeBlock(section.id, b.id)}>
                    Supprimer
                  </DropdownItem>
                </DropdownMenu>
              </div>
            </li>
          );
        })}
      </ul>
      <DropdownMenu
        align="start"
        label={`Ajouter un bloc à ${schema.name}`}
        className="max-h-80 overflow-y-auto"
        trigger={(p) => (
          <button {...p} disabled={full} className="mt-0.5 flex min-h-11 items-center gap-2 rounded-[10px] px-3 text-[13px] font-medium text-primary transition-colors hover:bg-primary-soft disabled:opacity-50 sm:min-h-9">
            <Plus className="size-3.5" aria-hidden /> {full ? `Maximum ${schema.maxBlocks} blocs` : "Ajouter un bloc"}
          </button>
        )}
      >
        <DropdownLabel>Type de bloc</DropdownLabel>
        {schema.blocks!.map((bs) => {
          const check = canAddBlock(section, bs.type);
          return (
            <DropdownItem key={bs.type} disabled={!check.ok} hint={!check.ok && bs.limit ? `${bs.limit} max` : undefined} onSelect={() => actions.addBlock(section.id, bs.type)}>
              {bs.name}
            </DropdownItem>
          );
        })}
      </DropdownMenu>
    </div>
  );
}
