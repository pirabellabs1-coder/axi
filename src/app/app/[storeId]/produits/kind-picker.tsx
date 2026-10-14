"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { CalendarClock, Check, FileDown, Gift, Lock, Package, type LucideIcon } from "lucide-react";
import { PRODUCT_KINDS, PRODUCT_KIND_HINTS, PRODUCT_KIND_LABELS, type ProductKindValue } from "@/lib/digital/kinds";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Alert } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import { kindChangeConsequences, type KindChangeContext } from "./kind-change";

/**
 * Choix de la nature du produit (vague 2), première étape du parcours de création.
 *
 *  - `ProductKindStep`  : 4 cartes cliquables en haut de la page « Ajouter un produit » (avant le titre).
 *  - `ProductKindBar`   : ligne compacte « Type de produit : … · Changer » en haut du formulaire d'édition,
 *                         avec fenêtre de confirmation listant les conséquences (`kind-change.ts`).
 *
 * Accessibilité : vrais boutons radio (navigation aux flèches, un seul arrêt de tabulation), cible ≥ 44 px,
 * état choisi marqué par une pastille cochée en plus de la couleur, focus visible via `peer-focus-visible`.
 */

export const PRODUCT_KIND_ICONS: Record<ProductKindValue, LucideIcon> = {
  PHYSICAL: Package,
  DIGITAL: FileDown,
  SERVICE: CalendarClock,
  GIFT_CARD: Gift,
};

/** Droits du plan utiles au choix de la nature. */
export type KindLocks = { digitalProducts: boolean; giftCards: boolean };

/** Une nature verrouillée par le plan reste visible mais non sélectionnable (sauf si le produit l'a déjà). */
export function kindLocked(kind: ProductKindValue, locks: KindLocks, current: ProductKindValue): boolean {
  if (kind === current) return false;
  if (kind === "DIGITAL" || kind === "SERVICE") return !locks.digitalProducts;
  if (kind === "GIFT_CARD") return !locks.giftCards;
  return false;
}

function KindChoiceGrid({
  name,
  legend,
  description,
  visibleLegend = false,
  value,
  onChange,
  locks,
  storeId,
  wide = false,
}: {
  /** Nom du groupe de radios (les flèches naviguent dans un même groupe). */
  name: string;
  legend: string;
  description?: string;
  visibleLegend?: boolean;
  value: ProductKindValue;
  onChange: (k: ProductKindValue) => void;
  locks: KindLocks;
  storeId: string;
  /** 4 colonnes sur très grand écran (étape de création) ; 2 colonnes dans la fenêtre. */
  wide?: boolean;
}) {
  const descId = useId();
  return (
    <fieldset aria-describedby={description ? descId : undefined}>
      <legend className={visibleLegend ? "text-[15px] font-semibold tracking-tight text-ink" : "sr-only"}>{legend}</legend>
      {description && (
        <p id={descId} className={cn("text-sm text-ink-muted", visibleLegend ? "mt-1" : "sr-only")}>
          {description}
        </p>
      )}
      <div className={cn("mt-4 grid gap-3 sm:grid-cols-2", wide && "xl:grid-cols-4")}>
        {PRODUCT_KINDS.map((k) => {
          const Icon = PRODUCT_KIND_ICONS[k];
          const on = value === k;
          const locked = kindLocked(k, locks, value);
          const head = (
            <span className="flex items-center gap-2.5">
              <span className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-full", on ? "bg-primary text-on-primary" : "bg-surface-2 text-ink-muted")}>
                <Icon className="size-[18px]" aria-hidden />
              </span>
              <span className={cn("text-[15px] font-semibold", on ? "text-primary-deep" : "text-ink")}>{PRODUCT_KIND_LABELS[k]}</span>
            </span>
          );

          if (locked) {
            return (
              <div key={k} className="relative flex min-h-[7rem] flex-col gap-2 rounded-[var(--radius-md)] bg-surface-2/40 px-4 py-3.5 ring-1 ring-inset ring-line">
                <span className="flex items-start justify-between gap-2">
                  {head}
                  <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-ink-muted ring-1 ring-inset ring-line">
                    <Lock className="size-3" aria-hidden /> Plan supérieur
                  </span>
                </span>
                <span className="text-[13px] leading-relaxed text-ink-muted">{PRODUCT_KIND_HINTS[k]}</span>
                <Link
                  href={`/app/${storeId}/abonnement#plans`}
                  className="mt-auto inline-flex min-h-11 items-center text-[13px] font-medium text-primary underline-offset-4 hover:underline"
                >
                  Voir les plans
                  <span className="sr-only"> pour débloquer « {PRODUCT_KIND_LABELS[k]} »</span>
                </Link>
              </div>
            );
          }

          return (
            <label
              key={k}
              className={cn(
                "relative flex min-h-[7rem] cursor-pointer flex-col gap-2 rounded-[var(--radius-md)] px-4 py-3.5 ring-1 ring-inset transition-[background-color,box-shadow] duration-200 ease-spring motion-reduce:transition-none",
                on ? "bg-primary-soft ring-2 ring-primary" : "bg-surface ring-line-strong hover:bg-surface-2",
              )}
            >
              <input type="radio" name={name} value={k} checked={on} onChange={() => onChange(k)} className="peer sr-only" />
              <span className="flex items-start justify-between gap-2">
                {head}
                <span
                  className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded-full ring-1 ring-inset", on ? "bg-primary text-on-primary ring-transparent" : "ring-line-strong")}
                  aria-hidden
                >
                  {on && <Check className="size-3.5" />}
                </span>
              </span>
              <span className="text-[13px] leading-relaxed text-ink-muted">{PRODUCT_KIND_HINTS[k]}</span>
              <span className="pointer-events-none absolute inset-0 rounded-[var(--radius-md)] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary" aria-hidden />
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Étape 1 de la création : le type avant toute saisie. « Produit physique » est présélectionné. */
export function ProductKindStep({
  value,
  onChange,
  locks,
  storeId,
  children,
}: {
  value: ProductKindValue;
  onChange: (k: ProductKindValue) => void;
  locks: KindLocks;
  storeId: string;
  /** Contenu complémentaire (limite de plan). */
  children?: React.ReactNode;
}) {
  return (
    <Card as="section" className="mb-6 px-5 py-5 sm:px-6">
      <KindChoiceGrid
        name="kind"
        legend="Que vendez-vous ?"
        description="Le type choisi détermine la livraison, le stock et ce que reçoit l'acheteur. Le formulaire s'adapte aussitôt."
        visibleLegend
        wide
        value={value}
        onChange={onChange}
        locks={locks}
        storeId={storeId}
      />
      {children && <div className="mt-4">{children}</div>}
    </Card>
  );
}

/** Édition : rappel compact du type en haut du formulaire, changement derrière une confirmation. */
export function ProductKindBar({
  value,
  onChange,
  locks,
  storeId,
  context,
  children,
}: {
  value: ProductKindValue;
  onChange: (k: ProductKindValue) => void;
  locks: KindLocks;
  storeId: string;
  /** Contexte du produit pour énumérer les conséquences du changement. */
  context: KindChangeContext;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ProductKindValue>(value);
  const Icon = PRODUCT_KIND_ICONS[value];
  const consequences = kindChangeConsequences(value, draft, context);

  const openDialog = () => {
    setDraft(value);
    setOpen(true);
  };
  const apply = () => {
    if (draft !== value) onChange(draft);
    setOpen(false);
  };

  return (
    <>
      <Card className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary-deep">
          <Icon className="size-[18px]" aria-hidden />
        </span>
        <p className="text-sm text-ink-muted">
          Type de produit : <span className="font-semibold text-ink">{PRODUCT_KIND_LABELS[value]}</span>
        </p>
        <Button variant="outline" size="sm" className="ml-auto" onClick={openDialog} aria-haspopup="dialog" aria-label="Changer le type de produit">
          Changer
        </Button>
        {children && <div className="w-full">{children}</div>}
      </Card>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Changer le type de produit"
        description="Le type détermine la livraison, le stock et ce que reçoit l'acheteur."
        size="lg"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button variant="primary" size="sm" onClick={apply} disabled={draft === value}>
              {consequences.length > 0 ? "Changer quand même" : "Appliquer"}
            </Button>
          </>
        }
      >
        <KindChoiceGrid name="kind-dialog" legend="Nouveau type de produit" value={draft} onChange={setDraft} locks={locks} storeId={storeId} />
        {consequences.length > 0 && (
          <Alert tone="warning" title="À savoir avant de changer" className="mt-4">
            <ul className="list-disc space-y-1 pl-4">
              {consequences.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </Alert>
        )}
        <p className="mt-3 text-[13px] text-ink-muted">Le changement n&apos;est définitif qu&apos;une fois le produit enregistré.</p>
      </Dialog>
    </>
  );
}
