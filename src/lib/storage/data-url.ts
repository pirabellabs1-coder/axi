/**
 * Data-URL d'images héritées du MVP (module pur : migration et tests).
 * Les documents (thème, options produit, listes d'images) sont parcourus en profondeur : toute chaîne
 * qui est une data-URL d'image est collectée puis remplacée par l'URL de stockage correspondante.
 */
const DATA_IMAGE_RE = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/\s]+={0,2})$/i;

export function isDataImageUrl(v: unknown): v is string {
  return typeof v === "string" && v.startsWith("data:image/") && DATA_IMAGE_RE.test(v);
}

export function decodeDataImageUrl(v: string): { mime: string; bytes: Uint8Array } | null {
  const m = DATA_IMAGE_RE.exec(v);
  if (!m) return null;
  const bytes = Buffer.from(m[2].replace(/\s+/g, ""), "base64");
  return bytes.byteLength ? { mime: m[1].toLowerCase(), bytes: new Uint8Array(bytes) } : null;
}

/** Toutes les data-URL d'image présentes dans une valeur JSON (dédoublonnées, ordre de rencontre). */
export function collectDataUrls(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (typeof value === "string") {
    if (isDataImageUrl(value)) out.add(value);
  } else if (Array.isArray(value)) {
    for (const v of value) collectDataUrls(v, out);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectDataUrls(v, out);
  }
  return out;
}

/**
 * Remplace les chaînes présentes dans `map` (copie profonde, l'entrée n'est jamais modifiée).
 * `changed` indique si au moins un remplacement a eu lieu (pour n'écrire que les lignes touchées).
 */
export function replaceDataUrls<T>(value: T, map: ReadonlyMap<string, string>): { value: T; changed: boolean } {
  let changed = false;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      const r = map.get(v);
      if (r !== undefined && r !== v) {
        changed = true;
        return r;
      }
      return v;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const o: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) o[k] = walk(x);
      return o;
    }
    return v;
  };
  const next = walk(value) as T;
  return { value: changed ? next : value, changed };
}
