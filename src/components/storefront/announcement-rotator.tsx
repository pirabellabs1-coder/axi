"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/** Annonces qui se succèdent (fondu), pause au survol et en mouvement réduit. */
export function AnnouncementRotator({ items, autoplay }: { items: { text: string; href: string | null }[]; autoplay: boolean }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (!autoplay || items.length < 2 || paused) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setI((x) => (x + 1) % items.length), 4500);
    return () => clearInterval(t);
  }, [autoplay, items.length, paused]);
  const it = items[i] ?? items[0];
  if (!it) return null;
  return (
    <div onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} className="flex min-h-10 items-center justify-center gap-3 px-4 py-2 text-center text-[13px] font-medium" aria-live="off">
      {items.length > 1 && !autoplay ? (
        <ul className="flex flex-wrap justify-center gap-x-8 gap-y-1">
          {items.map((x, k) => (
            <li key={k}>{x.href ? <Link href={x.href} className="underline-offset-4 hover:underline">{x.text}</Link> : x.text}</li>
          ))}
        </ul>
      ) : (
        <p key={i} className="sf-fade">
          {it.href ? (
            <Link href={it.href} className="underline-offset-4 hover:underline">
              {it.text}
            </Link>
          ) : (
            it.text
          )}
        </p>
      )}
    </div>
  );
}
