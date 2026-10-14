"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CalendarClock, ExternalLink, MessageCircle, Radio } from "lucide-react";
import { cn } from "@/lib/utils";
import { countdownLabel, countdownParts, type LiveStatus } from "@/lib/live/stream";
import { requestLiveReminder } from "@/lib/live/actions";
import { ProductImage } from "../product-image";

/**
 * Panneau du direct (lot 4 §18, équipe CAN).
 *
 *  - compte à rebours mis à jour chaque seconde, doublé d'un texte lisible par un lecteur d'écran
 *    (`aria-live="polite"` sur la minute, pas sur la seconde : pas de bavardage) ;
 *  - produits épinglés rafraîchis toutes les 15 s par `/api/live/{slug}`, uniquement quand la section est
 *    visible ET l'onglet au premier plan (aucune requête inutile sur un réseau lent) ;
 *  - « Me rappeler sur WhatsApp » : numéro + case de consentement explicite, action serveur ;
 *  - aucun lecteur tiers intégré (politique de sécurité) : le direct s'ouvre dans un nouvel onglet.
 */

export type LivePanelEvent = {
  id: string;
  title: string;
  startsAt: string;
  status: LiveStatus;
  platform: string;
  streamUrl: string;
  products: { id: string; slug: string; name: string; priceLabel: string; image: string | null; soldOut: boolean; pinned: boolean }[];
};

const POLL_MS = 15_000;


/**
 * Chargement du direct depuis `/api/live/{slug}` (la section de boutique reste un composant pur, sans accès
 * base, pour rester rendue à l'identique dans l'aperçu de l'éditeur).
 * États explicites : chargement (squelette), aucun direct (rien, ou une note dans l'aperçu), direct affiché.
 */
export function LiveLoader({ slug, base, showReminder, hideWhenNone, preview, note }: { slug: string; base: string; showReminder: boolean; hideWhenNone: boolean; preview: boolean; note: string }) {
  const [state, setState] = useState<{ phase: "loading" | "ready"; event: LivePanelEvent | null }>({ phase: "loading", event: null });
  const host = useRef<HTMLDivElement>(null);

  // « Masquer la section si aucun direct n'est prévu » : la section (rendue par le serveur) porte les marges,
  // on la replie donc ici plutôt que de laisser un espace vide.
  useEffect(() => {
    const section = host.current?.closest<HTMLElement>("[data-section-id]");
    if (!section) return;
    const hide = state.phase === "ready" && !state.event && hideWhenNone && !preview;
    section.style.display = hide ? "none" : "";
    return () => {
      section.style.display = "";
    };
  }, [state, hideWhenNone, preview]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/live/${slug}`, { cache: "no-store" });
        const data = res.ok ? ((await res.json()) as { event: LivePanelEvent | null }) : { event: null };
        if (!cancelled) setState({ phase: "ready", event: data.event });
      } catch {
        if (!cancelled) setState({ phase: "ready", event: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (state.phase === "loading") {
    return (
      <div ref={host} className="grid grid-cols-1 gap-6 md:grid-cols-[1.1fr_1fr] md:gap-10" aria-busy="true">
        <div className="h-48 animate-pulse rounded-[calc(var(--store-card-radius)+4px)] bg-surface-2 motion-reduce:animate-none" />
        <div className="h-48 animate-pulse rounded-[calc(var(--store-card-radius)+4px)] bg-surface-2 motion-reduce:animate-none" />
      </div>
    );
  }
  if (!state.event) {
    if (hideWhenNone && !preview) return <div ref={host} hidden />;
    return (
      <p className="rounded-[18px] bg-surface p-4 text-sm text-ink-muted ring-1 ring-line">
        {preview ? "Aucun direct programmé pour l'instant. Programmez-en un dans « Direct » : la section s'affichera alors ici." : note || "Aucun direct programmé pour le moment."}
      </p>
    );
  }
  return (
    <div ref={host}>
      <LivePanel slug={slug} base={base} initial={state.event} showReminder={showReminder} />
    </div>
  );
}

function LivePanel({ slug, base, initial, showReminder }: { slug: string; base: string; initial: LivePanelEvent; showReminder: boolean }) {
  const [event, setEvent] = useState(initial);
  const [now, setNow] = useState(() => Date.now());
  const box = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  // Horloge locale du compte à rebours (arrêtée une fois le direct commencé).
  useEffect(() => {
    if (event.status !== "scheduled") return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [event.status]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.05 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Rafraîchissement des produits épinglés.
  useEffect(() => {
    if (!visible) return;
    let stopped = false;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/live/${slug}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { event: LivePanelEvent | null };
        if (!stopped && data.event && data.event.id === event.id) setEvent(data.event);
      } catch {
        /* réseau indisponible : on garde l'affichage courant */
      }
    };
    const id = window.setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [visible, slug, event.id]);

  const parts = countdownParts(event.startsAt, now);
  const live = event.status === "live";
  const pinned = event.products.find((p) => p.pinned) ?? null;

  return (
    <div ref={box} className="grid grid-cols-1 gap-6 md:grid-cols-[1.1fr_1fr] md:items-start md:gap-10">
      <div className="rounded-[calc(var(--store-card-radius)+4px)] bg-surface p-5 ring-1 ring-line">
        <p className="flex items-center gap-2 text-sm font-semibold">
          {live ? (
            <span className="inline-flex items-center gap-2 rounded-full bg-[#d11a2a] px-3 py-1 text-xs font-bold uppercase tracking-wide text-white">
              <Radio className="size-3.5" aria-hidden /> En direct
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-full bg-[var(--store-primary-soft)] px-3 py-1 text-xs font-semibold text-[var(--store-primary)]">
              <CalendarClock className="size-3.5" aria-hidden /> Bientôt
            </span>
          )}
        </p>
        <h3 className="mt-3 text-lg font-semibold text-ink">{event.title}</h3>

        {!live && (
          <>
            <ul className="mt-4 flex gap-2" aria-hidden>
              {[
                { v: parts.days, l: "j" },
                { v: parts.hours, l: "h" },
                { v: parts.minutes, l: "min" },
                { v: parts.seconds, l: "s" },
              ].map((u) => (
                <li key={u.l} className="min-w-14 rounded-[14px] bg-surface-2 px-3 py-2 text-center">
                  <span className="block font-mono text-xl font-semibold tabular text-ink">{String(u.v).padStart(2, "0")}</span>
                  <span className="block text-[11px] text-ink-muted">{u.l}</span>
                </li>
              ))}
            </ul>
            <p role="status" aria-live="polite" className="mt-2 text-sm text-ink-muted">
              Début dans {countdownLabel({ ...parts, seconds: 0 })}
            </p>
          </>
        )}

        <div className="mt-5 flex flex-wrap gap-3">
          <a
            href={event.streamUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "inline-flex min-h-12 items-center gap-2 rounded-full px-6 text-sm font-semibold transition-transform active:scale-[0.98] motion-reduce:transition-none",
              live ? "bg-[var(--store-primary)] text-[var(--store-primary-contrast)]" : "bg-surface-2 text-ink ring-1 ring-inset ring-line",
            )}
          >
            <ExternalLink className="size-4" aria-hidden />
            {live ? `Regarder sur ${event.platform}` : `Voir la page ${event.platform}`}
            <span className="sr-only"> (nouvel onglet)</span>
          </a>
        </div>

        {showReminder && !live && <ReminderForm slug={slug} eventId={event.id} />}
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-ink-muted">{live ? "Produits du direct" : "Au programme"}</h3>
        {event.products.length === 0 ? (
          <p className="rounded-[18px] bg-surface p-4 text-sm text-ink-muted ring-1 ring-line">Les produits seront annoncés pendant le direct.</p>
        ) : (
          <ul className="space-y-3">
            {event.products.map((p) => (
              <li
                key={p.id}
                aria-current={p.pinned ? "true" : undefined}
                className={cn("rounded-[min(var(--store-card-radius),18px)] bg-surface p-3 ring-1", p.pinned ? "ring-2 ring-[var(--store-primary)]" : "ring-line")}
              >
                <Link href={`${base}/p/${p.slug}`} className="group flex items-center gap-3">
                  <ProductImage src={p.image ?? undefined} alt="" ratio="aspect-square" className="w-16 shrink-0 rounded-[12px]" sizes="64px" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink group-hover:underline group-hover:underline-offset-4">{p.name}</span>
                    <span className="mt-0.5 block text-sm text-ink-muted">
                      <span className="font-semibold text-ink">{p.priceLabel}</span>
                      {p.soldOut && <span className="ml-2">· épuisé</span>}
                      {p.pinned && <span className="ml-2 font-semibold text-[var(--store-primary)]">· à l&apos;écran</span>}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {pinned && <p className="sr-only" role="status" aria-live="polite">{`Produit présenté : ${pinned.name}`}</p>}
      </div>
    </div>
  );
}

function ReminderForm({ slug, eventId }: { slug: string; eventId: string }) {
  const [state, action] = useActionState(requestLiveReminder, undefined);
  if (state?.ok) {
    return (
      <p role="status" className="mt-5 rounded-[14px] bg-whatsapp-soft p-3 text-sm font-medium text-whatsapp-deep">
        {state.message}
      </p>
    );
  }
  return (
    <form action={action} noValidate className="mt-5 space-y-3 border-t border-line pt-4">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="eventId" value={eventId} />
      <p className="text-sm font-medium text-ink">Me rappeler sur WhatsApp</p>
      {state && !state.ok && (
        <p role="alert" className="text-sm font-medium text-danger">
          {state.error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <label htmlFor={`live-name-${eventId}`} className="sr-only">
          Votre prénom
        </label>
        <input
          id={`live-name-${eventId}`}
          name="name"
          autoComplete="given-name"
          placeholder="Prénom (facultatif)"
          maxLength={80}
          className="h-12 min-w-36 flex-1 rounded-full bg-surface-2 px-4 text-[15px] text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-[var(--store-primary)]"
        />
        <label htmlFor={`live-phone-${eventId}`} className="sr-only">
          Votre numéro WhatsApp
        </label>
        <input
          id={`live-phone-${eventId}`}
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          placeholder="Numéro WhatsApp"
          maxLength={24}
          className="h-12 min-w-40 flex-1 rounded-full bg-surface-2 px-4 text-[15px] text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-[var(--store-primary)]"
        />
      </div>
      <label className="flex items-start gap-2 text-[13px] leading-relaxed text-ink-muted">
        <input type="checkbox" name="consent" required className="mt-0.5 size-5 shrink-0 accent-[var(--store-primary)]" />
        <span>J&apos;accepte de recevoir un message WhatsApp pour ce direct et les offres de la boutique. Je peux me désinscrire à tout moment.</span>
      </label>
      <button
        type="submit"
        className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-whatsapp-deep px-6 text-sm font-semibold text-white transition-transform active:scale-[0.98] motion-reduce:transition-none"
      >
        <MessageCircle className="size-4" aria-hidden /> Me rappeler
      </button>
    </form>
  );
}
