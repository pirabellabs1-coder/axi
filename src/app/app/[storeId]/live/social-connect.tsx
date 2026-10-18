"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import Script from "next/script";
import { Link2 } from "lucide-react";
import { connectSocialPage, startSocialConnection, type PageChoice } from "@/lib/meta-social/actions";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/misc";

/** Sous-ensemble du SDK JS Meta utilisé ici (typé localement, sans redéclarer `window.FB`). */
type FbSdk = {
  init: (params: { appId: string; autoLogAppEvents?: boolean; xfbml?: boolean; version: string }) => void;
  login: (cb: (res: { authResponse?: { code?: string } | null }) => void, opts: { config_id: string; response_type: string; override_default_response_type: boolean }) => void;
};
const sdk = () => (window as unknown as { FB?: FbSdk }).FB;

type Status = { kind: "idle" } | { kind: "working" } | { kind: "error"; message: string } | { kind: "done"; message: string };

/**
 * « Connecter ma Page Facebook / Instagram » : Facebook Login for Business (configuration dédiée, réponse `code`).
 * Le code part à l'action serveur qui l'échange ; si plusieurs Pages sont partagées, le marchand choisit la sienne.
 * Aucun jeton ne transite en clair par le navigateur.
 */
export function SocialConnectButton({ storeId, appId, configId, version, connected }: { storeId: string; appId: string; configId: string; version: string; connected: boolean }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [choice, setChoice] = useState<{ session: string; pages: PageChoice[] } | null>(null);

  const initFb = useCallback(() => {
    const fb = sdk();
    if (!fb) return;
    fb.init({ appId, autoLogAppEvents: false, xfbml: false, version });
    setReady(true);
  }, [appId, version]);

  const launch = () => {
    const fb = sdk();
    if (!fb) return;
    setChoice(null);
    setStatus({ kind: "working" });
    fb.login(
      (res) => {
        const code = res?.authResponse?.code;
        if (!code) {
          setStatus({ kind: "idle" });
          return;
        }
        startSocialConnection({ storeId, code })
          .then((r) => {
            if (!r.ok) return setStatus({ kind: "error", message: r.error });
            if (r.data?.pages?.length) {
              setChoice(r.data);
              return setStatus({ kind: "idle" });
            }
            setStatus({ kind: "done", message: r.message ?? "Page connectée." });
            router.refresh();
          })
          .catch(() => setStatus({ kind: "error", message: "Une erreur est survenue pendant la connexion. Réessayez." }));
      },
      { config_id: configId, response_type: "code", override_default_response_type: true },
    );
  };

  const pick = (pageId: string) => {
    if (!choice) return;
    setStatus({ kind: "working" });
    connectSocialPage({ storeId, session: choice.session, pageId })
      .then((r) => {
        if (!r.ok) return setStatus({ kind: "error", message: r.error });
        setChoice(null);
        setStatus({ kind: "done", message: r.message ?? "Page connectée." });
        router.refresh();
      })
      .catch(() => setStatus({ kind: "error", message: "Une erreur est survenue pendant la connexion. Réessayez." }));
  };

  return (
    <div className="space-y-3">
      {/* onReady : appelé aussi quand le script est déjà chargé (navigation cliente). */}
      <Script src="https://connect.facebook.net/fr_FR/sdk.js" strategy="afterInteractive" onReady={initFb} />
      {status.kind === "error" && <Alert tone="danger" title="Connexion impossible">{status.message}</Alert>}
      {status.kind === "done" && <Alert tone="success" title="Connecté">{status.message}</Alert>}
      {choice ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-ink">Quelle Page relier à cette boutique ?</legend>
          <ul className="space-y-2">
            {choice.pages.map((p) => (
              <li key={p.id}>
                <Button type="button" variant="secondary" className="min-h-11 w-full justify-between" onClick={() => pick(p.id)} disabled={status.kind === "working"}>
                  <span className="truncate">{p.name}</span>
                  <span className="text-xs text-ink-muted">{p.instagram ?? "sans Instagram"}</span>
                </Button>
              </li>
            ))}
          </ul>
        </fieldset>
      ) : (
        <Button type="button" variant={connected ? "secondary" : "primary"} className="min-h-11" onClick={launch} loading={status.kind === "working"} disabled={!ready || status.kind === "working"}>
          <Link2 className="size-4" aria-hidden /> {connected ? "Connecter une autre Page" : "Connecter ma Page Facebook / Instagram"}
        </Button>
      )}
      <p className="text-xs leading-relaxed text-ink-muted">
        Une fenêtre Meta s&apos;ouvre : choisissez votre Page et, si elle en a un, son compte Instagram professionnel. Axi reçoit alors les
        commentaires de vos directs et publications pour réserver les articles demandés.
      </p>
    </div>
  );
}
