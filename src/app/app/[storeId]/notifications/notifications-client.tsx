"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { ShoppingBag, Wallet, CircleAlert, PackageMinus, PackageX, Star, MessageCircle, Coins, Receipt, Zap, Megaphone, Info, type LucideIcon } from "lucide-react";
import { markNotificationsSeen, updateNotificationPrefs } from "@/lib/notifications/actions";
import type { NotifKind } from "@/lib/notifications/kinds";
import { Field, Input, Switch } from "@/components/ui/field";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage, fieldError } from "@/components/forms/form-message";
import { cn } from "@/lib/utils";

const ICONS: Record<NotifKind, LucideIcon> = {
  "order.new": ShoppingBag,
  "payment.verify": Wallet,
  "payment.failed": CircleAlert,
  "stock.low": PackageMinus,
  "stock.oversold": PackageX,
  "review.new": Star,
  "messages.unread": MessageCircle,
  credits: Coins,
  "invoice.due": Receipt,
  automation: Zap,
  campaign: Megaphone,
  other: Info,
};

const TONES = {
  neutral: "bg-surface-2 text-ink-muted",
  info: "bg-info-soft text-info",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  success: "bg-accent-soft text-primary-deep",
};

const DEFAULT_TONE: Record<NotifKind, keyof typeof TONES> = {
  "order.new": "success",
  "payment.verify": "warning",
  "payment.failed": "danger",
  "stock.low": "danger",
  "stock.oversold": "danger",
  "review.new": "info",
  "messages.unread": "info",
  credits: "warning",
  "invoice.due": "warning",
  automation: "neutral",
  campaign: "neutral",
  other: "neutral",
};

export function KindIcon({ kind, tone }: { kind: NotifKind; tone?: keyof typeof TONES }) {
  const Icon = ICONS[kind] ?? Info;
  return (
    <span className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ring-line", TONES[tone ?? DEFAULT_TONE[kind]])}>
      <Icon className="size-[17px]" aria-hidden />
    </span>
  );
}

/** Marque le flux comme lu après l'affichage (les pastilles « Nouveau » restent visibles sur cette page). */
export function MarkSeen({ storeId }: { storeId: string }) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    void markNotificationsSeen(storeId);
  }, [storeId]);
  return null;
}

export function PrefsForm({ storeId, dailyReport, lowStockThreshold }: { storeId: string; dailyReport: boolean; lowStockThreshold: number }) {
  const [state, action] = useActionState(updateNotificationPrefs, undefined);
  const [daily, setDaily] = useState(dailyReport);
  return (
    <form action={action} className="mt-4 space-y-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="storeId" value={storeId} />
      <div>
        <div className="flex min-h-11 items-center">
          <Switch name="dailyReport" checked={daily} onChange={setDaily} label="Récapitulatif quotidien par e-mail" />
        </div>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">Chaque matin vers 7 h : ventes de la veille, commandes à traiter, stock bas. Envoyé au propriétaire, seulement s'il y a quelque chose à dire.</p>
      </div>
      <Field id="lowStockThreshold" label="Seuil de stock bas par défaut" hint="Alerte quand un article suivi passe à ce niveau ou en dessous. Un produit peut avoir son propre seuil (fiche produit, Inventaire)." error={fieldError(state, "lowStockThreshold")}>
        {(p) => <Input {...p} name="lowStockThreshold" type="number" inputMode="numeric" min={0} max={1000} defaultValue={lowStockThreshold} className="tabular sm:max-w-32" />}
      </Field>
      <SubmitButton size="sm" className="h-11 sm:h-9">
        Enregistrer
      </SubmitButton>
    </form>
  );
}
