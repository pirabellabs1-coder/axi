"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Save, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea, Select } from "@/components/ui/field";
import { Alert } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { CodeBlock } from "@/app/app/[storeId]/integrations/ia/code-block";
import { toast } from "@/components/ui/toast";
import { APP_CATEGORIES } from "@/lib/apps/types";
import { SCOPES, SCOPE_LABELS } from "@/lib/mcp/scopes";
import type { ActionResult } from "@/lib/action";
import { createApp, updateApp } from "@/lib/apps/dev-actions";
import { useDevBase } from "../_components/dev-link";

export type AppFormDefaults = {
  name: string;
  slug: string;
  tagline: string;
  description: string;
  category: string;
  requestedScopes: string[];
  pricingType: "FREE" | "SUBSCRIPTION" | "ONE_TIME";
  priceAmount: number;
  priceInterval: "month" | "year" | "";
  trialDays: number;
  appUrl: string;
  webhookUrl: string;
  supportUrl: string;
  iconUrl: string;
  redirectUris: string[];
};

const EMPTY: AppFormDefaults = {
  name: "", slug: "", tagline: "", description: "", category: "autre",
  requestedScopes: ["catalog:read"], pricingType: "FREE", priceAmount: 0, priceInterval: "", trialDays: 0,
  appUrl: "", webhookUrl: "", supportUrl: "", iconUrl: "", redirectUris: [],
};

type CreatedSecret = { appId: string; clientId: string; clientSecret: string };

/** Sections du formulaire : « catalog » (fiche, tarif, support) et « config » (scopes, OAuth, URL). */
export type AppFormSection = "catalog" | "config";

/**
 * Champs non affichés transmis tels quels : l'action `updateApp` valide le formulaire complet, chaque
 * onglet n'édite donc qu'une partie et renvoie le reste à l'identique.
 */
function HiddenFields({ d, section }: { d: AppFormDefaults; section: AppFormSection }) {
  if (section === "catalog") {
    return (
      <>
        <input type="hidden" name="name" value={d.name} />
        <input type="hidden" name="tagline" value={d.tagline} />
        <input type="hidden" name="description" value={d.description} />
        <input type="hidden" name="category" value={d.category} />
        <input type="hidden" name="iconUrl" value={d.iconUrl} />
        <input type="hidden" name="supportUrl" value={d.supportUrl} />
        <input type="hidden" name="pricingType" value={d.pricingType} />
        <input type="hidden" name="priceAmount" value={String(d.priceAmount)} />
        <input type="hidden" name="priceInterval" value={d.priceInterval} />
        <input type="hidden" name="trialDays" value={String(d.trialDays)} />
      </>
    );
  }
  return (
    <>
      <input type="hidden" name="redirectUris" value={d.redirectUris.join("\n")} />
      <input type="hidden" name="appUrl" value={d.appUrl} />
      <input type="hidden" name="webhookUrl" value={d.webhookUrl} />
    </>
  );
}

export function AppForm({ mode, appId, defaults, sections = ["catalog", "config"] }: { mode: "create" | "edit"; appId?: string; defaults?: Partial<AppFormDefaults>; sections?: AppFormSection[] }) {
  const showCatalog = sections.includes("catalog");
  const showConfig = sections.includes("config");
  const router = useRouter();
  const dev = useDevBase();
  const d = { ...EMPTY, ...defaults };
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [created, setCreated] = useState<CreatedSecret | null>(null);

  const [scopes, setScopes] = useState<Set<string>>(new Set(d.requestedScopes));
  const [pricingType, setPricingType] = useState(d.pricingType);
  const [redirectUris, setRedirectUris] = useState(d.redirectUris.join("\n"));

  const toggleScope = (s: string) =>
    setScopes((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    const form = new FormData(e.currentTarget);
    // Les cases de scopes sont pilotées par l'état : on reconstruit la liste envoyée.
    form.delete("requestedScopes");
    for (const s of showConfig ? scopes : new Set(d.requestedScopes)) form.append("requestedScopes", s);

    start(async () => {
      const r: ActionResult<CreatedSecret | undefined> =
        mode === "create" ? await createApp(form) : await updateApp(appId!, form);
      if (!r.ok) {
        setError(r.error);
        setFieldErrors(r.fieldErrors ?? {});
        return;
      }
      if (mode === "create" && r.data) {
        setCreated(r.data as CreatedSecret);
      } else {
        toast.success(r.message ?? "Enregistré");
        router.refresh();
      }
    });
  };

  const fe = (k: string) => fieldErrors[k];

  return (
    <>
      <form onSubmit={onSubmit} className="space-y-8" noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        {!showCatalog && <HiddenFields d={d} section="catalog" />}
        {!showConfig && <HiddenFields d={d} section="config" />}

        {showCatalog && (
        <Card>
          <CardHeader title="Présentation" description="Ce que les marchands voient sur la fiche de votre application." />
          <CardBody className="space-y-5">
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Field id="name" label="Nom de l'application" required error={fe("name")}>
                {(p) => <Input {...p} name="name" defaultValue={d.name} maxLength={80} placeholder="Suivi des livraisons" autoComplete="off" />}
              </Field>
              {mode === "create" ? (
                <Field id="slug" label="Identifiant (URL)" required hint="Minuscules, chiffres et tirets. Définitif après création." error={fe("slug")}>
                  {(p) => <Input {...p} name="slug" defaultValue={d.slug} maxLength={48} placeholder="suivi-livraisons" autoComplete="off" spellCheck={false} />}
                </Field>
              ) : (
                <Field id="slug-ro" label="Identifiant (URL)" hint="Non modifiable.">
                  {(p) => <Input {...p} defaultValue={d.slug} readOnly disabled className="font-mono" />}
                </Field>
              )}
            </div>
            <Field id="tagline" label="Accroche" hint="Une phrase courte affichée sous le nom." error={fe("tagline")}>
              {(p) => <Input {...p} name="tagline" defaultValue={d.tagline} maxLength={120} placeholder="Informez vos clients à chaque étape de la livraison." />}
            </Field>
            <Field id="description" label="Description" hint="Markdown accepté. Décrivez les fonctionnalités et la configuration." error={fe("description")}>
              {(p) => <Textarea {...p} name="description" defaultValue={d.description} maxLength={5000} rows={5} />}
            </Field>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Field id="category" label="Catégorie" required error={fe("category")}>
                {(p) => (
                  <Select {...p} name="category" defaultValue={d.category}>
                    {APP_CATEGORIES.map((c) => (
                      <option key={c.id} value={c.id}>{c.label}</option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field id="iconUrl" label="Icône (URL https)" hint="Image carrée. Facultatif." error={fe("iconUrl")}>
                {(p) => <Input {...p} name="iconUrl" type="url" inputMode="url" defaultValue={d.iconUrl} placeholder="https://…/icon.png" autoComplete="off" spellCheck={false} />}
              </Field>
            </div>
            <Field id="supportUrl" label="URL de support" hint="Page d'aide ou contact affichée sur la fiche. Facultatif." error={fe("supportUrl")}>
              {(p) => <Input {...p} name="supportUrl" type="url" inputMode="url" defaultValue={d.supportUrl} placeholder="https://mon-app.com/support" autoComplete="off" spellCheck={false} />}
            </Field>
          </CardBody>
        </Card>
        )}

        {showConfig && (
        <Card>
          <CardHeader title="Autorisations demandées" description="Les données et actions auxquelles votre application accède sur une boutique. Elles sont toujours bornées par le plan du marchand." />
          <CardBody>
            <fieldset aria-describedby={fe("requestedScopes") ? "scopes-error" : undefined}>
              <legend className="sr-only">Autorisations (scopes)</legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {SCOPES.map((s) => (
                  <label key={s} className="flex cursor-pointer items-start gap-3 rounded-[var(--radius-md)] p-2.5 ring-1 ring-line transition-colors hover:bg-surface-2 has-[:checked]:bg-primary-soft has-[:checked]:ring-primary/30">
                    <input type="checkbox" className="mt-0.5 size-5 shrink-0 rounded border-line-strong accent-[var(--c-primary)]" checked={scopes.has(s)} onChange={() => toggleScope(s)} />
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium text-ink">{SCOPE_LABELS[s].label}</span>
                        {SCOPE_LABELS[s].write && <Badge tone="warning">Écriture</Badge>}
                      </span>
                      <span className="block text-xs text-ink-muted">{SCOPE_LABELS[s].description}</span>
                      <span className="mt-0.5 block font-mono text-[11px] text-ink-faint">{s}</span>
                    </span>
                  </label>
                ))}
              </div>
              {fe("requestedScopes") && <p id="scopes-error" role="alert" className="mt-2 text-[13px] font-medium text-danger">{fe("requestedScopes")![0]}</p>}
            </fieldset>
          </CardBody>
        </Card>
        )}

        {showCatalog && (
        <Card>
          <CardHeader title="Tarification" description="Comment votre application est facturée aux marchands. Les installations de test ne sont jamais facturées." />
          <CardBody className="space-y-5">
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
              <Field id="pricingType" label="Modèle" required>
                {(p) => (
                  <Select {...p} name="pricingType" value={pricingType} onChange={(e) => setPricingType(e.target.value as AppFormDefaults["pricingType"])}>
                    <option value="FREE">Gratuit</option>
                    <option value="SUBSCRIPTION">Abonnement</option>
                    <option value="ONE_TIME">Achat unique</option>
                  </Select>
                )}
              </Field>
              {pricingType !== "FREE" && (
                <Field id="priceAmount" label="Montant (FCFA)" required error={fe("priceAmount")}>
                  {(p) => <Input {...p} name="priceAmount" type="number" inputMode="numeric" min={0} step={1} defaultValue={d.priceAmount || ""} placeholder="5000" />}
                </Field>
              )}
              {pricingType === "SUBSCRIPTION" && (
                <Field id="priceInterval" label="Période" required error={fe("priceInterval")}>
                  {(p) => (
                    <Select {...p} name="priceInterval" defaultValue={d.priceInterval || "month"}>
                      <option value="month">par mois</option>
                      <option value="year">par an</option>
                    </Select>
                  )}
                </Field>
              )}
            </div>
            {pricingType === "SUBSCRIPTION" && (
              <Field id="trialDays" label="Jours d'essai gratuit" hint="0 pour aucun essai." error={fe("trialDays")}>
                {(p) => <Input {...p} name="trialDays" type="number" inputMode="numeric" min={0} max={365} step={1} defaultValue={d.trialDays} className="sm:max-w-40" />}
              </Field>
            )}
          </CardBody>
        </Card>
        )}

        {showConfig && (
        <Card>
          <CardHeader title="Connexion de votre application (OAuth, URL, webhooks)" description="Votre application tourne sur votre serveur. Indiquez où Axi doit renvoyer le marchand après l'autorisation OAuth, quelle page afficher dans l'admin et où envoyer les événements." />
          <CardBody className="space-y-5">
            <Field id="redirectUris" label="Adresses de redirection OAuth" required hint="Une par ligne. https, http://localhost ou un schéma d'application natif." error={fe("redirectUris")}>
              {(p) => <Textarea {...p} name="redirectUris" value={redirectUris} onChange={(e) => setRedirectUris(e.target.value)} rows={3} placeholder={"https://mon-app.com/oauth/callback"} spellCheck={false} className="font-mono text-sm" />}
            </Field>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Field id="appUrl" label="URL de l'application (page embarquée)" hint="Page https de votre serveur affichée dans l'admin du marchand. Requise pour apparaître dans l'admin." error={fe("appUrl")}>
                {(p) => <Input {...p} name="appUrl" type="url" inputMode="url" defaultValue={d.appUrl} placeholder="https://mon-app.com/embed" autoComplete="off" spellCheck={false} />}
              </Field>
              <Field id="webhookUrl" label="URL de webhook (cycle de vie)" hint="Reçoit les événements d'installation et de désinstallation. Facultatif." error={fe("webhookUrl")}>
                {(p) => <Input {...p} name="webhookUrl" type="url" inputMode="url" defaultValue={d.webhookUrl} placeholder="https://mon-app.com/webhooks/axi" autoComplete="off" spellCheck={false} />}
              </Field>
            </div>
          </CardBody>
        </Card>
        )}

        <div className="flex items-center justify-end gap-3">
          <Button type="submit" loading={pending}>
            {mode === "create" ? <><KeyRound className="size-4" aria-hidden /> Créer l'application</> : <><Save className="size-4" aria-hidden /> Enregistrer</>}
          </Button>
        </div>
      </form>

      <Dialog
        open={!!created}
        onClose={() => { setCreated(null); if (created) router.push(`${dev}/apps/${created.appId}`); }}
        title="Application créée"
        description="Copiez le secret client maintenant : il ne sera plus jamais affiché."
        size="lg"
        footer={<Button onClick={() => { const id = created?.appId; setCreated(null); if (id) router.push(`${dev}/apps/${id}`); }}>J&apos;ai copié le secret</Button>}
      >
        {created && (
          <div className="space-y-4">
            <Alert tone="warning" title="Secret affiché une seule fois">
              Conservez le secret client dans un endroit sûr. Axi n&apos;en garde qu&apos;une empreinte : impossible de le réafficher. En cas de perte, régénérez-le depuis la fiche de l&apos;application.
            </Alert>
            <CodeBlock code={created.clientId} label="Client ID (public)" />
            <CodeBlock code={created.clientSecret} label="Client secret (confidentiel)" />
            <p className="flex items-start gap-2 text-xs text-ink-muted">
              <ShieldAlert className="mt-px size-4 shrink-0" aria-hidden /> Ne partagez jamais le secret client côté navigateur ni dans un dépôt public.
            </p>
          </div>
        )}
      </Dialog>
    </>
  );
}
