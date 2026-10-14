/**
 * Catalogue du moteur d'automatisations (fonctions pures, utilisables côté client).
 *
 * Une automatisation = Quand (déclencheur) + Si (conditions) + Alors (actions) + Après (délai),
 * avec un plafond de fréquence par client. La configuration complète est sérialisée en JSON dans
 * la colonne `Automation.template` (voir `config.ts`) ; `trigger`, `delayMinutes` et `active`
 * restent des colonnes natives.
 */

export const TRIGGERS = [
  "order.created",
  "order.confirmed",
  "order.ready",
  "order.delivered",
  "order.cancelled",
  "payment.failed",
  "cart.abandoned",
  "customer.inactive",
  "review.request",
  "product.low_stock",
] as const;
export type AutomationTrigger = (typeof TRIGGERS)[number];

export function isTrigger(v: string): v is AutomationTrigger {
  return (TRIGGERS as readonly string[]).includes(v);
}

export type Purpose = "transactional" | "marketing";

export type TriggerMeta = {
  label: string;
  /** Phrase « Quand … » affichée dans le constructeur. */
  when: string;
  description: string;
  /** Destinataire naturel : le client ou le commerçant (alerte interne). */
  audience: "customer" | "merchant";
  /** event : déclenché par un événement (délai possible). sweep : détecté par le balayage périodique. */
  kind: "event" | "sweep";
  /** Les messages de ce déclencheur sont promotionnels : consentement marketing obligatoire. */
  marketing: boolean;
  /** Paramètre propre au déclencheur (jours d'inactivité, seuil de stock…). */
  param?: { key: "days" | "threshold"; label: string; unit: string; min: number; max: number; default: number };
  group: "Commandes" | "Paiements" | "Relances" | "Catalogue";
};

export const TRIGGER_META: Record<AutomationTrigger, TriggerMeta> = {
  "order.created": { label: "Commande reçue", when: "une commande est passée", description: "Dès qu'un client valide son panier.", audience: "customer", kind: "event", marketing: false, group: "Commandes" },
  "order.confirmed": { label: "Commande confirmée", when: "vous confirmez une commande", description: "Quand la commande passe au statut « Confirmée ».", audience: "customer", kind: "event", marketing: false, group: "Commandes" },
  "order.ready": { label: "Commande prête", when: "une commande est prête", description: "Quand la commande passe au statut « Prête ».", audience: "customer", kind: "event", marketing: false, group: "Commandes" },
  "order.delivered": { label: "Commande livrée", when: "une commande est livrée ou remise", description: "Quand la commande passe au statut « Livrée ».", audience: "customer", kind: "event", marketing: false, group: "Commandes" },
  "order.cancelled": { label: "Commande annulée", when: "une commande est annulée", description: "Quand la commande passe au statut « Annulée ».", audience: "customer", kind: "event", marketing: false, group: "Commandes" },
  "payment.failed": { label: "Paiement échoué", when: "un paiement en ligne échoue", description: "Échec ou expiration d'un paiement par passerelle.", audience: "customer", kind: "event", marketing: false, group: "Paiements" },
  "cart.abandoned": { label: "Panier abandonné", when: "un client abandonne son panier", description: "Téléphone saisi au paiement, sans commande 1 h après. Une seule relance par panier.", audience: "customer", kind: "event", marketing: true, group: "Relances" },
  "customer.inactive": {
    label: "Client inactif",
    when: "un client ne commande plus",
    description: "Aucune commande depuis le nombre de jours choisi. Une relance par période d'inactivité.",
    audience: "customer",
    kind: "sweep",
    marketing: true,
    param: { key: "days", label: "Jours sans commande", unit: "jours", min: 14, max: 365, default: 60 },
    group: "Relances",
  },
  "review.request": {
    label: "Demande d'avis",
    when: "une commande a été livrée il y a quelques jours",
    description: "Invite le client à noter ses produits depuis sa page de suivi.",
    audience: "customer",
    kind: "sweep",
    marketing: false,
    param: { key: "days", label: "Jours après la livraison", unit: "jours", min: 1, max: 14, default: 2 },
    group: "Relances",
  },
  "product.low_stock": {
    label: "Stock bas",
    when: "le stock d'un produit passe sous son seuil d'alerte",
    description: "Alerte interne, une fois par passage sous le seuil (celui du produit, sinon le seuil par défaut de la boutique dans Notifications).",
    audience: "merchant",
    kind: "sweep",
    marketing: false,
    group: "Catalogue",
  },
};

/** Compatibilité avec l'ancien écran. */
export const TRIGGER_LABELS: Record<AutomationTrigger, string> = Object.fromEntries(TRIGGERS.map((t) => [t, TRIGGER_META[t].label])) as Record<AutomationTrigger, string>;

export const FULFILLMENT_LABELS = { PICKUP: "Retrait", DELIVERY: "Livraison", WHATSAPP: "À convenir sur WhatsApp" } as const;
export type Fulfillment = keyof typeof FULFILLMENT_LABELS;

export const SEGMENT_LABELS = {
  all: "Tous les clients",
  new: "Nouveaux clients (30 derniers jours)",
  loyal: "Clients fidèles (3 commandes ou plus)",
  inactive: "Clients inactifs (plus de 60 jours)",
  tag: "Clients avec une étiquette",
} as const;
export type Segment = keyof typeof SEGMENT_LABELS;

export const ACTION_TYPES = ["whatsapp", "email", "notify", "tag", "coupon"] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export const ACTION_LABELS: Record<ActionType, string> = {
  whatsapp: "Message WhatsApp au client",
  email: "E-mail",
  notify: "Notification interne",
  tag: "Ajouter une étiquette au client",
  coupon: "Créer un coupon de relance",
};

/** Actions possibles selon le destinataire du déclencheur. */
export function actionsFor(trigger: AutomationTrigger): ActionType[] {
  return TRIGGER_META[trigger].audience === "merchant" ? ["notify", "email"] : [...ACTION_TYPES];
}

export const VARIABLES = [
  { key: "{prenom}", label: "Prénom du client" },
  { key: "{client}", label: "Nom complet du client" },
  { key: "{boutique}", label: "Nom de la boutique" },
  { key: "{reference}", label: "Référence de commande" },
  { key: "{total}", label: "Montant (commande ou panier)" },
  { key: "{lien}", label: "Lien utile (suivi, panier, boutique)" },
  { key: "{coupon}", label: "Code du coupon créé" },
  { key: "{produit}", label: "Nom du produit (stock bas)" },
  { key: "{stock}", label: "Stock restant" },
] as const;

export type TemplateVars = Partial<Record<"prenom" | "client" | "boutique" | "reference" | "total" | "lien" | "coupon" | "produit" | "stock", string>>;

/** Remplace les variables connues ; une variable sans valeur devient vide (jamais « undefined »). */
export function renderTemplate(template: string, vars: TemplateVars): string {
  return template
    .replace(/\{(prenom|client|boutique|reference|total|lien|coupon|produit|stock)\}/gi, (_, k: string) => vars[k.toLowerCase() as keyof TemplateVars] ?? "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function firstName(name: string): string {
  const n = name.trim().split(/\s+/)[0] ?? "";
  return n.startsWith("+") ? "" : n;
}

export function delayLabel(minutes: number): string {
  if (minutes <= 0) return "Immédiat";
  if (minutes % 1440 === 0) return `${minutes / 1440} j après`;
  if (minutes % 60 === 0) return `${minutes / 60} h après`;
  return `${minutes} min après`;
}

export const DELAY_PRESETS = [
  { value: 0, label: "Immédiatement" },
  { value: 15, label: "15 minutes après" },
  { value: 60, label: "1 heure après" },
  { value: 180, label: "3 heures après" },
  { value: 1440, label: "Le lendemain (24 h)" },
  { value: 2880, label: "2 jours après" },
] as const;
