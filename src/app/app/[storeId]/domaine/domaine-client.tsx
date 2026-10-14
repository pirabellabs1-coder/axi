"use client";

import { useActionState, useState } from "react";
import { Globe, ShieldCheck, Trash2, RefreshCw, Plus, Clock } from "lucide-react";
import { changeSlug, addDomain, verifyDomain, deleteDomain } from "@/lib/domains/actions";
import { Field, Input } from "@/components/ui/field";
import { Alert } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage, fieldError } from "@/components/forms/form-message";
import { ActionButton, ConfirmActionButton, CopyButton } from "@/components/app/action-controls";
import { slugify } from "@/lib/utils";

export function SlugForm({ storeId, slug, domain }: { storeId: string; slug: string; domain: string }) {
  const [state, action] = useActionState(changeSlug, undefined);
  const [value, setValue] = useState(slug);
  const changed = value !== slug && value.length >= 3;
  return (
    <form action={action} noValidate className="space-y-4">
      <FormMessage state={state} />
      <input type="hidden" name="storeId" value={storeId} />
      <Field id="slug" label="Sous-domaine" error={fieldError(state, "slug")} hint="Lettres minuscules, chiffres et traits d'union. 3 à 48 caractères.">
        {(p) => (
          <div className="flex items-stretch overflow-hidden rounded-[var(--radius-md)] ring-1 ring-inset ring-line-strong focus-within:ring-2 focus-within:ring-primary">
            <Input
              {...p}
              name="slug"
              value={value}
              onChange={(e) => setValue(slugify(e.target.value))}
              maxLength={48}
              autoComplete="off"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-none font-mono shadow-none ring-0 hover:ring-0 focus:ring-0"
            />
            <span className="inline-flex max-w-[45%] shrink-0 items-center truncate border-l border-line bg-surface-2 px-3 font-mono text-sm text-ink-muted" aria-hidden>
              .{domain}
            </span>
          </div>
        )}
      </Field>
      {value !== slug && (
        <Alert tone="warning">
          L&apos;ancien lien <strong className="font-mono">{slug}.{domain}</strong> ne fonctionnera plus : mettez à jour vos bios Instagram et Facebook, vos QR codes et vos messages WhatsApp.
        </Alert>
      )}
      <div className="flex justify-end">
        <SubmitButton variant={changed ? "primary" : "secondary"} disabled={!changed}>
          Changer le sous-domaine
        </SubmitButton>
      </div>
    </form>
  );
}

export function AddDomainForm({ storeId, disabled }: { storeId: string; disabled?: boolean }) {
  const [state, action] = useActionState(addDomain, undefined);
  return (
    <form action={action} noValidate key={state?.ok ? "done" : "edit"}>
      <FormMessage state={state} toastSuccess />
      <input type="hidden" name="storeId" value={storeId} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <Field
          id="hostname"
          label="Nom de domaine"
          className="flex-1"
          error={fieldError(state, "hostname")}
          hint={disabled ? "Maximum 3 domaines par boutique. Retirez-en un pour en ajouter un autre." : "Exemple : boutique.votremarque.com"}
        >
          {(p) => <Input {...p} name="hostname" placeholder="boutique.votremarque.com" inputMode="url" autoComplete="off" spellCheck={false} disabled={disabled} />}
        </Field>
        <SubmitButton className="sm:mt-7" disabled={disabled}>
          <Plus className="size-4" aria-hidden /> Ajouter le domaine
        </SubmitButton>
      </div>
    </form>
  );
}

export type DomainDTO = { id: string; hostname: string; verified: boolean; verifyToken: string; isPrimary: boolean };

export function DomainCard({ storeId, domain, appDomain, inactive = false }: { storeId: string; domain: DomainDTO; appDomain: string; inactive?: boolean }) {
  return (
    <li className="rounded-[var(--radius-lg)] bg-surface p-5 ring-1 ring-line shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-muted">
          <Globe className="size-[18px]" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-[15px] font-medium text-ink">{domain.hostname}</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {inactive ? (
              <Badge tone="neutral">Inactif avec votre plan</Badge>
            ) : domain.verified ? (
              <Badge tone="success" dot>Vérifié</Badge>
            ) : (
              <Badge tone="sun" dot>En attente de vérification</Badge>
            )}
            {domain.isPrimary && <Badge tone="neutral">Principal</Badge>}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {!domain.verified && !inactive && (
            <ActionButton variant="outline" size="sm" className="h-11" action={() => verifyDomain(storeId, domain.id)}>
              <RefreshCw className="size-4" aria-hidden /> Vérifier
            </ActionButton>
          )}
          <ConfirmActionButton
            title={`Retirer ${domain.hostname} ?`}
            description="La boutique ne répondra plus sur ce domaine. Vous pourrez le reconnecter plus tard."
            confirmLabel="Retirer le domaine"
            action={() => deleteDomain(storeId, domain.id)}
            className="inline-flex size-11 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-danger-soft hover:text-danger"
          >
            <Trash2 className="size-4" aria-hidden />
            <span className="sr-only">Retirer {domain.hostname}</span>
          </ConfirmActionButton>
        </div>
      </div>

      {!inactive &&
        (!domain.verified ? (
          <div className="mt-5 rounded-[var(--radius-md)] bg-surface-2/60 p-4 ring-1 ring-inset ring-line">
            <p className="text-sm font-medium text-ink">Chez votre fournisseur de domaine (OVH, GoDaddy, Cloudflare…), créez ces deux enregistrements :</p>
            <ol className="mt-4 space-y-4">
              <DnsStep n={1} type="CNAME" name={domain.hostname} value={appDomain} help="Fait pointer votre domaine vers Axi." />
              <DnsStep n={2} type="TXT" name={`_axi-verify.${domain.hostname}`} value={domain.verifyToken} help="Prouve que le domaine vous appartient." />
            </ol>
            <p className="mt-4 flex items-start gap-2 text-[13px] text-ink-muted">
              <Clock className="mt-0.5 size-4 shrink-0" aria-hidden /> La propagation prend de quelques minutes à 24 h. Cliquez ensuite sur « Vérifier ».
            </p>
          </div>
        ) : (
          <p className="mt-4 flex items-start gap-2 text-sm text-ink-muted">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden /> Domaine vérifié. Le certificat HTTPS est délivré automatiquement par l&apos;hébergement.
          </p>
        ))}
    </li>
  );
}

function DnsStep({ n, type, name, value, help }: { n: number; type: string; name: string; value: string; help: string }) {
  return (
    <li className="grid grid-cols-1 gap-2 sm:grid-cols-[28px_1fr]">
      <span className="tabular inline-flex size-7 items-center justify-center rounded-full bg-surface text-xs font-semibold text-ink ring-1 ring-line" aria-hidden>
        {n}
      </span>
      <div className="min-w-0">
        <p className="text-sm text-ink">
          <Badge tone="neutral" className="mr-2 font-mono">{type}</Badge>
          {help}
        </p>
        <dl className="mt-2 grid gap-2 text-sm">
          <DnsValue label="Nom" value={name} />
          <DnsValue label="Valeur" value={value} />
        </dl>
      </div>
    </li>
  );
}

function DnsValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-[var(--radius-sm)] bg-surface px-3 py-1.5 ring-1 ring-line">
      <dt className="w-12 shrink-0 text-xs text-ink-muted">{label}</dt>
      <dd className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink" title={value}>
        {value}
      </dd>
      <dd className="shrink-0">
        <CopyButton value={value} label="Copier" className="h-9 rounded-full" />
      </dd>
    </div>
  );
}
