"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell } from "lucide-react";
import { cn } from "@/lib/utils";

const POLL_MS = 30_000;

/**
 * Cloche de l'en-tête : compteur des notifications non vues, rafraîchi toutes les 30 s
 * (uniquement quand l'onglet est visible) et à chaque navigation.
 *
 * <NotificationBell storeId={store.id} />
 */
export function NotificationBell({ storeId, initialCount = 0, className }: { storeId: string; initialCount?: number; className?: string }) {
  const [count, setCount] = useState(initialCount);
  const pathname = usePathname();
  const href = `/app/${storeId}/notifications`;
  const active = pathname === href;
  const inflight = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    inflight.current?.abort();
    const ctrl = new AbortController();
    inflight.current = ctrl;
    try {
      const res = await fetch(`/app/${storeId}/notifications/count`, { cache: "no-store", signal: ctrl.signal });
      if (!res.ok) return;
      const data = (await res.json()) as { unseen?: number };
      if (typeof data.unseen === "number") setCount(data.unseen);
    } catch {
      // réseau coupé ou requête annulée : on garde la dernière valeur
    }
  }, [storeId]);

  useEffect(() => {
    // Sur la page Notifications, le flux est marqué comme lu : on remet le compteur à zéro.
    const t = setTimeout(() => (active ? setCount(0) : void refresh()), active ? 0 : 400);
    return () => clearTimeout(t);
  }, [pathname, active, refresh]);

  useEffect(() => {
    const id = setInterval(refresh, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      inflight.current?.abort();
    };
  }, [refresh]);

  const label = count > 0 ? `Notifications, ${count} non lue${count > 1 ? "s" : ""}` : "Notifications";
  return (
    <Link
      href={href}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink-muted transition-[background-color,color,transform] duration-200 ease-out hover:bg-surface-2 hover:text-ink active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2",
        active && "bg-surface-2 text-ink",
        className,
      )}
    >
      <Bell className="size-[19px]" aria-hidden />
      {count > 0 && (
        <span
          aria-hidden
          className="absolute right-1.5 top-1.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-[11px] font-semibold leading-none text-on-accent tabular ring-2 ring-surface"
        >
          {count > 9 ? "9+" : count}
        </span>
      )}
      <span className="sr-only" aria-live="polite">
        {count > 0 ? `${count} notification${count > 1 ? "s" : ""} non lue${count > 1 ? "s" : ""}` : ""}
      </span>
    </Link>
  );
}
