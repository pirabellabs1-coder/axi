"use client";

import { useEffect, useRef } from "react";
import { Bold, Italic, List, ListOrdered, Link2 } from "lucide-react";
import { markdownToHtml } from "@/lib/products/markdown";
import { cn } from "@/lib/utils";

/** Convertit le DOM de l'éditeur en Markdown limité (gras, italique, listes, liens). */
function htmlToMarkdown(root: HTMLElement): string {
  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").replace(/ /g, " ");
    if (!(node instanceof HTMLElement)) return "";
    const inner = () => Array.from(node.childNodes).map(walk).join("");
    switch (node.tagName) {
      case "B":
      case "STRONG": {
        const t = inner();
        return t.trim() ? `**${t.trim()}**` : t;
      }
      case "I":
      case "EM": {
        const t = inner();
        return t.trim() ? `*${t.trim()}*` : t;
      }
      case "A": {
        const href = node.getAttribute("href") ?? "";
        const t = inner();
        return /^(https?:\/\/|mailto:|\/)/.test(href) ? `[${t}](${href})` : t;
      }
      case "BR":
        return "\n";
      case "UL":
      case "OL": {
        const items = Array.from(node.children).filter((c) => c.tagName === "LI");
        return "\n" + items.map((li, i) => `${node.tagName === "OL" ? `${i + 1}.` : "-"} ${walk(li).replace(/\n+/g, " ").trim()}`).join("\n") + "\n\n";
      }
      case "LI":
        return inner();
      case "P":
      case "DIV":
        return `${inner()}\n\n`;
      default:
        return inner();
    }
  };
  return walk(root)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const tool =
  "inline-flex size-11 items-center justify-center rounded-[10px] text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-primary sm:size-9";

/**
 * Éditeur de texte enrichi léger : stocke du Markdown limité, n'accepte que du texte brut au collage.
 * `value` peut changer de l'extérieur (assistant IA) : l'éditeur se resynchronise.
 */
export function RichTextEditor({ id, value, onChange, labelledBy, describedBy, invalid }: { id: string; value: string; onChange: (md: string) => void; labelledBy: string; describedBy?: string; invalid?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef<string | null>(null);

  useEffect(() => {
    if (!ref.current || value === last.current) return;
    ref.current.innerHTML = markdownToHtml(value);
    last.current = value;
  }, [value]);

  const emit = () => {
    if (!ref.current) return;
    const md = htmlToMarkdown(ref.current);
    last.current = md;
    onChange(md);
  };

  const exec = (cmd: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(cmd, false, arg);
    emit();
  };

  const addLink = () => {
    const url = window.prompt("Adresse du lien (https://…)", "https://");
    if (!url) return;
    if (!/^https:\/\/\S+$/i.test(url.trim())) {
      window.alert("Le lien doit commencer par https://");
      return;
    }
    const sel = window.getSelection();
    if (sel && sel.toString().length === 0) exec("insertText", url.trim());
    exec("createLink", url.trim());
  };

  return (
    <div className={cn("overflow-hidden rounded-[var(--radius-md)] bg-surface ring-1 ring-inset ring-line-strong focus-within:ring-2 focus-within:ring-primary", invalid && "ring-2 ring-danger")}>
      <div role="toolbar" aria-label="Mise en forme" aria-controls={id} className="flex flex-wrap items-center gap-0.5 border-b border-line bg-surface-2/50 px-1.5 py-1">
        <button type="button" className={tool} onMouseDown={(e) => e.preventDefault()} onClick={() => exec("bold")} aria-label="Gras" title="Gras (Ctrl+B)">
          <Bold className="size-4" aria-hidden />
        </button>
        <button type="button" className={tool} onMouseDown={(e) => e.preventDefault()} onClick={() => exec("italic")} aria-label="Italique" title="Italique (Ctrl+I)">
          <Italic className="size-4" aria-hidden />
        </button>
        <span className="mx-1 h-5 w-px bg-line" aria-hidden />
        <button type="button" className={tool} onMouseDown={(e) => e.preventDefault()} onClick={() => exec("insertUnorderedList")} aria-label="Liste à puces">
          <List className="size-4" aria-hidden />
        </button>
        <button type="button" className={tool} onMouseDown={(e) => e.preventDefault()} onClick={() => exec("insertOrderedList")} aria-label="Liste numérotée">
          <ListOrdered className="size-4" aria-hidden />
        </button>
        <button type="button" className={tool} onMouseDown={(e) => e.preventDefault()} onClick={addLink} aria-label="Insérer un lien">
          <Link2 className="size-4" aria-hidden />
        </button>
      </div>
      <div
        ref={ref}
        id={id}
        role="textbox"
        aria-multiline="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        contentEditable
        suppressContentEditableWarning
        onInput={emit}
        onBlur={emit}
        onPaste={(e) => {
          e.preventDefault();
          document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
          emit();
        }}
        className="prose-description min-h-40 max-w-none px-4 py-3 text-[15px] leading-relaxed text-ink outline-none [&_a]:text-primary [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-5"
      />
    </div>
  );
}
