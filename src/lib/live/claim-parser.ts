/**
 * « Commenter pour acheter » : analyse d'un commentaire Facebook / Instagram (fonction PURE, testée dans
 * tests/live-claim-parser.test.ts). Aucun accès base, aucune dépendance serveur.
 *
 * Règles :
 *  - le code est un mot-clé configuré pour le direct (ex. « 12 », « robe1 »), comparé en forme normalisée
 *    (minuscules, sans accents, lettres et chiffres uniquement) ;
 *  - AVEC une intention d'achat (« je prends », « JP », « je veux », « moi », « i take », « sold »…), le code peut
 *    se trouver n'importe où dans le commentaire ;
 *  - SANS intention, le commentaire doit se réduire au code (+ quantité, + politesse) : « 12 », « #12 x2 svp ».
 *    « J'ai 12 ans » ou « le 12 est dispo ? » ne réservent donc rien ;
 *  - quantité : « 12 x2 », « 12 x 2 », « 12*2 », « 2x 12 », « 12 2 pièces » ; bornée à MAX_QTY_PER_COMMENT ;
 *  - tolérance aux fautes simples sur les mots d'intention (une lettre de différence, lettres doublées :
 *    « je prend », « prennds », « reserver ») ; JAMAIS sur les codes (« robe1 » et « robe2 » sont distincts) ;
 *  - un commentaire = au plus un article (le premier code reconnu).
 */

export const MAX_QTY_PER_COMMENT = 10;

export type ParsedClaim = { code: string; quantity: number };

/** Forme normalisée d'un code (saisie marchand ou commentaire) : `#Robe-1` → `robe1`. */
export function normalizeCode(raw: string): string {
  return stripAccents(raw.toLowerCase())
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 24);
}

/** Code acceptable : 1 à 24 caractères alphanumériques après normalisation. */
export function isValidCode(code: string): boolean {
  return /^[a-z0-9]{1,24}$/.test(code);
}

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Lettres répétées réduites (« prennnds » → « prends ») : comparaison tolérante des mots d'intention. */
function squash(s: string): string {
  return s.replace(/(.)\1+/g, "$1");
}

function levenshteinAtMostOne(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (la > lb) i++;
    else if (lb > la) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (la - i) + (lb - j) <= 1;
}

/** Mots qui, seuls, expriment l'intention d'achat (forme normalisée). */
const INTENT_WORDS = new Set([
  "jp",
  "jprends",
  "jprend",
  "jeprends",
  "jeprend",
  "jveux",
  "jeveux",
  "moi",
  "mine",
  "sold",
  "buy",
  "take",
  "want",
  "reserve",
  "reserver",
  "reservez",
  "commande",
  "commander",
  "achete",
  "acheter",
  "jachete",
  "prends",
  "prend",
  "prendre",
  "veux",
]);

/** Mots longs corrigés avec une faute (distance 1, lettres doublées ignorées). */
const FUZZY_INTENT = ["prends", "prendre", "reserve", "reserver", "commande", "commander", "achete", "acheter", "jeprends"];

/** Mots neutres tolérés dans un commentaire SANS intention (« 12 svp »). */
const FILLER = new Set(["svp", "stp", "please", "pls", "plz", "merci", "thanks", "ok", "oui", "yes", "le", "la", "les", "l", "n", "no", "num", "numero", "ref", "article", "produit", "code"]);

/** Unités qui suivent une quantité : « 2 pièces ». */
const UNIT_WORDS = new Set(["pcs", "pc", "piece", "pieces", "articles", "unite", "unites", "fois", "units"]);

function isIntentToken(t: string): boolean {
  if (INTENT_WORDS.has(t)) return true;
  if (t.length < 5) return false;
  const s = squash(t);
  return FUZZY_INTENT.some((w) => levenshteinAtMostOne(s, squash(w)));
}

/** Préfixes d'intention collés au code : « jp12 », « moi12 ». */
const GLUED_INTENT = /^(jp|jeprends|jprends|moi|take|sold)([a-z0-9]+)$/;

function tokenize(text: string): string[] {
  const t = stripAccents(text.toLowerCase())
    .replace(/[×*]/g, " x ")
    .replace(/[’'`]/g, " ")
    .replace(/[^a-z0-9#\s]/g, " ")
    .replace(/#/g, " ");
  return t.split(/\s+/).filter(Boolean).slice(0, 60);
}

function asQty(t: string | undefined): number | null {
  if (!t || !/^\d{1,3}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 ? n : null;
}

type Candidate = { code: string; quantity: number; consumed: Set<number> };

/**
 * Analyse un commentaire. `codes` : codes normalisés du direct. Renvoie null si aucun achat n'est exprimé.
 */
export function parseClaimComment(text: string, codes: Iterable<string>): ParsedClaim | null {
  if (!text || text.length > 2000) return null;
  const known = new Set([...codes].filter(isValidCode));
  if (known.size === 0) return null;

  // Préfixes collés (« jp12 ») : séparés en deux jetons.
  const tokens: string[] = [];
  let intent = false;
  for (const raw of tokenize(text)) {
    const glued = GLUED_INTENT.exec(raw);
    if (glued && !known.has(raw) && known.has(glued[2])) {
      tokens.push(glued[1], glued[2]);
      continue;
    }
    // Quantité collée au code : « 12x2 » → « 12 », « x2 ».
    const qtyGlued = /^([a-z0-9]+?)x(\d{1,3})$/.exec(raw);
    if (qtyGlued && !known.has(raw) && known.has(qtyGlued[1])) {
      tokens.push(qtyGlued[1], `x${qtyGlued[2]}`);
      continue;
    }
    tokens.push(raw);
  }
  const intentIdx = new Set<number>();
  // Intentions sur deux mots : « je prends », « je veux », « i take », « pour moi ».
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const pair = `${t}${tokens[i + 1] ?? ""}`;
    if (["je", "j", "i", "ill", "pour"].includes(t) && tokens[i + 1] && (isIntentToken(tokens[i + 1]) || isIntentToken(pair))) {
      intentIdx.add(i);
      intentIdx.add(i + 1);
      intent = true;
      continue;
    }
    if (isIntentToken(t) && !known.has(t)) {
      intentIdx.add(i);
      intent = true;
    }
  }

  const candidates: Candidate[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (intentIdx.has(i)) continue;
    let code: string | null = null;
    const consumed = new Set<number>([i]);
    if (known.has(tokens[i])) code = tokens[i];
    else if (i + 1 < tokens.length && known.has(tokens[i] + tokens[i + 1]) && /[a-z]/.test(tokens[i]) && /\d/.test(tokens[i + 1])) {
      // « robe 1 » pour le code « robe1 »
      code = tokens[i] + tokens[i + 1];
      consumed.add(i + 1);
    }
    if (!code) continue;
    const last = Math.max(...consumed);

    // Quantité APRÈS le code : « x2 », « x 2 », « 2 pièces ».
    let qty: number | null = null;
    let afterIsCode = false;
    const a1 = tokens[last + 1];
    const a2 = tokens[last + 2];
    if (a1 && /^x\d{1,3}$/.test(a1)) {
      qty = asQty(a1.slice(1));
      consumed.add(last + 1);
    } else if (a1 === "x" && asQty(a2) !== null) {
      qty = asQty(a2);
      afterIsCode = !!a2 && known.has(a2);
      consumed.add(last + 1).add(last + 2);
    } else if (asQty(a1) !== null && a2 && UNIT_WORDS.has(a2)) {
      qty = asQty(a1);
      consumed.add(last + 1).add(last + 2);
    }
    if (qty !== null && qty > MAX_QTY_PER_COMMENT) {
      // « 2 x 12 » quand « 2 » et « 12 » sont tous deux des codes : on essaie la lecture suivante.
      if (afterIsCode) continue;
      return null;
    }

    // Quantité AVANT le code : « 2x 12 », « 2 x 12 ».
    if (qty === null) {
      const b1 = tokens[i - 1];
      const b2 = tokens[i - 2];
      if (b1 && /^\d{1,3}x$/.test(b1) && !intentIdx.has(i - 1)) {
        qty = asQty(b1.slice(0, -1));
        consumed.add(i - 1);
      } else if (b1 === "x" && asQty(b2) !== null) {
        qty = asQty(b2);
        consumed.add(i - 1).add(i - 2);
      }
      // « 12 x 2 » relu depuis « 2 » : le « 12 » n'est pas une quantité, cette lecture est écartée.
      if (qty !== null && qty > MAX_QTY_PER_COMMENT) continue;
    }
    candidates.push({ code, quantity: qty ?? 1, consumed });
  }
  if (!candidates.length) return null;

  if (intent) {
    const c = candidates[0];
    return { code: c.code, quantity: c.quantity };
  }
  // Sans intention : tout le commentaire doit être « code (+ quantité) (+ politesse) ».
  for (const c of candidates) {
    const rest = tokens.filter((t, i) => !c.consumed.has(i) && !FILLER.has(t));
    if (rest.length === 0) return { code: c.code, quantity: c.quantity };
  }
  return null;
}
