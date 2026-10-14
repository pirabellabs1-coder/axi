"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Menu, MessageCircle, X } from "lucide-react";
import type { MenuLink } from "@/lib/storefront/render-types";
import { CurrencyPicker } from "./currency-picker";
import { cn } from "@/lib/utils";

/** Menu mobile plein écran (dialog natif : focus piégé, Échap pour fermer), liens en cascade. */
export function MobileMenu({ links, storeName, whatsappHref, currency }: { links: MenuLink[]; storeName: string; whatsappHref: string | null; /** Lot 2 (devises) : sélecteur affiché ici sur mobile (l'en-tête n'a pas la place à 375 px). */ currency?: React.ComponentProps<typeof CurrencyPicker> | null }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => {
    ref.current?.close();
  }, [pathname]);
  return (
    <>
      <button type="button" onClick={() => ref.current?.showModal()} aria-label="Ouvrir le menu" aria-expanded={open} className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink transition-colors hover:bg-surface-2 lg:hidden">
        <Menu className="size-5" aria-hidden />
      </button>
      <dialog
        ref={ref}
        onClose={() => setOpen(false)}
        onCancel={() => setOpen(false)}
        onToggle={(e) => setOpen((e.target as HTMLDialogElement).open)}
        aria-label="Menu"
        className="sf-ink-reset m-0 h-dvh max-h-none w-[min(88vw,380px)] max-w-none bg-surface p-0 text-ink shadow-[var(--shadow-lg)] backdrop:bg-black/40 open:animate-[sf-rise_350ms_cubic-bezier(0.16,1,0.3,1)]"
        onClick={(e) => e.target === ref.current && ref.current?.close()}
      >
        <div className="flex h-full flex-col">
          <div className="flex h-16 items-center justify-between border-b border-line px-4">
            <p className="truncate text-[15px] font-semibold">{storeName}</p>
            <button type="button" onClick={() => ref.current?.close()} aria-label="Fermer le menu" className="inline-flex size-11 items-center justify-center rounded-full hover:bg-surface-2" autoFocus>
              <X className="size-5" aria-hidden />
            </button>
          </div>
          <nav aria-label="Navigation principale" className="flex-1 overflow-y-auto px-2 py-3">
            <ul>
              {links.map((l, i) =>
                l.children.length ? (
                  <li key={i}>
                    <details className="group">
                      <summary className="flex min-h-13 cursor-pointer list-none items-center justify-between rounded-[12px] px-3 text-[17px] font-medium hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
                        {l.label}
                        <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
                      </summary>
                      <ul className="mb-2 ml-3 border-l border-line pl-2">
                        <li>
                          <Link href={l.href} className="flex min-h-11 items-center rounded-[10px] px-3 text-[15px] text-ink-muted hover:bg-surface-2 hover:text-ink">
                            Tout voir
                          </Link>
                        </li>
                        {l.children.map((c, j) => (
                          <li key={j}>
                            <Link href={c.href} className="flex min-h-11 items-center rounded-[10px] px-3 text-[15px] text-ink-muted hover:bg-surface-2 hover:text-ink">
                              {c.label}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </details>
                  </li>
                ) : (
                  <li key={i}>
                    <Link href={l.href} className={cn("flex min-h-13 items-center rounded-[12px] px-3 text-[17px] font-medium hover:bg-surface-2", pathname === l.href && "text-[var(--store-primary)]")}>
                      {l.label}
                    </Link>
                  </li>
                ),
              )}
            </ul>
          </nav>
          {currency && (
            <div className="border-t border-line p-4">
              <p className="mb-2 text-sm font-medium text-ink">Devise d&apos;affichage</p>
              <CurrencyPicker {...currency} className="w-full [&>select]:w-full" />
            </div>
          )}
          {whatsappHref && (
            <div className="border-t border-line p-4">
              <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className="sf-btn sf-btn-whatsapp h-12 w-full">
                <MessageCircle className="size-5" aria-hidden /> Écrire sur WhatsApp
              </a>
            </div>
          )}
        </div>
      </dialog>
    </>
  );
}
