/**
 * Lecteurs intégrés de la section « Direct » de la boutique (module PUR, testé dans tests/social-live-embed.test.ts).
 *
 * À partir du lien de diffusion saisi par le marchand (déjà validé par parseStreamUrl, src/lib/live/stream.ts), donne
 * l'URL d'iframe officielle de la plateforme, ou null quand la plateforme ne permet pas d'intégrer ce contenu :
 *  - YouTube : vidéo / direct (`watch?v=`, `/live/{id}`, `youtu.be/{id}`, `/shorts/{id}`, `/embed/{id}`) → lecteur
 *    youtube-nocookie.com ; direct d'une chaîne (`/channel/UC…/live`) → `embed/live_stream?channel=…` ;
 *  - Facebook : vidéo ou direct public d'une Page → plugin `facebook.com/plugins/video.php?href=…` ;
 *  - TikTok : vidéo (`/@compte/video/{id}`) → lecteur `tiktok.com/player/v1/{id}`. Les DIRECTS TikTok ne sont pas
 *    intégrables : lien vers TikTok ;
 *  - Instagram : publication / Reel (`/p/{code}`, `/reel/{code}`) → `instagram.com/…/embed`. Les DIRECTS Instagram ne
 *    sont pas intégrables : lien vers Instagram.
 *
 * Les origines d'iframe correspondantes sont les SEULES ajoutées à `frame-src` (next.config.ts, LIVE_PLAYER_ORIGINS).
 * Le lecteur n'est chargé qu'au clic du visiteur (aucun traceur tiers sans action, page légère sur réseau mobile).
 */

export type LivePlatform = "youtube" | "facebook" | "tiktok" | "instagram";

export type LiveEmbed = {
  platform: LivePlatform;
  /** URL de l'iframe (https, origine de LIVE_PLAYER_ORIGINS). */
  src: string;
  /** Format : 16/9 (YouTube, Facebook) ou vertical 9/16 (TikTok, Reels). */
  vertical: boolean;
};

/** Origines autorisées dans `frame-src` pour ces lecteurs (et rien d'autre). */
export const LIVE_PLAYER_ORIGINS = [
  "https://www.youtube-nocookie.com",
  "https://www.youtube.com",
  "https://www.facebook.com",
  "https://www.tiktok.com",
  "https://www.instagram.com",
] as const;

export const PLATFORM_LABELS: Record<string, string> = { youtube: "YouTube", facebook: "Facebook", tiktok: "TikTok", instagram: "Instagram" };

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

function youtube(url: URL): LiveEmbed | null {
  const host = url.hostname.replace(/^(www|m)\./, "");
  const parts = url.pathname.split("/").filter(Boolean);
  let id: string | null = null;
  if (host === "youtu.be") id = parts[0] ?? null;
  else if (parts[0] === "watch") id = url.searchParams.get("v");
  else if (["live", "shorts", "embed"].includes(parts[0] ?? "") && parts[1] !== "live_stream") id = parts[1] ?? null;
  else if (parts[0] === "channel" && /^UC[A-Za-z0-9_-]{22}$/.test(parts[1] ?? "") && parts[2] === "live") {
    return { platform: "youtube", src: `https://www.youtube.com/embed/live_stream?channel=${parts[1]}&autoplay=1&playsinline=1`, vertical: false };
  }
  if (!id || !YT_ID.test(id)) return null;
  return { platform: "youtube", src: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1&rel=0`, vertical: parts[0] === "shorts" };
}

function facebook(url: URL): LiveEmbed | null {
  const host = url.hostname.replace(/^(www|m|web)\./, "");
  const path = url.pathname;
  const isVideo =
    host === "fb.watch" ||
    /\/videos\//.test(path) ||
    /^\/reel\/\d+/.test(path) ||
    ((path === "/watch" || path === "/watch/" || path.startsWith("/watch/live")) && /^\d+$/.test(url.searchParams.get("v") ?? "")) ||
    (path === "/video.php" && /^\d+$/.test(url.searchParams.get("v") ?? ""));
  if (!isVideo) return null;
  // Le plugin attend l'URL publique canonique (www.facebook.com).
  const href = host === "fb.watch" ? url.toString() : `https://www.facebook.com${path}${url.search}`;
  const qs = new URLSearchParams({ href, show_text: "false", autoplay: "true", allowfullscreen: "true", width: "734" });
  return { platform: "facebook", src: `https://www.facebook.com/plugins/video.php?${qs}`, vertical: /^\/reel\//.test(path) };
}

function tiktok(url: URL): LiveEmbed | null {
  const m = url.pathname.match(/^\/@[\w.-]{1,40}\/video\/(\d{8,25})\/?$/);
  if (!m) return null;
  return { platform: "tiktok", src: `https://www.tiktok.com/player/v1/${m[1]}?autoplay=1&rel=0`, vertical: true };
}

function instagram(url: URL): LiveEmbed | null {
  const m = url.pathname.match(/^\/(p|reel|tv)\/([A-Za-z0-9_-]{5,40})\/?$/);
  if (!m) return null;
  const kind = m[1] === "tv" ? "p" : m[1];
  return { platform: "instagram", src: `https://www.instagram.com/${kind}/${m[2]}/embed/`, vertical: kind === "reel" };
}

/** Lecteur intégrable pour un lien de diffusion https, ou null (lien externe seulement). */
export function liveEmbed(streamUrl: string | null | undefined): LiveEmbed | null {
  if (!streamUrl || streamUrl.length > 500) return null;
  let url: URL;
  try {
    url = new URL(streamUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (/(^|\.)youtube(-nocookie)?\.com$/.test(host) || host === "youtu.be") return youtube(url);
  if (/(^|\.)facebook\.com$/.test(host) || host === "fb.watch") return facebook(url);
  if (/(^|\.)tiktok\.com$/.test(host)) return tiktok(url);
  if (/(^|\.)instagram\.com$/.test(host)) return instagram(url);
  return null;
}
