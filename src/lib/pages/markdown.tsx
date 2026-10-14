import * as React from "react";

/**
 * Markdown limité et sûr pour les pages de boutique : aucun HTML brut, aucun
 * dangerouslySetInnerHTML. Pris en charge : titres (#, ##, ###), paragraphes, listes (- , 1.),
 * **gras**, *italique*, [lien](https://…) (http, https, mailto, tel uniquement), séparateur ---.
 * Utilisable côté serveur et client (boutique publique comprise).
 */

import { PAGE_BODY_MAX } from "./constants";

export { PAGE_BODY_MAX };

const SAFE_URL = /^(https?:\/\/|mailto:|tel:)[^\s<>"']+$/i;

function inline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(\[([^\]]+)\]\(([^)\s]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyBase}-${i++}`;
    if (m[2]) out.push(<strong key={key}>{m[2]}</strong>);
    else if (m[4]) out.push(<em key={key}>{m[4]}</em>);
    else if (m[6] && m[7]) {
      const href = m[7];
      if (SAFE_URL.test(href)) {
        const external = /^https?:/i.test(href);
        out.push(
          <a key={key} href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer nofollow" } : {})}>
            {m[6]}
          </a>,
        );
      } else out.push(m[6]);
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function renderMarkdown(src: string, opts: { headingOffset?: 0 | 1 } = {}): React.ReactNode {
  const offset = opts.headingOffset ?? 1; // # → h2 par défaut (le titre de la page est le h1)
  const lines = src.replace(/\r\n?/g, "\n").slice(0, PAGE_BODY_MAX).split("\n");
  const blocks: React.ReactNode[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let k = 0;

  const flushPara = () => {
    if (para.length) {
      const key = `p${k++}`;
      blocks.push(
        <p key={key}>
          {para.map((l, i) => (
            <React.Fragment key={i}>
              {i > 0 && <br />}
              {inline(l, `${key}-${i}`)}
            </React.Fragment>
          ))}
        </p>,
      );
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      const key = `l${k++}`;
      const items = list.items.map((it, i) => <li key={i}>{inline(it, `${key}-${i}`)}</li>);
      blocks.push(list.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>);
      list = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = /^(#{1,3})\s+(.+)$/.exec(line);
    const ul = /^\s*[-*]\s+(.+)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (!line.trim()) {
      flushPara();
      flushList();
    } else if (/^-{3,}$/.test(line.trim())) {
      flushPara();
      flushList();
      blocks.push(<hr key={`hr${k++}`} />);
    } else if (h) {
      flushPara();
      flushList();
      const level = Math.min(6, h[1]!.length + offset);
      const Tag = `h${level}` as "h2" | "h3" | "h4";
      const key = `h${k++}`;
      blocks.push(<Tag key={key}>{inline(h[2]!, key)}</Tag>);
    } else if (ul || ol) {
      flushPara();
      const ordered = !!ol;
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push((ul ?? ol)![1]!);
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return blocks;
}

/** Classes de mise en forme du contenu rendu (sans plugin typography). */
export const PROSE_CLASSES =
  "space-y-4 text-[15px] leading-relaxed text-ink [&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_h2]:mt-6 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h3]:mt-5 [&_h3]:text-lg [&_h3]:font-semibold [&_h4]:font-semibold [&_hr]:my-6 [&_hr]:border-line [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5 [&_strong]:font-semibold";
