"use client";

import { Coins, Globe, HardDrive, LayoutTemplate, MessageSquareText, Sparkles, Store, UserPlus, Wand2, Phone, type LucideIcon } from "lucide-react";
import { ADD_ONS, ADD_ON_BILLING_LABEL, PLANS, ZONE_CURRENCY, type AddOn, type AddOnId } from "@/config/plans";
import { formatPrice } from "@/lib/marketing/pricing";
import { usePricing } from "@/components/marketing/pricing-context";
import { cn } from "@/lib/utils";

const ICONS: Record<AddOnId, LucideIcon> = {
  EXTRA_MEMBER: UserPlus,
  EXTRA_WHATSAPP_NUMBER: Phone,
  EXTRA_STORE: Store,
  PACK_WA_UTILITY_500: MessageSquareText,
  PACK_WA_MARKETING_200: Coins,
  PACK_AI_1000: Sparkles,
  STORAGE_10GB: HardDrive,
  DOMAIN_NAME: Globe,
  SECTOR_TEMPLATE: LayoutTemplate,
  DONE_FOR_YOU: Wand2,
};

const GROUPS: { title: string; text: string; ids: AddOnId[] }[] = [
  { title: "Grandir", text: "Plus de membres, de numéros et de boutiques, dès Business.", ids: ["EXTRA_MEMBER", "EXTRA_WHATSAPP_NUMBER", "EXTRA_STORE"] },
  { title: "Crédits", text: "Des packs valables 12 mois, ajoutés à votre portefeuille.", ids: ["PACK_WA_UTILITY_500", "PACK_WA_MARKETING_200", "PACK_AI_1000"] },
  { title: "Espace et adresse", text: "Plus de stockage, votre propre nom de domaine.", ids: ["STORAGE_10GB", "DOMAIN_NAME"] },
  { title: "On le fait pour vous", text: "Un modèle prêt à vendre ou une boutique livrée clé en main.", ids: ["SECTOR_TEMPLATE", "DONE_FOR_YOU"] },
];

function availability(a: AddOn) {
  if (a.plans.length >= 5) return "Tous les plans";
  return a.plans.map((p) => PLANS[p].name).join(", ");
}

/** Options payantes (`ADD_ONS`) regroupées par usage, prix selon la zone choisie. */
export function PricingAddOns() {
  const { zone } = usePricing();
  const currency = ZONE_CURRENCY[zone];
  return (
    <div className="grid grid-cols-1 gap-x-10 gap-y-14 lg:grid-cols-2">
      {GROUPS.map((g, gi) => (
        <div key={g.title} className="reveal" style={{ transitionDelay: `${(gi % 2) * 80}ms` }}>
          <h3 className="text-h3 font-semibold text-ink">{g.title}</h3>
          <p className="mt-1.5 text-[15px] text-ink-muted">{g.text}</p>
          <ul className="mt-5 space-y-3">
            {g.ids.map((id) => {
              const a = ADD_ONS.find((x) => x.id === id);
              if (!a) return null;
              const Icon = ICONS[id];
              return (
                <li key={id} className="flex gap-4 rounded-[var(--radius-lg)] bg-surface p-5 ring-1 ring-line shadow-[var(--shadow-card)]">
                  <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-2 text-primary">
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <p className="font-medium text-ink">{a.name}</p>
                      <p className="text-ink">
                        <span className="font-semibold tabular">{formatPrice(a.price[zone], currency)}</span>{" "}
                        <span className="text-[13px] text-ink-muted">{ADD_ON_BILLING_LABEL[a.billing]}</span>
                      </p>
                    </div>
                    <p className="mt-1 text-sm text-ink-muted">{a.description}</p>
                    <p className={cn("mt-2.5 text-[12.5px] text-ink-faint")}>Disponible avec : {availability(a)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
