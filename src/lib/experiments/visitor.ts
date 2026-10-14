/**
 * Lot 4 §12 et §13 : cookies fonctionnels de premier niveau de la vitrine.
 *
 *  - `axi_vid` (1 an, 128 bits aléatoires) : affectation stable aux variantes d'un test A/B et dédoublonnage des
 *    expositions. Aucune donnée personnelle, aucun partage, aucune lecture par un tiers.
 *  - `axi_src` (30 jours) : source de PREMIER contact (whatsapp, instagram, tiktok, facebook, google, campaign,
 *    direct), utilisée par les règles d'audience. Seule une valeur de la liste fermée est stockée.
 *
 * `src/proxy.ts` appartenant à une autre équipe cette vague, les deux cookies sont calculés côté serveur au rendu
 * (valeur utilisée immédiatement, donc aucune hésitation sur la première page) puis PERSISTÉS par un petit îlot
 * client (`src/components/experiments/experiment-runtime.tsx`). Le résultat est identique à un dépôt par le proxy,
 * à ceci près qu'un visiteur sans JavaScript n'est jamais compté — ce qui est exactement le comportement voulu
 * pour des mesures d'affichage.
 *
 * Module PUR (aucun accès base) : testé directement.
 */
import { AUDIENCE_SOURCES } from "@/lib/theme-engine/types";
import { parseSourceCookie } from "@/lib/theme-engine/audience";

export type AudienceSource = (typeof AUDIENCE_SOURCES)[number];

const SOURCE_ALIASES: Record<string, AudienceSource> = {
  whatsapp: "whatsapp",
  whatsapp_status: "whatsapp",
  whatsapp_catalog: "whatsapp",
  wa: "whatsapp",
  instagram: "instagram",
  ig: "instagram",
  tiktok: "tiktok",
  tt: "tiktok",
  facebook: "facebook",
  fb: "facebook",
  messenger: "facebook",
  meta: "facebook",
  google: "google",
  adwords: "google",
  campaign: "campaign",
  email: "campaign",
  sms: "campaign",
  newsletter: "campaign",
  direct: "direct",
};

const REFERER_HOSTS: { test: RegExp; source: AudienceSource }[] = [
  { test: /(^|\.)whatsapp\.com$|(^|\.)wa\.me$/, source: "whatsapp" },
  { test: /(^|\.)instagram\.com$/, source: "instagram" },
  { test: /(^|\.)tiktok\.com$/, source: "tiktok" },
  { test: /(^|\.)facebook\.com$|(^|\.)fb\.com$|(^|\.)messenger\.com$/, source: "facebook" },
  { test: /(^|\.)google\.[a-z.]{2,8}$/, source: "google" },
];

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function normalize(raw: string | undefined): AudienceSource | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase().slice(0, 40).replace(/[^a-z0-9_]/g, "_");
  return SOURCE_ALIASES[v] ?? parseSourceCookie(v);
}

/**
 * Source de premier contact. Ordre : `utm_source`, `ref`, puis le référent ; un référent interne (même hôte)
 * ou inconnu donne « direct ». Jamais null : le cookie est posé une fois pour 30 jours.
 */
export function detectFirstTouchSource(input: {
  searchParams?: Record<string, string | string[] | undefined>;
  referer?: string | null;
  host?: string | null;
}): AudienceSource {
  const sp = input.searchParams ?? {};
  const fromParam = normalize(first(sp.utm_source)) ?? normalize(first(sp.ref)) ?? normalize(first(sp.source));
  if (fromParam) return fromParam;
  if (first(sp.utm_campaign)) return "campaign";

  const ref = input.referer?.trim();
  if (!ref) return "direct";
  let host: string;
  try {
    host = new URL(ref).hostname.toLowerCase();
  } catch {
    return "direct";
  }
  const own = (input.host ?? "").toLowerCase().split(":")[0];
  if (own && (host === own || host.endsWith(`.${own}`))) return "direct"; // navigation interne
  const hit = REFERER_HOSTS.find((r) => r.test.test(host));
  return hit ? hit.source : "direct";
}
