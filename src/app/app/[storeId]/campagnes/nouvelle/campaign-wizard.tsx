"use client";

import { useActionState, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Users, Heart, Moon, Sparkles, Tag, CalendarClock, Send, Save, ShieldCheck, Info } from "lucide-react";
import { createCampaign } from "@/lib/campaigns/actions";
import { SEGMENTS, MAX_CAMPAIGN_MESSAGE, MAX_RECIPIENTS, renderCampaignMessage, type SegmentKind } from "@/lib/campaigns/segments";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Alert } from "@/components/ui/misc";
import { Card } from "@/components/ui/card";
import { fieldError } from "@/components/forms/form-message";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

type Overview = {
  totalCustomers: number;
  consenting: number;
  counts: Record<Exclude<SegmentKind, "tag">, number>;
  tags: { tag: string; count: number }[];
  sampleName: string | null;
};

const ICONS: Record<SegmentKind, typeof Users> = { all: Users, loyal: Heart, inactive: Moon, new: Sparkles, tag: Tag };
const STEPS = ["Audience", "Message", "Envoi"] as const;
const STEP_OF_FIELD: Record<string, number> = { segmentKind: 0, tag: 0, name: 1, message: 1, scheduledAt: 2 };

const TEMPLATES = [
  { label: "Nouveauté", text: "Bonjour {prenom}, du nouveau chez {boutique} ! Découvrez nos derniers articles avant tout le monde. Répondez à ce message pour commander." },
  { label: "Promotion", text: "Bonjour {prenom}, -15 % sur toute la boutique {boutique} jusqu'à dimanche. Répondez OUI et nous préparons votre commande." },
  { label: "Relance", text: "Bonjour {prenom}, cela fait longtemps ! Toute l'équipe {boutique} serait ravie de vous revoir. Une question ? Écrivez-nous ici." },
];

function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function CampaignWizard({ storeId, storeName, overview, balance, apiActive, canBuyCredits }: { storeId: string; storeName: string; overview: Overview; balance: number; apiActive: boolean; canBuyCredits: boolean }) {
  const [state, action, pending] = useActionState(createCampaign, undefined);
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<SegmentKind>("all");
  const [tag, setTag] = useState(overview.tags[0]?.tag ?? "");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [when, setWhen] = useState<"now" | "later">("now");
  const [localDate, setLocalDate] = useState(() => toLocalInput(new Date(Date.now() + 24 * 3600_000)));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const uid = useId();

  const recipients = Math.min(MAX_RECIPIENTS, kind === "tag" ? overview.tags.find((t) => t.tag === tag)?.count ?? 0 : overview.counts[kind]);
  const cost = apiActive ? recipients : 0;
  const insufficient = apiActive && cost > balance;
  const preview = useMemo(() => renderCampaignMessage(message || "Votre message apparaîtra ici.", { prenom: overview.sampleName ?? "Awa", boutique: storeName }), [message, overview.sampleName, storeName]);

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      if (state.message) toast.success(state.message);
      router.push(state.data?.id ? `/app/${storeId}/campagnes/${state.data.id}` : `/app/${storeId}/campagnes`);
    } else {
      toast.error(state.error);
      const firstField = Object.keys(state.fieldErrors ?? {})[0];
      if (firstField && STEP_OF_FIELD[firstField] !== undefined) setStep(STEP_OF_FIELD[firstField]);
    }
  }, [state, router, storeId]);

  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  function validate(s: number): boolean {
    const e: Record<string, string> = {};
    if (s === 0 && kind === "tag" && !tag) e.tag = "Choisissez une étiquette";
    if (s === 1) {
      if (name.trim().length < 2) e.name = "Donnez un nom à la campagne";
      if (message.trim().length < 5) e.message = "Le message est trop court";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function insertVar(v: string) {
    const el = areaRef.current;
    if (!el) return setMessage((m) => m + v);
    const start = el.selectionStart ?? message.length;
    const end = el.selectionEnd ?? message.length;
    const next = message.slice(0, start) + v + message.slice(end);
    setMessage(next.slice(0, MAX_CAMPAIGN_MESSAGE));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + v.length, start + v.length);
    });
  }

  const err = (k: string) => errors[k] ?? fieldError(state, k);
  const scheduledIso = (() => {
    const d = new Date(localDate);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString();
  })();

  return (
    <form action={action} noValidate className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <input type="hidden" name="storeId" value={storeId} />
      <input type="hidden" name="segmentKind" value={kind} />
      <input type="hidden" name="tag" value={kind === "tag" ? tag : ""} />
      <input type="hidden" name="name" value={name} />
      <input type="hidden" name="message" value={message} />
      <input type="hidden" name="scheduledAt" value={when === "later" ? scheduledIso : ""} />

      <div className="min-w-0">
        <ol className="mb-5 flex items-center gap-2" aria-label="Étapes">
          {STEPS.map((label, i) => (
            <li key={label} className="flex items-center gap-2" aria-current={i === step ? "step" : undefined}>
              <span
                className={cn(
                  "inline-flex size-7 items-center justify-center rounded-full text-xs font-semibold tabular transition-colors duration-200",
                  i < step ? "bg-primary text-on-primary" : i === step ? "bg-accent text-on-accent" : "bg-surface-2 text-ink-muted",
                )}
              >
                {i < step ? <Check className="size-3.5" aria-hidden /> : i + 1}
              </span>
              <span className={cn("text-sm", i === step ? "font-semibold text-ink" : "text-ink-muted")}>{label}</span>
              {i < STEPS.length - 1 && <span className="mx-1 hidden h-px w-8 bg-line-strong sm:block" aria-hidden />}
            </li>
          ))}
        </ol>

        <Card className="p-5 sm:p-6">
          {/* Étape 1 : audience */}
          <div hidden={step !== 0}>
            <h2 ref={step === 0 ? headingRef : undefined} tabIndex={-1} className="text-lg font-semibold text-ink outline-none">
              À qui envoyer ?
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              <ShieldCheck className="mr-1 inline size-4 text-primary" aria-hidden />
              {overview.consenting} client{overview.consenting > 1 ? "s" : ""} sur {overview.totalCustomers} {overview.consenting > 1 ? "ont" : "a"} accepté vos messages marketing. Les autres ne sont jamais contactés.
            </p>
            <fieldset className="mt-5">
              <legend className="sr-only">Audience</legend>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {SEGMENTS.map((s) => {
                  const Icon = ICONS[s.kind];
                  const count = s.kind === "tag" ? null : overview.counts[s.kind];
                  const disabled = s.kind === "tag" && overview.tags.length === 0;
                  const checked = kind === s.kind;
                  return (
                    <label
                      key={s.kind}
                      className={cn(
                        "relative flex cursor-pointer gap-3 rounded-[var(--radius-md)] p-4 ring-1 transition-[box-shadow,background-color] duration-150 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary",
                        checked ? "bg-primary-soft/60 ring-2 ring-primary" : "bg-surface ring-line hover:ring-line-strong",
                        disabled && "cursor-not-allowed opacity-60",
                      )}
                    >
                      <input type="radio" name={`${uid}-segment`} value={s.kind} checked={checked} disabled={disabled} onChange={() => setKind(s.kind)} className="sr-only" />
                      <span className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-full", checked ? "bg-primary text-on-primary" : "bg-surface-2 text-ink-muted")}>
                        <Icon className="size-4" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="font-medium text-ink">{s.label}</span>
                          {count !== null && <span className="text-sm font-semibold text-ink tabular">{count}</span>}
                        </span>
                        <span className="mt-0.5 block text-xs text-ink-muted">{disabled ? "Aucune étiquette client pour l'instant." : s.description}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
            {kind === "tag" && overview.tags.length > 0 && (
              <Field id={`${uid}-tag`} label="Étiquette" className="mt-4 max-w-sm" error={err("tag")}>
                {(p) => (
                  <Select {...p} value={tag} onChange={(e) => setTag(e.target.value)}>
                    {overview.tags.map((t) => (
                      <option key={t.tag} value={t.tag}>
                        {t.tag} ({t.count})
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            {recipients === 0 && (
              <Alert tone="warning" className="mt-4">
                Aucun client consentant dans ce segment. Le consentement marketing se recueille au moment de la commande (case à cocher du checkout) ou depuis la fiche client.
              </Alert>
            )}
          </div>

          {/* Étape 2 : message */}
          <div hidden={step !== 1} className="space-y-5">
            <h2 ref={step === 1 ? headingRef : undefined} tabIndex={-1} className="text-lg font-semibold text-ink outline-none">
              Le message
            </h2>
            <Field id={`${uid}-name`} label="Nom de la campagne" required hint="Visible par vous seul, ex. Soldes de fin de mois." error={err("name")}>
              {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="off" />}
            </Field>
            <div>
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <label htmlFor={`${uid}-msg`} className="text-sm font-medium text-ink">
                  Message<span className="ml-0.5 text-danger" aria-hidden>*</span>
                </label>
                <div className="flex gap-1" role="group" aria-label="Insérer une variable">
                  {["{prenom}", "{boutique}"].map((v) => (
                    <button key={v} type="button" onClick={() => insertVar(v)} className="h-8 rounded-full bg-surface-2 px-2.5 font-mono text-xs text-ink hover:bg-line">
                      + {v}
                    </button>
                  ))}
                </div>
              </div>
              <Textarea
                id={`${uid}-msg`}
                ref={areaRef}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={MAX_CAMPAIGN_MESSAGE}
                rows={6}
                invalid={!!err("message")}
                aria-describedby={`${uid}-msg-hint`}
                placeholder="Bonjour {prenom}, …"
              />
              <div id={`${uid}-msg-hint`} className="mt-1.5 flex justify-between gap-3 text-[13px]">
                {err("message") ? <span role="alert" className="font-medium text-danger">{err("message")}</span> : <span className="text-ink-muted">{"{prenom}"} est remplacé par le prénom de chaque client.</span>}
                <span className="shrink-0 text-ink-faint tabular">
                  {message.length}/{MAX_CAMPAIGN_MESSAGE}
                </span>
              </div>
            </div>
            {!message && (
              <div>
                <p className="mb-2 text-sm font-medium text-ink">Partir d&apos;un modèle</p>
                <div className="flex flex-wrap gap-2">
                  {TEMPLATES.map((t) => (
                    <Button key={t.label} type="button" variant="outline" size="sm" onClick={() => setMessage(t.text)}>
                      {t.label}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Étape 3 : envoi */}
          <div hidden={step !== 2} className="space-y-5">
            <h2 ref={step === 2 ? headingRef : undefined} tabIndex={-1} className="text-lg font-semibold text-ink outline-none">
              Quand envoyer ?
            </h2>
            <fieldset>
              <legend className="sr-only">Moment de l&apos;envoi</legend>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {(
                  [
                    { k: "now", label: "Maintenant", desc: "Dès votre confirmation.", icon: Send },
                    { k: "later", label: "Plus tard", desc: "À la date de votre choix.", icon: CalendarClock },
                  ] as const
                ).map((o) => (
                  <label
                    key={o.k}
                    className={cn(
                      "flex cursor-pointer gap-3 rounded-[var(--radius-md)] p-4 ring-1 transition-[box-shadow,background-color] duration-150 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary",
                      when === o.k ? "bg-primary-soft/60 ring-2 ring-primary" : "bg-surface ring-line hover:ring-line-strong",
                    )}
                  >
                    <input type="radio" name={`${uid}-when`} value={o.k} checked={when === o.k} onChange={() => setWhen(o.k)} className="sr-only" />
                    <o.icon className="mt-0.5 size-5 text-primary" aria-hidden />
                    <span>
                      <span className="block font-medium text-ink">{o.label}</span>
                      <span className="block text-xs text-ink-muted">{o.desc}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            {when === "later" && (
              <Field id={`${uid}-date`} label="Date et heure d'envoi" className="max-w-xs" error={err("scheduledAt")} hint="Heure de votre appareil.">
                {(p) => <Input {...p} type="datetime-local" value={localDate} min={toLocalInput(new Date())} onChange={(e) => setLocalDate(e.target.value)} />}
              </Field>
            )}

            <div className="rounded-[var(--radius-md)] bg-surface-2/70 p-4">
              <dl className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <dt className="text-xs text-ink-muted">Destinataires</dt>
                  <dd className="mt-1 text-xl font-semibold text-ink tabular">{recipients}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-muted">Coût estimé</dt>
                  <dd className="mt-1 text-xl font-semibold text-ink tabular">
                    {cost} <span className="text-xs font-normal text-ink-muted">crédit{cost > 1 ? "s" : ""}</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-muted">Solde marketing</dt>
                  <dd className={cn("mt-1 text-xl font-semibold tabular", insufficient ? "text-danger" : "text-ink")}>{balance}</dd>
                </div>
              </dl>
              {!apiActive ? (
                <p className="mt-3 flex gap-2 text-sm text-ink-muted">
                  <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
                  L&apos;API WhatsApp n&apos;est pas connectée : chaque message sera préparé dans la conversation du client, avec un bouton pour l&apos;envoyer depuis WhatsApp. Aucun crédit n&apos;est débité.
                </p>
              ) : (
                <p className="mt-3 text-sm text-ink-muted">1 crédit par message accepté par WhatsApp. Les échecs d&apos;envoi sont recrédités automatiquement.</p>
              )}
            </div>
            {insufficient && (
              <Alert tone="danger" title="Solde insuffisant">
                Il manque {cost - balance} crédit{cost - balance > 1 ? "s" : ""}.{" "}
                {canBuyCredits ? (
                  <Link href={`/app/${storeId}/abonnement`} className="font-medium underline">
                    Acheter un pack de messages marketing
                  </Link>
                ) : (
                  "Demandez au propriétaire de la boutique d'acheter un pack."
                )}
              </Alert>
            )}
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-line pt-5">
            {step > 0 && (
              <Button type="button" variant="ghost" onClick={() => setStep((s) => s - 1)}>
                <ArrowLeft className="size-4" aria-hidden /> Retour
              </Button>
            )}
            <div className="ml-auto flex flex-wrap gap-2">
              {step === 2 && (
                <Button type="submit" name="intent" value="draft" variant="outline" disabled={pending}>
                  <Save className="size-4" aria-hidden /> Brouillon
                </Button>
              )}
              {step < 2 ? (
                <Button
                  type="button"
                  trailing={ArrowRight}
                  onClick={() => {
                    if (validate(step)) setStep((s) => s + 1);
                  }}
                >
                  Continuer
                </Button>
              ) : when === "now" ? (
                <Button type="submit" name="intent" value="send" variant="accent" loading={pending} disabled={recipients === 0 || insufficient}>
                  <Send className="size-4" aria-hidden /> {apiActive ? `Envoyer à ${recipients} client${recipients > 1 ? "s" : ""}` : "Préparer les messages"}
                </Button>
              ) : (
                <Button type="submit" name="intent" value="schedule" variant="accent" loading={pending} disabled={recipients === 0}>
                  <CalendarClock className="size-4" aria-hidden /> Planifier
                </Button>
              )}
            </div>
          </div>
        </Card>
      </div>

      {/* Aperçu */}
      <aside aria-label="Aperçu du message" className="lg:sticky lg:top-24 lg:self-start">
        <p className="mb-2 text-sm font-medium text-ink-muted">Aperçu sur WhatsApp</p>
        <div className="overflow-hidden rounded-[var(--radius-xl)] bg-surface ring-1 ring-line shadow-[var(--shadow-card)]">
          <div className="flex items-center gap-3 bg-whatsapp-deep px-4 py-3 text-white">
            <span className="inline-flex size-9 items-center justify-center rounded-full bg-white/20 text-sm font-bold" aria-hidden>
              {storeName.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{storeName}</p>
              <p className="text-xs text-white/90">Compte professionnel</p>
            </div>
          </div>
          <div className="min-h-56 bg-canvas-deep/70 p-4">
            <div className="max-w-[90%] rounded-[16px] rounded-tl-md bg-surface px-3.5 py-2.5 text-ink shadow-[var(--shadow-sm)]">
              <p className={cn("whitespace-pre-wrap break-words text-[14px] leading-relaxed [overflow-wrap:anywhere]", !message && "text-ink-faint")}>{preview}</p>
              <p className="mt-1 text-right text-[11px] text-ink-faint">{new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(new Date())}</p>
            </div>
          </div>
        </div>
        <p className="mt-2 text-xs text-ink-muted">
          Exemple avec le prénom {overview.sampleName ? "d'un de vos clients" : "« Awa »"}. Seuls les clients ayant accepté vos messages marketing le reçoivent.
        </p>
      </aside>
    </form>
  );
}
