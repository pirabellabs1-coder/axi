"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Script from "next/script";
import { MessageCircle, Smartphone } from "lucide-react";
import { finishEmbeddedSignup } from "@/lib/whatsapp/actions";
import { buildLoginExtras, parseEsignupMessage, type EmbeddedSignupSetup, type SignupMode } from "@/lib/whatsapp/embedded-signup-prefill";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/misc";

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
 * Boutons de connexion (mode partenaire) : « J'utilise déjà WhatsApp Business » (coexistence) ou « Connecter un
 * nouveau numéro » (flux standard). Charge le SDK JS Meta, lance l'Embedded Signup, récupère
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
  /** Un numéro est déjà connecté : les boutons servent à changer de numéro. */
  connected?: boolean;
}) {
  const [mode, setMode] = useState<SignupMode | null>(null);
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
      const session = parseEsignupMessage(event.data);
      if (session) sessionRef.current = session;
    }
    window.addEventListener("message", onMessage);
    // Si le script a chargé avant le montage (navigation cliente), initialise immédiatement.
    if (window.FB && !ready) initFb();
    return () => window.removeEventListener("message", onMessage);
  }, [initFb, ready]);

  const launch = useCallback((chosen: SignupMode) => {
    if (!window.FB) return;
    sessionRef.current = {};
    setMode(chosen);
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
        finishEmbeddedSignup({ storeId, code, phoneNumberId: phoneNumberId ?? "", wabaId, mode: chosen })
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
        // Coexistence : featureType « whatsapp_business_app_onboarding » ; le pré-remplissage reste envoyé.
        extras: buildLoginExtras(setup, chosen),
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
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2 rounded-[var(--radius-md)] p-4 ring-1 ring-line">
          <Button
            type="button"
            variant={connected ? "secondary" : "primary"}
            className="min-h-11 w-full"
            onClick={() => launch("coexistence")}
            loading={status.kind === "working" && mode === "coexistence"}
            disabled={!ready || status.kind === "working"}
          >
            <Smartphone className="size-4" aria-hidden /> J&apos;utilise déjà WhatsApp Business
          </Button>
          <p className="text-xs leading-relaxed text-ink-muted">
            Recommandé : vous gardez l&apos;application sur votre téléphone, avec le même numéro. Contacts et historique sont importés.
            Application WhatsApp Business 2.24.17 ou plus récente requise.
          </p>
        </div>
        <div className="space-y-2 rounded-[var(--radius-md)] p-4 ring-1 ring-line">
          <Button
            type="button"
            variant="secondary"
            className="min-h-11 w-full"
            onClick={() => launch("standard")}
            loading={status.kind === "working" && mode === "standard"}
            disabled={!ready || status.kind === "working"}
          >
            <MessageCircle className="size-4" aria-hidden /> Connecter un nouveau numéro
          </Button>
          <p className="text-xs leading-relaxed text-ink-muted">
            Numéro dédié à l&apos;API, non utilisé dans une application WhatsApp. Vérification par code SMS.
          </p>
        </div>
      </div>
      <p className="text-xs leading-relaxed text-ink-muted">
        {connected
          ? "Pour connecter un autre numéro, relancez la fenêtre Meta : le nouveau numéro remplacera l'actuel."
          : "Une fenêtre Meta s'ouvre, déjà pré-remplie avec les informations de votre boutique : connectez-vous à Facebook, vérifiez-les puis validez. Aucun identifiant à recopier."}
      </p>
    </div>
  );
}
