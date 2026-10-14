"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Bell, BellOff, Gauge } from "lucide-react";
import { LITE_COOKIE, LITE_COOKIE_MAX_AGE } from "@/lib/pwa/lite";
import { subscribeToPush, unsubscribeFromPush } from "@/lib/push/actions";

/**
 * Compléments du pied de page du lot 4D : interrupteur « Mode économie de données » (§14) et
 * abonnement aux notifications (§19). Composants CLIENT sans import serveur : le pied de page est aussi
 * rendu dans l'aperçu en direct de l'éditeur, où ces contrôles restent inertes (`[data-preview]`).
 *
 * Les réglages serveur (portée, clé publique VAPID, mode économie effectif) sont lus dans les balises
 * `<meta name="axi-pwa">` et `<meta name="axi-push-key">` posées par `PwaHead`.
 */

type PwaMeta = { slug: string; scope: string; sw: boolean; lite: boolean; push: boolean };

function readPwaMeta(): PwaMeta | null {
  const raw = document.querySelector('meta[name="axi-pwa"]')?.getAttribute("content");
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<PwaMeta>;
    if (typeof o.slug !== "string" || typeof o.scope !== "string") return null;
    return { slug: o.slug, scope: o.scope, sw: o.sw === true, lite: o.lite === true, push: o.push === true };
  } catch {
    return null;
  }
}

/**
 * Lecture unique et mémorisée des réglages posés par `PwaHead` : `useSyncExternalStore` évite à la fois
 * un `setState` dans un effet et une différence entre le rendu serveur (rien) et le client.
 */
let cachedMeta: { meta: PwaMeta | null; preview: boolean } | null = null;
const noSubscribe = () => () => {};
const clientSnapshot = () => (cachedMeta ??= { meta: readPwaMeta(), preview: !!document.querySelector("[data-preview]") || window.top !== window.self });
const serverSnapshot = () => null;

export function FooterExtras() {
  const state = useSyncExternalStore(noSubscribe, clientSnapshot, serverSnapshot);
  const meta = state?.meta ?? null;
  const preview = state?.preview ?? true;

  if (!meta || preview) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <LiteToggle initial={meta.lite} />
      {meta.push && meta.sw && <PushToggle slug={meta.slug} scope={meta.scope} />}
    </div>
  );
}

/* ───────────── Mode économie de données ───────────── */

function LiteToggle({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);

  const toggle = () => {
    const next = !on;
    setOn(next);
    setBusy(true);
    // Cookie posé côté client (aucune donnée personnelle) : la page est rechargée pour que le serveur
    // rende la version allégée (police système, images réduites, aucune lecture automatique).
    document.cookie = `${LITE_COOKIE}=${next ? "1" : "0"}; path=/; max-age=${LITE_COOKIE_MAX_AGE}; samesite=lax`;
    window.location.reload();
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={on}
      className="inline-flex min-h-11 items-center gap-2 rounded-full px-1 text-xs font-medium text-ink-muted hover:text-ink disabled:opacity-60"
    >
      <Gauge className="size-4" aria-hidden />
      Mode économie de données&nbsp;: <span className="font-semibold">{on ? "activé" : "désactivé"}</span>
    </button>
  );
}

/* ───────────── Notifications ───────────── */

function urlBase64ToUint8Array(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function b64url(buf: ArrayBuffer | null): string {
  if (!buf) return "";
  let s = "";
  const bytes = new Uint8Array(buf);
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

type PushState = "unknown" | "unsupported" | "off" | "on" | "blocked";

function PushToggle({ slug, scope }: { slug: string; scope: string }) {
  const [state, setState] = useState<PushState>("unknown");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        if (!cancelled) setState("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        if (!cancelled) setState("blocked");
        return;
      }
      try {
        const reg = await navigator.serviceWorker.getRegistration(scope);
        const sub = await reg?.pushManager.getSubscription();
        if (!cancelled) setState(sub ? "on" : "off");
      } catch {
        if (!cancelled) setState("off");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scope]);

  if (state === "unknown" || state === "unsupported") return null;

  const enable = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const key = document.querySelector('meta[name="axi-push-key"]')?.getAttribute("content");
      if (!key) throw new Error("Notifications indisponibles");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        return;
      }
      const reg = (await navigator.serviceWorker.getRegistration(scope)) ?? (await navigator.serviceWorker.ready);
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) as BufferSource });
      const json = sub.toJSON() as { endpoint?: string };
      const res = await subscribeToPush({
        slug,
        endpoint: json.endpoint ?? sub.endpoint,
        p256dh: b64url(sub.getKey("p256dh")),
        auth: b64url(sub.getKey("auth")),
        topics: ["orders", "marketing"],
      });
      if (!res.ok) {
        await sub.unsubscribe().catch(() => {});
        setState("off");
        setMessage(res.error);
        return;
      }
      setState("on");
      setMessage("Notifications activées.");
    } catch {
      setState("off");
      setMessage("Activation impossible sur ce navigateur.");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration(scope);
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await unsubscribeFromPush({ slug, endpoint: sub.endpoint });
        await sub.unsubscribe().catch(() => {});
      }
      setState("off");
      setMessage("Notifications désactivées.");
    } catch {
      setMessage("Désactivation impossible.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={state === "on" ? disable : enable}
        disabled={busy || state === "blocked"}
        aria-pressed={state === "on"}
        className="inline-flex min-h-11 items-center gap-2 rounded-full px-1 text-xs font-medium text-ink-muted hover:text-ink disabled:opacity-60"
      >
        {state === "on" ? <BellOff className="size-4" aria-hidden /> : <Bell className="size-4" aria-hidden />}
        {state === "blocked" ? "Notifications bloquées par le navigateur" : state === "on" ? "Désactiver les notifications" : busy ? "Activation…" : "Recevoir les notifications"}
      </button>
      <span role="status" aria-live="polite" className="text-xs text-ink-muted">
        {message}
      </span>
    </span>
  );
}
