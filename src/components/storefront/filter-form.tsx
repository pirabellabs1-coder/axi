"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

/**
 * Formulaire GET des filtres : fonctionne sans JS (bouton « Appliquer »), et avec JS applique chaque changement
 * sans rechargement complet (navigation client, défilement conservé).
 */
export function FilterForm({ action, children, className, id }: { action: string; children: React.ReactNode; className?: string; id?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = (form: HTMLFormElement) => {
    const fd = new FormData(form);
    const sp = new URLSearchParams();
    for (const [k, v] of fd.entries()) if (typeof v === "string" && v.trim() !== "") sp.append(k, v.trim());
    const q = sp.toString();
    start(() => router.push(`${action}${q ? `?${q}` : ""}`, { scroll: false }));
  };
  return (
    <form
      id={id}
      action={action}
      method="get"
      className={className}
      aria-busy={pending}
      data-pending={pending || undefined}
      onChange={(e) => {
        const t = e.target as unknown as HTMLInputElement;
        if (t.type === "number") return; // prix : appliqué à la validation
        go(e.currentTarget);
      }}
      onSubmit={(e) => {
        e.preventDefault();
        go(e.currentTarget);
      }}
    >
      {children}
    </form>
  );
}
