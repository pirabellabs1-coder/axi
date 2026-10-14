import { Lock, ArrowUpRight, PackagePlus, Check } from "lucide-react";
import { PLANS, PLAN_ORDER, getAddOn, type AddOnId, type PlanFeatures, type PlanId } from "@/config/plans";
import { ButtonLink } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Plan minimal qui débloque une fonctionnalité. */
export function requiredPlanFor(feature: keyof PlanFeatures): PlanId {
  return PLAN_ORDER.find((id) => PLANS[id].features[feature]) ?? "ENTERPRISE";
}

export const FEATURE_LABELS: Record<keyof PlanFeatures, string> = {
  removeBranding: "Masquer le logo Axi",
  customDomain: "Domaine personnalisé",
  advancedEditor: "Éditeur avancé et versions",
  variants: "Variantes",
  options: "Options et suppléments",
  stockTracking: "Suivi de stock",
  csvImport: "Import CSV",
  csvExport: "Export CSV",
  digitalProducts: "Services et produits numériques",
  orderExport: "Impression et export des commandes",
  scheduledOrders: "Commandes planifiées",
  refunds: "Retours et remboursements partiels",
  onlinePayments: "Mobile Money et carte en ligne",
  reconciliation: "Rapprochement automatique",
  pickupSlots: "Créneaux de retrait",
  couriers: "Livreurs internes",
  carriers: "Transporteurs partenaires",
  whatsappApi: "WhatsApp officiel (API)",
  inbox: "Boîte de réception partagée",
  pipeline: "Entonnoir de vente",
  campaigns: "Campagnes WhatsApp",
  socialInbox: "Instagram et Facebook",
  chatbot: "Chatbot",
  crm: "Fichier clients (CRM)",
  coupons: "Codes promo",
  segments: "Segments et consentements",
  loyalty: "Programme de fidélité",
  reviews: "Avis clients",
  automations: "Automatisations",
  abandonedCart: "Relance des paniers abandonnés",
  customerAccounts: "Comptes clients",
  automaticDiscounts: "Remises automatiques",
  advancedDiscounts: "Lots et « X achetés = Y offerts »",
  cartOffers: "Offres au panier",
  giftCards: "Cartes cadeaux",
  storeCredit: "Avoirs clients",
  returnsPortal: "Retours en libre-service",
  multiCurrency: "Affichage multi-devises",
  taxes: "TVA et prix TTC / HT",
  invoices: "Factures et avoirs",
  blog: "Blog de la boutique",
  webhooks: "Webhooks sortants",
  restApi: "API REST",
  aiTranslation: "Traduction par l'IA",
  aiStoreBuilder: "Boutique générée par l'IA",
  designAssistant: "Assistant de design",
  inlineEditing: "Édition dans l'aperçu",
  metafields: "Champs personnalisés",
  alternateTemplates: "Modèles alternatifs",
  savedSections: "Sections enregistrées",
  premiumSections: "Sections premium",
  scheduledThemes: "Thèmes programmés",
  audiencePersonalization: "Contenus par audience",
  abTests: "Tests A/B",
  qualityScores: "Scores qualité",
  motionPresets: "Animations",
  pwa: "Boutique installable (PWA)",
  webPush: "Notifications push",
  catalogFeeds: "Flux catalogues",
  catalogSync: "Catalogue WhatsApp synchronisé",
  shoppableMedia: "Vidéos et stories achetables",
  liveShopping: "Live shopping",
  stockTransfers: "Transferts entre dépôts",
  advancedAnalytics: "Rapports avancés",
  pixels: "Pixel Meta et Google Analytics",
  aiAssistant: "Assistant IA",
  aiSummary: "Synthèse des ventes par IA",
  customRoles: "Rôles personnalisés",
  auditLog: "Journal d'audit",
  api: "API et webhooks",
  pos: "Caisse en magasin",
  resellers: "Revendeurs et marque blanche",
  prioritySupport: "Support prioritaire",
  sla: "Engagement de service (SLA)",
};

export type PlanGateProps = {
  storeId: string;
  /** Fonctionnalité verrouillée par le plan. */
  feature?: keyof PlanFeatures;
  /** Plan cible explicite (sinon déduit de `feature`). */
  plan?: PlanId;
  /** Option payante qui débloque aussi (ex. EXTRA_MEMBER). */
  addOn?: AddOnId;
  title?: string;
  /** Pourquoi c'est bloqué (texte court). */
  description?: React.ReactNode;
  /** Ce que le marchand obtient en débloquant (4 puces maximum). */
  unlocks?: string[];
  /** Alias de `unlocks` (compatibilité). */
  bullets?: string[];
  /** Limite atteinte : affichée « 3 / 3 membres ». */
  limit?: { label: string; used: number; max: number };
  compact?: boolean;
  className?: string;
};

/**
 * Écran de limite de plan : ce qui est bloqué, pourquoi, quel plan OU quelle option débloque.
 * Ton factuel, sans pression trompeuse : aucune donnée n'est perdue, changement réversible.
 */
export function PlanGate({ storeId, feature, plan: planProp, addOn, title, description, unlocks, bullets, limit, compact = false, className }: PlanGateProps) {
  const planId = planProp ?? (feature ? requiredPlanFor(feature) : "BUSINESS");
  const plan = PLANS[planId];
  const label = title ?? (feature ? FEATURE_LABELS[feature] : "Fonction réservée");
  const option = addOn ? getAddOn(addOn) : null;
  const points = unlocks ?? bullets;
  const why =
    description ??
    (limit
      ? `Vous avez atteint la limite de votre plan : ${limit.used} sur ${limit.max} ${limit.label}.`
      : `${label} est inclus à partir du plan ${plan.name}. Le changement est immédiat et vos données restent intactes.`);

  const actions = (
    <div className={cn("flex flex-wrap items-center gap-2", !compact && "mt-7 justify-center")}>
      <ButtonLink href={`/app/${storeId}/abonnement#plans`} variant={compact ? "outline" : "accent"} size={compact ? "sm" : "md"} trailing={compact ? undefined : ArrowUpRight}>
        Passer au plan {plan.name}
      </ButtonLink>
      {option && (
        <ButtonLink href={`/app/${storeId}/options#${option.id}`} variant={compact ? "ghost" : "outline"} size={compact ? "sm" : "md"}>
          <PackagePlus className="size-4" aria-hidden /> {option.name}
        </ButtonLink>
      )}
    </div>
  );

  if (compact) {
    return (
      <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-3 rounded-[var(--radius-md)] bg-surface-2/70 px-4 py-3.5 ring-1 ring-inset ring-line", className)} role="note">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-surface text-ink-muted ring-1 ring-line">
          <Lock className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
            {label} <Badge tone="accent">Plan {plan.name}</Badge>
            {limit && <span className="font-mono text-xs font-medium text-ink-muted tabular">{limit.used} / {limit.max}</span>}
          </p>
          <p className="mt-0.5 text-[13px] text-ink-muted">{why}</p>
        </div>
        {actions}
      </div>
    );
  }

  return (
    <div className={cn("bezel mx-auto max-w-xl", className)} role="note">
      <div className="bezel-core flex flex-col items-center px-6 py-12 text-center sm:px-10">
        <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-forest text-lime">
          <Lock className="size-5" aria-hidden />
        </span>
        <Badge tone="accent" className="mt-5">{option ? `Plan ${plan.name} ou option` : `Inclus dans le plan ${plan.name}`}</Badge>
        <h2 className="mt-3 text-xl font-semibold tracking-[-0.025em] text-ink">{label}</h2>
        {limit && (
          <p className="mt-2 font-mono text-sm text-ink tabular">
            {limit.used} / {limit.max} {limit.label}
          </p>
        )}
        <p className="mt-2 max-w-md text-sm leading-relaxed text-ink-muted">{why}</p>
        {points && points.length > 0 && (
          <ul className="mt-5 space-y-2 text-left text-sm text-ink">
            {points.slice(0, 4).map((b) => (
              <li key={b} className="flex items-start gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden /> {b}
              </li>
            ))}
          </ul>
        )}
        {actions}
        {option && <p className="mt-3 text-xs text-ink-muted">L'option « {option.name} » s'ajoute à votre plan actuel, sans changer de formule.</p>}
      </div>
    </div>
  );
}
