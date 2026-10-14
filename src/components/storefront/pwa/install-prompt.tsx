"use client";

import { useEffect, useRef, useState } from "react";
import { Download, X } from "lucide-react";

type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

const VISITS_KEY = "axi:pwa:visits";
const DISMISS_KEY = "axi:pwa:dismissed";
/** Invitation reproposée au plus tôt 30 jours après un refus. */
const SNOOZE_MS = 30 * 24 * 3600 * 1000;

function slugOf(scope: string): string {
  const m = /^\/s\/([a-z0-9-]+)\//.exec(scope);
  return m ? m[1] : "";
}

/** Le visiteur a déjà un panier sur cette boutique (lecture directe du panier local, aucun suivi ajouté). */
function hasCart(scope: string): boolean {
  try {
    const slug = slugOf(scope);
    const keys = slug ? [`axi:cart:${slug}`] : Object.keys(window.localStorage).filter((k) => k.startsWith("axi:cart:"));
    return keys.some((k) => {
      const raw = window.localStorage.getItem(k);
      return !!raw && raw !== "[]";
    });
  } catch {
    return false;
  }
}

/**
 * Invitation discrète à l'installation (lot 4 §14) : proposée à partir de la 2ᵉ visite ou dès qu'un panier
 * existe, uniquement si le navigateur déclare la boutique installable (`beforeinstallprompt`), et jamais
 * dans une application déjà installée. Refus mémorisé 30 jours. Désactivable par le commerçant (thème).
 *
 * Accessibilité : bandeau `role="dialog"` non modal, focus laissé au visiteur, deux cibles de 44 px,
 * fermeture au clavier (bouton « Plus tard » et touche Échap), apparition en `transform`/`opacity`
 * et immobile sous `prefers-reduced-motion`.
 */
export function InstallPrompt({ storeName, scope }: { storeName: string; scope: string }) {
  const [visible, setVisible] = useState(false);
  const deferred = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (window.top !== window.self) return;
    if (window.matchMedia("(display-mode: standalone)").matches) return;

    let visits = 1;
    try {
      visits = Math.min(Number(window.localStorage.getItem(VISITS_KEY) ?? "0") + 1, 99);
      window.localStorage.setItem(VISITS_KEY, String(visits));
      const dismissed = Number(window.localStorage.getItem(DISMISS_KEY) ?? "0");
      if (dismissed && Date.now() - dismissed < SNOOZE_MS) return;
    } catch {
      /* stockage indisponible (navigation privée) : on s'en tient à l'événement du navigateur */
    }
    const eligible = visits >= 2 || hasCart(scope);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      deferred.current = e as BeforeInstallPromptEvent;
      if (eligible) setVisible(true);
    };
    const onInstalled = () => setVisible(false);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [scope]);

  const close = () => {
    setVisible(false);
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* ignoré */
    }
  };

  const install = async () => {
    const e = deferred.current;
    setVisible(false);
    if (!e) return;
    try {
      await e.prompt();
      const choice = await e.userChoice;
      if (choice.outcome === "dismissed") close();
    } catch {
      /* invitation déjà consommée */
    }
  };

  if (!visible) return null;
  return (
    <div
      role="dialog"
      aria-label="Installer la boutique"
      onKeyDown={(e) => {
        if (e.key === "Escape") close();
      }}
      className="fixed inset-x-3 bottom-3 z-40 mx-auto max-w-sm rounded-[18px] bg-surface p-3 shadow-[var(--shadow-md)] ring-1 ring-line sm:left-3 sm:right-auto"
    >
      <div className="flex items-center gap-3">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--store-primary-soft)] text-[var(--store-primary)]">
          <Download className="size-5" aria-hidden />
        </span>
        <p className="min-w-0 flex-1 text-[13px] leading-snug text-ink">
          Ajoutez <span className="font-semibold">{storeName}</span> à votre écran d&apos;accueil : ouverture plus rapide, même avec peu de réseau.
        </p>
        <button type="button" onClick={close} aria-label="Plus tard" className="-mr-1 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-surface-2 hover:text-ink">
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <button
        type="button"
        onClick={install}
        className="mt-2 inline-flex h-11 w-full items-center justify-center rounded-full bg-[var(--store-primary)] px-5 text-sm font-semibold text-[var(--store-primary-contrast)] transition-transform duration-200 ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.98] motion-reduce:transition-none"
      >
        Installer
      </button>
    </div>
  );
}
