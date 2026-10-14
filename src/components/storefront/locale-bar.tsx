"use client";

import { useState } from "react";
import { Globe, X } from "lucide-react";
import type { LocaleView } from "@/i18n/locales";
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, isPlatformLocale } from "@/i18n/locales";
import { storefrontTranslator } from "@/i18n/dictionary";

/**
 * Langues de la vitrine (lot 2 §1.1) : sélecteur et bandeau de suggestion.
 *
 *  - l'URL fait foi : chaque langue est un vrai lien (`/en/…`), indexable, sans JavaScript obligatoire ;
 *  - le cookie `axi_locale` n'enregistre QUE la préférence affichée dans le bandeau : aucune redirection
 *    automatique (le même lien renvoie toujours la même page pour un moteur de recherche) ;
 *  - « Non merci » éteint la suggestion en enregistrant la langue courante comme préférence.
 */
export function LocaleBar({ view }: { view: LocaleView }) {
  const [dismissed, setDismissed] = useState(false);
  const { t } = storefrontTranslator(view.locale);
  if (view.options.length < 2) return null;
  const suggestion = !dismissed && view.suggestion ? view.suggestion : null;

  function remember(code: string) {
    if (!isPlatformLocale(code) || typeof document === "undefined") return;
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${LOCALE_COOKIE}=${code}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
  }

  return (
    <div className="border-b border-line bg-surface text-ink">
      {suggestion && (
        <div role="status" className="mx-auto flex max-w-[var(--store-page-width,1200px)] flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
          {/* Suggestion : lien explicite, jamais une redirection (SEO) */}
          <span>{storefrontTranslator(suggestion.locale).t("locale.suggestion", { language: suggestion.label })}</span>
          <a href={suggestion.href} onClick={() => remember(suggestion.locale)} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4">
            {suggestion.label}
          </a>
          <button type="button" onClick={() => setDismissed(true)} className="ms-auto inline-flex min-h-11 items-center gap-1.5 px-1 text-ink-muted hover:text-ink">
            <X className="size-4" aria-hidden />
            {t("locale.dismiss")}
          </button>
        </div>
      )}
      <nav aria-label={t("locale.label")} className="mx-auto flex max-w-[var(--store-page-width,1200px)] flex-wrap items-center gap-1 px-4 py-1.5 text-sm">
        <Globe className="me-1 size-4 text-ink-muted" aria-hidden />
        {view.options.map((o) => (
          <a
            key={o.code}
            href={o.href}
            lang={o.code}
            hrefLang={o.code}
            aria-current={o.current ? "true" : undefined}
            onClick={() => remember(o.code)}
            className={`inline-flex min-h-11 items-center rounded-full px-3 ${o.current ? "font-semibold text-ink" : "text-ink-muted hover:text-ink hover:underline"}`}
          >
            {o.label}
          </a>
        ))}
      </nav>
    </div>
  );
}
