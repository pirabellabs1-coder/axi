/**
 * Lot 4 §11 : préréglages d'occasion des thèmes programmés (module PUR, aucune dépendance).
 *
 * Un préréglage décrit l'habillage d'une fête : annonce d'en-tête, couleur d'accent, bannière et compte à rebours.
 * Il est appliqué à une COPIE du thème courant par `applyOccasion` (src/lib/theme-schedules/occasion-doc.ts),
 * puis le document obtenu est enregistré tel quel dans `ThemeSchedule.document` (le thème principal n'est pas touché).
 *
 * Dates : seules les fêtes à date civile fixe sont suggérées. Les fêtes mobiles (Tabaski, Korité et Ramadan, fête des
 * mères selon le pays) sont SAISIES par le commerçant — aucun calendrier lunaire n'est embarqué, pour ne jamais
 * proposer une date fausse. `movable: true` le signale à l'écran.
 */

export const OCCASION_IDS = [
  "tabaski",
  "korite-ramadan",
  "noel",
  "nouvel-an",
  "saint-valentin",
  "fete-des-meres",
  "independance",
  "rentree",
  "black-friday",
  "soldes",
] as const;

export type OccasionId = (typeof OCCASION_IDS)[number];

export type OccasionPreset = {
  id: OccasionId;
  name: string;
  /** Phrase courte affichée dans la liste des préréglages. */
  description: string;
  /** Texte de l'annonce d'en-tête (≤ 120 caractères, contrainte du moteur). */
  announcement: string;
  /** Couleur d'accent (badges, promotions) appliquée au document programmé. */
  accent: string;
  /** Bannière ajoutée en haut de la page d'accueil. */
  banner: { heading: string; text: string; cta: string };
  /** Ajouter une section « compte à rebours » qui s'arrête à la fin de la programmation. */
  countdown: boolean;
  /** Date civile fixe (mois 1-12), ou null : date mobile saisie par le commerçant. */
  fixed: { month: number; day: number } | null;
  /** Date dépendante du pays de la boutique (fêtes de l'indépendance). */
  byCountry?: boolean;
  /** Jours de mise en place AVANT le jour J, puis durée totale suggérée (en jours). */
  suggest: { lead: number; days: number };
};

/** Fêtes de l'indépendance (pays où Axi est proposé). Dates civiles fixes. */
export const INDEPENDENCE_DAYS: Record<string, { label: string; month: number; day: number }> = {
  BJ: { label: "Bénin", month: 8, day: 1 },
  BF: { label: "Burkina Faso", month: 12, day: 11 },
  CI: { label: "Côte d'Ivoire", month: 8, day: 7 },
  CM: { label: "Cameroun", month: 5, day: 20 },
  CD: { label: "République démocratique du Congo", month: 6, day: 30 },
  CG: { label: "Congo-Brazzaville", month: 8, day: 15 },
  GA: { label: "Gabon", month: 8, day: 17 },
  GN: { label: "Guinée", month: 10, day: 2 },
  ML: { label: "Mali", month: 9, day: 22 },
  NE: { label: "Niger", month: 8, day: 3 },
  SN: { label: "Sénégal", month: 4, day: 4 },
  TG: { label: "Togo", month: 4, day: 27 },
};

export const OCCASIONS: OccasionPreset[] = [
  {
    id: "tabaski",
    name: "Tabaski (Aïd el-Kébir)",
    description: "Habillage vert et or, annonce et compte à rebours.",
    announcement: "Bonne fête de Tabaski ! Livraison renforcée toute la semaine.",
    accent: "#1f8a4c",
    banner: { heading: "Spécial Tabaski", text: "Nos sélections et nos offres pour préparer la fête en famille.", cta: "Voir la sélection" },
    countdown: true,
    fixed: null,
    suggest: { lead: 7, days: 10 },
  },
  {
    id: "korite-ramadan",
    name: "Korité et Ramadan",
    description: "Teinte bleu nuit, annonce du mois de Ramadan.",
    announcement: "Ramadan Moubarak : commandes et livraisons jusque tard le soir.",
    accent: "#2d4a8a",
    banner: { heading: "Ramadan et Korité", text: "Tout ce qu'il faut pour la rupture du jeûne et la fête.", cta: "Découvrir" },
    countdown: true,
    fixed: null,
    suggest: { lead: 7, days: 34 },
  },
  {
    id: "noel",
    name: "Noël",
    description: "Rouge de fête, annonce cadeaux et compte à rebours.",
    announcement: "Noël approche : commandez avant le 22 décembre pour être livré à temps.",
    accent: "#c62828",
    banner: { heading: "Idées cadeaux de Noël", text: "Notre sélection pour faire plaisir, livrée avant la fête.", cta: "Trouver un cadeau" },
    countdown: true,
    fixed: { month: 12, day: 25 },
    suggest: { lead: 21, days: 24 },
  },
  {
    id: "nouvel-an",
    name: "Nouvel An",
    description: "Doré festif, annonce de fin d'année.",
    announcement: "Bonne année ! Nouvelle sélection et nouveaux prix.",
    accent: "#b8860b",
    banner: { heading: "Bonne année !", text: "On démarre l'année avec une nouvelle sélection.", cta: "Voir les nouveautés" },
    countdown: true,
    fixed: { month: 1, day: 1 },
    suggest: { lead: 6, days: 10 },
  },
  {
    id: "saint-valentin",
    name: "Saint-Valentin",
    description: "Rose intense, annonce et compte à rebours.",
    announcement: "Saint-Valentin : commandez avant le 13 février pour être livré à temps.",
    accent: "#d6336c",
    banner: { heading: "Spécial Saint-Valentin", text: "Des idées qui font plaisir, livrées à temps.", cta: "Voir les idées" },
    countdown: true,
    fixed: { month: 2, day: 14 },
    suggest: { lead: 10, days: 12 },
  },
  {
    id: "fete-des-meres",
    name: "Fête des mères",
    description: "Teinte douce, annonce dédiée (date variable selon le pays).",
    announcement: "Fête des mères : nos idées pour lui faire plaisir.",
    accent: "#9c4dcc",
    banner: { heading: "Pour toutes les mamans", text: "Une sélection pensée pour la fête des mères.", cta: "Voir la sélection" },
    countdown: false,
    fixed: null,
    suggest: { lead: 10, days: 12 },
  },
  {
    id: "independance",
    name: "Fête de l'indépendance",
    description: "Annonce nationale, date selon le pays de la boutique.",
    announcement: "Bonne fête de l'indépendance ! Offres spéciales toute la semaine.",
    accent: "#0f8a5f",
    banner: { heading: "Fête de l'indépendance", text: "Nous célébrons avec vous : offres et livraison renforcée.", cta: "En profiter" },
    countdown: false,
    fixed: null,
    byCountry: true,
    suggest: { lead: 3, days: 5 },
  },
  {
    id: "rentree",
    name: "Rentrée",
    description: "Bleu scolaire, annonce fournitures et équipement.",
    announcement: "C'est la rentrée : tout l'essentiel, livré chez vous.",
    accent: "#1769aa",
    banner: { heading: "Prêts pour la rentrée", text: "Fournitures, tenues et équipement : tout au même endroit.", cta: "Préparer la rentrée" },
    countdown: false,
    fixed: { month: 9, day: 15 },
    suggest: { lead: 30, days: 35 },
  },
  {
    id: "black-friday",
    name: "Black Friday",
    description: "Noir et jaune, compte à rebours jusqu'à la fin de l'offre.",
    announcement: "Black Friday : remises exceptionnelles, quantités limitées.",
    accent: "#f5a300",
    banner: { heading: "Black Friday", text: "Nos meilleures remises de l'année, pendant quelques jours seulement.", cta: "Voir les remises" },
    countdown: true,
    fixed: { month: 11, day: 28 },
    suggest: { lead: 3, days: 5 },
  },
  {
    id: "soldes",
    name: "Soldes",
    description: "Accent vif, annonce et compte à rebours de fin de soldes.",
    announcement: "Soldes en cours : profitez-en avant la fin.",
    accent: "#e5481d",
    banner: { heading: "C'est les soldes", text: "Des prix réduits sur une sélection de produits.", cta: "Voir les soldes" },
    countdown: true,
    fixed: null,
    suggest: { lead: 0, days: 21 },
  },
];

const BY_ID = new Map<string, OccasionPreset>(OCCASIONS.map((o) => [o.id, o]));

export function isOccasionId(v: unknown): v is OccasionId {
  return typeof v === "string" && BY_ID.has(v);
}

export function occasionById(id: unknown): OccasionPreset | null {
  return typeof id === "string" ? (BY_ID.get(id) ?? null) : null;
}

export function occasionName(id: unknown): string | null {
  return occasionById(id)?.name ?? null;
}

/* ───────────── Suggestion de dates (pure, aucune horloge implicite) ───────────── */

const pad = (n: number) => String(n).padStart(2, "0");

/** « AAAA-MM-JJTHH:MM » : forme attendue par un champ `datetime-local` et par `localDateTimeToUtc`. */
export function localInput(year: number, month: number, day: number, hour = 0, minute = 0): string {
  // Normalisation par UTC (aucun fuseau impliqué : on ne manipule ici que des champs de calendrier).
  const d = new Date(Date.UTC(year, month - 1, day, hour, minute));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** Jour J d'une occasion pour une année donnée, ou null si la date est mobile (à saisir). */
export function occasionDay(o: OccasionPreset, year: number, country?: string | null): { month: number; day: number } | null {
  if (o.byCountry) {
    const row = country ? INDEPENDENCE_DAYS[country.toUpperCase()] : undefined;
    return row ? { month: row.month, day: row.day } : null;
  }
  if (!o.fixed) return null;
  // Black Friday : 4ᵉ vendredi de novembre (la date fixe du préréglage n'est qu'un repère).
  if (o.id === "black-friday") {
    const first = new Date(Date.UTC(year, 10, 1));
    const offset = (5 - first.getUTCDay() + 7) % 7; // 5 = vendredi
    return { month: 11, day: 1 + offset + 21 };
  }
  return o.fixed;
}

/**
 * Dates suggérées (chaînes locales `datetime-local`) pour l'année en cours ou la suivante si le jour J est passé.
 * `null` = date mobile : le commerçant saisit lui-même le début et la fin.
 */
export function suggestedRange(
  o: OccasionPreset,
  opts: { todayLocal: string; country?: string | null },
): { startsAt: string; endsAt: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(opts.todayLocal);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const today = Date.UTC(year, month - 1, day);
  for (const y of [year, year + 1]) {
    const d = occasionDay(o, y, opts.country);
    if (!d) return null;
    const target = Date.UTC(y, d.month - 1, d.day);
    const start = target - o.suggest.lead * 86_400_000;
    const end = start + o.suggest.days * 86_400_000;
    if (end <= today) continue;
    const s = new Date(Math.max(start, today));
    const e = new Date(end);
    return {
      startsAt: localInput(s.getUTCFullYear(), s.getUTCMonth() + 1, s.getUTCDate(), 0, 0),
      endsAt: localInput(e.getUTCFullYear(), e.getUTCMonth() + 1, e.getUTCDate(), 23, 59),
    };
  }
  return null;
}
