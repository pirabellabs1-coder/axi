"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import Image from "next/image";
import { ArrowLeft, ArrowRight, Check, Globe2, Loader2, MapPin, Sparkles, Store, X } from "lucide-react";
import { createStore, isSlugAvailable } from "@/lib/store/actions";
import { Field, Input, Select, Switch } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Bezel } from "@/components/ui/card";
import { StepProgress } from "@/components/ui/progress";
import { KeyValue } from "@/components/ui/misc";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage } from "@/components/forms/form-message";
import { slugify, cn } from "@/lib/utils";
import { SECTORS, getSector, type SectorId } from "./sectors";
import { STORE_CURRENCY_OPTIONS, defaultStoreCurrency } from "@/lib/currency/store-currencies";

type Zone = "WORLD" | "AFRICA";

export type WizardCountry = { code: string; name: string; currency: string; zone: Zone };

export type WizardProps = {
  domain: string;
  countries: WizardCountry[];
  zoneLabel: Record<Zone, string>;
  /** Première boutique : essai du plan payant ; sinon plan Gratuit. */
  firstStore: boolean;
  trial: { planName: string; days: number; price: Record<Zone, string> };
  doneForYou: { name: string; description: string; price: Record<Zone, string> };
};

const STEPS = [
  { id: 1, title: "Nom et adresse" },
  { id: 2, title: "Pays" },
  { id: 3, title: "Secteur" },
  { id: 4, title: "Accompagnement" },
  { id: 5, title: "Récapitulatif" },
] as const;

const FIELD_STEP: Record<string, number> = { name: 1, slug: 1, country: 2, currency: 2, city: 2, sector: 3 };

type Avail = { available: boolean; reason?: string } | null;

export function StoreWizard({ domain, countries, zoneLabel, firstStore, trial, doneForYou }: WizardProps) {
  const [state, action] = useActionState(createStore, undefined);
  const [seenState, setSeenState] = useState(state);
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [checked, setChecked] = useState<{ slug: string; res: NonNullable<Avail> } | null>(null);
  const [checking, startCheck] = useTransition();
  const [country, setCountry] = useState(countries[0]?.code ?? "BJ");
  // Devise des prix : pré-sélectionnée selon le pays tant que le commerçant ne l'a pas choisie lui-même.
  const [currencyChoice, setCurrencyChoice] = useState<string | null>(null);
  const [city, setCity] = useState("");
  const [sector, setSector] = useState<SectorId | "">("");
  const [dfy, setDfy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  const effectiveSlug = slugTouched ? slug : slugify(name);
  const avail: Avail = effectiveSlug.length >= 3 && checked?.slug === effectiveSlug ? checked.res : null;
  const selectedCountry = countries.find((c) => c.code === country) ?? countries[0];
  const zone: Zone = selectedCountry?.zone ?? "AFRICA";
  const currency = currencyChoice ?? defaultStoreCurrency(country, selectedCountry?.currency);
  const sectorOption = getSector(sector);

  // Disponibilité de l'adresse (anti-rebond). Le résultat n'est valable que pour l'adresse vérifiée.
  useEffect(() => {
    if (effectiveSlug.length < 3) return;
    const t = setTimeout(() => startCheck(async () => setChecked({ slug: effectiveSlug, res: await isSlugAvailable(effectiveSlug) })), 350);
    return () => clearTimeout(t);
  }, [effectiveSlug]);

  // Erreurs serveur : retour à l'étape concernée (ajustement pendant le rendu, sans effet)
  if (state !== seenState) {
    setSeenState(state);
    if (state && !state.ok && state.fieldErrors) {
      const fe = Object.fromEntries(Object.entries(state.fieldErrors).map(([k, v]) => [k, v?.[0] ?? ""]));
      setErrors(fe);
      const target = Math.min(...Object.keys(fe).map((k) => FIELD_STEP[k] ?? 5));
      if (Number.isFinite(target)) setStep(target);
    }
  }

  // Focus sur le titre de l'étape à chaque changement (lecteurs d'écran, clavier)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  function clearError(key: string) {
    setErrors((prev) => {
      if (!(key in prev)) return prev;
      const copy = { ...prev };
      delete copy[key];
      return copy;
    });
  }

  function validate(s: number): Record<string, string> {
    const e: Record<string, string> = {};
    if (s === 1) {
      if (name.trim().length < 2) e.name = "Indiquez le nom de votre boutique (2 caractères minimum).";
      if (effectiveSlug.length < 3) e.slug = "L'adresse doit contenir au moins 3 caractères.";
      else if (avail && !avail.available) e.slug = avail.reason ?? "Adresse indisponible.";
    }
    if (s === 2 && !selectedCountry) e.country = "Choisissez un pays.";
    if (s === 3 && !sector) e.sector = "Choisissez le secteur de votre boutique.";
    return e;
  }

  async function next() {
    const e = validate(step);
    if (step === 1 && !e.slug && (!avail || checking)) {
      const res = await isSlugAvailable(effectiveSlug);
      setChecked({ slug: effectiveSlug, res });
      if (!res.available) e.slug = res.reason ?? "Adresse indisponible.";
    }
    setErrors(e);
    if (Object.keys(e).length) {
      const firstKey = Object.keys(e)[0];
      document.getElementById(firstKey === "sector" ? "sector-general" : firstKey)?.focus();
      return;
    }
    setStep((s) => Math.min(STEPS.length, s + 1));
  }

  const back = () => {
    setErrors({});
    setStep((s) => Math.max(1, s - 1));
  };

  const current = STEPS[step - 1];
  const isLast = step === STEPS.length;

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-10">
      <form
        action={action}
        noValidate
        onKeyDown={(e) => {
          // Entrée dans un champ : passer à l'étape suivante au lieu de soumettre
          if (e.key === "Enter" && !isLast && (e.target as HTMLElement).tagName === "INPUT") {
            e.preventDefault();
            void next();
          }
        }}
        onSubmit={(e) => {
          if (!isLast) e.preventDefault();
        }}
      >
        {/* Valeurs conservées entre les étapes, soumises en une fois */}
        <input type="hidden" name="name" value={name} />
        <input type="hidden" name="slug" value={effectiveSlug} />
        <input type="hidden" name="country" value={country} />
        <input type="hidden" name="currency" value={currency} />
        <input type="hidden" name="city" value={city} />
        <input type="hidden" name="sector" value={sector} />
        <input type="hidden" name="doneForYou" value={dfy ? "true" : "false"} />

        <Bezel coreClassName="p-5 sm:p-8">
          <StepProgress current={step} total={STEPS.length} label={`Étape ${step} sur ${STEPS.length} : ${current.title}`} />

          <div className="mt-7" aria-live="polite">
            <FormMessage state={state} />
          </div>

          {step === 1 && (
            <section aria-labelledby="step-title" className="animate-fade-in">
              <StepTitle ref={headingRef} title="Comment s'appelle votre boutique ?" sub="Vos clients verront ce nom en haut de votre boutique et dans WhatsApp." />
              <div className="mt-6 space-y-5">
                <Field id="name" label="Nom de la boutique" error={errors.name} required>
                  {(p) => (
                    <Input
                      {...p}
                      value={name}
                      maxLength={60}
                      autoComplete="organization"
                      onChange={(e) => {
                        setName(e.target.value);
                        clearError("name");
                      }}
                      placeholder="Ex. Chez Aïcha Pâtisserie"
                      autoFocus
                    />
                  )}
                </Field>
                <Field
                  id="slug"
                  label="Adresse de la boutique"
                  required
                  error={errors.slug ?? (avail && !avail.available ? avail.reason : undefined)}
                  hint={
                    checking ? (
                      <span className="inline-flex items-center gap-1.5"><Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> Vérification…</span>
                    ) : avail?.available ? (
                      <span className="inline-flex items-center gap-1.5 font-medium text-primary"><Check className="size-3.5" aria-hidden /> Adresse disponible</span>
                    ) : (
                      "Lettres minuscules, chiffres et traits d'union."
                    )
                  }
                >
                  {(p) => (
                    <div className="flex items-stretch">
                      <Input
                        {...p}
                        value={effectiveSlug}
                        maxLength={48}
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        onChange={(e) => {
                          setSlugTouched(true);
                          setSlug(slugify(e.target.value));
                          clearError("slug");
                        }}
                        className="rounded-r-none"
                        placeholder="chez-aicha"
                      />
                      <span className="inline-flex shrink-0 items-center rounded-r-[var(--radius-md)] bg-surface-2 px-3 text-sm text-ink-muted ring-1 ring-inset ring-line-strong">.{domain}</span>
                    </div>
                  )}
                </Field>
                <div className="rounded-[var(--radius-md)] bg-surface-2 px-4 py-3 text-sm ring-1 ring-inset ring-line">
                  <p className="text-ink-muted">Vos clients pourront commander sur :</p>
                  <p className="mt-1 font-mono text-[13px] text-ink [overflow-wrap:anywhere]">
                    {effectiveSlug || "votre-boutique"}.{domain}
                  </p>
                  <p className="font-mono text-[13px] text-ink-muted [overflow-wrap:anywhere]">ou /s/{effectiveSlug || "votre-boutique"}</p>
                </div>
              </div>
            </section>
          )}

          {step === 2 && (
            <section aria-labelledby="step-title" className="animate-fade-in">
              <StepTitle ref={headingRef} title="Où vendez-vous ?" sub="Le pays fixe l'indicatif WhatsApp et votre zone tarifaire Axi. Choisissez la devise de vos prix." />
              <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Field id="country" label="Pays" error={errors.country} required>
                  {(p) => (
                    <Select {...p} value={country} autoComplete="country" onChange={(e) => setCountry(e.target.value)}>
                      {countries.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field
                  id="currency"
                  label="Devise de la boutique"
                  required
                  error={errors.currency}
                  hint="Tous vos prix, paniers et commandes seront dans cette devise. Modifiable tant que vous n'avez reçu aucune commande."
                >
                  {(p) => (
                    <Select
                      {...p}
                      value={currency}
                      onChange={(e) => {
                        setCurrencyChoice(e.target.value);
                        clearError("currency");
                      }}
                    >
                      {STORE_CURRENCY_OPTIONS.map((o) => (
                        <option key={o.code} value={o.code}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field id="city" label="Ville" hint="Facultatif. Affichée sur la marketplace.">
                  {(p) => <Input {...p} value={city} maxLength={60} autoComplete="address-level2" onChange={(e) => setCity(e.target.value)} placeholder="Cotonou" />}
                </Field>
              </div>
              <div className="mt-6 flex items-start gap-3 rounded-[var(--radius-md)] bg-primary-soft px-4 py-3.5 text-sm text-primary-deep ring-1 ring-inset ring-primary/15">
                <Globe2 className="mt-0.5 size-4 shrink-0" aria-hidden />
                <div>
                  <p>
                    Zone tarifaire : <strong className="font-semibold">{zoneLabel[zone]}</strong>
                  </p>
                  <p className="mt-0.5 opacity-85">
                    {firstStore
                      ? `${trial.planName} offert ${trial.days} jours, puis ${trial.price[zone]} par mois si vous continuez. Sans carte bancaire.`
                      : "Cette boutique démarre sur le plan Gratuit. Vous pourrez la passer à un plan payant à tout moment."}
                  </p>
                </div>
              </div>
            </section>
          )}

          {step === 3 && (
            <section aria-labelledby="step-title" className="animate-fade-in">
              <StepTitle ref={headingRef} title="Que vendez-vous ?" sub="Nous préparons un thème et des libellés adaptés. Vous pourrez tout changer ensuite." />
              <fieldset className="mt-6" aria-describedby={errors.sector ? "sector-error" : undefined}>
                <legend className="sr-only">Secteur d&apos;activité</legend>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {SECTORS.map((s, i) => {
                    const checked = sector === s.id;
                    return (
                      <label
                        key={s.id}
                        className={cn(
                          "group relative flex cursor-pointer flex-col overflow-hidden rounded-[var(--radius-lg)] bg-surface ring-1 ring-line transition-[box-shadow,transform] duration-300 ease-spring active:scale-[0.98] motion-reduce:transition-none",
                          "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary",
                          checked ? "ring-2 ring-primary shadow-[var(--shadow-card)]" : "hover:ring-line-strong",
                        )}
                      >
                        <input
                          type="radio"
                          name="sector-choice"
                          id={`sector-${s.id}`}
                          value={s.id}
                          checked={checked}
                          onChange={() => {
                            setSector(s.id);
                            clearError("sector");
                          }}
                          className="sr-only"
                          aria-label={s.label}
                          aria-describedby={`sector-${s.id}-hint`}
                        />
                        <span className="relative block aspect-[4/3] overflow-hidden bg-surface-2">
                          <Image
                            src={s.image}
                            alt=""
                            fill
                            sizes="(min-width: 1024px) 200px, (min-width: 640px) 30vw, 45vw"
                            priority={i < 3}
                            className="object-cover transition-transform duration-700 ease-out-expo group-hover:scale-[1.04] motion-reduce:transition-none"
                          />
                          <span
                            aria-hidden
                            className={cn(
                              "absolute right-2 top-2 inline-flex size-7 items-center justify-center rounded-full ring-1 transition-[background-color,opacity] duration-200",
                              checked ? "bg-primary text-on-primary ring-white/40" : "bg-surface/85 text-transparent ring-line backdrop-blur-sm",
                            )}
                          >
                            <Check className="size-4" />
                          </span>
                        </span>
                        <span className="flex min-h-16 flex-col justify-center px-3 py-2.5">
                          <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                            {s.label}
                            {checked && <span className="sr-only">(sélectionné)</span>}
                          </span>
                          <span id={`sector-${s.id}-hint`} className="mt-0.5 text-xs leading-snug text-ink-muted">
                            {s.hint}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                {errors.sector && (
                  <p id="sector-error" role="alert" className="mt-3 text-[13px] font-medium text-danger">
                    {errors.sector}
                  </p>
                )}
              </fieldset>
            </section>
          )}

          {step === 4 && (
            <section aria-labelledby="step-title" className="animate-fade-in">
              <StepTitle ref={headingRef} title="Voulez-vous un coup de main ?" sub="Vous pouvez tout faire seul en quelques minutes. Si vous manquez de temps, notre équipe s'en charge." />
              <div
                className={cn(
                  "mt-6 overflow-hidden rounded-[var(--radius-lg)] ring-1 transition-[box-shadow] duration-300",
                  dfy ? "ring-2 ring-primary" : "ring-line",
                )}
              >
                <div className="bg-forest p-5 text-white sm:p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="inline-flex items-center gap-1.5 text-xs font-medium text-lime">
                        <Sparkles className="size-3.5" aria-hidden /> Option facultative
                      </p>
                      <h3 className="mt-2 text-lg font-semibold tracking-tight">{doneForYou.name}</h3>
                      <p className="mt-1 max-w-[46ch] text-sm text-white/75">{doneForYou.description}</p>
                    </div>
                    <p className="shrink-0 text-right">
                      <span className="tabular block text-lg font-semibold">{doneForYou.price[zone]}</span>
                      <span className="text-xs text-white/65">une fois</span>
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 bg-surface px-5 py-4 sm:px-6">
                  <Switch checked={dfy} onChange={setDfy} label="Je veux que l'équipe Axi crée ma boutique" />
                  <span className="text-xs text-ink-muted">Rien n&apos;est facturé maintenant.</span>
                </div>
              </div>
              <p className="mt-4 text-sm text-ink-muted">
                {dfy
                  ? "Après la création, vous arriverez sur la page des options pour confirmer la demande."
                  : "Laissez désactivé pour continuer seul : un guide pas à pas vous attend après la création."}
              </p>
            </section>
          )}

          {step === 5 && (
            <section aria-labelledby="step-title" className="animate-fade-in">
              <StepTitle ref={headingRef} title="Tout est prêt." sub="Vérifiez les informations, puis créez votre boutique. Elle reste en brouillon jusqu'à sa publication." />
              <KeyValue
                className="mt-6 rounded-[var(--radius-md)] bg-surface-2 px-4 ring-1 ring-inset ring-line"
                items={[
                  { label: "Nom", value: <span className="font-medium">{name}</span> },
                  { label: "Adresse", value: <span className="font-mono text-[13px]">{effectiveSlug}.{domain}</span> },
                  { label: "Pays", value: `${selectedCountry?.name ?? ""}${city ? `, ${city}` : ""}` },
                  { label: "Devise des prix", value: currency },
                  { label: "Secteur", value: sectorOption?.label ?? "" },
                  { label: "Formule", value: firstStore ? `Essai ${trial.planName}, ${trial.days} jours` : "Gratuit" },
                  { label: "Zone tarifaire", value: zoneLabel[zone] },
                  { label: "Création clé en main", value: dfy ? <Badge tone="primary">Demandée</Badge> : "Non" },
                ]}
              />
              <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {[
                  { s: 1, l: "Modifier le nom" },
                  { s: 2, l: "Modifier le pays" },
                  { s: 3, l: "Modifier le secteur" },
                ].map((x) => (
                  <button key={x.s} type="button" onClick={() => setStep(x.s)} className="inline-flex min-h-11 items-center text-primary underline-offset-4 hover:underline">
                    {x.l}
                  </button>
                ))}
              </div>
            </section>
          )}

          <div className="mt-8 flex items-center justify-between gap-3 border-t border-line pt-5">
            {step > 1 ? (
              <Button type="button" variant="ghost" onClick={back}>
                <ArrowLeft className="size-4" aria-hidden /> Précédent
              </Button>
            ) : (
              <span />
            )}
            {isLast ? (
              <SubmitButton variant="accent" size="lg" trailing={Store}>
                Créer ma boutique
              </SubmitButton>
            ) : (
              <Button type="button" onClick={() => void next()} trailing={ArrowRight}>
                Suivant
              </Button>
            )}
          </div>
        </Bezel>
      </form>

      <aside aria-label="Aperçu de votre boutique" className="hidden lg:block">
        <div className="sticky top-8">
          <p className="mb-3 text-xs font-medium text-ink-muted">Aperçu en direct</p>
          <div className="overflow-hidden rounded-[var(--radius-xl)] bg-surface ring-1 ring-line shadow-[var(--shadow-card)]">
            <div className="relative aspect-[4/3] bg-surface-2">
              {sectorOption ? (
                <Image src={sectorOption.image} alt={sectorOption.alt} fill sizes="340px" className="object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-ink-faint">
                  <Store className="size-8" aria-hidden />
                </div>
              )}
              <span className="absolute left-3 top-3">
                <Badge tone="neutral" className="bg-surface/90 backdrop-blur-sm">Brouillon</Badge>
              </span>
            </div>
            <div className="p-5">
              <p className="truncate text-lg font-semibold tracking-tight text-ink">{name || "Votre boutique"}</p>
              <p className="mt-0.5 truncate font-mono text-xs text-ink-muted">
                {effectiveSlug || "votre-boutique"}.{domain}
              </p>
              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-ink-muted ring-1 ring-inset ring-line">
                  <MapPin className="size-3" aria-hidden /> {city || selectedCountry?.name}
                </span>
                {sectorOption && <span className="rounded-full bg-surface-2 px-2.5 py-1 text-ink-muted ring-1 ring-inset ring-line">{sectorOption.label}</span>}
                <span className="rounded-full bg-surface-2 px-2.5 py-1 text-ink-muted ring-1 ring-inset ring-line">{currency}</span>
              </div>
            </div>
          </div>
          <ol className="mt-6 space-y-1.5 text-sm">
            {STEPS.map((s) => (
              <li key={s.id} className={cn("flex items-center gap-2.5", s.id === step ? "font-medium text-ink" : "text-ink-muted")} aria-current={s.id === step ? "step" : undefined}>
                <span
                  aria-hidden
                  className={cn(
                    "inline-flex size-5 items-center justify-center rounded-full text-[11px]",
                    s.id < step ? "bg-primary text-on-primary" : s.id === step ? "bg-ink text-canvas" : "bg-surface-2 text-ink-faint ring-1 ring-inset ring-line",
                  )}
                >
                  {s.id < step ? <Check className="size-3" /> : s.id}
                </span>
                {s.title}
                {s.id < step && <span className="sr-only">(terminée)</span>}
              </li>
            ))}
          </ol>
          {avail && !avail.available && step === 1 && (
            <p className="mt-4 inline-flex items-center gap-1 text-xs text-danger">
              <X className="size-3.5" aria-hidden /> Adresse indisponible
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}

function StepTitle({ title, sub, ref }: { title: string; sub: string; ref: React.Ref<HTMLHeadingElement> }) {
  return (
    <header>
      <h2 id="step-title" ref={ref} tabIndex={-1} className="text-[24px] font-semibold leading-[1.1] tracking-[-0.035em] text-ink outline-none sm:text-[28px]">
        {title}
      </h2>
      <p className="mt-2 max-w-[56ch] text-[15px] leading-relaxed text-ink-muted">{sub}</p>
    </header>
  );
}
