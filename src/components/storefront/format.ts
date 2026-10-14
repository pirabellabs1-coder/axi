/** Helpers partagés (serveur et client) pour la boutique publique. */

export const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export const DAY_LABELS: Record<(typeof DAY_KEYS)[number], string> = {
  mon: "Lundi",
  tue: "Mardi",
  wed: "Mercredi",
  thu: "Jeudi",
  fri: "Vendredi",
  sat: "Samedi",
  sun: "Dimanche",
};
/** Ordre d'affichage : lundi → dimanche. */
export const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export function dayLabelByIndex(dayOfWeek: number): string {
  const key = DAY_KEYS[((dayOfWeek % 7) + 7) % 7];
  return DAY_LABELS[key];
}

export type HoursRow = { day: string; ranges: string };

/** Normalise `openingHours` JSON en lignes affichables. Retourne [] si non renseigné. */
export function hoursRows(openingHours: unknown): HoursRow[] {
  if (!openingHours || typeof openingHours !== "object") return [];
  const h = openingHours as Record<string, unknown>;
  return DAY_ORDER.map((k) => {
    const ranges = Array.isArray(h[k]) ? (h[k] as unknown[]).filter((r): r is [string, string] => Array.isArray(r) && r.length === 2) : [];
    return { day: DAY_LABELS[k], ranges: ranges.length ? ranges.map(([a, b]) => `${a} - ${b}`).join(", ") : "Fermé" };
  });
}

export function themeFontFamily(font: "sans" | "display" | "serif"): { body: string; heading: string } {
  const sans = "var(--font-geist), ui-sans-serif, system-ui, sans-serif";
  const serif = "ui-serif, 'Iowan Old Style', 'Palatino Linotype', Georgia, serif";
  if (font === "serif") return { body: sans, heading: serif };
  return { body: sans, heading: sans };
}

/** Index du jour (0 = lundi) dans le fuseau de la boutique, pour surligner « aujourd'hui ». */
export function todayIndex(timezone: string, now = new Date()): number {
  try {
    const wd = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, weekday: "short" }).format(now).toLowerCase().slice(0, 3);
    const i = (DAY_ORDER as readonly string[]).indexOf(wd);
    return i < 0 ? 0 : i;
  } catch {
    return (now.getDay() + 6) % 7;
  }
}

export function storePath(slug: string, rest = ""): string {
  return `/s/${slug}${rest}`;
}

/** Clé stable d'une ligne de panier (même produit + variante + options → même ligne). Partagée client/serveur. */
export function lineKey(productId: string, variantId: string | null | undefined, optionIds: string[]): string {
  return [productId, variantId ?? "", [...optionIds].sort().join("+")].join(":");
}

export function isHttps(url: string | null | undefined): url is string {
  return typeof url === "string" && url.startsWith("https://");
}
