import * as React from "react";
import { safeLink } from "@/lib/storefront/safe-link";
import { isStoredMediaUrl } from "@/lib/storage/public-url";
import { BLOG_BODY_MAX } from "./constants";

/**
 * Markdown limité et sûr des articles de blog. Même grammaire que les pages de boutique (src/lib/pages/markdown.tsx),
 * étendue aux besoins éditoriaux : images (`![texte alternatif](url)` seule sur sa ligne, médias téléversés ou https),
 * citations (`> `) et liens internes de la boutique (`/catalogue`, préfixés par la base de la boutique).
 *
 * Aucun HTML brut, aucun dangerouslySetInnerHTML : le texte est échappé par React, liens et images filtrés.
 * Utilisable côté serveur et client (aperçu de l'éditeur, boutique publique).
 */

export const IMAGE_LINE_RE = /^!\[([^\]\n]{0,200})\]\(([^)\s]{1,600})\)$/;

/** Image de corps d'article acceptée : https ou média stocké par la plateforme (jamais data:, jamais http). */
export function isBlogImageUrl(url: string): boolean {
  return /^https:\/\/[^\s<>"']+$/i.test(url) || isStoredMediaUrl(url);
}

function resolveLink(raw: string, base?: string): string | null {
  const url = safeLink(raw);
  if (!url) return null;
  if (base && url.startsWith("/") && !url.startsWith("/s/") && !url.startsWith("/media/")) return `${base}${url === "/" ? "" : url}`;
  return url;
}

const INLINE_RE = /(\*\*([^*]+)\*\*)|(\*([^*\s][^*]*)\*)|(_([^_\s][^_]*)_)|(\[([^\]]{1,200})\]\(([^)\s]{1,500})\))/g;

function inline(text: string, keyBase: string, base?: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const key = `${keyBase}-${i++}`;
    if (m[2]) out.push(<strong key={key}>{m[2]}</strong>);
    else if (m[4] || m[6]) out.push(<em key={key}>{m[4] ?? m[6]}</em>);
    else if (m[8] && m[9]) {
      const href = resolveLink(m[9], base);
      if (href) {
        const external = href.startsWith("https://");
        out.push(
          <a key={key} href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer nofollow" } : {})}>
            {m[8]}
          </a>,
        );
      } else out.push(m[8]);
    }
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function renderBlogMarkdown(src: string, opts: { base?: string; priorityFirstImage?: boolean } = {}): React.ReactNode[] {
  const lines = src.replace(/\r\n?/g, "\n").slice(0, BLOG_BODY_MAX).split("\n");
  const blocks: React.ReactNode[] = [];
  let para: string[] = [];
  let quote: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let k = 0;
  let images = 0;

  const flushPara = () => {
    if (!para.length) return;
    const key = `p${k++}`;
    blocks.push(
      <p key={key}>
        {para.map((l, i) => (
          <React.Fragment key={i}>
            {i > 0 && <br />}
            {inline(l, `${key}-${i}`, opts.base)}
          </React.Fragment>
        ))}
      </p>,
    );
    para = [];
  };
  const flushQuote = () => {
    if (!quote.length) return;
    const key = `q${k++}`;
    blocks.push(<blockquote key={key}>{inline(quote.join(" "), key, opts.base)}</blockquote>);
    quote = [];
  };
  const flushList = () => {
    if (!list) return;
    const key = `l${k++}`;
    const items = list.items.map((it, i) => <li key={i}>{inline(it, `${key}-${i}`, opts.base)}</li>);
    blocks.push(list.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>);
    list = null;
  };
  const flushAll = () => {
    flushPara();
    flushQuote();
    flushList();
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const t = line.trim();
    const h = /^(#{1,3})\s+(.+)$/.exec(t);
    const ul = /^\s*[-*]\s+(.+)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    const q = /^>\s?(.*)$/.exec(t);
    const img = IMAGE_LINE_RE.exec(t);
    if (!t) flushAll();
    else if (/^-{3,}$/.test(t)) {
      flushAll();
      blocks.push(<hr key={`hr${k++}`} />);
    } else if (img) {
      flushAll();
      const url = img[2]!;
      if (isBlogImageUrl(url)) {
        const eager = opts.priorityFirstImage && images === 0;
        images++;
        blocks.push(
          <figure key={`f${k++}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={img[1] ?? ""} width={1200} height={800} loading={eager ? "eager" : "lazy"} decoding="async" />
          </figure>,
        );
      }
    } else if (h) {
      flushAll();
      const level = Math.min(4, h[1]!.length + 1);
      const Tag = `h${level}` as "h2" | "h3" | "h4";
      const key = `h${k++}`;
      blocks.push(<Tag key={key}>{inline(h[2]!, key, opts.base)}</Tag>);
    } else if (q) {
      flushPara();
      flushList();
      quote.push(q[1]!);
    } else if (ul || ol) {
      flushPara();
      flushQuote();
      const ordered = !!ol;
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push((ul ?? ol)![1]!);
    } else {
      flushList();
      flushQuote();
      para.push(line);
    }
  }
  flushAll();
  return blocks;
}

/** Texte brut (extrait automatique, temps de lecture, flux RSS, méta-description). */
export function markdownToPlainText(src: string): string {
  return src
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((l) => !IMAGE_LINE_RE.test(l.trim()) && !/^-{3,}$/.test(l.trim()))
    .map((l) => l.replace(/^\s*(?:(?:#{1,3}|[-*]|\d+[.)])\s+|>\s?)/, ""))
    .join("\n")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1$2")
    .replace(/(^|\W)_([^_\s][^_]*)_/g, "$1$2")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n\n")
    .trim();
}

/** Temps de lecture en minutes (200 mots par minute, 12 s par image, minimum 1). */
export function readingMinutes(src: string): number {
  const words = markdownToPlainText(src).split(/\s+/).filter(Boolean).length;
  const imgs = src.split("\n").filter((l) => IMAGE_LINE_RE.test(l.trim())).length;
  return Math.max(1, Math.round(words / 200 + imgs * 0.2));
}

/** Extrait automatique : début du texte, coupé proprement sur un mot. */
export function autoExcerpt(src: string, max = 160): string {
  const text = markdownToPlainText(src).replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const at = cut.lastIndexOf(" ");
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,.;:!?]+$/, "")}…`;
}

/** Mise en forme du corps d'un article (sans plugin typography), pilotée par les variables du thème de la boutique. */
export const ARTICLE_PROSE =
  "space-y-5 text-[calc(17px*var(--store-body-scale,1))] leading-[1.75] text-ink [&_a]:font-medium [&_a]:text-ink [&_a]:underline [&_a]:decoration-[var(--store-primary)] [&_a]:decoration-2 [&_a]:underline-offset-[3px] [&_a:hover]:opacity-80 [&_h2]:pt-6 [&_h2]:text-[calc(1.6rem*var(--store-scale,1))] [&_h3]:pt-4 [&_h3]:text-[calc(1.25rem*var(--store-scale,1))] [&_h4]:pt-2 [&_h4]:font-semibold [&_hr]:my-10 [&_hr]:border-line [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6 [&_li]:pl-1 [&_strong]:font-semibold [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--store-primary)] [&_blockquote]:pl-5 [&_blockquote]:text-[1.15em] [&_blockquote]:italic [&_blockquote]:text-ink [&_figure]:my-8 [&_figure_img]:h-auto [&_figure_img]:w-full [&_figure_img]:rounded-[var(--store-card-radius)] [&_figure_img]:bg-[var(--store-primary-soft)]";
