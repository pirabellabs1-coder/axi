"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Script from "next/script";
import { MessageCircle } from "lucide-react";
import { finishEmbeddedSignup } from "@/lib/whatsapp/actions";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/misc";

/** Données renvoyées par la fenêtre Meta via postMessage à la fin du flux Embedded Signup. */
type EsignupMessage = { type?: string; event?: string; data?: { phone_number_id?: string; waba_id?: string } };

declare global {
  interface Window {
    FB?: {
      init: (params: { appId: string; autoLogAppEvents?: boolean; xfbml?: boolean; version: string }) => void;
      login: (
        cb: (res: { authResponse?: { code?: string } | null; status?: string }) => void,
        opts: { config_id: string; response_type: string; override_default_response_type: boolean; extras?: Record<string, unknown> },
      ) => void;
    };
    fbAsyncInit?: () => void;
  }
}

type Status = { kind: "idle" } | { kind: "working" } | { kind: "error"; message: string } | { kind: "done"; message: string };

/**
 * Bouton « Connecter avec WhatsApp » (mode partenaire). Charge le SDK JS Meta, lance l'Embedded Signup, récupère
 * le `code` (callback FB.login) ainsi que `phone_number_id` / `waba_id` (message de la fenêtre), puis appelle
 * l'action serveur qui finalise la connexion. Aucun identifiant à copier-coller côté marchand.
 */
export function EmbeddedSignupButton({ storeId, appId, configId, version }: { storeId: string; appId: string; configId: string; version: string }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  // phone_number_id / waba_id arrivent par postMessage AVANT le callback FB.login : on les garde ici.
  const sessionRef = useRef<{ phoneNumberId?: string; wabaId?: string }>({});

  const initFb = useCallback(() => {
    if (!window.FB) return;
    window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version });
    setReady(true);
  }, [appId, version]);

  // Capte le message de fin de flux Meta (phone_number_id + waba_id).
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      let host: string;
      try {
        host = new URL(event.origin).hostname;
      } catch {
        return;
      }
      if (host !== "facebook.com" && !host.endsWith(".facebook.com")) return;
      let payload: EsignupMessage | null = null;
      try {
        payload = typeof event.data === "string" ? (JSON.parse(event.data) as EsignupMessage) : (event.data as EsignupMessage);
      } catch {
        return;
      }
      if (payload?.type !== "WA_EMBEDDED_SIGNUP") return;
      if (payload.event === "FINISH" && payload.data) {
        sessionRef.current = { phoneNumberId: payload.data.phone_number_id, wabaId: payload.data.waba_id };
      } else if (payload.event === "CANCEL") {
        sessionRef.current = {};
      }
    }
    window.addEventListener("message", onMessage);
    // Si le script a chargé avant le montage (navigation cliente), initialise immédiatement.
    if (window.FB && !ready) initFb();
    return () => window.removeEventListener("message", onMessage);
  }, [initFb, ready]);

  const launch = useCallback(() => {
    if (!window.FB) return;
    sessionRef.current = {};
    setStatus({ kind: "working" });
    window.FB.login(
      (res) => {
        const code = res?.authResponse?.code;
        if (!code) {
          setStatus({ kind: "idle" });
          return;
        }
        const { phoneNumberId, wabaId } = sessionRef.current;
        if (!phoneNumberId || !wabaId) {
          setStatus({ kind: "error", message: "La fenêtre WhatsApp n'a pas renvoyé le numéro. Réessayez et finalisez bien toutes les étapes." });
          return;
        }
        finishEmbeddedSignup({ storeId, code, phoneNumberId, wabaId })
          .then((r) => {
            if (r.ok) {
              setStatus({ kind: "done", message: r.message ?? "WhatsApp connecté." });
              router.refresh();
            } else {
              setStatus({ kind: "error", message: r.error });
            }
          })
          .catch(() => setStatus({ kind: "error", message: "Une erreur est survenue pendant la connexion. Réessayez." }));
      },
      { config_id: configId, response_type: "code", override_default_response_type: true, extras: { setup: {}, featureType: "", sessionInfoVersion: "3" } },
    );
  }, [configId, router, storeId]);

  return (
    <div className="space-y-4">
      <Script
        src="https://connect.facebook.net/en_US/sdk.js"
        strategy="afterInteractive"
        onLoad={initFb}
        onReady={initFb}
      />
      {status.kind === "error" && <Alert tone="danger" title="Connexion impossible">{status.message}</Alert>}
      {status.kind === "done" && <Alert tone="success" title="Numéro connecté">{status.message}</Alert>}
      <Button type="button" variant="primary" onClick={launch} loading={status.kind === "working"} disabled={!ready}>
        <MessageCircle className="size-4" aria-hidden /> Connecter avec WhatsApp
      </Button>
      <p className="text-xs leading-relaxed text-ink-muted">
        Vous serez redirigé vers Meta pour autoriser Axi à envoyer des messages depuis votre numéro WhatsApp Business.
        Aucun identifiant à recopier : tout est configuré automatiquement.
      </p>
    </div>
  );
}
