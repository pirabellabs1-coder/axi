/**
 * Live shopping (lot 4 §18) : fonctions PURES de la diffusion (liste blanche des plateformes, statut,
 * compte à rebours). Aucun accès base, aucun `next/headers` : testables et utilisables des deux côtés.
 *
 * Choix de sécurité : AUCUN lecteur tiers n'est intégré dans la boutique. La politique de sécurité du site
 * (`frame-src 'self'`, next.config.ts) interdit les iframes externes, et un lecteur tiers chargerait des
 * traceurs sans action du visiteur. Le direct s'ouvre donc dans un nouvel onglet, comme la section « Vidéo ».
 */

export type LiveStatus = "scheduled" | "live" | "ended";

export type StreamRef = { platform: "youtube" | "facebook" | "tiktok" | "instagram"; url: string; label: string };

const HOSTS: { platform: StreamRef["platform"]; label: string; hosts: string[] }[] = [
  { platform: "youtube", label: "YouTube", hosts: ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "youtube-nocookie.com", "www.youtube-nocookie.com"] },
  { platform: "facebook", label: "Facebook", hosts: ["facebook.com", "www.facebook.com", "m.facebook.com", "fb.watch", "web.facebook.com"] },
  { platform: "tiktok", label: "TikTok", hosts: ["tiktok.com", "www.tiktok.com", "vm.tiktok.com"] },
  { platform: "instagram", label: "Instagram", hosts: ["instagram.com", "www.instagram.com"] },
];

/** Lien de diffusion accepté : https et plateforme de la liste blanche, sans identifiants ni fragment. */
export function parseStreamUrl(raw: string | null | undefined): StreamRef | null {
  if (!raw || raw.length > 500) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  const match = HOSTS.find((h) => h.hosts.includes(host));
  if (!match) return null;
  url.hash = "";
  return { platform: match.platform, url: url.toString(), label: match.label };
}

/** Plateformes acceptées, pour l'aide de l'écran marchand. */
export const STREAM_PLATFORMS = HOSTS.map((h) => h.label);

export type LiveEventLike = { startsAt: Date | string; endsAt: Date | string | null; status: string };

const ms = (v: Date | string) => (typeof v === "string" ? Date.parse(v) : v.getTime());

/**
 * Statut effectif, dérivé des dates ET du statut enregistré :
 *  - `CANCELLED` ou `ENDED` → terminé ;
 *  - `LIVE` → en direct tant que la fin n'est pas passée ;
 *  - `SCHEDULED` → en direct à partir de l'heure de début (le marchand n'a pas à cliquer), terminé après la
 *    fin déclarée, ou 3 h après le début si aucune fin n'est renseignée.
 */
export function liveStatus(event: LiveEventLike, now: Date | number = new Date()): LiveStatus {
  const t = typeof now === "number" ? now : now.getTime();
  const start = ms(event.startsAt);
  const end = event.endsAt ? ms(event.endsAt) : start + 3 * 3600_000;
  if (event.status === "CANCELLED" || event.status === "ENDED") return "ended";
  if (t >= end) return "ended";
  if (event.status === "LIVE") return "live";
  return t >= start ? "live" : "scheduled";
}

/** Décomposition du compte à rebours (jamais négative). */
export function countdownParts(targetIso: string | Date, now: Date | number = new Date()): { days: number; hours: number; minutes: number; seconds: number; total: number } {
  const t = typeof now === "number" ? now : now.getTime();
  const total = Math.max(0, ms(typeof targetIso === "string" ? targetIso : targetIso) - t);
  const s = Math.floor(total / 1000);
  return { days: Math.floor(s / 86400), hours: Math.floor((s % 86400) / 3600), minutes: Math.floor((s % 3600) / 60), seconds: s % 60, total };
}

/** Texte du compte à rebours, lisible par un lecteur d'écran (unités écrites en entier). */
export function countdownLabel(parts: ReturnType<typeof countdownParts>): string {
  if (parts.total <= 0) return "C'est maintenant";
  if (parts.days > 0) return `${parts.days} jour${parts.days > 1 ? "s" : ""} et ${parts.hours} heure${parts.hours > 1 ? "s" : ""}`;
  if (parts.hours > 0) return `${parts.hours} heure${parts.hours > 1 ? "s" : ""} et ${parts.minutes} minute${parts.minutes > 1 ? "s" : ""}`;
  if (parts.minutes > 0) return `${parts.minutes} minute${parts.minutes > 1 ? "s" : ""} et ${parts.seconds} seconde${parts.seconds > 1 ? "s" : ""}`;
  return `${parts.seconds} seconde${parts.seconds > 1 ? "s" : ""}`;
}

/** Nom de la campagne de rappel d'un direct (recherche idempotente, §18). */
export function reminderCampaignName(eventId: string): string {
  return `Rappel du direct (${eventId.slice(-6)})`;
}

/** Étiquette client posée aux inscrits au rappel : segment de la campagne. */
export function reminderTag(eventId: string): string {
  return `direct-${eventId.slice(-8)}`;
}
