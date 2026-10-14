"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Plus, RotateCw, ShieldAlert, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, ConfirmButton } from "@/components/ui/dialog";
import { Field, Input, Select, Checkbox } from "@/components/ui/field";
import { Alert, EmptyState } from "@/components/ui/misc";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { formatDate, relativeTime, cn } from "@/lib/utils";
import { SCOPES, SCOPE_LABELS, SCOPE_PRESETS, type Scope, type ScopePresetId } from "@/lib/mcp/scopes";
import { createApiToken, revokeApiToken, rotateApiToken, type CreatedToken } from "@/lib/mcp/actions";
import { CodeBlock } from "./code-block";

export type TokenRow = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  expiresAt: string | null;
  createdBy: string | null;
  expired: boolean;
};

const EXPIRY: { value: number; label: string }[] = [
  { value: 7, label: "7 jours" },
  { value: 30, label: "30 jours" },
  { value: 90, label: "90 jours (recommandé)" },
  { value: 365, label: "1 an" },
  { value: 0, label: "Sans expiration" },
];

function ScopeBadges({ scopes }: { scopes: string[] }) {
  const known = scopes.filter((s): s is Scope => (SCOPES as readonly string[]).includes(s));
  const writes = known.filter((s) => SCOPE_LABELS[s].write).length;
  return (
    <span className="flex flex-wrap gap-1" title={known.map((s) => SCOPE_LABELS[s].label).join(", ")}>
      <Badge tone="neutral">{known.length} autorisation{known.length > 1 ? "s" : ""}</Badge>
      {writes > 0 ? <Badge tone="sun">Écriture</Badge> : <Badge tone="info">Lecture seule</Badge>}
    </span>
  );
}

export function TokenManager({
  storeId,
  tokens,
  canManage,
  allowedScopes,
  maxTokens,
  planName,
  mcpUrl,
}: {
  storeId: string;
  tokens: TokenRow[];
  canManage: boolean;
  allowedScopes: Scope[];
  maxTokens: number | null;
  planName: string;
  mcpUrl: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState<CreatedToken | null>(null);
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [preset, setPreset] = useState<ScopePresetId>("read");
  const [custom, setCustom] = useState<Set<Scope>>(new Set(allowedScopes.filter((s) => !SCOPE_LABELS[s].write)));
  const [expiry, setExpiry] = useState(90);
  const [error, setError] = useState<string | null>(null);

  const active = tokens.filter((t) => !t.expired).length;
  const limitReached = maxTokens != null && active >= maxTokens;
  const allowed = useMemo(() => new Set(allowedScopes), [allowedScopes]);
  const selected: Scope[] = preset === "custom" ? SCOPES.filter((s) => custom.has(s)) : (SCOPE_PRESETS.find((p) => p.id === preset)?.scopes ?? []).filter((s) => allowed.has(s));

  const reset = () => {
    setName("");
    setPreset("read");
    setExpiry(90);
    setError(null);
  };

  const submit = () => {
    setError(null);
    start(async () => {
      const r = await createApiToken(storeId, { name, scopes: selected, expiresInDays: expiry });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setSecret(r.data!);
      reset();
      setOpen(false);
      router.refresh();
    });
  };

  const rotate = async (id: string) => {
    const r = await rotateApiToken(storeId, id);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    setSecret(r.data!);
    router.refresh();
  };

  const revoke = async (id: string) => {
    const r = await revokeApiToken(storeId, id);
    if (r.ok) toast.success(r.message ?? "Jeton révoqué");
    else toast.error(r.error);
    router.refresh();
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">
          <span className="font-medium text-ink tabular">{active}</span>
          {maxTokens != null ? ` / ${maxTokens}` : ""} jeton{active > 1 ? "s" : ""} actif{active > 1 ? "s" : ""} · plan {planName}
        </p>
        {canManage && (
          <Button onClick={() => setOpen(true)} disabled={limitReached} title={limitReached ? "Limite de jetons atteinte pour votre plan" : undefined}>
            <Plus className="size-4" aria-hidden /> Créer un jeton
          </Button>
        )}
      </div>
      {limitReached && canManage && (
        <Alert tone="info" className="mb-4" title="Limite de jetons atteinte">
          Révoquez un jeton inutilisé ou passez à un plan supérieur pour en créer d&apos;autres.
        </Alert>
      )}

      {tokens.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title="Aucun jeton API"
          description="Un jeton permet à Claude Desktop, Claude Code, Cursor ou vos propres outils d'accéder à votre boutique, avec les autorisations que vous choisissez."
          action={canManage ? <Button onClick={() => setOpen(true)} disabled={limitReached}><Plus className="size-4" aria-hidden /> Créer un jeton</Button> : undefined}
        />
      ) : (
        <Table minWidth={760}>
          <THead>
            <tr>
              <TH>Nom</TH>
              <TH>Préfixe</TH>
              <TH>Autorisations</TH>
              <TH>Dernière utilisation</TH>
              <TH>Expiration</TH>
              {canManage && <TH align="right"><span className="sr-only">Actions</span></TH>}
            </tr>
          </THead>
          <TBody>
            {tokens.map((t) => (
              <TR key={t.id}>
                <TD>
                  <span className="font-medium text-ink">{t.name}</span>
                  <span className="block text-xs text-ink-muted">Créé le {formatDate(t.createdAt)}{t.createdBy ? ` par ${t.createdBy}` : ""}</span>
                </TD>
                <TD className="whitespace-nowrap font-mono text-xs">{t.prefix}…</TD>
                <TD><ScopeBadges scopes={t.scopes} /></TD>
                <TD className="whitespace-nowrap text-ink-muted">{t.lastUsedAt ? relativeTime(t.lastUsedAt) : "Jamais"}</TD>
                <TD className="whitespace-nowrap">
                  {t.expired ? <Badge tone="danger">Expiré</Badge> : t.expiresAt ? <span className="text-ink-muted">{formatDate(t.expiresAt)}</span> : <span className="text-ink-muted">Jamais</span>}
                </TD>
                {canManage && (
                  <TD align="right">
                    <span className="inline-flex gap-1">
                      {!t.expired && (
                        <ConfirmButton
                          title={`Faire tourner « ${t.name} » ?`}
                          description="Un nouveau secret est généré avec les mêmes autorisations. L'ancien cesse immédiatement de fonctionner : mettez à jour vos outils."
                          confirmLabel="Générer un nouveau secret"
                          tone="primary"
                          onConfirm={() => rotate(t.id)}
                          className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-ink hover:bg-surface-2"
                        >
                          <RotateCw className="size-4" aria-hidden /> <span className="hidden sm:inline">Faire tourner</span>
                          <span className="sr-only sm:hidden">Faire tourner {t.name}</span>
                        </ConfirmButton>
                      )}
                      <ConfirmButton
                        title={`Révoquer « ${t.name} » ?`}
                        description="Les assistants qui utilisent ce jeton perdent l'accès immédiatement. Cette action est définitive."
                        confirmLabel="Révoquer"
                        onConfirm={() => revoke(t.id)}
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-danger hover:bg-danger-soft"
                      >
                        <Trash2 className="size-4" aria-hidden /> <span className="hidden sm:inline">Révoquer</span>
                        <span className="sr-only sm:hidden">Révoquer {t.name}</span>
                      </ConfirmButton>
                    </span>
                  </TD>
                )}
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {/* Création */}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Nouveau jeton API"
        description="Le secret ne sera affiché qu'une seule fois."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Annuler</Button>
            <Button onClick={submit} loading={pending} disabled={name.trim().length < 2 || selected.length === 0}>
              <KeyRound className="size-4" aria-hidden /> Créer le jeton
            </Button>
          </>
        }
      >
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {error && <Alert tone="danger">{error}</Alert>}
          <Field id="token-name" label="Nom" hint="Pour le reconnaître, par exemple « Claude Desktop (bureau) »." required>
            {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="off" />}
          </Field>

          <fieldset>
            <legend className="mb-2 text-sm font-medium text-ink">Autorisations</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {[...SCOPE_PRESETS, { id: "custom" as const, label: "Personnalisé", description: "Choisissez chaque autorisation.", scopes: [] as Scope[] }].map((p) => {
                const missing = p.scopes.filter((s) => !allowed.has(s));
                return (
                  <label key={p.id} className={cn("flex min-h-11 cursor-pointer items-start gap-3 rounded-[var(--radius-md)] p-3 ring-1 ring-line transition-colors hover:bg-surface-2 has-[:checked]:bg-primary-soft has-[:checked]:ring-primary")}>
                    <input type="radio" name="preset" value={p.id} checked={preset === p.id} onChange={() => setPreset(p.id)} className="mt-1 size-4 accent-[var(--c-primary)]" />
                    <span>
                      <span className="block text-sm font-medium text-ink">{p.label}</span>
                      <span className="block text-[13px] text-ink-muted">{p.description}</span>
                      {p.id !== "custom" && missing.length > 0 && <span className="mt-1 block text-xs text-ink-muted">Limité par votre plan ({missing.length} non incluse{missing.length > 1 ? "s" : ""}).</span>}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {preset === "custom" && (
            <fieldset className="rounded-[var(--radius-md)] p-4 ring-1 ring-line">
              <legend className="px-1 text-sm font-medium text-ink">Autorisations détaillées</legend>
              <div className="space-y-3">
                {SCOPES.map((s) => {
                  const info = SCOPE_LABELS[s];
                  const ok = allowed.has(s);
                  return (
                    <Checkbox
                      key={s}
                      checked={custom.has(s)}
                      disabled={!ok}
                      onChange={(e) => {
                        const next = new Set(custom);
                        if (e.target.checked) next.add(s);
                        else next.delete(s);
                        setCustom(next);
                      }}
                      label={
                        <span className="inline-flex flex-wrap items-center gap-2">
                          {info.label} <code className="font-mono text-[11px] text-ink-faint">{s}</code>
                          {info.write && <Badge tone="sun">Écriture</Badge>}
                          {!ok && <Badge tone="accent">Plan supérieur</Badge>}
                        </span>
                      }
                      description={info.description}
                    />
                  );
                })}
              </div>
            </fieldset>
          )}

          <p className="text-[13px] text-ink-muted">
            {selected.length ? `Ce jeton pourra : ${selected.map((s) => SCOPE_LABELS[s].label.toLowerCase()).join(", ")}.` : "Aucune autorisation sélectionnée."}
          </p>

          <Field id="token-expiry" label="Expiration">
            {(p) => (
              <Select {...p} value={String(expiry)} onChange={(e) => setExpiry(Number(e.target.value))}>
                {EXPIRY.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </Select>
            )}
          </Field>
          <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
        </form>
      </Dialog>

      {/* Secret affiché une seule fois */}
      <Dialog
        open={!!secret}
        onClose={() => setSecret(null)}
        title={secret ? `Jeton « ${secret.name} » prêt` : "Jeton"}
        size="lg"
        footer={<Button onClick={() => setSecret(null)}>J&apos;ai copié mon jeton</Button>}
      >
        {secret && (
          <div className="space-y-4">
            <Alert tone="warning" title="Copiez-le maintenant">
              Pour votre sécurité, ce secret ne sera plus jamais affiché. Ne le partagez pas : il donne accès à votre boutique.
            </Alert>
            <CodeBlock code={secret.token} label="Jeton API" />
            <CodeBlock code={`claude mcp add --transport http axi ${mcpUrl} --header "Authorization: Bearer ${secret.token}"`} label="Claude Code" />
            <CodeBlock code={JSON.stringify({ mcpServers: { axi: { url: mcpUrl, headers: { Authorization: `Bearer ${secret.token}` } } } }, null, 2)} label="Cursor (.cursor/mcp.json)" />
            <p className="flex items-start gap-2 text-xs text-ink-muted">
              <ShieldAlert className="mt-px size-4 shrink-0" aria-hidden /> En cas de fuite, révoquez le jeton ou faites-le tourner depuis cette page.
            </p>
          </div>
        )}
      </Dialog>
    </div>
  );
}
