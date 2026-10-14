"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronRight, CornerDownRight, GripVertical, IndentDecrease, IndentIncrease, ListTree, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmButton } from "@/components/ui/dialog";
import { DropdownItem, DropdownMenu, DropdownSeparator } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/misc";
import { Field, Input, Select } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";
import { createMenu, deleteMenu, saveMenu } from "@/lib/theme/actions";
import { MAX_MENU_CHILDREN, MAX_MENU_ITEMS, MENU_LINK_LABELS, MENU_LINK_TYPES, validateMenuItems, type MenuItem, type MenuLinkType } from "@/lib/theme/menu-schema";
import { useSortable } from "@/components/theme-editor/use-sortable";
import { cn } from "@/lib/utils";

type Target = { id: string; label: string };
type Targets = Record<"collection" | "product" | "page", Target[]>;
type MenuInfo = { handle: string; title: string; description: string; core: boolean; items: MenuItem[] };

const newId = () => `m-${Math.random().toString(36).slice(2, 10)}`;
const iconBtn = "grid size-11 shrink-0 place-items-center rounded-[10px] text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink sm:size-9";

export function MenusManager({ storeId, menus, initialHandle, targets }: { storeId: string; menus: MenuInfo[]; initialHandle: string; targets: Targets }) {
  const router = useRouter();
  const [handle, setHandle] = React.useState(initialHandle);
  const [drafts, setDrafts] = React.useState<Record<string, MenuItem[]>>({});
  const current = menus.find((m) => m.handle === handle) ?? menus[0];
  const items = drafts[current.handle] ?? current.items;
  const dirty = !!drafts[current.handle];

  const choose = (h: string) => {
    setHandle(h);
    router.replace(`/app/${storeId}/navigation?menu=${encodeURIComponent(h)}`, { scroll: false });
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      <div className="space-y-3">
        <ul className="space-y-1.5" aria-label="Menus">
          {menus.map((m) => {
            const count = (drafts[m.handle] ?? m.items).length;
            return (
              <li key={m.handle}>
                <button
                  type="button"
                  onClick={() => choose(m.handle)}
                  aria-current={m.handle === current.handle ? "true" : undefined}
                  className={cn(
                    "flex min-h-14 w-full items-center gap-3 rounded-[var(--radius-md)] px-3 py-2 text-left ring-1 transition-colors",
                    m.handle === current.handle ? "bg-primary-soft ring-primary/30" : "bg-surface ring-line hover:bg-surface-2",
                  )}
                >
                  <ListTree className="size-4 shrink-0 text-ink-muted" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">
                      {m.title}
                      {drafts[m.handle] && <span className="sr-only"> (modifications non enregistrées)</span>}
                    </span>
                    <span className="block text-[12px] text-ink-muted">
                      {count} élément{count > 1 ? "s" : ""}
                      {drafts[m.handle] ? " · non enregistré" : ""}
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-ink-faint" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
        <CreateMenuForm storeId={storeId} onCreated={(h) => choose(h)} />
      </div>

      <MenuEditor
        key={current.handle}
        storeId={storeId}
        menu={current}
        items={items}
        dirty={dirty}
        targets={targets}
        onChange={(next) => setDrafts((d) => ({ ...d, [current.handle]: next }))}
        onReset={() =>
          setDrafts((d) => {
            const n = { ...d };
            delete n[current.handle];
            return n;
          })
        }
        onDeleted={() => choose("main")}
      />
    </div>
  );
}

function CreateMenuForm({ storeId, onCreated }: { storeId: string; onCreated: (h: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const [value, setValue] = React.useState("");
  const [error, setError] = React.useState<string | undefined>();
  const [pending, start] = React.useTransition();
  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="w-full">
        <Plus className="size-4" aria-hidden /> Créer un menu
      </Button>
    );
  }
  return (
    <form
      className="space-y-2 rounded-[var(--radius-md)] bg-surface p-3 ring-1 ring-line"
      onSubmit={(e) => {
        e.preventDefault();
        const h = value
          .trim()
          .toLowerCase()
          .normalize("NFD")
          .replace(/[̀-ͯ]/g, "")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");
        start(async () => {
          const r = await createMenu(storeId, h);
          if (r.ok) {
            toast.success(r.message ?? "Menu créé");
            setOpen(false);
            setValue("");
            setError(undefined);
            onCreated(r.data?.handle ?? h);
          } else setError(r.fieldErrors?.handle?.[0] ?? r.error);
        });
      }}
    >
      <Field id="new-menu" label="Nom du menu" hint="Exemple : aide, informations légales." error={error}>
        {(f) => <Input {...f} fieldSize="sm" value={value} maxLength={40} onChange={(e) => setValue(e.target.value)} autoFocus />}
      </Field>
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={pending} disabled={!value.trim()}>
          Créer
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Annuler
        </Button>
      </div>
    </form>
  );
}

/* ───────────── Éditeur d'un menu ───────────── */

function MenuEditor({
  storeId,
  menu,
  items,
  dirty,
  targets,
  onChange,
  onReset,
  onDeleted,
}: {
  storeId: string;
  menu: MenuInfo;
  items: MenuItem[];
  dirty: boolean;
  targets: Targets;
  onChange: (items: MenuItem[]) => void;
  onReset: () => void;
  onDeleted: () => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<string | null>(null);
  const [live, setLive] = React.useState("");
  const [pending, start] = React.useTransition();
  const check = validateMenuItems(items);

  const labelOf = (id: string) => {
    for (const it of items) {
      if (it.id === id) return it.label || "Élément sans nom";
      const c = it.children?.find((x) => x.id === id);
      if (c) return c.label || "Élément sans nom";
    }
    return "Élément";
  };

  const moveTop = (id: string, to: number) => {
    const from = items.findIndex((x) => x.id === id);
    if (from < 0 || to < 0 || to >= items.length) return;
    const next = items.slice();
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it);
    onChange(next);
  };
  const updateItem = (id: string, patch: Partial<MenuItem>) =>
    onChange(items.map((it) => (it.id === id ? { ...it, ...patch } : { ...it, ...(it.children ? { children: it.children.map((c) => (c.id === id ? { ...c, ...patch } : c)) } : {}) })));
  const removeItem = (id: string) => {
    onChange(items.filter((it) => it.id !== id).map((it) => (it.children ? { ...it, children: it.children.filter((c) => c.id !== id) } : it)));
    setLive(`${labelOf(id)} supprimé.`);
  };
  const addItem = (parentId?: string) => {
    const it: MenuItem = { id: newId(), label: "", type: "catalog" };
    if (parentId) onChange(items.map((p) => (p.id === parentId ? { ...p, children: [...(p.children ?? []), it] } : p)));
    else onChange([...items, it]);
    setEditing(it.id);
  };
  /** Devient sous-élément de l'élément précédent (alternative clavier au glisser-déposer). */
  const indent = (id: string) => {
    const i = items.findIndex((x) => x.id === id);
    if (i <= 0 || items[i].children?.length) return;
    const parent = items[i - 1];
    if ((parent.children?.length ?? 0) >= MAX_MENU_CHILDREN) return toast.error(`${MAX_MENU_CHILDREN} sous-éléments maximum.`);
    const child: MenuItem = { ...items[i] };
    delete child.children;
    onChange(items.filter((x) => x.id !== id).map((x) => (x.id === parent.id ? { ...x, children: [...(x.children ?? []), child] } : x)));
    setLive(`${labelOf(id)} placé sous ${parent.label || "l'élément précédent"}.`);
  };
  const outdent = (parentId: string, id: string) => {
    if (items.length >= MAX_MENU_ITEMS) return toast.error(`${MAX_MENU_ITEMS} éléments maximum par menu.`);
    const pi = items.findIndex((x) => x.id === parentId);
    const child = items[pi].children!.find((c) => c.id === id)!;
    const next = items.map((x) => (x.id === parentId ? { ...x, children: x.children!.filter((c) => c.id !== id) } : x));
    next.splice(pi + 1, 0, child);
    onChange(next);
    setLive(`${labelOf(id)} remonté au premier niveau.`);
  };

  const sortable = useSortable({ ids: items.map((i) => i.id), onMove: moveTop, label: labelOf, announce: setLive });

  const save = () =>
    start(async () => {
      if (!check.ok) {
        toast.error("Menu incomplet", check.error);
        return;
      }
      const r = await saveMenu(storeId, menu.handle, JSON.stringify(check.items));
      if (r.ok) {
        toast.success(r.message ?? "Menu enregistré");
        onReset();
        setEditing(null);
        router.refresh();
      } else toast.error("Enregistrement impossible", r.error);
    });

  return (
    <Card>
      <CardHeader
        title={menu.title}
        description={menu.description}
        action={
          !menu.core ? (
            <ConfirmButton
              title={`Supprimer « ${menu.title} » ?`}
              description="Le menu et ses liens seront supprimés. Retirez-le aussi du pied de page dans l'éditeur de thème."
              confirmLabel="Supprimer"
              onConfirm={async () => {
                const r = await deleteMenu(storeId, menu.handle);
                if (r.ok) {
                  toast.success(r.message ?? "Menu supprimé");
                  onDeleted();
                  router.refresh();
                } else toast.error(r.error);
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-danger hover:bg-danger-soft"
            >
              <Trash2 className="size-4" aria-hidden /> Supprimer
            </ConfirmButton>
          ) : undefined
        }
      />
      <CardBody className="pt-3">
        <div aria-live="polite" className="sr-only">
          {live}
        </div>
        {items.length === 0 ? (
          <EmptyState icon={ListTree} title="Ce menu est vide" description="Ajoutez des liens vers vos collections, produits, pages ou une adresse web." action={<Button size="sm" onClick={() => addItem()}><Plus className="size-4" aria-hidden /> Ajouter un élément</Button>} />
        ) : (
          <>
            <p className="mb-3 text-[13px] text-ink-muted">
              Glissez la poignée pour réordonner, ou utilisez le clavier : Espace pour saisir, flèches pour déplacer. Le menu « Plus » permet de créer des sous-éléments.
            </p>
            <ul className="space-y-1.5" aria-label={`Éléments de ${menu.title}`}>
              {items.map((it, i) => (
                <li key={it.id} ref={sortable.itemRef(it.id)} style={sortable.itemStyle(it.id)} className={cn("rounded-[12px]", sortable.draggingId === it.id && "bg-surface shadow-[var(--shadow-md)]")}>
                  <ItemRow
                    item={it}
                    targets={targets}
                    editing={editing === it.id}
                    onEdit={() => setEditing(editing === it.id ? null : it.id)}
                    onChange={(patch) => updateItem(it.id, patch)}
                    handle={<button type="button" className={cn(iconBtn, "cursor-grab", sortable.grabbedId === it.id && "bg-primary-soft text-primary")} {...sortable.handleProps(it.id)}><GripVertical className="size-4" aria-hidden /></button>}
                    menu={
                      <>
                        <DropdownItem icon={ArrowUp} disabled={i === 0} onSelect={() => moveTop(it.id, i - 1)}>Monter</DropdownItem>
                        <DropdownItem icon={ArrowDown} disabled={i === items.length - 1} onSelect={() => moveTop(it.id, i + 1)}>Descendre</DropdownItem>
                        <DropdownItem icon={IndentIncrease} disabled={i === 0 || !!it.children?.length} onSelect={() => indent(it.id)}>Placer sous l&apos;élément précédent</DropdownItem>
                        <DropdownItem icon={Plus} disabled={(it.children?.length ?? 0) >= MAX_MENU_CHILDREN} onSelect={() => addItem(it.id)}>Ajouter un sous-élément</DropdownItem>
                        <DropdownSeparator />
                        <DropdownItem icon={Trash2} tone="danger" onSelect={() => removeItem(it.id)}>Supprimer{it.children?.length ? " (et ses sous-éléments)" : ""}</DropdownItem>
                      </>
                    }
                  />
                  {!!it.children?.length && (
                    <ChildList
                      parent={it}
                      targets={targets}
                      editing={editing}
                      setEditing={setEditing}
                      announce={setLive}
                      onChildren={(children) => onChange(items.map((x) => (x.id === it.id ? { ...x, children } : x)))}
                      updateItem={updateItem}
                      removeItem={removeItem}
                      outdent={(cid) => outdent(it.id, cid)}
                    />
                  )}
                </li>
              ))}
            </ul>
            <Button variant="ghost" size="sm" className="mt-2 text-primary" disabled={items.length >= MAX_MENU_ITEMS} onClick={() => addItem()}>
              <Plus className="size-4" aria-hidden /> Ajouter un élément
            </Button>
          </>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <Button onClick={save} loading={pending} disabled={!dirty} className="min-w-[140px]">
            Enregistrer
          </Button>
          <Button variant="ghost" onClick={onReset} disabled={!dirty || pending}>
            Annuler les modifications
          </Button>
          {dirty && !check.ok && <p className="text-[13px] font-medium text-danger" role="alert">{check.error}</p>}
        </div>
      </CardBody>
    </Card>
  );
}

function ChildList({
  parent,
  targets,
  editing,
  setEditing,
  announce,
  onChildren,
  updateItem,
  removeItem,
  outdent,
}: {
  parent: MenuItem;
  targets: Targets;
  editing: string | null;
  setEditing: (id: string | null) => void;
  announce: (m: string) => void;
  onChildren: (c: MenuItem[]) => void;
  updateItem: (id: string, patch: Partial<MenuItem>) => void;
  removeItem: (id: string) => void;
  outdent: (id: string) => void;
}) {
  const children = parent.children ?? [];
  const move = (id: string, to: number) => {
    const from = children.findIndex((c) => c.id === id);
    if (from < 0 || to < 0 || to >= children.length) return;
    const next = children.slice();
    const [c] = next.splice(from, 1);
    next.splice(to, 0, c);
    onChildren(next);
  };
  const sortable = useSortable({ ids: children.map((c) => c.id), onMove: move, label: (id) => children.find((c) => c.id === id)?.label || "Sous-élément", announce });
  return (
    <ul className="ml-6 mt-1.5 space-y-1.5 border-l border-line pl-3" aria-label={`Sous-éléments de ${parent.label || "l'élément"}`}>
      {children.map((c, i) => (
        <li key={c.id} ref={sortable.itemRef(c.id)} style={sortable.itemStyle(c.id)} className={cn("rounded-[12px]", sortable.draggingId === c.id && "bg-surface shadow-[var(--shadow-md)]")}>
          <ItemRow
            item={c}
            child
            targets={targets}
            editing={editing === c.id}
            onEdit={() => setEditing(editing === c.id ? null : c.id)}
            onChange={(patch) => updateItem(c.id, patch)}
            handle={<button type="button" className={cn(iconBtn, "cursor-grab", sortable.grabbedId === c.id && "bg-primary-soft text-primary")} {...sortable.handleProps(c.id)}><GripVertical className="size-4" aria-hidden /></button>}
            menu={
              <>
                <DropdownItem icon={ArrowUp} disabled={i === 0} onSelect={() => move(c.id, i - 1)}>Monter</DropdownItem>
                <DropdownItem icon={ArrowDown} disabled={i === children.length - 1} onSelect={() => move(c.id, i + 1)}>Descendre</DropdownItem>
                <DropdownItem icon={IndentDecrease} onSelect={() => outdent(c.id)}>Remonter au premier niveau</DropdownItem>
                <DropdownSeparator />
                <DropdownItem icon={Trash2} tone="danger" onSelect={() => removeItem(c.id)}>Supprimer</DropdownItem>
              </>
            }
          />
        </li>
      ))}
    </ul>
  );
}

function targetSummary(item: MenuItem, targets: Targets): string {
  if (item.type === "home" || item.type === "catalog") return MENU_LINK_LABELS[item.type];
  if (item.type === "url") return item.target || "Adresse à renseigner";
  const t = targets[item.type].find((x) => x.id === item.target);
  return t ? `${MENU_LINK_LABELS[item.type]} · ${t.label}` : `${MENU_LINK_LABELS[item.type]} à choisir`;
}

function ItemRow({
  item,
  child = false,
  targets,
  editing,
  onEdit,
  onChange,
  handle,
  menu,
}: {
  item: MenuItem;
  child?: boolean;
  targets: Targets;
  editing: boolean;
  onEdit: () => void;
  onChange: (patch: Partial<MenuItem>) => void;
  handle: React.ReactNode;
  menu: React.ReactNode;
}) {
  const formId = `item-${item.id}`;
  const incomplete = !item.label.trim() || (item.type !== "home" && item.type !== "catalog" && !item.target);
  return (
    <div className={cn("rounded-[12px] bg-surface ring-1", editing ? "ring-primary/40" : "ring-line")}>
      <div className="flex items-center gap-1 pr-1">
        {handle}
        {child && <CornerDownRight className="size-3.5 shrink-0 text-ink-faint" aria-hidden />}
        <button type="button" onClick={onEdit} aria-expanded={editing} aria-controls={formId} className="flex min-h-12 min-w-0 flex-1 flex-col justify-center py-1.5 text-left">
          <span className="truncate text-sm font-medium text-ink">{item.label || "Élément sans nom"}</span>
          <span className={cn("truncate text-[12px]", incomplete ? "text-warning" : "text-ink-muted")}>{targetSummary(item, targets)}</span>
        </button>
        <button type="button" onClick={onEdit} className={iconBtn} aria-label={editing ? `Fermer ${item.label || "l'élément"}` : `Modifier ${item.label || "l'élément"}`}>
          <Pencil className="size-4" aria-hidden />
        </button>
        <DropdownMenu label={`Actions : ${item.label || "élément"}`} trigger={(p) => <button {...p} className={iconBtn} aria-label={`Plus d'actions : ${item.label || "élément"}`}><MoreHorizontal className="size-4" aria-hidden /></button>}>
          {menu}
        </DropdownMenu>
      </div>
      {editing && (
        <div id={formId} className="grid grid-cols-1 gap-3 border-t border-line p-3 sm:grid-cols-2">
          <Field id={`${formId}-label`} label="Libellé" required>
            {(f) => <Input {...f} fieldSize="sm" maxLength={60} value={item.label} onChange={(e) => onChange({ label: e.target.value })} autoFocus={!item.label} />}
          </Field>
          <Field id={`${formId}-type`} label="Lien vers">
            {(f) => (
              <Select {...f} fieldSize="sm" value={item.type} onChange={(e) => onChange({ type: e.target.value as MenuLinkType, target: undefined })}>
                {MENU_LINK_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {MENU_LINK_LABELS[t]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {(item.type === "collection" || item.type === "product" || item.type === "page") && (
            <Field id={`${formId}-target`} label={MENU_LINK_LABELS[item.type]} className="sm:col-span-2" hint={targets[item.type].length ? undefined : `Aucune ${MENU_LINK_LABELS[item.type].toLowerCase()} pour le moment.`}>
              {(f) => (
                <Select {...f} fieldSize="sm" value={item.target ?? ""} onChange={(e) => onChange({ target: e.target.value || undefined, ...(!item.label && e.target.value ? { label: targets[item.type as "page"].find((x) => x.id === e.target.value)?.label.slice(0, 60) ?? "" } : {}) })}>
                  <option value="">Choisir…</option>
                  {targets[item.type as "collection" | "product" | "page"].map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          {item.type === "url" && (
            <Field id={`${formId}-url`} label="Adresse" className="sm:col-span-2" hint="Adresse https (https://…) ou chemin de la boutique (/catalogue).">
              {(f) => <Input {...f} fieldSize="sm" inputMode="url" placeholder="https://" value={item.target ?? ""} onChange={(e) => onChange({ target: e.target.value.trim() || undefined })} />}
            </Field>
          )}
        </div>
      )}
    </div>
  );
}
