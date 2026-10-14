"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, FolderTree, Pencil, Trash2, X } from "lucide-react";
import { saveCategory, deleteCategory, moveCategory } from "@/lib/blog/actions";
import { BLOG_CATEGORY_DESCRIPTION_MAX, BLOG_CATEGORY_NAME_MAX } from "@/lib/blog/constants";
import { blogSlugify } from "@/lib/blog/slug";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";
import { FormMessage, fieldError } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { ActionButton, ConfirmActionButton } from "@/components/app/action-controls";

type Cat = { id: string; name: string; slug: string; description: string | null; posts: number };

export function CategoryManager({ storeId, storeSlug, categories }: { storeId: string; storeSlug: string; categories: Cat[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Cat | null>(null);
  const [state, action] = useActionState(saveCategory, undefined);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [formKey, setFormKey] = useState(0);

  const reset = (c: Cat | null) => {
    setEditing(c);
    setName(c?.name ?? "");
    setSlug(c?.slug ?? "");
    setDescription(c?.description ?? "");
    setSlugTouched(!!c);
    setFormKey((k) => k + 1);
  };

  // Après un enregistrement réussi : formulaire vidé (ajustement pendant le rendu, sans effet). La liste est
  // rafraîchie par revalidatePath côté serveur.
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state?.ok) reset(null);
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0">
        {categories.length === 0 ? (
          <EmptyState icon={FolderTree} title="Aucune catégorie" description="Les catégories regroupent vos articles (Conseils, Recettes, Coulisses) et créent une page dédiée sur votre blog." />
        ) : (
          <Card as="section" aria-label="Catégories du blog">
            <ul className="divide-y divide-line">
              {categories.map((c, i) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink">{c.name}</p>
                    <p className="truncate text-xs text-ink-muted">
                      <span className="font-mono">/blog/categorie/{c.slug}</span> · {c.posts} article{c.posts > 1 ? "s" : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button type="button" variant="ghost" size="icon" onClick={() => reset(c)} aria-label={`Modifier ${c.name}`}>
                      <Pencil className="size-4" aria-hidden />
                    </Button>
                    <ActionButton variant="ghost" size="icon" action={() => moveCategory(storeId, c.id, "up")} disabled={i === 0} aria-label={`Monter ${c.name}`} successMessage="Ordre mis à jour" onDone={() => router.refresh()}>
                      <ArrowUp className="size-4" aria-hidden />
                    </ActionButton>
                    <ActionButton variant="ghost" size="icon" action={() => moveCategory(storeId, c.id, "down")} disabled={i === categories.length - 1} aria-label={`Descendre ${c.name}`} successMessage="Ordre mis à jour" onDone={() => router.refresh()}>
                      <ArrowDown className="size-4" aria-hidden />
                    </ActionButton>
                    <ConfirmActionButton
                      action={() => deleteCategory(storeId, c.id)}
                      title={`Supprimer « ${c.name} » ?`}
                      description={c.posts ? `Ses ${c.posts} article(s) restent publiés, sans catégorie.` : "La catégorie est vide."}
                      confirmLabel="Supprimer"
                      className="inline-flex size-11 items-center justify-center rounded-full text-danger hover:bg-danger-soft"
                    >
                      <Trash2 className="size-4" aria-hidden />
                      <span className="sr-only">Supprimer {c.name}</span>
                    </ConfirmActionButton>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      <Card className="h-fit p-5 lg:sticky lg:top-24">
        <form key={formKey} action={action} className="space-y-4" noValidate>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-ink">{editing ? `Modifier « ${editing.name} »` : "Nouvelle catégorie"}</h2>
            {editing && (
              <Button type="button" variant="ghost" size="icon" onClick={() => reset(null)} aria-label="Annuler la modification">
                <X className="size-4" aria-hidden />
              </Button>
            )}
          </div>
          <FormMessage state={state} />
          <input type="hidden" name="storeId" value={storeId} />
          {editing && <input type="hidden" name="categoryId" value={editing.id} />}
          <Field id="bc-name" label="Nom" required error={fieldError(state, "name")}>
            {(p) => (
              <Input
                {...p}
                name="name"
                value={name}
                maxLength={BLOG_CATEGORY_NAME_MAX}
                placeholder="Conseils"
                onChange={(e) => {
                  setName(e.target.value);
                  if (!slugTouched) setSlug(blogSlugify(e.target.value, 48));
                }}
              />
            )}
          </Field>
          <Field id="bc-slug" label="Adresse" error={fieldError(state, "slug")} hint={`/s/${storeSlug}/blog/categorie/${slug || "adresse"}`}>
            {(p) => (
              <Input
                {...p}
                name="slug"
                value={slug}
                maxLength={48}
                className="font-mono text-sm"
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-"));
                }}
                onBlur={() => setSlug((s) => blogSlugify(s, 48))}
              />
            )}
          </Field>
          <Field id="bc-desc" label="Présentation (facultatif)" error={fieldError(state, "description")} hint="Affichée en tête de la page de la catégorie.">
            {(p) => <Textarea {...p} name="description" rows={3} value={description} maxLength={BLOG_CATEGORY_DESCRIPTION_MAX} onChange={(e) => setDescription(e.target.value)} />}
          </Field>
          <SubmitButton className="w-full">{editing ? "Enregistrer" : "Créer la catégorie"}</SubmitButton>
        </form>
      </Card>
    </div>
  );
}
