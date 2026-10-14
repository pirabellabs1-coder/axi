"use client";

import { useActionState, useState, useTransition } from "react";
import { Search, Check, X, ShieldCheck, ArrowLeft, RotateCw } from "lucide-react";
import { buyDomain, renewDomainNow, searchDomainAction, setDomainAutoRenewAction } from "@/lib/domains/purchase-actions";
import type { SearchItem } from "@/lib/domains/service";
import { formatMoney } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Field, Input, Checkbox } from "@/components/ui/field";
import { Alert } from "@/components/ui/misc";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage, fieldError } from "@/components/forms/form-message";
import { AsyncSwitch } from "@/components/app/action-controls";
import { toast } from "@/components/ui/toast";
import { useRouter } from "next/navigation";

export type ContactDefaults = { firstName: string; lastName: string; organization: string; email: string; phone: string; address1: string; city: string; zip: string; country: string };

/** Recherche → choix → titulaire → facture (paiement via la facturation Axi). */
export function DomainPurchase({ storeId, defaults, tlds }: { storeId: string; defaults: ContactDefaults; tlds: string[] }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ query: SearchItem; suggestions: SearchItem[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<SearchItem | null>(null);
  const [pending, start] = useTransition();

  if (picked) return <ContactForm storeId={storeId} item={picked} defaults={defaults} onBack={() => setPicked(null)} />;

  return (
    <div className="space-y-4">
      <form
        role="search"
        className="flex flex-col gap-3 sm:flex-row sm:items-start"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          start(async () => {
            const r = await searchDomainAction(storeId, query);
            if (r.ok && r.data) setResults(r.data);
            else {
              setResults(null);
              setError(r.ok ? null : r.error);
            }
          });
        }}
      >
        <Field id="domain-search" label="Nom de domaine recherché" className="flex-1" hint={`Extensions disponibles : ${tlds.map((t) => `.${t}`).join(", ")}`}>
          {(p) => <Input {...p} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="maboutique.com" inputMode="url" autoComplete="off" spellCheck={false} maxLength={253} />}
        </Field>
        <Button type="submit" className="sm:mt-7" loading={pending} disabled={query.trim().length < 2}>
          <Search className="size-4" aria-hidden /> Rechercher
        </Button>
      </form>

      <div aria-live="polite">
        {error && <Alert tone="warning">{error}</Alert>}
        {results && (
          <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-md)] ring-1 ring-line" aria-label="Résultats">
            {[results.query, ...results.suggestions].map((r, i) => (
              <li key={r.domain} className="flex flex-wrap items-center gap-3 px-4 py-3">
                {r.available ? <Check className="size-4 shrink-0 text-primary" aria-hidden /> : <X className="size-4 shrink-0 text-ink-faint" aria-hidden />}
                <span className="min-w-0 flex-1 truncate font-mono text-[15px] text-ink">
                  {r.domain}
                  {i === 0 && results.suggestions.length > 0 && <span className="sr-only"> (votre recherche)</span>}
                </span>
                {r.available && r.price != null ? (
                  <>
                    <span className="text-right text-sm">
                      <strong className="font-mono tabular text-ink">{formatMoney(r.price, r.currency)}</strong>
                      <span className="text-ink-muted"> la 1re année, TTC</span>
                      {r.renewPrice != null && <span className="block text-xs text-ink-muted">puis {formatMoney(r.renewPrice, r.currency)} / an (prix courant)</span>}
                    </span>
                    <Button onClick={() => setPicked(r)} aria-label={`Choisir ${r.domain}`}>
                      Choisir
                    </Button>
                  </>
                ) : (
                  <span className="text-sm text-ink-muted">Indisponible</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ContactForm({ storeId, item, defaults, onBack }: { storeId: string; item: SearchItem; defaults: ContactDefaults; onBack: () => void }) {
  const [state, action] = useActionState(buyDomain, undefined);
  const f = (name: keyof ContactDefaults, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}, hint?: string) => (
    <Field id={`c-${name}`} label={label} error={fieldError(state, name)} hint={hint} required={!["organization", "zip"].includes(name)}>
      {(p) => <Input {...p} name={name} defaultValue={defaults[name]} {...extra} />}
    </Field>
  );
  return (
    <form action={action} noValidate className="space-y-5">
      <FormMessage state={state} />
      <input type="hidden" name="storeId" value={storeId} />
      <input type="hidden" name="domain" value={item.domain} />
      <input type="hidden" name="years" value="1" />
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] bg-surface-2/70 px-4 py-3 ring-1 ring-inset ring-line">
        <span className="font-mono text-[15px] text-ink">{item.domain}</span>
        <strong className="font-mono tabular text-ink">{item.price != null ? `${formatMoney(item.price, item.currency)} / 1 an` : ""}</strong>
      </div>
      <p className="text-sm text-ink-muted">Titulaire du domaine (vous). Ces coordonnées sont transmises au registre ; la protection de la vie privée les masque dans l&apos;annuaire public WHOIS.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {f("firstName", "Prénom", { autoComplete: "given-name" })}
        {f("lastName", "Nom", { autoComplete: "family-name" })}
        {f("organization", "Entreprise (facultatif)", { autoComplete: "organization" })}
        {f("email", "E-mail", { type: "email", autoComplete: "email", inputMode: "email" }, "Le registre peut vous demander de le confirmer.")}
        {f("phone", "Téléphone", { type: "tel", autoComplete: "tel", inputMode: "tel", placeholder: "+22997000000" }, "Format international.")}
        {f("address1", "Adresse", { autoComplete: "street-address" })}
        {f("city", "Ville", { autoComplete: "address-level2" })}
        {f("zip", "Code postal (facultatif)", { autoComplete: "postal-code" })}
        {f("country", "Pays (code à 2 lettres)", { autoComplete: "country", maxLength: 2, placeholder: "BJ" })}
      </div>
      <Alert tone="info">
        <span className="inline-flex items-start gap-2">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
          Protection de la vie privée incluse. Le domaine est enregistré après paiement de la facture, puis relié automatiquement à votre boutique (HTTPS inclus).
        </span>
      </Alert>
      <Checkbox name="accept" label="J'accepte les conditions d'enregistrement du registre et je certifie l'exactitude de ces coordonnées." description="Un nom de domaine enregistré n'est pas remboursable." />
      {fieldError(state, "accept") && <p className="text-sm text-danger">{fieldError(state, "accept")}</p>}
      <div className="flex flex-wrap justify-between gap-3">
        <Button type="button" variant="ghost" onClick={onBack}>
          <ArrowLeft className="size-4" aria-hidden /> Changer de domaine
        </Button>
        <SubmitButton>Continuer vers le paiement</SubmitButton>
      </div>
    </form>
  );
}

export function RegistrationActions({ storeId, id, autoRenew, canRenew }: { storeId: string; id: string; autoRenew: boolean; canRenew: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <AsyncSwitch checked={autoRenew} label="Renouvellement automatique" action={(next) => setDomainAutoRenewAction(storeId, id, next)} />
      {canRenew && (
        <Button
          variant="outline"
          loading={pending}
          onClick={() =>
            start(async () => {
              const r = await renewDomainNow(storeId, id);
              if (r.ok && r.data) router.push(r.data.url);
              else if (!r.ok) toast.error(r.error);
            })
          }
        >
          <RotateCw className="size-4" aria-hidden /> Renouveler maintenant
        </Button>
      )}
    </div>
  );
}

