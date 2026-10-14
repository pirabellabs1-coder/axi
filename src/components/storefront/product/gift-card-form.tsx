"use client";

import { Gift } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GiftCardRecipientInput } from "../cart-store";

type Key = keyof GiftCardRecipientInput;
export type RecipientErrors = Partial<Record<Key, string>>;

const MESSAGE_MAX = 300;

/** Contrôle local (confort) ; le serveur revalide et normalise (placeOrder, émission après paiement). */
export function giftCardRecipientError(v: GiftCardRecipientInput): RecipientErrors {
  const e: RecipientErrors = {};
  const phone = (v.recipientPhone ?? "").replace(/\D/g, "");
  const email = (v.recipientEmail ?? "").trim();
  if (!(v.recipientName ?? "").trim()) e.recipientName = "Indiquez le prénom ou le nom du destinataire.";
  if (!phone && !email) e.recipientPhone = "Indiquez un numéro WhatsApp ou un e-mail pour envoyer la carte.";
  if (phone && phone.length < 6) e.recipientPhone = "Numéro invalide, par exemple 97 00 00 00.";
  if (email && !/^\S+@\S+\.\S+$/.test(email)) e.recipientEmail = "Adresse e-mail invalide.";
  if ((v.message ?? "").length > MESSAGE_MAX) e.message = `${MESSAGE_MAX} caractères maximum.`;
  if (v.sendAt) {
    const d = new Date(`${v.sendAt}T08:00:00`);
    if (Number.isNaN(d.getTime()) || d.getTime() < Date.now()) e.sendAt = "Choisissez une date à venir, ou laissez vide pour un envoi dès le paiement.";
  }
  return e;
}

/** Valeurs envoyées au panier : champs vides retirés, longueurs bornées. */
export function cleanRecipient(v: GiftCardRecipientInput): GiftCardRecipientInput {
  const out: GiftCardRecipientInput = {};
  const set = (k: Key, max: number) => {
    const x = (v[k] ?? "").trim().slice(0, max);
    if (x) out[k] = x;
  };
  set("recipientName", 80);
  set("recipientPhone", 20);
  set("recipientEmail", 160);
  set("message", MESSAGE_MAX);
  if (v.sendAt && /^\d{4}-\d{2}-\d{2}$/.test(v.sendAt)) out.sendAt = new Date(`${v.sendAt}T08:00:00`).toISOString();
  return out;
}

function tomorrow(): string {
  const d = new Date(Date.now() + 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Bloc « Carte cadeau : destinataire » (fiche d'un produit carte cadeau) : nom, WhatsApp ou e-mail, message, date.
 * Libellés au-dessus des champs, erreurs liées (aria-describedby), cibles de 48 px.
 */
export function GiftCardForm({ value, errors, onChange }: { value: GiftCardRecipientInput; errors: RecipientErrors; onChange: (v: GiftCardRecipientInput) => void }) {
  const set = (k: Key) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange({ ...value, [k]: e.target.value });
  const field = (k: Key, label: string, input: (p: { id: string; "aria-invalid"?: boolean; "aria-describedby"?: string }) => React.ReactNode, hint?: string) => {
    const id = `gc-${k}`;
    const err = errors[k];
    const describedBy = [hint ? `${id}-hint` : null, err ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
    return (
      <div>
        <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink">
          {label}
        </label>
        {input({ id, "aria-invalid": err ? true : undefined, "aria-describedby": describedBy })}
        {hint && !err && (
          <p id={`${id}-hint`} className="mt-1 text-xs text-ink-muted">
            {hint}
          </p>
        )}
        {err && (
          <p id={`${id}-error`} role="alert" className="mt-1 text-[13px] font-medium text-danger">
            {err}
          </p>
        )}
      </div>
    );
  };
  const msgLen = (value.message ?? "").length;
  return (
    <fieldset className="rounded-[min(var(--store-card-radius),16px)] bg-surface p-4 ring-1 ring-line sm:p-5">
      <legend className="sr-only">Destinataire de la carte cadeau</legend>
      <p className="mb-4 flex items-center gap-2 text-[15px] font-semibold text-ink" aria-hidden>
        <Gift className="size-[18px] text-[var(--store-primary)]" /> Pour qui est cette carte ?
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">{field("recipientName", "Nom du destinataire", (p) => <input {...p} className="sf-input" autoComplete="off" maxLength={80} value={value.recipientName ?? ""} onChange={set("recipientName")} />)}</div>
        {field("recipientPhone", "WhatsApp du destinataire", (p) => <input {...p} className="sf-input" type="tel" inputMode="tel" autoComplete="off" maxLength={20} placeholder="97 00 00 00" value={value.recipientPhone ?? ""} onChange={set("recipientPhone")} />, "Ou renseignez son e-mail.")}
        {field("recipientEmail", "E-mail (facultatif)", (p) => <input {...p} className="sf-input" type="email" inputMode="email" autoComplete="off" maxLength={160} value={value.recipientEmail ?? ""} onChange={set("recipientEmail")} />)}
        <div className="sm:col-span-2">
          {field(
            "message",
            "Message (facultatif)",
            (p) => <textarea {...p} rows={3} maxLength={MESSAGE_MAX} className={cn("sf-input h-auto min-h-24 py-3")} value={value.message ?? ""} onChange={set("message")} placeholder="Joyeux anniversaire !" />,
            `${msgLen}/${MESSAGE_MAX} caractères`,
          )}
        </div>
        <div className="sm:col-span-2">{field("sendAt", "Date d'envoi (facultatif)", (p) => <input {...p} type="date" className="sf-input" min={tomorrow()} value={value.sendAt ?? ""} onChange={set("sendAt")} />, "Sans date, la carte est envoyée dès la confirmation du paiement.")}</div>
      </div>
    </fieldset>
  );
}
