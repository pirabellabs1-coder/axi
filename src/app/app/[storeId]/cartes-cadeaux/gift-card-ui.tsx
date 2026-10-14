"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, Copy, Eye, Send, Ban, RotateCcw, CalendarPlus, SlidersHorizontal } from "lucide-react";
import { createGiftCard, disableGiftCard, enableGiftCard, extendGiftCard, adjustGiftCardBalance, revealGiftCardCode, resendGiftCard } from "@/lib/giftcards/actions";
import type { ActionResult } from "@/lib/action";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea, Select, Checkbox } from "@/components/ui/field";
import { Alert } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage, fieldError } from "@/components/forms/form-message";
import { cn } from "@/lib/utils";

const control =
  "h-11 md:h-9 rounded-full border-0 bg-surface text-sm text-ink ring-1 ring-inset ring-line-strong placeholder:text-ink-faint transition-shadow duration-200 hover:ring-ink-faint/60 focus:outline-none focus:ring-2 focus:ring-primary";

/** Recherche par 4 derniers caractères (formulaire GET, fonctionne sans JS). */
export function GiftCardSearch({ action, q, status, client }: { action: string; q: string; status?: string; client?: string }) {
  return (
    <form method="get" action={action} role="search" className="flex w-full flex-wrap items-center gap-2 lg:w-auto lg:flex-1 lg:justify-end">
      {status && <input type="hidden" name="statut" value={status} />}
      {client && <input type="hidden" name="client" value={client} />}
      <div className="relative min-w-0 flex-1 basis-56 lg:max-w-72">
        <label htmlFor="giftcard-q" className="sr-only">
          Rechercher par les 4 derniers caractères du code
        </label>
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" aria-hidden />
        <input id="giftcard-q" name="q" type="search" defaultValue={q} maxLength={20} autoCapitalize="characters" placeholder="4 derniers caractères (ex. H3VW)" className={cn(control, "w-full pl-9 pr-3 uppercase")} />
      </div>
      <button type="submit" className="sr-only">
        Rechercher
      </button>
    </form>
  );
}

function CopyCode({ code }: { code: string }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(code);
          toast.success("Code copié");
        } catch {
          toast.error("Copie impossible", "Sélectionnez le code puis copiez-le manuellement.");
        }
      }}
    >
      <Copy className="size-4" aria-hidden /> Copier
    </Button>
  );
}

/* ───────────────────────── Création manuelle ───────────────────────── */

export function CreateGiftCardButton(props: { storeId: string; currency: string; minValue: number; maxValue: number; defaultExpiresOn: string; minExpiresOn: string }) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const router = useRouter();
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden /> Créer une carte
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          setFormKey((k) => k + 1);
          router.refresh();
        }}
        title="Nouvelle carte cadeau"
        description="Le code n'est affiché qu'une fois : notez-le ou envoyez-le au destinataire."
        size="md"
      >
        <CreateGiftCardForm key={formKey} {...props} />
      </Dialog>
    </>
  );
}

function CreateGiftCardForm({ storeId, currency, minValue, maxValue, defaultExpiresOn, minExpiresOn }: { storeId: string; currency: string; minValue: number; maxValue: number; defaultExpiresOn: string; minExpiresOn: string }) {
  const [state, action] = useActionState(createGiftCard, undefined);
  const [noExpiry, setNoExpiry] = useState(false);
  const created = state?.ok ? state.data : undefined;
  const unit = currency === "XOF" || currency === "XAF" ? "FCFA" : currency;

  if (created) {
    return (
      <div className="space-y-4">
        <Alert tone="success" title="Carte cadeau créée">
          Ce code ne sera plus affiché. En cas de besoin, la révélation depuis la fiche est enregistrée dans le journal d&apos;audit.
        </Alert>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg)] bg-surface-2 px-4 py-4 ring-1 ring-line">
          <output aria-label="Code de la carte" className="select-all font-mono text-xl font-semibold tracking-[0.08em] text-ink">
            {created.code}
          </output>
          <CopyCode code={created.code} />
        </div>
        <a href={`/app/${storeId}/cartes-cadeaux/${created.id}`} className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline">
          Ouvrir la fiche de la carte
        </a>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage state={state} toastSuccess={false} />
      <input type="hidden" name="storeId" value={storeId} />
      <Field id="gc-value" label={`Valeur (${unit})`} required hint={`Entre ${minValue.toLocaleString("fr-FR")} et ${maxValue.toLocaleString("fr-FR")} ${unit}.`} error={fieldError(state, "value")}>
        {(p) => <Input {...p} name="value" inputMode="numeric" autoComplete="off" placeholder="10 000" />}
      </Field>
      <div>
        <Field id="gc-expires" label="Expiration" hint="Fin de journée, heure de la boutique." error={fieldError(state, "expiresOn")}>
          {(p) => <Input {...p} type="date" name="expiresOn" defaultValue={defaultExpiresOn} min={minExpiresOn} disabled={noExpiry} />}
        </Field>
        <div className="mt-2">
          <Checkbox label="Sans date d'expiration" checked={noExpiry} onChange={(e) => setNoExpiry(e.currentTarget.checked)} />
        </div>
      </div>
      <fieldset className="space-y-4 rounded-[var(--radius-lg)] p-4 ring-1 ring-line">
        <legend className="px-1 text-sm font-medium text-ink">Destinataire (facultatif)</legend>
        <Field id="gc-name" label="Nom" error={fieldError(state, "recipientName")}>
          {(p) => <Input {...p} name="recipientName" autoComplete="off" maxLength={80} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="gc-phone" label="Téléphone WhatsApp" hint="Rattache la carte à la fiche client." error={fieldError(state, "recipientPhone")}>
            {(p) => <Input {...p} name="recipientPhone" type="tel" inputMode="tel" autoComplete="off" />}
          </Field>
          <Field id="gc-email" label="E-mail" error={fieldError(state, "recipientEmail")}>
            {(p) => <Input {...p} name="recipientEmail" type="email" inputMode="email" autoComplete="off" />}
          </Field>
        </div>
        <Field id="gc-message" label="Message" hint="300 caractères maximum." error={fieldError(state, "message")}>
          {(p) => <Textarea {...p} name="message" rows={2} maxLength={300} />}
        </Field>
        <Checkbox name="sendNow" label="Envoyer la carte par e-mail maintenant" description="Sans e-mail, utilisez « Renvoyer » sur la fiche pour l'envoyer sur WhatsApp." />
      </fieldset>
      <Field id="gc-note" label="Note interne" hint="Motif de la création, visible dans le journal." error={fieldError(state, "note")}>
        {(p) => <Input {...p} name="note" maxLength={300} placeholder="Geste commercial, concours…" />}
      </Field>
      <div className="flex justify-end">
        <SubmitButton>Créer la carte</SubmitButton>
      </div>
    </form>
  );
}

/* ───────────────────────── Fiche : actions ───────────────────────── */

function useRefreshOnSuccess(state: ActionResult | undefined, close: () => void) {
  const router = useRouter();
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });
  useEffect(() => {
    if (state?.ok) {
      closeRef.current();
      router.refresh();
    }
  }, [state, router]);
}

function DisableForm({ storeId, id, close }: { storeId: string; id: string; close: () => void }) {
  const [state, action] = useActionState(disableGiftCard, undefined);
  useRefreshOnSuccess(state, close);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <input type="hidden" name="storeId" value={storeId} />
      <input type="hidden" name="id" value={id} />
      <Field id="gc-disable-reason" label="Motif" required error={fieldError(state, "reason")}>
        {(p) => <Input {...p} name="reason" maxLength={300} placeholder="Carte perdue, fraude suspectée…" />}
      </Field>
      <p className="text-sm text-ink-muted">La carte ne pourra plus être utilisée au paiement. Vous pourrez la réactiver.</p>
      <div className="flex justify-end">
        <SubmitButton variant="danger">Désactiver</SubmitButton>
      </div>
    </form>
  );
}

function ExtendForm({ storeId, id, minDate, defaultDate, close }: { storeId: string; id: string; minDate: string; defaultDate: string; close: () => void }) {
  const [state, action] = useActionState(extendGiftCard, undefined);
  useRefreshOnSuccess(state, close);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <input type="hidden" name="storeId" value={storeId} />
      <input type="hidden" name="id" value={id} />
      <Field id="gc-extend" label="Nouvelle date d'expiration" required hint="Une carte expirée redevient active." error={fieldError(state, "expiresOn")}>
        {(p) => <Input {...p} type="date" name="expiresOn" min={minDate} defaultValue={defaultDate} />}
      </Field>
      <div className="flex justify-end">
        <SubmitButton>Prolonger</SubmitButton>
      </div>
    </form>
  );
}

function AdjustForm({ storeId, id, unit, close }: { storeId: string; id: string; unit: string; close: () => void }) {
  const [state, action] = useActionState(adjustGiftCardBalance, undefined);
  useRefreshOnSuccess(state, close);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <input type="hidden" name="storeId" value={storeId} />
      <input type="hidden" name="id" value={id} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="gc-adj-dir" label="Opération" required>
          {(p) => (
            <Select {...p} name="direction" defaultValue="credit">
              <option value="credit">Créditer</option>
              <option value="debit">Débiter</option>
            </Select>
          )}
        </Field>
        <Field id="gc-adj-amount" label={`Montant (${unit})`} required error={fieldError(state, "amount")}>
          {(p) => <Input {...p} name="amount" inputMode="numeric" autoComplete="off" />}
        </Field>
      </div>
      <Field id="gc-adj-reason" label="Motif" required hint="Enregistré dans le journal de la carte et l'audit." error={fieldError(state, "reason")}>
        {(p) => <Input {...p} name="reason" maxLength={300} />}
      </Field>
      <div className="flex justify-end">
        <SubmitButton>Ajuster le solde</SubmitButton>
      </div>
    </form>
  );
}

type Panel = null | "disable" | "extend" | "adjust";

export function GiftCardActions(props: {
  storeId: string;
  id: string;
  status: "ACTIVE" | "DISABLED" | "EXPIRED";
  expired: boolean;
  unit: string;
  minDate: string;
  defaultExtendDate: string;
  canResend: boolean;
}) {
  const { storeId, id, status, expired, unit, minDate, defaultExtendDate, canResend } = props;
  const [panel, setPanel] = useState<Panel>(null);
  const [code, setCode] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const close = () => setPanel(null);

  const reveal = () =>
    start(async () => {
      const r = await revealGiftCardCode(storeId, id);
      if (r.ok && r.data) setCode(r.data.code);
      else if (!r.ok) toast.error(r.error);
    });
  const enable = () =>
    start(async () => {
      const r = await enableGiftCard(storeId, id);
      if (r.ok) {
        toast.success(r.message ?? "Carte réactivée");
        router.refresh();
      } else toast.error(r.error);
    });
  const resend = () =>
    start(async () => {
      const r = await resendGiftCard(storeId, id);
      if (!r.ok) return toast.error(r.error);
      if (r.data?.waLink) {
        window.open(r.data.waLink, "_blank", "noopener,noreferrer");
        toast.info("WhatsApp ouvert", "Le message prérempli contient le code : il ne part que si vous appuyez sur « Envoyer ».");
      } else toast.success(r.message ?? "Envoi programmé");
    });

  return (
    <div className="space-y-4">
      {code ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg)] bg-surface-2 px-4 py-3 ring-1 ring-line">
          <output aria-label="Code de la carte" className="select-all font-mono text-lg font-semibold tracking-[0.08em] text-ink">
            {code}
          </output>
          <CopyCode code={code} />
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {!code && (
          <Button type="button" variant="outline" size="sm" onClick={reveal} loading={pending}>
            <Eye className="size-4" aria-hidden /> Révéler le code
          </Button>
        )}
        {canResend && status === "ACTIVE" && !expired && (
          <Button type="button" variant="outline" size="sm" onClick={resend} disabled={pending}>
            <Send className="size-4" aria-hidden /> Renvoyer
          </Button>
        )}
        <Button type="button" variant="outline" size="sm" onClick={() => setPanel("adjust")}>
          <SlidersHorizontal className="size-4" aria-hidden /> Ajuster le solde
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setPanel("extend")}>
          <CalendarPlus className="size-4" aria-hidden /> Prolonger
        </Button>
        {status === "ACTIVE" && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setPanel("disable")} className="text-danger">
            <Ban className="size-4" aria-hidden /> Désactiver
          </Button>
        )}
        {status === "DISABLED" && (
          <Button type="button" variant="outline" size="sm" onClick={enable} disabled={pending || expired} title={expired ? "Carte expirée : prolongez-la d'abord" : undefined}>
            <RotateCcw className="size-4" aria-hidden /> Réactiver
          </Button>
        )}
      </div>
      <p className="text-xs text-ink-muted">La révélation du code et les ajustements sont enregistrés dans le journal d&apos;audit.</p>

      <Dialog open={panel === "disable"} onClose={close} title="Désactiver la carte" size="sm">
        {panel === "disable" && <DisableForm storeId={storeId} id={id} close={close} />}
      </Dialog>
      <Dialog open={panel === "extend"} onClose={close} title="Prolonger la validité" size="sm">
        {panel === "extend" && <ExtendForm storeId={storeId} id={id} minDate={minDate} defaultDate={defaultExtendDate} close={close} />}
      </Dialog>
      <Dialog open={panel === "adjust"} onClose={close} title="Ajuster le solde" size="sm">
        {panel === "adjust" && <AdjustForm storeId={storeId} id={id} unit={unit} close={close} />}
      </Dialog>
    </div>
  );
}
