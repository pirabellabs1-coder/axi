"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bold, Italic, Heading2, List, Link2, Eye, PenLine } from "lucide-react";
import { savePage } from "@/lib/pages/actions";
import { renderMarkdown, PROSE_CLASSES } from "@/lib/pages/markdown";
import { PAGE_BODY_MAX } from "@/lib/pages/constants";
import { Field, Input, Switch } from "@/components/ui/field";
import { Card } from "@/components/ui/card";
import { FormMessage, fieldError } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { slugify, cn } from "@/lib/utils";

const TOOLS = [
  { id: "bold", label: "Gras", icon: Bold },
  { id: "italic", label: "Italique", icon: Italic },
  { id: "h2", label: "Intertitre", icon: Heading2 },
  { id: "list", label: "Liste", icon: List },
  { id: "link", label: "Lien", icon: Link2 },
] as const;

export type PageDraft = { id?: string; title: string; slug: string; body: string; published: boolean };

export function PageEditor({ storeId, storeSlug, page }: { storeId: string; storeSlug: string; page: PageDraft }) {
  const [state, action] = useActionState(savePage, undefined);
  const router = useRouter();
  const [title, setTitle] = useState(page.title);
  const [slug, setSlug] = useState(page.slug);
  const [slugTouched, setSlugTouched] = useState(!!page.id);
  const [body, setBody] = useState(page.body);
  const [published, setPublished] = useState(page.published);
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (state?.ok && state.data?.id && !page.id) router.replace(`/app/${storeId}/pages/${state.data.id}`);
  }, [state, page.id, router, storeId]);

  function wrap(before: string, after = before, placeholder = "texte") {
    const el = area.current;
    if (!el) return;
    const s = el.selectionStart;
    const e = el.selectionEnd;
    const sel = body.slice(s, e) || placeholder;
    const next = body.slice(0, s) + before + sel + after + body.slice(e);
    setBody(next.slice(0, PAGE_BODY_MAX));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + before.length, s + before.length + sel.length);
    });
  }
  function linePrefix(prefix: string) {
    const el = area.current;
    if (!el) return;
    const s = el.selectionStart;
    const lineStart = body.lastIndexOf("\n", s - 1) + 1;
    const next = body.slice(0, lineStart) + prefix + body.slice(lineStart);
    setBody(next.slice(0, PAGE_BODY_MAX));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + prefix.length, s + prefix.length);
    });
  }

  function applyTool(id: (typeof TOOLS)[number]["id"]) {
    if (id === "bold") wrap("**");
    else if (id === "italic") wrap("*");
    else if (id === "h2") linePrefix("## ");
    else if (id === "list") linePrefix("- ");
    else wrap("[", "](https://)", "texte du lien");
  }

  return (
    <form action={action} className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px]" noValidate>
      <input type="hidden" name="storeId" value={storeId} />
      {page.id && <input type="hidden" name="pageId" value={page.id} />}
      <input type="hidden" name="published" value={published ? "true" : "false"} />
      <input type="hidden" name="body" value={body} />

      <div className="min-w-0 space-y-5">
        <FormMessage state={state} />
        <Card className="space-y-5 p-5 sm:p-6">
          <Field id="pg-title" label="Titre" required error={fieldError(state, "title")}>
            {(p) => (
              <Input
                {...p}
                name="title"
                value={title}
                maxLength={80}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (!slugTouched) setSlug(slugify(e.target.value));
                }}
              />
            )}
          </Field>
          <Field id="pg-slug" label="Adresse de la page" error={fieldError(state, "slug")} hint={`/s/${storeSlug}/${slug || "adresse"}`}>
            {(p) => (
              <Input
                {...p}
                name="slug"
                value={slug}
                maxLength={48}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(slugify(e.target.value) || e.target.value.toLowerCase());
                }}
                onBlur={() => setSlug((s) => slugify(s))}
                className="font-mono text-sm"
              />
            )}
          </Field>
        </Card>

        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-1 border-b border-line px-3 py-2">
            <div role="tablist" aria-label="Mode d'édition" className="flex gap-1">
              {(
                [
                  { k: "edit", label: "Écrire", icon: PenLine },
                  { k: "preview", label: "Aperçu", icon: Eye },
                ] as const
              ).map((t) => (
                <button
                  key={t.k}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.k}
                  aria-controls={`pg-panel-${t.k}`}
                  onClick={() => setTab(t.k)}
                  className={cn("inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors duration-150", tab === t.k ? "bg-surface-2 text-ink" : "text-ink-muted hover:text-ink")}
                >
                  <t.icon className="size-4" aria-hidden /> {t.label}
                </button>
              ))}
            </div>
            {tab === "edit" && (
              <div className="ml-auto flex gap-0.5" role="toolbar" aria-label="Mise en forme">
                {TOOLS.map((t) => (
                  <button key={t.label} type="button" onClick={() => applyTool(t.id)} className="inline-flex size-9 items-center justify-center rounded-full text-ink-muted hover:bg-surface-2 hover:text-ink" aria-label={t.label} title={t.label}>
                    <t.icon className="size-4" aria-hidden />
                  </button>
                ))}
              </div>
            )}
          </div>
          <div id="pg-panel-edit" role="tabpanel" hidden={tab !== "edit"}>
            <label htmlFor="pg-body" className="sr-only">
              Contenu de la page
            </label>
            <textarea
              id="pg-body"
              ref={area}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={PAGE_BODY_MAX}
              rows={18}
              aria-describedby="pg-body-hint"
              className="block min-h-[360px] w-full resize-y border-0 bg-surface px-5 py-4 font-mono text-sm leading-relaxed text-ink placeholder:text-ink-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
              placeholder={"## Intertitre\n\nVotre texte. **Gras**, *italique*, [lien](https://exemple.com).\n\n- Élément de liste"}
            />
            <p id="pg-body-hint" className="flex justify-between gap-3 border-t border-line px-5 py-2 text-xs text-ink-muted">
              <span>Mise en forme simple : ## intertitre, **gras**, *italique*, - liste, [lien](https://…).</span>
              <span className="shrink-0 tabular">
                {body.length.toLocaleString("fr-FR")}/{PAGE_BODY_MAX.toLocaleString("fr-FR")}
              </span>
            </p>
          </div>
          <div id="pg-panel-preview" role="tabpanel" hidden={tab !== "preview"} className="min-h-[360px] px-5 py-5 sm:px-8">
            <h1 className="mb-4 text-2xl font-semibold tracking-tight text-ink">{title || "Sans titre"}</h1>
            {body.trim() ? <div className={PROSE_CLASSES}>{renderMarkdown(body)}</div> : <p className="text-sm text-ink-muted">La page est vide.</p>}
          </div>
        </Card>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
        <Card className="space-y-4 p-5">
          <Switch checked={published} onChange={setPublished} label={published ? "Publiée" : "Brouillon (masquée)"} />
          <p className="text-sm text-ink-muted">{published ? "Accessible à vos clients sur votre boutique." : "Invisible pour vos clients tant qu'elle n'est pas publiée."}</p>
          <SubmitButton className="w-full">{page.id ? "Enregistrer" : "Créer la page"}</SubmitButton>
        </Card>
      </aside>
    </form>
  );
}
