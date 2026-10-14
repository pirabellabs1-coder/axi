import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AlertTriangle, ArrowLeftRight, BadgeCheck, Eye, Lock, PencilLine, ShieldAlert, ShieldCheck, Store as StoreIcon } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { PLANS } from "@/config/plans";
import { AUTHORIZE_KEYS, OAUTH_RESUME_COOKIE, connectableStores, loadAndValidateAuthorize, pickAuthorizeParams } from "@/lib/mcp/oauth";
import { getMcpKillSwitch } from "@/lib/mcp/runtime";
import { isVerifiedRedirectUri } from "@/lib/mcp/tokens";
import { approveAuthorization, denyAuthorization } from "@/lib/mcp/oauth-actions";
import { SCOPE_LABELS } from "@/lib/mcp/scopes";
import { AxiMark, Logo } from "@/components/ui/logo";
import { Alert } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { SubmitButton } from "@/components/forms/submit-button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Autoriser une application", robots: { index: false, follow: false } };

const ERRORS: Record<string, string> = {
  invalid_client: "Application inconnue, désactivée ou non autorisée. Relancez la connexion depuis votre assistant IA.",
  invalid_request: "La demande de connexion est incomplète ou invalide (sécurité PKCE). Relancez-la depuis votre assistant IA.",
  unsupported_response_type: "Ce type de demande n'est pas pris en charge par Axi.",
  invalid_scope: "Les autorisations demandées ne sont pas reconnues par Axi.",
  invalid_target: "La demande vise un autre service qu'Axi.",
  no_store: "Aucune boutique éligible n'a été choisie. Relancez la connexion depuis votre assistant IA.",
  temporarily_unavailable: "Les connexions des assistants IA sont temporairement suspendues. Réessayez plus tard.",
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-canvas px-4 py-6 sm:py-10">
      <div className="mx-auto flex max-w-lg items-center justify-between">
        <Logo />
        <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
          <Lock className="size-3.5" aria-hidden /> Connexion sécurisée
        </span>
      </div>
      <main className="mx-auto mt-8 max-w-lg" id="contenu">
        {children}
      </main>
    </div>
  );
}

function Fatal({ message }: { message: string }) {
  return (
    <Shell>
      <div className="rounded-[var(--radius-xl)] bg-surface p-6 ring-1 ring-line shadow-[var(--shadow-card)] sm:p-8">
        <AlertTriangle className="size-6 text-warning" aria-hidden />
        <h1 className="mt-4 text-xl font-semibold tracking-[-0.02em] text-ink">Connexion impossible</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">{message}</p>
        <ButtonLink href="/app" variant="outline" className="mt-6">
          Retour à mon espace
        </ButtonLink>
      </div>
    </Shell>
  );
}

export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;

  // Retour de connexion : la demande mise de côté est rejouée (puis revalidée intégralement).
  if (sp.reprendre && !sp.client_id) {
    const saved = (await cookies()).get(OAUTH_RESUME_COOKIE)?.value;
    if (saved) redirect(`/oauth/authorize?${saved}`);
    return <Fatal message="La demande de connexion a expiré. Relancez-la depuis votre assistant IA." />;
  }
  if (typeof sp.error === "string" && !sp.client_id) return <Fatal message={ERRORS[sp.error] ?? "La demande de connexion est invalide."} />;

  const kill = await getMcpKillSwitch();
  if (kill.enabled) return <Fatal message={kill.message || ERRORS.temporarily_unavailable} />;

  // Aucune redirection vers l'application avant session ET consentement : toute erreur est affichée ici.
  const params = pickAuthorizeParams(sp);
  const v = await loadAndValidateAuthorize(params);
  if (!v.ok) return <Fatal message={v.fatal ? v.description : (ERRORS[v.error] ?? v.description)} />;
  const request = v.request;
  const verified = isVerifiedRedirectUri(request.redirectUri);

  const user = await getCurrentUser();
  if (!user) {
    const qs = new URLSearchParams();
    for (const k of AUTHORIZE_KEYS) if (params[k]) qs.set(k, params[k]!);
    redirect(`/oauth/authorize/connexion?${qs.toString()}`);
  }
  if (!user.emailVerified) return <Fatal message="Vérifiez d'abord votre adresse e-mail depuis votre espace Axi, puis relancez la connexion." />;

  const stores = await connectableStores(user.id, request.scopes);
  const eligible = stores.filter((s) => s.oauth && s.scopes.length > 0);
  const redirectHost = (() => {
    try {
      const u = new URL(request.redirectUri);
      return u.protocol === "http:" || u.protocol === "https:" ? u.host : u.protocol.replace(/:$/, "");
    } catch {
      return request.redirectUri;
    }
  })();
  const hidden = AUTHORIZE_KEYS.map((k) => {
    const value = k === "redirect_uri" ? request.redirectUri : params[k];
    return value ? <input key={k} type="hidden" name={k} value={value} /> : null;
  });
  const writes = request.scopes.filter((s) => SCOPE_LABELS[s].write);

  return (
    <Shell>
      <div className="rounded-[var(--radius-xl)] bg-surface ring-1 ring-line shadow-[var(--shadow-card)]">
        <div className="border-b border-line p-6 sm:p-8">
          <div className="flex items-center gap-3" aria-hidden>
            <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-surface-2 text-lg font-semibold text-ink ring-1 ring-line">
              {request.client.name.slice(0, 1).toUpperCase()}
            </span>
            <ArrowLeftRight className="size-4 text-ink-faint" />
            <AxiMark size={48} />
          </div>
          <div className="mt-5">
            {verified ? (
              <Badge tone="success">
                <BadgeCheck className="size-3.5" aria-hidden /> Application vérifiée
              </Badge>
            ) : (
              <p role="alert" className="flex items-start gap-2 rounded-[var(--radius-md)] bg-warning-soft px-3.5 py-3 text-[13px] leading-relaxed text-ink">
                <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                <span>
                  <span className="font-semibold">Application non vérifiée.</span> Axi ne connaît pas l&apos;éditeur de cette application. N&apos;autorisez l&apos;accès que si vous l&apos;avez vous-même installée ou configurée.
                </span>
              </p>
            )}
          </div>
          <h1 className="mt-4 text-[22px] font-semibold leading-tight tracking-[-0.025em] text-ink">
            {request.client.name}
            {!verified && <span className="mt-1 block break-all font-mono text-[13px] font-normal text-ink-muted">{request.redirectUri}</span>} souhaite accéder à votre boutique
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            Connecté en tant que <span className="font-medium text-ink">{user.email}</span>. Après accord, vous serez renvoyé vers <span className="font-mono text-[13px] text-ink">{redirectHost}</span>.
            {" "}Vérifiez que vous êtes bien à l&apos;origine de cette demande.
          </p>
        </div>

        {eligible.length === 0 ? (
          <div className="p-6 sm:p-8">
            <Alert tone="warning" title="Aucune boutique ne peut être connectée">
              {stores.length === 0
                ? "Seuls le propriétaire et les gestionnaires d'une boutique peuvent connecter un assistant IA."
                : `La connexion en un clic est incluse à partir du plan ${PLANS.BUSINESS.name}. Sur votre plan actuel, créez plutôt un jeton API dans Connecteurs IA.`}
            </Alert>
            <form action={denyAuthorization} className="mt-6 flex flex-wrap gap-2">
              {hidden}
              <Button type="submit" variant="outline">
                Revenir à l&apos;application
              </Button>
              {stores[0] && (
                <ButtonLink href={`/app/${stores[0].id}/integrations/ia`} variant="ghost">
                  Ouvrir Connecteurs IA
                </ButtonLink>
              )}
            </form>
          </div>
        ) : (
          <form action={approveAuthorization} className="p-6 sm:p-8">
            {hidden}
            <fieldset>
              <legend className="text-sm font-semibold text-ink">Boutique à connecter</legend>
              <div className="mt-3 space-y-2">
                {stores.map((s) => {
                  const disabled = !s.oauth || s.scopes.length === 0;
                  return (
                    <label
                      key={s.id}
                      className={`flex min-h-14 cursor-pointer items-start gap-3 rounded-[var(--radius-md)] p-3.5 ring-1 ring-line transition-colors has-[:checked]:bg-primary-soft has-[:checked]:ring-primary ${disabled ? "cursor-not-allowed opacity-60" : "hover:bg-surface-2"}`}
                    >
                      <input type="radio" name="storeId" value={s.id} defaultChecked={!disabled && s.id === eligible[0].id} disabled={disabled} required className="mt-1 size-4 accent-[var(--c-primary)]" />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                          <StoreIcon className="size-4 text-ink-muted" aria-hidden /> {s.name}
                          <Badge tone="neutral">Plan {PLANS[s.planId].name}</Badge>
                        </span>
                        {!s.oauth ? (
                          <span className="mt-1 block text-[13px] text-ink-muted">Connexion en un clic à partir du plan {PLANS.BUSINESS.name}.</span>
                        ) : s.dropped.length ? (
                          <span className="mt-1 block text-[13px] text-ink-muted">Non accordé (plan ou rôle) : {s.dropped.map((d) => SCOPE_LABELS[d].label.toLowerCase()).join(", ")}.</span>
                        ) : null}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <h2 className="mt-7 text-sm font-semibold text-ink">L&apos;application pourra</h2>
            <ul className="mt-3 space-y-2.5">
              {request.scopes.map((s) => {
                const info = SCOPE_LABELS[s];
                const Icon = info.write ? PencilLine : Eye;
                return (
                  <li key={s} className="flex items-start gap-3 text-sm">
                    <span className={`mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full ${info.write ? "bg-sun-soft text-ink" : "bg-surface-2 text-ink-muted"}`}>
                      <Icon className="size-3.5" aria-hidden />
                    </span>
                    <span>
                      <span className="font-medium text-ink">{info.label}</span>
                      {info.write && <span className="sr-only"> (modification)</span>}
                      <span className="block text-[13px] text-ink-muted">{info.description}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
            {writes.length > 0 && (
              <p className="mt-4 rounded-[var(--radius-md)] bg-surface-2 px-3.5 py-3 text-[13px] leading-relaxed text-ink-muted">
                Cette application pourra modifier votre boutique. Chaque modification est enregistrée dans le journal à son nom, et vous pouvez retirer l&apos;accès à tout moment dans Connecteurs IA.
              </p>
            )}

            <div className="mt-7 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="submit" variant="ghost" formAction={denyAuthorization} formNoValidate>
                Refuser
              </Button>
              <SubmitButton variant="primary">
                <ShieldCheck className="size-4" aria-hidden /> Autoriser l&apos;accès
              </SubmitButton>
            </div>
          </form>
        )}
      </div>
      <p className="mt-5 text-center text-xs leading-relaxed text-ink-faint">
        Axi ne transmet jamais votre mot de passe. L&apos;accès expire si vous ne l&apos;utilisez plus pendant 30 jours.{" "}
        <Link href="/developpeurs" className="underline-offset-4 hover:underline">
          En savoir plus
        </Link>
      </p>
    </Shell>
  );
}
