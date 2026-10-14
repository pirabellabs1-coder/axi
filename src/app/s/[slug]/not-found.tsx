"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { SearchX } from "lucide-react";
import { storePath } from "@/components/storefront/format";

/** Rendu dans le layout boutique (produit ou page inexistants). Une boutique inconnue remonte au not-found racine. */
export default function StoreNotFound() {
  const params = useParams<{ slug?: string }>();
  const href = params?.slug ? storePath(params.slug) : "/";
  return (
    <div className="container-x py-16 sm:py-24">
      <div className="mx-auto flex max-w-md flex-col items-center rounded-[var(--store-card-radius)] bg-surface px-6 py-12 text-center ring-1 ring-line">
        <span className="mb-5 inline-flex size-14 items-center justify-center rounded-full bg-[var(--store-primary-soft)] text-[var(--store-primary)]">
          <SearchX className="size-6" aria-hidden />
        </span>
        <h1 className="text-xl font-semibold tracking-[-0.02em] text-ink">Page introuvable</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">Ce produit ou cette page a peut-être été retiré. Le reste du catalogue vous attend.</p>
        <Link href={href} className="mt-6 inline-flex h-12 items-center rounded-full bg-[var(--store-primary)] px-6 text-sm font-semibold text-[var(--store-primary-contrast)] active:scale-[0.98]">
          Retour à la boutique
        </Link>
        {params?.slug && (
          <form action={href} method="get" role="search" className="mt-4 w-full">
            <label htmlFor="nf-search" className="sr-only">
              Rechercher dans la boutique
            </label>
            <input id="nf-search" name="q" type="search" placeholder="Rechercher dans la boutique…" className="h-12 w-full rounded-full bg-surface-2 px-5 text-[15px] text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-[var(--store-primary)]" />
          </form>
        )}
      </div>
    </div>
  );
}
