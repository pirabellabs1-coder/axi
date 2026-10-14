"use client";

import * as React from "react";
import { Layers, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import type { AlternateTemplateType, ThemeDocument } from "@/lib/theme-engine/types";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Select, FieldError, Hint } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { ALTERNATE_TYPE_LABELS, alternateSuffixes, canCreateAlternate, checkSuffix, suffixFromName, type AlternateLimit } from "./editor-target";
import type { AlternateOwner } from "./types";

const OWNER_NOUN: Record<AlternateTemplateType, [string, string]> = {
  product: ["produit", "produits"],
  collection: ["collection", "collections"],
  page: ["page", "pages"],
  article: ["article", "articles"],
};

export function ownersCountLabel(type: AlternateTemplateType, n: number): string {
  if (!n) return "Aucun élément ne l'utilise";
  const [one, many] = OWNER_NOUN[type];
  return `Utilisé par ${n} ${n > 1 ? many : one}`;
}

/** Bouton « Modèles » de la barre du haut + fenêtre de gestion des modèles alternatifs d'un type. */
export function AlternateManager({
  doc,
  type,
  current,
  owners,
  limit,
  storeId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  triggerClassName,
}: {
  doc: ThemeDocument;
  type: AlternateTemplateType;
  current: string | null;
  owners: AlternateOwner[];
  limit: AlternateLimit;
  storeId: string;
  onSelect: (suffix: string | null) => void;
  onCreate: (suffix: string, from: string | null) => boolean;
  onRename: (from: string, to: string) => Promise<string | null>;
  onDelete: (suffix: string) => Promise<boolean>;
  triggerClassName?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [from, setFrom] = React.useState<string>(current ?? "");
  const [createError, setCreateError] = React.useState<string | null>(null);
  const [renaming, setRenaming] = React.useState<string | null>(null);
  const [renameText, setRenameText] = React.useState("");
  const [renameError, setRenameError] = React.useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const suffixes = alternateSuffixes(doc, type);
  const typeLabel = ALTERNATE_TYPE_LABELS[type];
  const allowed = canCreateAlternate(doc, type, limit);
  const ownersOf = (s: string) => owners.filter((o) => o.type === type && o.suffix === s);
  const preview = suffixFromName(name);

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    const bad = checkSuffix(doc, type, preview);
    if (bad) {
      setCreateError(bad);
      return;
    }
    if (onCreate(preview, from || null)) {
      setName("");
      setCreateError(null);
      setOpen(false);
    }
  };

  const doRename = async (s: string) => {
    const to = suffixFromName(renameText);
    if (to === s) {
      setRenaming(null);
      return;
    }
    const bad = checkSuffix(doc, type, to);
    if (bad) {
      setRenameError(bad);
      return;
    }
    setBusy(true);
    const err = await onRename(s, to);
    setBusy(false);
    if (err) setRenameError(err);
    else {
      setRenaming(null);
      setRenameError(null);
    }
  };

  const deleting = confirmDelete ? ownersOf(confirmDelete) : [];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`Modèles ${typeLabel.toLowerCase()} : gérer les modèles alternatifs`}
        title="Modèles alternatifs"
        className={triggerClassName}
      >
        <Layers className="size-4" aria-hidden />
        {suffixes.length > 0 && <span className="tabular text-[12px] font-medium">{suffixes.length + 1}</span>}
      </button>

      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          setRenaming(null);
        }}
        title={`Modèles de page · ${typeLabel}`}
        description={`Créez des variantes de la page ${typeLabel.toLowerCase()} (ex. « luxe » pour vos pièces haut de gamme). Chaque ${OWNER_NOUN[type][0]} choisit son modèle dans sa fiche.`}
        size="md"
      >
        <div className="space-y-5">
          <ul className="space-y-1.5" aria-label="Modèles existants">
            <li>
              <TemplateRow active={!current} title={`${typeLabel} (par défaut)`} detail="Utilisé par tous les éléments sans modèle choisi" onOpen={() => (onSelect(null), setOpen(false))} />
            </li>
            {suffixes.map((s) => {
              const n = ownersOf(s).length;
              return (
                <li key={s}>
                  {renaming === s ? (
                    <form
                      className="rounded-[var(--radius-md)] p-3 ring-2 ring-primary"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void doRename(s);
                      }}
                    >
                      <Label htmlFor={`rename-${s}`}>Nouveau nom</Label>
                      <Input id={`rename-${s}`} fieldSize="sm" autoFocus value={renameText} maxLength={40} onChange={(e) => (setRenameText(e.target.value), setRenameError(null))} invalid={!!renameError} aria-describedby={`rename-${s}-help`} />
                      {renameError ? (
                        <FieldError id={`rename-${s}-help`}>{renameError}</FieldError>
                      ) : (
                        <Hint id={`rename-${s}-help`}>
                          Identifiant : <span className="font-mono">{suffixFromName(renameText) || "…"}</span>. {n ? `Les ${n} ${OWNER_NOUN[type][n > 1 ? 1 : 0]} qui l'utilisent suivent le nouveau nom.` : ""}
                        </Hint>
                      )}
                      <div className="mt-2 flex justify-end gap-1.5">
                        <button type="button" onClick={() => setRenaming(null)} className="h-11 rounded-full px-4 text-[13px] font-medium text-ink hover:bg-surface-2 sm:h-9">
                          Annuler
                        </button>
                        <button type="submit" disabled={busy} aria-busy={busy || undefined} className="h-11 rounded-full bg-primary px-4 text-[13px] font-medium text-on-primary hover:bg-primary-hover disabled:opacity-60 sm:h-9">
                          {busy ? "Renommage…" : "Renommer"}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <TemplateRow
                      active={current === s}
                      title={`${typeLabel} · ${s}`}
                      detail={ownersCountLabel(type, n)}
                      onOpen={() => (onSelect(s), setOpen(false))}
                      actions={
                        <>
                          <button
                            type="button"
                            onClick={() => (setRenaming(s), setRenameText(s), setRenameError(null))}
                            aria-label={`Renommer le modèle « ${s} »`}
                            className="grid size-11 place-items-center rounded-full text-ink-muted hover:bg-surface-2 hover:text-ink sm:size-9"
                          >
                            <Pencil className="size-4" aria-hidden />
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDelete(s)}
                            aria-label={`Supprimer le modèle « ${s} »`}
                            className="grid size-11 place-items-center rounded-full text-ink-muted hover:bg-danger-soft hover:text-danger sm:size-9"
                          >
                            <Trash2 className="size-4" aria-hidden />
                          </button>
                        </>
                      }
                    />
                  )}
                </li>
              );
            })}
          </ul>

          {allowed.ok ? (
            <form onSubmit={create} className="space-y-3 rounded-[var(--radius-md)] bg-surface-2 p-3">
              <h3 className="text-sm font-semibold text-ink">Nouveau modèle</h3>
              <div>
                <Label htmlFor="alt-name">Nom</Label>
                <Input id="alt-name" fieldSize="sm" placeholder="Ex. Luxe" value={name} maxLength={40} onChange={(e) => (setName(e.target.value), setCreateError(null))} invalid={!!createError} aria-describedby="alt-name-help" />
                {createError ? (
                  <FieldError id="alt-name-help">{createError}</FieldError>
                ) : (
                  <Hint id="alt-name-help">
                    Identifiant : <span className="font-mono">{preview || "…"}</span>
                  </Hint>
                )}
              </div>
              <div>
                <Label htmlFor="alt-from">Partir de</Label>
                <Select id="alt-from" fieldSize="sm" value={from} onChange={(e) => setFrom(e.target.value)}>
                  <option value="">{typeLabel} (par défaut)</option>
                  {suffixes.map((s) => (
                    <option key={s} value={s}>
                      {typeLabel} · {s}
                    </option>
                  ))}
                </Select>
              </div>
              <button type="submit" className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-primary px-4 text-sm font-medium text-on-primary transition-[background-color,transform] duration-150 hover:bg-primary-hover active:scale-[0.98] sm:h-10">
                <Plus className="size-4" aria-hidden /> Créer par duplication
              </button>
            </form>
          ) : (
            <p className="flex items-start gap-2 rounded-[var(--radius-md)] bg-surface-2 p-3 text-[13px] leading-relaxed text-ink-muted">
              <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                {allowed.reason}{" "}
                <a href={`/app/${storeId}/abonnement`} className="font-medium text-primary underline-offset-4 hover:underline">
                  Voir les plans
                </a>
              </span>
            </p>
          )}
        </div>
      </Dialog>

      <Dialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        size="sm"
        title={`Supprimer « ${typeLabel} · ${confirmDelete ?? ""} » ?`}
        description="Le modèle est supprimé du brouillon et de la boutique en ligne. Cette action ne peut pas être annulée."
        footer={
          <>
            <button type="button" onClick={() => setConfirmDelete(null)} className="h-10 rounded-full px-4 text-sm font-medium text-ink hover:bg-surface-2">
              Garder le modèle
            </button>
            <button
              type="button"
              disabled={busy}
              aria-busy={busy || undefined}
              onClick={async () => {
                if (!confirmDelete) return;
                setBusy(true);
                const ok = await onDelete(confirmDelete);
                setBusy(false);
                if (ok) setConfirmDelete(null);
              }}
              className="h-10 rounded-full bg-danger px-4 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
            >
              {busy ? "Suppression…" : "Supprimer"}
            </button>
          </>
        }
      >
        {deleting.length ? (
          <div className="rounded-[var(--radius-md)] bg-warning-soft p-3 text-[13px] leading-relaxed text-ink">
            <p className="font-medium">
              {deleting.length} {OWNER_NOUN[type][deleting.length > 1 ? 1 : 0]} {deleting.length > 1 ? "utilisent" : "utilise"} ce modèle et {deleting.length > 1 ? "retrouveront" : "retrouvera"} le modèle par défaut :
            </p>
            <ul className="mt-1 list-disc pl-5">
              {deleting.slice(0, 5).map((o) => (
                <li key={o.path} className="truncate">
                  {o.name}
                </li>
              ))}
              {deleting.length > 5 && <li>et {deleting.length - 5} autre{deleting.length - 5 > 1 ? "s" : ""}</li>}
            </ul>
          </div>
        ) : (
          <p className="text-[13px] text-ink-muted">Aucun élément n&apos;utilise ce modèle.</p>
        )}
      </Dialog>
    </>
  );
}

function TemplateRow({ active, title, detail, onOpen, actions }: { active: boolean; title: string; detail: string; onOpen: () => void; actions?: React.ReactNode }) {
  return (
    <div className={cn("flex items-center gap-1 rounded-[var(--radius-md)] pr-1 ring-1 transition-colors", active ? "bg-primary-soft ring-2 ring-primary" : "ring-line hover:bg-surface-2")}>
      <button type="button" onClick={onOpen} aria-current={active ? "true" : undefined} className="flex min-h-12 min-w-0 flex-1 flex-col justify-center rounded-[var(--radius-md)] px-3 py-2 text-left">
        <span className="truncate text-sm font-medium text-ink">{title}</span>
        <span className="truncate text-[12px] text-ink-muted">{active ? `En cours de modification · ${detail}` : detail}</span>
      </button>
      {actions}
    </div>
  );
}
