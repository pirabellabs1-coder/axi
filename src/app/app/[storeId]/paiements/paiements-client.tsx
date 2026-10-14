"use client";

import { startTransition, useActionState, useRef, useState, type FormEvent } from "react";
import { KIND_META } from "./meta";
import { Plus, Pencil, Trash2, ArrowUp, ArrowDown, RefreshCw, PlugZap, ExternalLink } from "lucide-react";
import { upsertPaymentMethod, togglePaymentMethod, movePaymentMethod, deletePaymentMethod, reconcileStorePayments, testPaymentGateway } from "@/lib/payment-methods/actions";
import { CHANNEL_LABELS, suggestedMethodLabel, type ChannelId } from "@/lib/payments/channels";
import type { CredentialField } from "@/lib/payments/provider";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch, Textarea, Hint, Checkbox } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/misc";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage, fieldError } from "@/components/forms/form-message";
import { ActionButton, AsyncSwitch, ConfirmActionButton, CopyButton } from "@/components/app/action-controls";
import { cn } from "@/lib/utils";

export type GatewayDTO = {
  id: string;
  label: string;
  credentialFields: CredentialField[];
  supportedCountries: string[];
  supportedCurrencies: string[];
  /** Portefeuilles disponibles dans le pays de la boutique ; null = fournisseur sans notion de portefeuille. */
  channels: string[] | null;
  docsUrl: string | null;
  canTest: boolean;
};
export type MethodDTO = {
  id: string;
  kind: "CASH_ON_DELIVERY" | "MOBILE_MONEY_MANUAL" | "BANK_TRANSFER_MANUAL" | "GATEWAY";
  provider: string | null;
  label: string;
  instructions: string | null;
  accountNumber: string | null;
  accountName: string | null;
  active: boolean;
  configured: boolean;
  attempts: number;
  channels: string[];
  /** Valeurs NON secrètes enregistrées (environnement, pays) ; jamais de clé. */
  publicCreds: Record<string, string>;
  mode: "test" | "live" | null;
};

export { KIND_META } from "./meta";

type DialogProps = { gateways: GatewayDTO[]; momoOperators: string[]; country: string; currency: string; appUrl: string; onlinePayments: boolean };

const GENERIC_GATEWAY_LABEL = "Carte ou Mobile Money en ligne";

export function MethodDialog({ storeId, method, gateways, momoOperators, country, currency, appUrl, onlinePayments }: { storeId: string; method?: MethodDTO } & DialogProps) {
  const [open, setOpen] = useState(false);
  const [state, action, saving] = useActionState(upsertPaymentMethod, undefined);
  const [testState, testAction, testing] = useActionState(testPaymentGateway, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  // Test sans soumettre le formulaire (même raison que onSubmit ci-dessous).
  // Enregistrement sans `action` sur le <form> : pas de réinitialisation automatique après un refus
  // (sinon la liste « Type » revient à sa valeur initiale dans le DOM et les clés saisies sont effacées).
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => action(fd));
  };
  const runTest = () => {
    if (!formRef.current) return;
    const fd = new FormData(formRef.current);
    startTransition(() => testAction(fd));
  };
  const [kind, setKind] = useState<MethodDTO["kind"]>(method?.kind ?? (onlinePayments ? "MOBILE_MONEY_MANUAL" : "CASH_ON_DELIVERY"));
  const [provider, setProvider] = useState(method?.provider ?? gateways[0]?.id ?? "");
  const [active, setActive] = useState(method?.active ?? true);
  const [label, setLabel] = useState(method?.label ?? (!onlinePayments ? "Paiement à la livraison" : ""));
  const gw = gateways.find((g) => g.id === provider);
  const [channels, setChannels] = useState<string[]>(method?.kind === "GATEWAY" && method.channels.length ? method.channels : (gw?.channels ?? []));
  const sameProvider = method?.kind === "GATEWAY" && method.provider === provider && method.configured;
  // Passerelle existante après un changement de plan : modifiable, mais seulement désactivée.
  const lockedGateway = kind === "GATEWAY" && !onlinePayments;
  const available = kind === "GATEWAY" ? (gw?.channels ?? null) : null;
  const webhookUrl = gw ? `${appUrl.replace(/\/$/, "")}/api/webhooks/payments/${gw.id}` : "";

  /** Le libellé client suit les portefeuilles cochés tant que le marchand ne l'a pas personnalisé. */
  const followLabel = (next: string[]) => {
    if (!label || label === GENERIC_GATEWAY_LABEL || label === suggestedMethodLabel(channels)) setLabel(suggestedMethodLabel(next));
  };
  const chooseProvider = (id: string) => {
    setProvider(id);
    const g = gateways.find((x) => x.id === id);
    const next = method?.kind === "GATEWAY" && method.provider === id && method.channels.length ? method.channels : (g?.channels ?? []);
    if (g?.channels) followLabel(next);
    setChannels(next);
  };
  const toggleChannel = (c: string, on: boolean) => {
    const next = on ? [...channels, c] : channels.filter((x) => x !== c);
    followLabel(next);
    setChannels(next);
  };

  // Ferme la fenêtre au succès (comparaison pendant le rendu, sans effet).
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state?.ok) setOpen(false);
  }

  return (
    <>
      {method ? (
        <Button variant="ghost" size="icon" aria-label={`Modifier ${method.label}`} onClick={() => setOpen(true)}>
          <Pencil className="size-4" aria-hidden />
        </Button>
      ) : (
        <Button variant="accent" onClick={() => setOpen(true)}>
          <Plus className="size-4" aria-hidden /> Ajouter un moyen
        </Button>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title={method ? "Modifier le moyen de paiement" : "Nouveau moyen de paiement"} description="0 % de commission Axi : l'argent arrive directement sur vos comptes." sheet>
        <form ref={formRef} onSubmit={onSubmit} noValidate className="space-y-4">
          <FormMessage state={state} />
          <input type="hidden" name="storeId" value={storeId} />
          {method && <input type="hidden" name="id" value={method.id} />}

          <Field id="kind" label="Type" required hint={KIND_META[kind].hint} error={fieldError(state, "kind")}>
            {(p) => (
              <Select
                {...p}
                name="kind"
                value={kind}
                onChange={(e) => {
                  const next = e.target.value as MethodDTO["kind"];
                  setKind(next);
                  if (!method && !label && next === "CASH_ON_DELIVERY") setLabel("Paiement à la livraison");
                  if (!method && !label && next === "GATEWAY" && gw?.channels) setLabel(suggestedMethodLabel(channels));
                }}
              >
                {(Object.keys(KIND_META) as MethodDTO["kind"][]).map((k) => {
                  const locked = k === "GATEWAY" && !onlinePayments && method?.kind !== "GATEWAY";
                  return (
                    <option key={k} value={k} disabled={locked}>
                      {KIND_META[k].label}
                      {locked ? " (plan Starter)" : ""}
                    </option>
                  );
                })}
              </Select>
            )}
          </Field>
          {!onlinePayments && kind !== "GATEWAY" && (
            <p className="-mt-2 text-[13px] text-ink-muted">
              Wave, Orange Money, le Mobile Money et la carte en ligne sont inclus à partir du plan{" "}
              <a href={`/app/${storeId}/abonnement#plans`} className="font-medium text-primary underline-offset-4 hover:underline">
                Starter
              </a>
              .
            </p>
          )}

          <Field id="label" label="Libellé affiché au client" required error={fieldError(state, "label")}>
            {(p) => (
              <Input
                {...p}
                name="label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={kind === "MOBILE_MONEY_MANUAL" ? (momoOperators[0] ?? "Mobile Money") : kind === "BANK_TRANSFER_MANUAL" ? "Virement bancaire" : kind === "GATEWAY" ? GENERIC_GATEWAY_LABEL : "Paiement à la livraison"}
                maxLength={60}
              />
            )}
          </Field>

          {kind === "MOBILE_MONEY_MANUAL" && (
            <>
              {momoOperators.length > 0 && (
                <div role="group" aria-label="Opérateurs suggérés" className="flex flex-wrap gap-2">
                  {momoOperators.map((op) => (
                    <button
                      key={op}
                      type="button"
                      aria-pressed={label === op}
                      onClick={() => setLabel(op)}
                      className={cn(
                        "inline-flex min-h-9 items-center rounded-full px-3.5 text-sm font-medium ring-1 ring-inset transition-colors focus-visible:outline-2 focus-visible:outline-offset-2",
                        label === op ? "bg-primary-soft text-primary-deep ring-primary/40" : "text-ink-muted ring-line-strong hover:bg-surface-2",
                      )}
                    >
                      {op}
                    </button>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field id="accountNumber" label="Numéro Mobile Money" required error={fieldError(state, "accountNumber")}>
                  {(p) => <Input {...p} name="accountNumber" inputMode="tel" autoComplete="off" defaultValue={method?.accountNumber ?? ""} placeholder="01 97 00 00 00" className="tabular" />}
                </Field>
                <Field id="accountName" label="Nom du titulaire" error={fieldError(state, "accountName")}>
                  {(p) => <Input {...p} name="accountName" defaultValue={method?.accountName ?? ""} />}
                </Field>
              </div>
            </>
          )}

          {kind === "BANK_TRANSFER_MANUAL" && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field id="accountNumber" label="IBAN ou RIB" required error={fieldError(state, "accountNumber")}>
                {(p) => <Input {...p} name="accountNumber" autoComplete="off" spellCheck={false} defaultValue={method?.accountNumber ?? ""} className="font-mono text-sm" />}
              </Field>
              <Field id="accountName" label="Banque et titulaire" error={fieldError(state, "accountName")}>
                {(p) => <Input {...p} name="accountName" defaultValue={method?.accountName ?? ""} placeholder="Ecobank, Aïcha K." />}
              </Field>
            </div>
          )}

          {kind === "GATEWAY" && (
            <>
              {lockedGateway && (
                <Alert tone="warning" title="Plan Starter requis">
                  Votre plan ne comprend plus les paiements en ligne. Ce moyen peut être modifié ou supprimé, mais il doit rester désactivé.
                </Alert>
              )}
              <Field id="provider" label="Fournisseur" required error={fieldError(state, "provider")} hint="Pour Wave et Orange Money, choisissez un agrégateur : il encaisse sur votre propre compte.">
                {(p) => (
                  <Select {...p} name="provider" value={provider} onChange={(e) => chooseProvider(e.target.value)}>
                    {gateways.some((g) => g.channels !== null) && (
                      <optgroup label="Wave, Orange Money, MTN, Moov (agrégateurs)">
                        {gateways
                          .filter((g) => g.channels !== null)
                          .map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.label}
                              {g.channels && g.channels.length > 0 ? ` : ${g.channels.map((c) => CHANNEL_LABELS[c as ChannelId] ?? c).join(", ")}` : " (pays non couvert)"}
                              {g.channels && g.channels.length > 0 && !g.supportedCurrencies.includes(currency) ? ` (${currency} non pris en charge)` : ""}
                            </option>
                          ))}
                      </optgroup>
                    )}
                    <optgroup label="Autres passerelles">
                      {gateways
                        .filter((g) => g.channels === null)
                        .map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.label}
                            {!g.supportedCountries.includes(country) ? " (pays non listé)" : ""}
                            {!g.supportedCurrencies.includes(currency) ? ` (${currency} non pris en charge)` : ""}
                          </option>
                        ))}
                    </optgroup>
                  </Select>
                )}
              </Field>

              {available &&
                (available.length === 0 ? (
                  <Alert tone="warning" title={`${gw?.label ?? "Ce fournisseur"} n'est pas disponible dans votre pays`}>
                    Il n&apos;encaisse pas pour une boutique située dans ce pays. Choisissez un autre fournisseur.
                  </Alert>
                ) : (
                  <fieldset className="min-w-0 space-y-1.5" aria-describedby="channels-hint">
                    <legend className="mb-1 text-sm font-medium text-ink">Moyens proposés au client</legend>
                    <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
                      {available.map((c) => (
                        <Checkbox
                          key={c}
                          name="channels"
                          value={c}
                          checked={channels.includes(c)}
                          onChange={(e) => toggleChannel(c, e.target.checked)}
                          label={CHANNEL_LABELS[c as ChannelId] ?? c}
                          className="min-h-11 items-center"
                        />
                      ))}
                    </div>
                    <Hint id="channels-hint">
                      Le client choisit son portefeuille sur la page sécurisée de {gw?.label}. Chaque opérateur doit aussi être activé sur votre compte {gw?.label}.
                    </Hint>
                    {fieldError(state, "channels") && <p className="text-sm text-danger">{fieldError(state, "channels")}</p>}
                  </fieldset>
                ))}

              {gw && (
                <fieldset className="min-w-0 space-y-4 rounded-[var(--radius-md)] bg-surface-2/60 p-4 ring-1 ring-inset ring-line">
                  <legend className="sr-only">Identifiants {gw.label}</legend>
                  <p className="text-sm font-semibold text-ink" aria-hidden>
                    Identifiants {gw.label}
                  </p>
                  {gw.credentialFields.map((f) => {
                    const saved = sameProvider ? method?.publicCreds[f.key] : undefined;
                    const secretHint = f.secret ? (sameProvider ? "Déjà enregistré. Laissez vide pour conserver, saisissez pour remplacer." : "Chiffré au repos, jamais réaffiché.") : null;
                    const hint = [f.hint, secretHint].filter(Boolean).join(" ");
                    const defaultOption = saved ?? (f.key === "country" && f.options?.some((o) => o.value === country) ? country : f.options?.[0]?.value);
                    return (
                      <Field key={`${gw.id}-${f.key}`} id={`cred_${f.key}`} label={f.label} required={!sameProvider && !f.optional} hint={hint || undefined} error={fieldError(state, `cred_${f.key}`)}>
                        {(p) =>
                          f.options ? (
                            <Select {...p} name={`cred_${f.key}`} defaultValue={defaultOption}>
                              {f.options.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </Select>
                          ) : (
                            <Input
                              {...p}
                              name={`cred_${f.key}`}
                              type={f.secret ? "password" : "text"}
                              autoComplete={f.secret ? "new-password" : "off"}
                              spellCheck={false}
                              defaultValue={f.secret ? undefined : saved}
                              placeholder={f.secret && sameProvider ? "Enregistré (inchangé)" : (f.placeholder ?? "")}
                              className="font-mono text-sm"
                            />
                          )
                        }
                      </Field>
                    );
                  })}

                  {gw.canTest && (
                    <div className="space-y-3">
                      <Button type="button" variant="outline" onClick={runTest} disabled={testing || lockedGateway} className="w-full sm:w-auto">
                        <PlugZap className="size-4" aria-hidden /> {testing ? "Test en cours…" : "Tester la connexion"}
                      </Button>
                      <div aria-live="polite">
                        {testState &&
                          !testing &&
                          (testState.ok ? (
                            <Alert tone="success" title={testState.data?.message ?? "Connexion réussie"}>
                              {testState.data?.warnings.length ? (
                                <ul className="list-disc space-y-1 pl-4">
                                  {testState.data.warnings.map((w) => (
                                    <li key={w} className="[overflow-wrap:anywhere]">
                                      {w}
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                "Vous pouvez enregistrer ce moyen de paiement."
                              )}
                            </Alert>
                          ) : (
                            <Alert tone="danger" title="Échec du test de connexion">
                              {testState.error}
                            </Alert>
                          ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <p className="mb-1.5 text-sm font-medium text-ink">URL de webhook à déclarer chez {gw.label}</p>
                    <div className="flex items-center gap-2">
                      <code className="min-w-0 flex-1 truncate rounded-[var(--radius-sm)] bg-surface px-2.5 py-2 font-mono text-xs ring-1 ring-inset ring-line">{webhookUrl}</code>
                      <CopyButton value={webhookUrl} className="h-11 rounded-full" />
                    </div>
                    {gw.id === "cinetpay" && <Hint>CinetPay reçoit cette adresse à chaque paiement : rien à déclarer dans votre espace CinetPay.</Hint>}
                  </div>
                  {gw.docsUrl && (
                    <a href={gw.docsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline">
                      Documentation {gw.label} <ExternalLink className="size-3.5" aria-hidden />
                      <span className="sr-only">(nouvel onglet)</span>
                    </a>
                  )}
                  <Alert tone="info">
                    Vérifiez le contrat, la vérification d&apos;identité et les frais auprès du fournisseur. Une commande n&apos;est marquée « payée » qu&apos;après vérification serveur (webhook signé ou rapprochement).
                  </Alert>
                </fieldset>
              )}
            </>
          )}

          <Field id="instructions" label="Instructions pour le client" error={fieldError(state, "instructions")} hint="Affichées au moment de payer et dans le suivi de commande.">
            {(p) => (
              <Textarea
                {...p}
                name="instructions"
                defaultValue={method?.instructions ?? ""}
                rows={3}
                maxLength={500}
                placeholder={kind === "MOBILE_MONEY_MANUAL" ? "Envoyez le montant sur ce numéro puis indiquez la référence de transaction." : ""}
              />
            )}
          </Field>

          <div>
            <div className="flex min-h-11 items-center">
              <Switch name="active" checked={active && !lockedGateway} onChange={setActive} disabled={lockedGateway} label="Proposé aux clients" />
            </div>
            <Hint>Désactivé, le moyen reste ici mais n&apos;est plus proposé au moment de payer.</Hint>
          </div>

          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <SubmitButton loading={saving} disabled={saving}>
              {method ? "Enregistrer" : "Ajouter"}
            </SubmitButton>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function MethodRowActions({ storeId, method, index, total, ...dialogProps }: { storeId: string; method: MethodDTO; index: number; total: number } & DialogProps) {
  const locked = method.kind === "GATEWAY" && !dialogProps.onlinePayments && !method.active;
  return (
    <div className="-mr-2 flex flex-wrap items-center justify-end gap-x-1">
      <AsyncSwitch checked={method.active} disabled={locked} label={method.active ? "Proposé" : "Masqué"} action={(v) => togglePaymentMethod(storeId, method.id, v)} />
      {total > 1 && (
        <>
          <ActionButton variant="ghost" size="icon" aria-label={`Monter ${method.label}`} disabled={index === 0} action={() => movePaymentMethod(storeId, method.id, "up")} successMessage="Ordre mis à jour">
            <ArrowUp className="size-4" aria-hidden />
          </ActionButton>
          <ActionButton variant="ghost" size="icon" aria-label={`Descendre ${method.label}`} disabled={index === total - 1} action={() => movePaymentMethod(storeId, method.id, "down")} successMessage="Ordre mis à jour">
            <ArrowDown className="size-4" aria-hidden />
          </ActionButton>
        </>
      )}
      <MethodDialog storeId={storeId} method={method} {...dialogProps} />
      <ConfirmActionButton
        title={`Supprimer « ${method.label} » ?`}
        description={method.attempts > 0 ? "Des paiements y sont rattachés : la suppression sera refusée, désactivez-le plutôt." : "Cette action est définitive."}
        confirmLabel="Supprimer"
        action={() => deletePaymentMethod(storeId, method.id)}
        className="inline-flex size-11 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-danger-soft hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <Trash2 className="size-4" aria-hidden />
        <span className="sr-only">Supprimer {method.label}</span>
      </ConfirmActionButton>
    </div>
  );
}

export function ReconcileButton({ storeId }: { storeId: string }) {
  return (
    <ActionButton variant="outline" size="sm" className="h-11 sm:h-9" action={() => reconcileStorePayments(storeId)}>
      <RefreshCw className="size-4" aria-hidden /> Vérifier les paiements en attente
    </ActionButton>
  );
}

export function ConfiguredBadge({ configured }: { configured: boolean }) {
  return configured ? (
    <Badge tone="success" dot>
      Clés enregistrées
    </Badge>
  ) : (
    <Badge tone="warning" dot>
      Clés manquantes
    </Badge>
  );
}
