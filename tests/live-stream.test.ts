import { describe, expect, it } from "vitest";
import { countdownLabel, countdownParts, liveStatus, parseStreamUrl, reminderCampaignName, reminderTag, STREAM_PLATFORMS } from "@/lib/live/stream";

/** Lot 4 §18 : liste blanche des plateformes de diffusion, statut du direct, compte à rebours. */

describe("lien de diffusion", () => {
  it("accepte les plateformes de la liste blanche en https", () => {
    expect(parseStreamUrl("https://www.youtube.com/watch?v=abc")?.platform).toBe("youtube");
    expect(parseStreamUrl("https://youtu.be/abc")?.platform).toBe("youtube");
    expect(parseStreamUrl("https://www.facebook.com/boutique/videos/123")?.platform).toBe("facebook");
    expect(parseStreamUrl("https://fb.watch/xyz")?.platform).toBe("facebook");
    expect(parseStreamUrl("https://www.tiktok.com/@boutique/live")?.platform).toBe("tiktok");
    expect(parseStreamUrl("https://www.instagram.com/boutique/live")?.platform).toBe("instagram");
    expect(STREAM_PLATFORMS).toEqual(["YouTube", "Facebook", "TikTok", "Instagram"]);
  });

  it("refuse tout le reste", () => {
    expect(parseStreamUrl("http://www.youtube.com/watch?v=abc")).toBeNull(); // pas https
    expect(parseStreamUrl("https://evil.example.com/live")).toBeNull();
    expect(parseStreamUrl("https://user:pass@www.youtube.com/live")).toBeNull();
    expect(parseStreamUrl("javascript:alert(1)")).toBeNull();
    expect(parseStreamUrl("youtube.com/live")).toBeNull();
    expect(parseStreamUrl("")).toBeNull();
    expect(parseStreamUrl(null)).toBeNull();
    expect(parseStreamUrl(`https://www.youtube.com/${"x".repeat(600)}`)).toBeNull();
  });

  it("retire le fragment (jamais de code dans l'ancre)", () => {
    expect(parseStreamUrl("https://youtu.be/abc#%3Cscript%3E")?.url).toBe("https://youtu.be/abc");
  });
});

describe("statut du direct", () => {
  const start = Date.parse("2026-10-12T18:00:00Z");
  const base = { startsAt: new Date(start), endsAt: null, status: "SCHEDULED" };

  it("avant l'heure : programmé", () => {
    expect(liveStatus(base, start - 60_000)).toBe("scheduled");
  });

  it("à l'heure pile et après : en direct, sans action du marchand", () => {
    expect(liveStatus(base, start)).toBe("live");
    expect(liveStatus(base, start + 3600_000)).toBe("live");
  });

  it("sans heure de fin : terminé 3 heures après le début", () => {
    expect(liveStatus(base, start + 3 * 3600_000 - 1)).toBe("live");
    expect(liveStatus(base, start + 3 * 3600_000)).toBe("ended");
  });

  it("heure de fin déclarée : respectée", () => {
    const withEnd = { ...base, endsAt: new Date(start + 1800_000) };
    expect(liveStatus(withEnd, start + 1799_000)).toBe("live");
    expect(liveStatus(withEnd, start + 1800_000)).toBe("ended");
  });

  it("annulé ou terminé à la main : toujours terminé", () => {
    expect(liveStatus({ ...base, status: "CANCELLED" }, start)).toBe("ended");
    expect(liveStatus({ ...base, status: "ENDED" }, start)).toBe("ended");
  });

  it("lancé à la main avant l'heure : en direct", () => {
    expect(liveStatus({ ...base, status: "LIVE" }, start - 600_000)).toBe("live");
  });

  it("accepte aussi des dates ISO (données sérialisées pour la boutique)", () => {
    expect(liveStatus({ startsAt: "2026-10-12T18:00:00Z", endsAt: null, status: "SCHEDULED" }, start + 1000)).toBe("live");
  });
});

describe("compte à rebours", () => {
  const now = Date.parse("2026-10-12T10:00:00Z");

  it("décompose jours, heures, minutes, secondes", () => {
    const p = countdownParts("2026-10-14T12:30:45Z", now);
    expect([p.days, p.hours, p.minutes, p.seconds]).toEqual([2, 2, 30, 45]);
  });

  it("jamais négatif", () => {
    const p = countdownParts("2026-10-12T09:00:00Z", now);
    expect(p.total).toBe(0);
    expect(countdownLabel(p)).toBe("C'est maintenant");
  });

  it("texte lisible par un lecteur d'écran", () => {
    expect(countdownLabel(countdownParts("2026-10-13T11:00:00Z", now))).toBe("1 jour et 1 heure");
    expect(countdownLabel(countdownParts("2026-10-12T12:02:00Z", now))).toBe("2 heures et 2 minutes");
    expect(countdownLabel(countdownParts("2026-10-12T10:01:30Z", now))).toBe("1 minute et 30 secondes");
    expect(countdownLabel(countdownParts("2026-10-12T10:00:05Z", now))).toBe("5 secondes");
  });
});

describe("rappel WhatsApp", () => {
  it("nom de campagne et étiquette stables, dérivés du direct", () => {
    expect(reminderCampaignName("cjld2cjxh0000qzrmn831i7rn")).toBe("Rappel du direct (31i7rn)");
    expect(reminderTag("cjld2cjxh0000qzrmn831i7rn")).toBe("direct-n831i7rn");
    expect(reminderTag("a")).toBe("direct-a");
  });
});
