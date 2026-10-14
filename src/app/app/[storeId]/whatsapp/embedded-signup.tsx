"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Script from "next/script";
import { MessageCircle } from "lucide-react";
import { finishEmbeddedSignup } from "@/lib/whatsapp/actions";
import type { EmbeddedSignupSetup } from "@/lib/whatsapp/embedded-signup-prefill";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/misc";

/** Données renvoyées par la fenêtre Meta via postMessage à la fin du flux Embedded Signup. */
type EsignupMessage = {
  type?: string;
  event?: string;
  data?: { phone_number_id?: string; waba_id?: string; error_message?: string; current_step?: string };
};

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

/** Attend (≤ 6 s) le message de fin de flux : Meta ne garantit pas qu'il arrive avant le callback FB.login. */
function waitForSession(ref: { current: { phoneNumberId?: string; wabaId?: string; error?: string; step?: string } }) {
  return new Promise<{ phoneNumberId?: string; wabaId?: string; error?: string; step?: string }>((resolve) => {
    const started = Date.now();
    const tick = () => {
      const s = ref.current;
      if (s.wabaId || s.error || s.step || Date.now() - started > 6000) return resolve(s);
      setTimeout(tick, 200);
    };
    tick();
  });
}

type Status = { kind: "idle" } | { kind: "working" } | { kind: "error"; message: string } | { kind: "done"; message: string };

/**
 * Bouton « Connecter avec WhatsApp » (mode partenaire). Charge le SDK JS Meta, lance l'Embedded Signup, récupère
 * le `code` (callback FB.login) ainsi que `phone_number_id` / `waba_id` (message de la fenêtre), puis appelle
 * l'action serveur qui finalise la connexion. Aucun identifiant à copier-coller côté marchand.
 */
export function EmbeddedSignupButton({
  storeId,
  appId,
  configId,
  version,
  setup = {},
  connected = false,
}: {
  storeId: string;
  appId: string;
  configId: string;
  version: string;
  /** Pré-remplissage de la fenêtre Meta (infos de la boutique). */
  setup?: EmbeddedSignupSetup;
  /** Un numéro est déjà connecté : le bouton sert à changer de numéro. */
  connected?: boolean;
}) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  // phone_number_id / waba_id arrivent par postMessage AVANT le callback FB.login : on les garde ici.
  // Ils peuvent aussi arriver juste APRÈS : le callback attend quelques secondes (waitForSession).
  const sessionRef = useRef<{ phoneNumberId?: string; wabaId?: string; error?: string; step?: string }>({});

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
      const ev = payload.event ?? "";
      // FINISH, FINISH_ONLY_WABA, FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING… (sessionInfoVersion 3)
      if (ev.startsWith("FINISH") && payload.data) {
        sessionRef.current = { phoneNumberId: payload.data.phone_number_id, wabaId: payload.data.waba_id };
      } else if (ev === "CANCEL") {
        sessionRef.current = { step: payload.data?.current_step };
      } else if (ev === "ERROR") {
        sessionRef.current = { error: payload.data?.error_message };
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
        void waitForSession(sessionRef).then((session) => {
        const { phoneNumberId, wabaId, error, step } = session;
        if (!wabaId) {
          setStatus({
            kind: "error",
            message: error
              ? `Meta a signalé une erreur : ${error}`
              : step
                ? `La connexion a été interrompue à l'étape « ${step} ». Relancez et allez jusqu'au partage du compte.`
                : "La fenêtre WhatsApp n'a pas renvoyé votre compte WhatsApp Business. Relancez et allez jusqu'au bout (compte, numéro vérifié, puis partage).",
          });
          return;
        }
        finishEmbeddedSignup({ storeId, code, phoneNumberId: phoneNumberId ?? "", wabaId })
          .then((r) => {
            if (r.ok) {
              setStatus({ kind: "done", message: r.message ?? "WhatsApp connecté." });
              router.refresh();
            } else {
              setStatus({ kind: "error", message: r.error });
            }
          })
          .catch(() => setStatus({ kind: "error", message: "Une erreur est survenue pendant la connexion. Réessayez." }));
        });
      },
      {
        config_id: configId,
        response_type: "code",
        override_default_response_type: true,
        // version v4 : doit correspondre à la configuration Embedded Signup créée chez Meta (« ES Config », v4).
        extras: { setup, featureType: "", sessionInfoVersion: "3", version: "v4" },
      },
    );
  }, [configId, router, setup, storeId]);

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
      <Button type="button" variant={connected ? "secondary" : "primary"} onClick={launch} loading={status.kind === "working"} disabled={!ready}>
        <MessageCircle className="size-4" aria-hidden /> {connected ? "Changer de numéro" : "Connecter avec WhatsApp"}
      </Button>
      <p className="text-xs leading-relaxed text-ink-muted">
        {connected
          ? "Pour connecter un autre numéro, relancez la fenêtre Meta : le nouveau numéro remplacera l'actuel."
          : "Une fenêtre Meta s'ouvre, déjà pré-remplie avec les informations de votre boutique : connectez-vous à Facebook, vérifiez-les, puis saisissez le code reçu par SMS. Aucun identifiant à recopier."}
      </p>
    </div>
  );
}
