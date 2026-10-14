"use client";

import * as React from "react";
import { Bookmark, BookmarkPlus, Crown, LayoutTemplate, Loader2, Lock, Trash2 } from "lucide-react";
import { SECTION_SCHEMAS, sectionsForTemplate } from "@/lib/theme-engine/schemas";
import { canAddSection } from "@/lib/theme-engine/operations";
import type { SectionType, TemplateId, ThemeDocument } from "@/lib/theme-engine/types";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, FieldError, Hint } from "@/components/ui/field";
import { cn, formatDate } from "@/lib/utils";
import type { EditorLibraryItem, EditorSavedSection } from "./types";

export type SavedSectionsProps = {
  items: EditorSavedSection[];
  library: EditorLibraryItem[];
  storeId: string;
  /** 0 = non inclus ; null = illimité. */
  savedLimit: number | null;
  onInsertSaved: (item: EditorSavedSection) => Promise<boolean>;
  onDeleteSaved: (item: EditorSavedSection) => Promise<void>;
  onInsertLibrary: (item: EditorLibraryItem) => Promise<boolean>;
};

type ListProps = SavedSectionsProps & { doc: ThemeDocument; template: TemplateId; onDone: () => void };

function availability(doc: ThemeDocument, template: TemplateId, type: string): { ok: true } | { ok: false; reason: string } {
  if (!(type in SECTION_SCHEMAS)) return { ok: false, reason: "Type de section indisponible." };
  if (!sectionsForTemplate(template).some((s) => s.type === type)) return { ok: false, reason: "Non disponible sur ce modèle de page." };
  return canAddSection(doc, template, type as SectionType);
}

function Upsell({ storeId, children }: { storeId: string; children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-[var(--radius-md)] bg-surface-2 p-3 text-[13px] leading-relaxed text-ink-muted">
      <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>
        {children}{" "}
        <a href={`/app/${storeId}/abonnement`} className="font-medium text-primary underline-offset-4 hover:underline">
          Voir les plans
        </a>
      </span>
    </p>
  );
}

/** Onglet « Mes sections ». */
export function SavedSectionList({ items, storeId, savedLimit, doc, template, onInsertSaved, onDeleteSaved, onDone }: ListProps) {
  const [deleting, setDeleting] = React.useState<string | null>(null);
  const [inserting, setInserting] = React.useState<string | null>(null);
  if (savedLimit === 0 && !items.length) {
    return <Upsell storeId={storeId}>Enregistrez vos sections réussies pour les réutiliser sur d&apos;autres pages. Inclus à partir du plan Starter.</Upsell>;
  }
  if (!items.length) {
    return (
      <div className="grid place-items-center gap-2 py-10 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-primary-soft text-primary-deep">
          <Bookmark className="size-5" aria-hidden />
        </span>
        <p className="text-sm font-medium text-ink">Aucune section enregistrée</p>
        <p className="max-w-[320px] text-[13px] leading-relaxed text-ink-muted">
          Sélectionnez une section puis cliquez sur <BookmarkPlus className="inline size-3.5 align-[-2px]" aria-label="Enregistrer cette section" /> pour la retrouver ici.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {savedLimit != null && savedLimit > 0 && (
        <p className="tabular text-[12.5px] text-ink-muted">
          {items.length} / {savedLimit} sections enregistrées
        </p>
      )}
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {items.map((it) => {
          const check = availability(doc, template, it.sectionType);
          const schemaName = it.sectionName;
          return (
            <li key={it.id} className="flex items-stretch gap-1 rounded-[var(--radius-md)] ring-1 ring-line">
              <button
                type="button"
                disabled={!check.ok || inserting === it.id}
                aria-busy={inserting === it.id || undefined}
                onClick={async () => {
                  setInserting(it.id);
                  try {
                    if (await onInsertSaved(it)) onDone();
                  } finally {
                    setInserting(null);
                  }
                }}
                className="flex min-h-16 min-w-0 flex-1 items-center gap-3 rounded-[var(--radius-md)] p-3 text-left transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-55"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-primary-soft text-primary-deep">
                  <Bookmark className="size-[18px]" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink">{it.name}</span>
                  <span className="block truncate text-[12px] text-ink-muted">{check.ok ? `${schemaName} · ${formatDate(it.createdAt)}` : check.reason}</span>
                </span>
              </button>
              <button
                type="button"
                disabled={deleting === it.id}
                onClick={async () => {
                  setDeleting(it.id);
                  try {
                    await onDeleteSaved(it);
                  } finally {
                    setDeleting(null);
                  }
                }}
                aria-label={`Supprimer « ${it.name} » de mes sections`}
                className="grid w-11 shrink-0 place-items-center rounded-r-[var(--radius-md)] text-ink-muted hover:bg-danger-soft hover:text-danger"
              >
                {deleting === it.id ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Trash2 className="size-4" aria-hidden />}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Onglet « Bibliothèque » (compositions Axi ; éléments premium contrôlés par plan côté serveur). */
export function LibraryList({ library, storeId, doc, template, onInsertLibrary, onDone }: ListProps) {
  const [pending, setPending] = React.useState<string | null>(null);
  const usable = library.filter((it) => sectionsForTemplate(template).some((s) => s.type === it.sectionType));
  if (!usable.length) {
    return (
      <div className="grid place-items-center gap-2 py-10 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-surface-2 text-ink-muted">
          <LayoutTemplate className="size-5" aria-hidden />
        </span>
        <p className="text-sm font-medium text-ink">{library.length ? "Rien pour ce modèle de page" : "La bibliothèque arrive bientôt"}</p>
        <p className="max-w-[320px] text-[13px] leading-relaxed text-ink-muted">
          {library.length ? "Les compositions de la bibliothèque sont disponibles sur d'autres pages (accueil, produit…)." : "Des compositions prêtes à l'emploi, conçues par Axi, apparaîtront ici."}
        </p>
      </div>
    );
  }
  const groups = new Map<string, EditorLibraryItem[]>();
  for (const it of usable) groups.set(it.category, [...(groups.get(it.category) ?? []), it]);
  return (
    <div className="space-y-5">
      {[...groups.entries()].map(([cat, items]) => (
        <section key={cat} aria-label={cat}>
          <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-faint">{cat}</h3>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {items.map((it) => {
              const check = availability(doc, template, it.sectionType);
              const busy = pending === it.id;
              return (
                <li key={it.id}>
                  <button
                    type="button"
                    disabled={!check.ok || busy}
                    aria-describedby={it.locked ? `lib-${it.id}-lock` : undefined}
                    onClick={async () => {
                      setPending(it.id);
                      try {
                        if (await onInsertLibrary(it)) onDone();
                      } finally {
                        setPending(null);
                      }
                    }}
                    className={cn(
                      "group flex w-full flex-col overflow-hidden rounded-[var(--radius-lg)] text-left ring-1 ring-line transition-[box-shadow,transform] duration-200 hover:ring-line-strong active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-55",
                      it.locked && "bg-surface-2",
                    )}
                  >
                    <span className="relative block aspect-[16/9] w-full overflow-hidden bg-surface-2">
                      {it.previewUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={it.previewUrl} alt="" width={640} height={360} loading="lazy" decoding="async" className="size-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.02] motion-reduce:transition-none" />
                      ) : (
                        <span className="grid size-full place-items-center text-ink-faint">
                          <LayoutTemplate className="size-6" aria-hidden />
                        </span>
                      )}
                      {it.premium && (
                        <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-forest px-2 py-0.5 text-[11px] font-semibold text-lime">
                          <Crown className="size-3" aria-hidden /> Premium
                        </span>
                      )}
                      {busy && (
                        <span className="absolute inset-0 grid place-items-center bg-surface/60">
                          <Loader2 className="size-5 animate-spin text-ink" aria-label="Insertion en cours" />
                        </span>
                      )}
                    </span>
                    <span className="block p-3">
                      <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
                        <span className="truncate">{it.name}</span>
                        {it.locked && <Lock className="size-3.5 shrink-0 text-ink-faint" aria-hidden />}
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-[12px] leading-relaxed text-ink-muted">{check.ok ? (it.description ?? SECTION_SCHEMAS[it.sectionType as SectionType]?.name) : check.reason}</span>
                      {it.locked && (
                        <span id={`lib-${it.id}-lock`} className="mt-1 block text-[12px] font-medium text-primary">
                          {it.lockReason ?? `Inclus à partir du plan ${it.requiredPlanName}`}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {usable.some((x) => x.locked) && <Upsell storeId={storeId}>Les sections premium sont incluses à partir du plan Business.</Upsell>}
    </div>
  );
}

/** Fenêtre « Enregistrer cette section ». `onSave` renvoie un message d'erreur ou null. */
export function SaveSectionDialog({
  open,
  onClose,
  defaultName,
  sectionName,
  limitReached,
  storeId,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  defaultName: string;
  sectionName: string;
  limitReached: string | null;
  storeId: string;
  onSave: (name: string) => Promise<string | null>;
}) {
  const [name, setName] = React.useState(defaultName);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [last, setLast] = React.useState(defaultName);
  if (defaultName !== last) {
    setLast(defaultName);
    setName(defaultName);
    setError(null);
  }
  return (
    <Dialog open={open} onClose={onClose} size="sm" title="Enregistrer cette section" description={`« ${sectionName} » et ses blocs seront disponibles dans « Ajouter une section », onglet « Mes sections », sur toutes les pages compatibles.`}>
      {limitReached ? (
        <Upsell storeId={storeId}>{limitReached}</Upsell>
      ) : (
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const n = name.trim();
            if (n.length < 2) {
              setError("Nom : 2 caractères minimum.");
              return;
            }
            setPending(true);
            const err = await onSave(n).catch(() => "Connexion perdue. Réessayez.");
            setPending(false);
            if (err) setError(err);
            else onClose();
          }}
        >
          <div>
            <Label htmlFor="saved-section-name">Nom</Label>
            <Input id="saved-section-name" fieldSize="sm" autoFocus maxLength={60} value={name} onChange={(e) => (setName(e.target.value), setError(null))} invalid={!!error} aria-describedby="saved-section-name-help" />
            {error ? <FieldError id="saved-section-name-help">{error}</FieldError> : <Hint id="saved-section-name-help">Un nom unique dans votre boutique, ex. « Bannière Tabaski ».</Hint>}
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="h-11 rounded-full px-4 text-sm font-medium text-ink hover:bg-surface-2 sm:h-10">
              Annuler
            </button>
            <button type="submit" disabled={pending} aria-busy={pending || undefined} className="inline-flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-medium text-on-primary hover:bg-primary-hover disabled:opacity-60 sm:h-10">
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Enregistrer
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
