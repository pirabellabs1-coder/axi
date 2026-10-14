"use client";

import { useId, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Coins } from "lucide-react";
import { cn } from "@/lib/utils";
import { CURRENCY_COOKIE, CURRENCY_COOKIE_MAX_AGE } from "@/lib/currency/pick";

/**
 * Sélecteur de devise d'affichage de la vitrine (lot 2, §1.2). Prêt à monter dans l'en-tête :
 *
 *   const currency = await getCurrencyPickerData(store);            // src/lib/currency/display.ts (serveur)
 *   {currency && <CurrencyPicker {...currency} />}
 *
 * Écrit le cookie `axi_cur` (préférence d'affichage, SameSite=Lax) puis rafraîchit la page : le serveur relit la
 * devise et revalide qu'elle est active. Rien n'est rendu s'il n'y a qu'une devise. `<select>` natif : clavier,
 * lecteurs d'écran et mobile sans script supplémentaire ; cible ≥ 44 px.
 */
const noopSubscribe = () => () => undefined;

export function CurrencyPicker({ current, options, className, compact = false }: { current: string; options: { code: string; label: string }[]; className?: string; compact?: boolean }) {
  const router = useRouter();
  const id = useId();
  const [pending, start] = useTransition();
  // Inactif jusqu'à l'hydratation : un choix fait avant serait perdu (le cookie est écrit par le script).
  const ready = useSyncExternalStore(noopSubscribe, () => true, () => false);
  if (options.length < 2) return null;

  function choose(code: string) {
    if (!/^[A-Z]{3}$/.test(code)) return;
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${CURRENCY_COOKIE}=${code}; Path=/; Max-Age=${CURRENCY_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
    start(() => router.refresh());
  }

  return (
    <div className={cn("relative inline-flex items-center", className)}>
      <label htmlFor={id} className="sr-only">
        Devise d&apos;affichage
      </label>
      <Coins className="pointer-events-none absolute left-3 size-4 text-current opacity-70" aria-hidden />
      <select
        id={id}
        value={current}
        disabled={pending || !ready}
        aria-busy={pending || undefined}
        onChange={(e) => choose(e.target.value)}
        className={cn(
          "min-h-11 cursor-pointer appearance-none rounded-full bg-transparent py-2 pl-9 pr-4 text-sm font-medium text-current ring-1 ring-inset ring-current/25 transition-opacity hover:ring-current/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--store-primary,currentColor)] disabled:opacity-60",
          compact && "max-w-[7.5rem]",
        )}
      >
        {options.map((o) => (
          <option key={o.code} value={o.code}>
            {compact ? (o.code === "XOF" || o.code === "XAF" ? "FCFA" : o.code) : o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
