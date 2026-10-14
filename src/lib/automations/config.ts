import { z } from "zod";
import { ACTION_TYPES, TRIGGER_META, actionsFor, type AutomationTrigger, type ActionType, type Purpose } from "./templates";

/**
 * Configuration d'une automatisation (Si / Alors / plafond), sérialisée dans `Automation.template`.
 * Fonctions pures : partagées par le constructeur (client), les actions serveur et le moteur.
 * Les anciennes lignes (texte brut + colonne `channel`) sont relues comme une action unique.
 */

const message = z.string().trim().min(5, "Message trop court (5 caractères minimum)").max(1000, "1 000 caractères maximum");

export const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("whatsapp"), message, purpose: z.enum(["transactional", "marketing"]).default("transactional") }),
  z.object({ type: z.literal("email"), subject: z.string().trim().min(3, "Objet trop court").max(120), message }),
  z.object({ type: z.literal("notify"), message: z.string().trim().min(3, "Texte trop court").max(300) }),
  z.object({ type: z.literal("tag"), tag: z.string().trim().min(2, "Étiquette trop courte").max(30).regex(/^[\p{L}\p{N} _-]+$/u, "Lettres, chiffres, espaces et tirets uniquement") }),
  z.object({
    type: z.literal("coupon"),
    couponType: z.enum(["PERCENT", "FIXED", "FREE_DELIVERY"]),
    value: z.coerce.number().int().min(0).max(1_000_000_000),
    validDays: z.coerce.number().int().min(1, "1 jour minimum").max(90, "90 jours maximum"),
  }),
]);
export type AutomationAction = z.infer<typeof actionSchema>;

export const conditionsSchema = z.object({
  minTotal: z.coerce.number().int().min(0).max(1_000_000_000).nullable().default(null),
  fulfillment: z.enum(["PICKUP", "DELIVERY", "WHATSAPP"]).nullable().default(null),
  segment: z.enum(["all", "new", "loyal", "inactive", "tag"]).default("all"),
  tag: z.string().trim().max(30).nullable().default(null),
  requireConsent: z.boolean().default(false),
});
export type Conditions = z.infer<typeof conditionsSchema>;

export const configSchema = z.object({
  v: z.literal(2).default(2),
  name: z.string().trim().min(2, "Donnez un nom (2 caractères minimum)").max(60, "60 caractères maximum"),
  params: z
    .object({ days: z.coerce.number().int().min(1).max(365).optional(), threshold: z.coerce.number().int().min(0).max(1000).optional() })
    .default({}),
  conditions: conditionsSchema.default({ minTotal: null, fulfillment: null, segment: "all", tag: null, requireConsent: false }),
  actions: z.array(actionSchema).min(1, "Ajoutez au moins une action").max(4, "4 actions maximum"),
  cap: z.object({ max: z.coerce.number().int().min(1).max(20), days: z.coerce.number().int().min(1).max(90) }).nullable().default(null),
});
export type AutomationConfig = z.infer<typeof configSchema>;

export const MAX_DELAY_MINUTES = 60 * 24 * 14;

export function defaultConditions(): Conditions {
  return { minTotal: null, fulfillment: null, segment: "all", tag: null, requireConsent: false };
}

/** Valeur du paramètre propre au déclencheur (jours, seuil) avec sa valeur par défaut. */
export function triggerParam(trigger: AutomationTrigger, config: Pick<AutomationConfig, "params">): number | null {
  const p = TRIGGER_META[trigger].param;
  if (!p) return null;
  const v = config.params[p.key];
  return typeof v === "number" ? Math.min(p.max, Math.max(p.min, v)) : p.default;
}

/** Vérifie la cohérence déclencheur / actions. Renvoie un message d'erreur ou null. */
export function checkConfigForTrigger(trigger: AutomationTrigger, config: AutomationConfig): string | null {
  const allowed = actionsFor(trigger);
  const bad = config.actions.find((a) => !allowed.includes(a.type));
  if (bad) return "Ce déclencheur concerne votre boutique : seules la notification interne et l'e-mail sont possibles.";
  const coupons = config.actions.filter((a) => a.type === "coupon");
  if (coupons.length > 1) return "Un seul coupon par automatisation.";
  for (const c of coupons) {
    if (c.type !== "coupon") continue;
    if (c.couponType === "PERCENT" && (c.value < 1 || c.value > 90)) return "Remise en pourcentage : entre 1 et 90 %.";
    if (c.couponType === "FIXED" && c.value < 1) return "Indiquez le montant de la remise.";
  }
  if (config.conditions.segment === "tag" && !config.conditions.tag) return "Indiquez l'étiquette du segment.";
  const p = TRIGGER_META[trigger].param;
  if (p) {
    const v = config.params[p.key];
    if (typeof v === "number" && (v < p.min || v > p.max)) return `${p.label} : entre ${p.min} et ${p.max}.`;
  }
  return null;
}

/** Un message ou un coupon promotionnel exige le consentement marketing. */
export function isPromotional(trigger: AutomationTrigger, config: Pick<AutomationConfig, "actions" | "conditions">): boolean {
  if (TRIGGER_META[trigger].marketing) return true;
  if (config.conditions.requireConsent) return true;
  return config.actions.some((a) => a.type === "coupon" || (a.type === "whatsapp" && a.purpose === "marketing"));
}

/** Catégorie de crédit d'un message WhatsApp. */
export function whatsappPurpose(trigger: AutomationTrigger, action: { purpose?: Purpose }): Purpose {
  return TRIGGER_META[trigger].marketing ? "marketing" : (action.purpose ?? "transactional");
}

export function encodeConfig(config: AutomationConfig): string {
  return JSON.stringify(config);
}

/** Relit la colonne `template` : configuration v2, ou ancien texte brut. */
export function decodeConfig(raw: string, legacy: { trigger: string; channel: string }): AutomationConfig {
  if (raw.trim().startsWith("{")) {
    try {
      const parsed = configSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
    } catch {
      // texte qui commence par « { » : traité comme ancien message
    }
  }
  const meta = (TRIGGER_META as Record<string, (typeof TRIGGER_META)[AutomationTrigger] | undefined>)[legacy.trigger];
  const text = raw.trim().length >= 5 ? raw.trim() : "Bonjour {client}, merci pour votre commande {reference} chez {boutique}.";
  const action: AutomationAction =
    legacy.channel === "email"
      ? { type: "email", subject: `${meta?.label ?? "Information"} : {boutique}`, message: text }
      : { type: "whatsapp", message: text, purpose: "transactional" };
  return { v: 2, name: meta?.label ?? "Automatisation", params: {}, conditions: defaultConditions(), actions: [action], cap: null };
}

/** Canal principal affiché et stocké dans la colonne `channel`. */
export function primaryChannel(config: AutomationConfig): ActionType {
  const order: ActionType[] = ["whatsapp", "email", "notify", "coupon", "tag"];
  for (const t of order) if (config.actions.some((a) => a.type === t)) return t;
  return ACTION_TYPES[0];
}

/* ───────────────────────── Modèles prêts en un clic ───────────────────────── */

export type Preset = {
  key: string;
  name: string;
  pitch: string;
  trigger: AutomationTrigger;
  delayMinutes: number;
  config: AutomationConfig;
};

const c = (name: string, actions: AutomationAction[], extra: Partial<AutomationConfig> = {}): AutomationConfig => ({
  v: 2,
  name,
  params: {},
  conditions: defaultConditions(),
  actions,
  cap: null,
  ...extra,
});

export const PRESETS: Preset[] = [
  {
    key: "confirm",
    name: "Confirmation de commande",
    pitch: "Rassure le client dès la réception et lui donne son lien de suivi.",
    trigger: "order.created",
    delayMinutes: 0,
    config: c("Confirmation de commande", [
      { type: "whatsapp", purpose: "transactional", message: "Bonjour {prenom}, merci pour votre commande {reference} chez {boutique} ({total}). Nous la préparons et revenons vers vous très vite. Suivi : {lien}" },
    ]),
  },
  {
    key: "ready",
    name: "Commande prête",
    pitch: "Prévient le client que sa commande l'attend en boutique.",
    trigger: "order.ready",
    delayMinutes: 0,
    config: c(
      "Commande prête pour le retrait",
      [{ type: "whatsapp", purpose: "transactional", message: "Bonne nouvelle {prenom} : votre commande {reference} est prête chez {boutique}. Vous pouvez venir la récupérer aux horaires d'ouverture." }],
      { conditions: { ...defaultConditions(), fulfillment: "PICKUP" } },
    ),
  },
  {
    key: "review",
    name: "Demande d'avis",
    pitch: "Deux jours après la livraison, invite le client à noter ses produits.",
    trigger: "review.request",
    delayMinutes: 0,
    config: c(
      "Demande d'avis (J+2)",
      [{ type: "whatsapp", purpose: "transactional", message: "Bonjour {prenom}, votre commande {reference} vous a plu ? Votre avis aide énormément {boutique}. Il suffit de 30 secondes : {lien}" }],
      { params: { days: 2 } },
    ),
  },
  {
    key: "cart",
    name: "Relance panier abandonné",
    pitch: "Une heure après, rappelle au client son panier, avec un lien pour le reprendre.",
    trigger: "cart.abandoned",
    delayMinutes: 0,
    config: c(
      "Relance panier abandonné",
      [{ type: "whatsapp", purpose: "marketing", message: "Bonjour {prenom}, votre panier vous attend chez {boutique} ({total}). Reprenez-le en un clic : {lien}" }],
      { cap: { max: 1, days: 7 } },
    ),
  },
  {
    key: "winback",
    name: "Réactivation client inactif",
    pitch: "Après 60 jours sans commande, offre un coupon de 10 % valable 14 jours.",
    trigger: "customer.inactive",
    delayMinutes: 0,
    config: c(
      "Réactivation des clients inactifs",
      [
        { type: "coupon", couponType: "PERCENT", value: 10, validDays: 14 },
        { type: "whatsapp", purpose: "marketing", message: "Bonjour {prenom}, cela fait un moment ! {boutique} vous offre 10 % sur votre prochaine commande avec le code {coupon}, valable 14 jours : {lien}" },
        { type: "tag", tag: "relancé" },
      ],
      { params: { days: 60 }, cap: { max: 1, days: 30 } },
    ),
  },
  {
    key: "lowstock",
    name: "Alerte stock bas",
    pitch: "Vous prévient quand un produit passe sous son seuil d'alerte, avant la rupture.",
    trigger: "product.low_stock",
    delayMinutes: 0,
    config: c(
      "Alerte stock bas",
      [
        { type: "notify", message: "Stock bas : {produit}, plus que {stock} en stock." },
        { type: "email", subject: "Stock bas : {produit}", message: "Bonjour,\n\nLe produit {produit} n'a plus que {stock} unité(s) en stock sur {boutique}.\n\nMettre à jour le stock : {lien}" },
      ],
    ),
  },
];

export function getPreset(key: string): Preset | null {
  return PRESETS.find((p) => p.key === key) ?? null;
}
