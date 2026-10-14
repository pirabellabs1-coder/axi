"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bold, Eye, Heading2, ImagePlus, Italic, Link2, List, PenLine, Quote, Sparkles, Trash2, Undo2, Upload } from "lucide-react";
import { savePost, draftPostWithAi, type SavePostData } from "@/lib/blog/actions";
import { renderBlogMarkdown, readingMinutes, autoExcerpt } from "@/lib/blog/markdown";
import { blogSlugify } from "@/lib/blog/slug";
import { BLOG_AI_COST, BLOG_BODY_MAX, BLOG_EXCERPT_MAX, BLOG_SEO_DESCRIPTION_MAX, BLOG_SEO_TITLE_MAX, BLOG_TITLE_MAX, type BlogStatus } from "@/lib/blog/constants";
import { compressThemeImage, uploadImage, UploadFailedError } from "@/lib/storage/client";
import { ACCEPTED_IMAGE_TYPES } from "@/lib/storage/limits";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { FormMessage, fieldError } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { cn } from "@/lib/utils";

const TOOLS = [
  { id: "bold", label: "Gras", icon: Bold },
  { id: "italic", label: "Italique", icon: Italic },
  { id: "h2", label: "Intertitre", icon: Heading2 },
  { id: "list", label: "Liste", icon: List },
  { id: "quote", label: "Citation", icon: Quote },
  { id: "link", label: "Lien", icon: Link2 },
] as const;

const PREVIEW_PROSE =
  "space-y-4 text-[15px] leading-relaxed text-ink [&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_h2]:mt-6 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h3]:mt-5 [&_h3]:text-lg [&_h3]:font-semibold [&_h4]:font-semibold [&_hr]:my-6 [&_hr]:border-line [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5 [&_strong]:font-semibold [&_blockquote]:border-l-2 [&_blockquote]:border-primary [&_blockquote]:pl-4 [&_blockquote]:italic [&_figure_img]:h-auto [&_figure_img]:w-full [&_figure_img]:rounded-[var(--radius-md)]";

export type PostDraft = {
  id?: string;
  title: string;
  slug: string;
  excerpt: string;
  body: string;
  coverUrl: string;
  coverAlt: string;
  categoryId: string;
  tags: string;
  authorName: string;
  seoTitle: string;
  seoDescription: string;
  status: BlogStatus;
  scheduledLocal: string;
};

type Intent = "draft" | "publish" | "schedule" | "archive";
const INTENTS: { value: Intent; label: string; hint: string }[] = [
  { value: "draft", label: "Brouillon", hint: "Invisible pour vos clients." },
  { value: "publish", label: "Publier maintenant", hint: "Visible tout de suite sur votre boutique." },
  { value: "schedule", label: "Programmer", hint: "Publié automatiquement à la date choisie." },
  { value: "archive", label: "Archiver", hint: "Retiré de la boutique, conservé ici." },
];
const SUBMIT: Record<Intent, string> = { draft: "Enregistrer le brouillon", publish: "Publier", schedule: "Programmer", archive: "Archiver" };

export function PostEditor({
  storeId,
  storeSlug,
  timezone,
  categories,
  post,
  ai,
  minSchedule,
}: {
  storeId: string;
  storeSlug: string;
  timezone: string;
  categories: { id: string; name: string }[];
  post: PostDraft;
  ai: { available: boolean; reason: string | null; balance: number | null };
  minSchedule: string;
}) {
  const [state, action] = useActionState(savePost, undefined);
  const router = useRouter();
  const [v, setV] = useState(post);
  const set = (patch: Partial<PostDraft>) => setV((x) => ({ ...x, ...patch }));
  const [slugTouched, setSlugTouched] = useState(!!post.id);
  const [intent, setIntent] = useState<Intent>(post.status === "PUBLISHED" ? "publish" : post.status === "SCHEDULED" ? "schedule" : post.status === "ARCHIVED" ? "archive" : "draft");
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [upload, setUpload] = useState<{ target: "cover" | "body"; progress: number } | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  const bodyInput = useRef<HTMLInputElement>(null);

  const [topic, setTopic] = useState("");
  const [notes, setNotes] = useState("");
  const [aiPending, startAi] = useTransition();
  const [undo, setUndo] = useState<PostDraft | null>(null);

  useEffect(() => {
    const d = state?.ok ? (state.data as SavePostData | undefined) : undefined;
    if (!d) return;
    // Création : page de l'article ; modification : données serveur rechargées (l'éditeur est remonté, clé = updatedAt).
    if (!post.id) router.replace(`/app/${storeId}/blog/${d.id}`);
    else router.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  function replaceSelection(build: (sel: string) => { text: string; selStart: number; selEnd: number }) {
    const el = area.current;
    if (!el) return;
    const s = el.selectionStart;
    const e = el.selectionEnd;
    const r = build(v.body.slice(s, e));
    const next = (v.body.slice(0, s) + r.text + v.body.slice(e)).slice(0, BLOG_BODY_MAX);
    set({ body: next });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + r.selStart, s + r.selEnd);
    });
  }
  const wrap = (before: string, after = before, placeholder = "texte") =>
    replaceSelection((sel) => {
      const t = sel || placeholder;
      return { text: before + t + after, selStart: before.length, selEnd: before.length + t.length };
    });
  function linePrefix(prefix: string) {
    const el = area.current;
    if (!el) return;
    const s = el.selectionStart;
    const lineStart = v.body.lastIndexOf("\n", s - 1) + 1;
    set({ body: (v.body.slice(0, lineStart) + prefix + v.body.slice(lineStart)).slice(0, BLOG_BODY_MAX) });
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
    else if (id === "quote") linePrefix("> ");
    else wrap("[", "](https://)", "texte du lien");
  }

  async function onFile(f: File | null, target: "cover" | "body") {
    if (!f) return;
    setUpload({ target, progress: 0 });
    try {
      const blob = await compressThemeImage(f);
      const up = await uploadImage(storeId, "theme", blob, { onProgress: (p) => setUpload({ target, progress: p }) });
      if (target === "cover") set({ coverUrl: up.url, coverAlt: v.coverAlt || v.title });
      else {
        const alt = "description de l'image";
        replaceSelection(() => {
          const text = `\n\n![${alt}](${up.url})\n\n`;
          return { text, selStart: 4, selEnd: 4 + alt.length };
        });
        toast.success("Image insérée", "Remplacez « description de l'image » par une courte description.");
      }
    } catch (e) {
      toast.error("Image non ajoutée", e instanceof UploadFailedError ? e.message : "Image illisible ou trop lourde.");
    } finally {
      setUpload(null);
      if (coverInput.current) coverInput.current.value = "";
      if (bodyInput.current) bodyInput.current.value = "";
    }
  }

  function runAi() {
    startAi(async () => {
      const r = await draftPostWithAi({ storeId, topic: topic || v.title, notes, postId: post.id ?? null });
      if (!r.ok) {
        toast.error("Brouillon non rédigé", r.error);
        return;
      }
      const d = r.data!;
      setUndo(v);
      set({
        title: d.title,
        body: d.body,
        excerpt: d.excerpt,
        tags: d.tags.join(", "),
        seoTitle: d.seoTitle,
        seoDescription: d.seoDescription,
        ...(slugTouched ? {} : { slug: blogSlugify(d.title) }),
      });
      setIntent("draft");
      toast.success(`Brouillon rédigé (${d.creditsUsed} crédits IA)`, d.removed.length ? "Des phrases non vérifiables (prix, délais, promotions) ont été retirées. Relisez avant de publier." : "Relisez et complétez-le avant de publier.");
    });
  }

  const busy = upload !== null;
  const minutes = readingMinutes(v.body);
  const seoTitle = v.seoTitle || v.title;
  const seoDesc = v.seoDescription || v.excerpt || autoExcerpt(v.body, 155);

  return (
    <form action={action} className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]" noValidate>
      <input type="hidden" name="storeId" value={storeId} />
      {post.id && <input type="hidden" name="postId" value={post.id} />}
      <input type="hidden" name="body" value={v.body} />
      <input type="hidden" name="coverUrl" value={v.coverUrl} />
      <input type="hidden" name="intent" value={intent} />

      <div className="min-w-0 space-y-5">
        <FormMessage state={state} />
        <Card className="space-y-5 p-5 sm:p-6">
          <Field id="bp-title" label="Titre" required error={fieldError(state, "title")}>
            {(p) => (
              <Input
                {...p}
                name="title"
                value={v.title}
                maxLength={BLOG_TITLE_MAX}
                placeholder="Ex. Bien conserver vos gâteaux par forte chaleur"
                onChange={(e) => set({ title: e.target.value, ...(slugTouched ? {} : { slug: blogSlugify(e.target.value) }) })}
              />
            )}
          </Field>

          <div>
            <p className="mb-1.5 text-sm font-medium text-ink">Image de couverture</p>
            {v.coverUrl ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={v.coverUrl} alt="" width={240} height={160} className="aspect-[3/2] w-full rounded-[var(--radius-md)] object-cover ring-1 ring-line sm:w-60" />
                <div className="min-w-0 flex-1 space-y-3">
                  <Field id="bp-cover-alt" label="Description de l'image" hint="Lue par les lecteurs d'écran et Google." error={fieldError(state, "coverAlt")}>
                    {(p) => <Input {...p} name="coverAlt" value={v.coverAlt} maxLength={200} onChange={(e) => set({ coverAlt: e.target.value })} />}
                  </Field>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => coverInput.current?.click()} disabled={busy}>
                      <Upload className="size-4" aria-hidden /> Remplacer
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => set({ coverUrl: "", coverAlt: "" })}>
                      <Trash2 className="size-4" aria-hidden /> Retirer
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => coverInput.current?.click()}
                disabled={busy}
                className="flex min-h-32 w-full flex-col items-center justify-center gap-2 rounded-[var(--radius-md)] border border-dashed border-line-strong bg-surface-2 px-4 py-6 text-sm text-ink-muted transition-colors hover:border-primary hover:text-ink focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-60"
              >
                <ImagePlus className="size-6" aria-hidden />
                {upload?.target === "cover" ? `Envoi… ${Math.round(upload.progress * 100)} %` : "Ajouter une image de couverture (JPEG, PNG ou WebP)"}
              </button>
            )}
            <input ref={coverInput} type="file" accept={ACCEPTED_IMAGE_TYPES} className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => onFile(e.target.files?.[0] ?? null, "cover")} />
            {!v.coverUrl && <input type="hidden" name="coverAlt" value="" />}
          </div>
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
                  id={`bp-tab-${t.k}`}
                  aria-selected={tab === t.k}
                  aria-controls={`bp-panel-${t.k}`}
                  onClick={() => setTab(t.k)}
                  className={cn("inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors duration-150", tab === t.k ? "bg-surface-2 text-ink" : "text-ink-muted hover:text-ink")}
                >
                  <t.icon className="size-4" aria-hidden /> {t.label}
                </button>
              ))}
            </div>
            {tab === "edit" && (
              <div className="ml-auto flex flex-wrap gap-0.5" role="toolbar" aria-label="Mise en forme">
                {TOOLS.map((t) => (
                  <button key={t.id} type="button" onClick={() => applyTool(t.id)} className="inline-flex size-10 items-center justify-center rounded-full text-ink-muted hover:bg-surface-2 hover:text-ink" aria-label={t.label} title={t.label}>
                    <t.icon className="size-4" aria-hidden />
                  </button>
                ))}
                <button type="button" onClick={() => bodyInput.current?.click()} disabled={busy} className="inline-flex size-10 items-center justify-center rounded-full text-ink-muted hover:bg-surface-2 hover:text-ink disabled:opacity-50" aria-label="Insérer une image" title="Insérer une image">
                  <ImagePlus className="size-4" aria-hidden />
                </button>
                <input ref={bodyInput} type="file" accept={ACCEPTED_IMAGE_TYPES} className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => onFile(e.target.files?.[0] ?? null, "body")} />
              </div>
            )}
          </div>
          <div id="bp-panel-edit" role="tabpanel" aria-labelledby="bp-tab-edit" hidden={tab !== "edit"}>
            <label htmlFor="bp-body" className="sr-only">
              Contenu de l&apos;article
            </label>
            <textarea
              id="bp-body"
              ref={area}
              value={v.body}
              onChange={(e) => set({ body: e.target.value })}
              maxLength={BLOG_BODY_MAX}
              rows={22}
              aria-describedby="bp-body-hint"
              aria-invalid={!!fieldError(state, "body")}
              className="block min-h-[420px] w-full resize-y border-0 bg-surface px-5 py-4 font-mono text-sm leading-relaxed text-ink placeholder:text-ink-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
              placeholder={"## Intertitre\n\nVotre texte. **Gras**, *italique*, [lien](/catalogue).\n\n- Élément de liste\n\n> Une citation"}
            />
            {fieldError(state, "body") && (
              <p className="border-t border-line px-5 py-2 text-sm text-danger" role="alert">
                {fieldError(state, "body")}
              </p>
            )}
            <p id="bp-body-hint" className="flex flex-wrap justify-between gap-3 border-t border-line px-5 py-2 text-xs text-ink-muted">
              <span>## intertitre, **gras**, *italique*, - liste, &gt; citation, [lien](https://… ou /catalogue). Images : bouton « Insérer une image ».</span>
              <span className="shrink-0 tabular">
                {upload?.target === "body" ? `Envoi de l'image… ${Math.round(upload.progress * 100)} %` : `${minutes} min de lecture · ${v.body.length.toLocaleString("fr-FR")}/${BLOG_BODY_MAX.toLocaleString("fr-FR")}`}
              </span>
            </p>
          </div>
          <div id="bp-panel-preview" role="tabpanel" aria-labelledby="bp-tab-preview" hidden={tab !== "preview"} className="min-h-[420px] px-5 py-6 sm:px-10">
            <article className="mx-auto max-w-[68ch]">
              <h1 className="text-3xl font-semibold tracking-tight text-ink">{v.title || "Sans titre"}</h1>
              {v.excerpt && <p className="mt-3 text-lg text-ink-muted">{v.excerpt}</p>}
              <p className="mt-3 text-sm text-ink-muted">
                {v.authorName ? `Par ${v.authorName} · ` : ""}
                {minutes} min de lecture
              </p>
              {v.coverUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={v.coverUrl} alt={v.coverAlt} className="mt-6 aspect-[3/2] w-full rounded-[var(--radius-lg)] object-cover" />
              )}
              <div className={cn(PREVIEW_PROSE, "mt-6")}>{v.body.trim() ? renderBlogMarkdown(v.body, { base: `/s/${storeSlug}` }) : <p className="text-ink-muted">L&apos;article est vide.</p>}</div>
            </article>
          </div>
        </Card>

        <Card className="space-y-5 p-5 sm:p-6">
          <h2 className="text-base font-semibold text-ink">Référencement (Google)</h2>
          <div className="rounded-[var(--radius-md)] bg-surface-2 p-4" aria-label="Aperçu dans les résultats de recherche">
            <p className="truncate text-xs text-ink-muted">
              /s/{storeSlug}/blog/{v.slug || "adresse"}
            </p>
            <p className="mt-1 line-clamp-1 text-[17px] font-medium text-info">{seoTitle || "Titre de l'article"}</p>
            <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{seoDesc || "Description de l'article dans les résultats de recherche."}</p>
          </div>
          <Field id="bp-slug" label="Adresse de l'article" error={fieldError(state, "slug")} hint="Lettres, chiffres et tirets. Si elle est déjà prise, un suffixe (-2) est ajouté.">
            {(p) => (
              <Input
                {...p}
                name="slug"
                value={v.slug}
                maxLength={80}
                className="font-mono text-sm"
                onChange={(e) => {
                  setSlugTouched(true);
                  set({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-") });
                }}
                onBlur={() => set({ slug: blogSlugify(v.slug) })}
              />
            )}
          </Field>
          <Field id="bp-seo-title" label="Titre pour Google" error={fieldError(state, "seoTitle")} hint={`${v.seoTitle.length}/${BLOG_SEO_TITLE_MAX} caractères. Vide : le titre de l'article.`}>
            {(p) => <Input {...p} name="seoTitle" value={v.seoTitle} maxLength={BLOG_SEO_TITLE_MAX} onChange={(e) => set({ seoTitle: e.target.value })} />}
          </Field>
          <Field id="bp-seo-desc" label="Description pour Google" error={fieldError(state, "seoDescription")} hint={`${v.seoDescription.length}/${BLOG_SEO_DESCRIPTION_MAX} caractères. Vide : le résumé.`}>
            {(p) => <Textarea {...p} name="seoDescription" rows={3} value={v.seoDescription} maxLength={BLOG_SEO_DESCRIPTION_MAX} onChange={(e) => set({ seoDescription: e.target.value })} />}
          </Field>
        </Card>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
        <Card className="space-y-4 p-5">
          <fieldset>
            <legend className="mb-2 text-sm font-semibold text-ink">Publication</legend>
            <div className="space-y-1">
              {INTENTS.filter((i) => i.value !== "archive" || post.id).map((i) => (
                <label key={i.value} className={cn("flex min-h-11 cursor-pointer items-start gap-3 rounded-[var(--radius-md)] px-3 py-2 transition-colors", intent === i.value ? "bg-primary-soft" : "hover:bg-surface-2")}>
                  <input type="radio" name="intent-choice" value={i.value} checked={intent === i.value} onChange={() => setIntent(i.value)} className="mt-1 size-4 accent-[var(--c-primary)]" />
                  <span>
                    <span className="block text-sm font-medium text-ink">{i.label}</span>
                    <span className="block text-xs text-ink-muted">{i.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          {intent === "schedule" && (
            <Field id="bp-schedule" label="Date et heure de publication" error={fieldError(state, "scheduledAt")} hint={`Fuseau de la boutique : ${timezone}.`}>
              {(p) => <Input {...p} type="datetime-local" name="scheduledAt" min={minSchedule} value={v.scheduledLocal} onChange={(e) => set({ scheduledLocal: e.target.value })} />}
            </Field>
          )}
          <SubmitButton className="w-full" disabled={busy}>
            {SUBMIT[intent]}
          </SubmitButton>
        </Card>

        <Card className="space-y-4 p-5">
          <h2 className="text-sm font-semibold text-ink">Organisation</h2>
          <Field id="bp-excerpt" label="Résumé" error={fieldError(state, "excerpt")} hint={`Affiché sur les cartes d'article. ${v.excerpt.length}/${BLOG_EXCERPT_MAX}`}>
            {(p) => <Textarea {...p} name="excerpt" rows={3} value={v.excerpt} maxLength={BLOG_EXCERPT_MAX} onChange={(e) => set({ excerpt: e.target.value })} />}
          </Field>
          <Field id="bp-category" label="Catégorie" error={fieldError(state, "categoryId")} hint={categories.length ? undefined : "Créez des catégories depuis Blog, Catégories."}>
            {(p) => (
              <Select {...p} name="categoryId" value={v.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
                <option value="">Sans catégorie</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="bp-tags" label="Étiquettes" hint="Séparées par des virgules (10 au plus)." error={fieldError(state, "tags")}>
            {(p) => <Input {...p} name="tags" value={v.tags} maxLength={400} placeholder="conseils, recettes" onChange={(e) => set({ tags: e.target.value })} />}
          </Field>
          <Field id="bp-author" label="Auteur" error={fieldError(state, "authorName")}>
            {(p) => <Input {...p} name="authorName" value={v.authorName} maxLength={60} onChange={(e) => set({ authorName: e.target.value })} />}
          </Field>
        </Card>

        <Card className="space-y-3 p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Sparkles className="size-4 text-primary" aria-hidden /> Rédiger un brouillon avec l&apos;IA
          </h2>
          {ai.available ? (
            <>
              <Field id="bp-ai-topic" label="Sujet" hint="Ex. Comment choisir un gâteau d'anniversaire.">
                {(p) => <Input {...p} value={topic} maxLength={160} onChange={(e) => setTopic(e.target.value)} placeholder={v.title || "Sujet de l'article"} />}
              </Field>
              <Field id="bp-ai-notes" label="Vos notes (facultatif)" hint="Points à aborder, produits, conseils de la maison.">
                {(p) => <Textarea {...p} rows={3} value={notes} maxLength={800} onChange={(e) => setNotes(e.target.value)} />}
              </Field>
              <Button type="button" variant="outline" className="w-full" loading={aiPending} disabled={busy || (topic.trim().length < 5 && v.title.trim().length < 5)} onClick={runAi}>
                Rédiger ({BLOG_AI_COST} crédits IA)
              </Button>
              <p className="text-xs text-ink-muted">
                Solde : {ai.balance ?? 0} crédits. Le texte remplace le titre, le résumé et le contenu ; il n&apos;est jamais publié sans vous. Prix, délais et promotions sont exclus.
              </p>
              {undo && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setV(undo);
                    setUndo(null);
                  }}
                >
                  <Undo2 className="size-4" aria-hidden /> Rétablir le texte précédent
                </Button>
              )}
            </>
          ) : (
            <Alert tone="info">{ai.reason}</Alert>
          )}
        </Card>
      </aside>
    </form>
  );
}
