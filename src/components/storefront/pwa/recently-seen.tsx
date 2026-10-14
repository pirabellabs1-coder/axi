"use client";

import { useEffect, useState } from "react";

type Seen = { url: string; title: string };

/**
 * Derniers produits vus, relus dans le cache HTML du service worker (lot 4 §14, page hors ligne).
 * Aucune donnée n'est stockée en plus : on réutilise ce que le service worker a déjà conservé
 * (stratégie « réseau d'abord » sur le HTML), ce qui évite tout suivi supplémentaire du visiteur.
 * États : rien pendant la lecture, rien si aucun produit — la page hors ligne reste utile sans cette liste.
 */
export function RecentlySeen({ base, max = 6 }: { base: string; max?: number }) {
  const [items, setItems] = useState<Seen[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!("caches" in window)) return;
        const names = (await caches.keys()).filter((n) => n.startsWith("axi-html-"));
        const out: Seen[] = [];
        for (const name of names) {
          const cache = await caches.open(name);
          for (const req of await cache.keys()) {
            const path = new URL(req.url).pathname;
            if (!path.includes("/p/")) continue;
            if (out.some((o) => o.url === path)) continue;
            const res = await cache.match(req);
            const html = res ? await res.text() : "";
            const title = /<title>([^<]{1,120})</i.exec(html)?.[1]?.split("·")[0]?.trim();
            out.push({ url: path, title: title || decodeURIComponent(path.split("/p/")[1] ?? "").replace(/-/g, " ") });
            if (out.length >= max) break;
          }
          if (out.length >= max) break;
        }
        if (!cancelled) setItems(out);
      } catch {
        if (!cancelled) setItems([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [base, max]);

  if (!items?.length) return null;
  return (
    <div className="mt-8 w-full text-left">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-ink-muted">Derniers produits vus</h2>
      <ul className="divide-y divide-line">
        {items.map((i) => (
          <li key={i.url}>
            <a href={i.url} className="flex min-h-11 items-center text-sm text-ink hover:underline hover:underline-offset-4">
              <span className="truncate first-letter:uppercase">{i.title}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
