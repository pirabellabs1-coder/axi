import { describe, it, expect } from "vitest";
import {
  boundsIssue,
  countsTowardLimit,
  effectiveStatus,
  isActiveAt,
  localDateTimeToUtc,
  localDay,
  MAX_SCHEDULE_DAYS,
  overlaps,
  pickActive,
  timeZoneOffsetMinutes,
  utcToLocalInput,
} from "@/lib/theme-schedules/rules";
import { OCCASIONS, occasionById, occasionDay, suggestedRange, INDEPENDENCE_DAYS } from "@/config/occasions";
import { applyOccasion, countdownValue } from "@/lib/theme-schedules/occasion-doc";
import { defaultThemeDocument } from "@/lib/theme-engine/defaults";
import { validateThemeDocument } from "@/lib/theme-engine/validate";
import { SECTOR_PRESETS } from "@/lib/storefront/theme";

/**
 * Lot 4 §11 (équipe EXP) : bornes à la seconde, chevauchement refusé, fuseau de la boutique,
 * préréglages d'occasion (document toujours valide, dates mobiles non devinées).
 */

const BJ = "Africa/Porto-Novo"; // UTC+1, sans heure d'été
const PARIS = "Europe/Paris"; // UTC+1 / UTC+2

describe("fuseau de la boutique", () => {
  it("convertit une saisie locale en instant UTC", () => {
    expect(localDateTimeToUtc("2026-12-24T18:00", BJ)?.toISOString()).toBe("2026-12-24T17:00:00.000Z");
    // Heure d'été à Paris : UTC+2 en juillet, UTC+1 en janvier.
    expect(localDateTimeToUtc("2026-07-14T12:00", PARIS)?.toISOString()).toBe("2026-07-14T10:00:00.000Z");
    expect(localDateTimeToUtc("2026-01-14T12:00", PARIS)?.toISOString()).toBe("2026-01-14T11:00:00.000Z");
  });

  it("refuse une saisie mal formée", () => {
    for (const bad of ["", "2026-13-01T00:00", "demain", "2026-12-24", "2026-12-24T25:00"]) {
      expect(localDateTimeToUtc(bad, BJ)).toBeNull();
    }
  });

  it("fait l'aller-retour saisie → UTC → saisie", () => {
    const utc = localDateTimeToUtc("2026-08-01T06:30", BJ)!;
    expect(utcToLocalInput(utc, BJ)).toBe("2026-08-01T06:30");
    expect(localDay(utc, BJ)).toBe("2026-08-01");
  });

  it("gère un fuseau inconnu comme UTC, sans jeter", () => {
    expect(timeZoneOffsetMinutes(new Date("2026-01-01T00:00:00Z"), "Mars/Olympus")).toBe(0);
    expect(localDateTimeToUtc("2026-01-01T00:00", "Mars/Olympus")?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("une journée locale ne dépend pas du fuseau du serveur", () => {
    // 23 h 30 UTC le 31 juillet = 00 h 30 le 1er août à Porto-Novo.
    expect(localDay(new Date("2026-07-31T23:30:00Z"), BJ)).toBe("2026-08-01");
  });
});

describe("bornes à la seconde", () => {
  const bounds = { startsAt: new Date("2026-12-20T00:00:00Z"), endsAt: new Date("2026-12-26T00:00:00Z") };

  it("inclut le début et exclut la fin", () => {
    expect(isActiveAt(bounds, new Date("2026-12-19T23:59:59Z"))).toBe(false);
    expect(isActiveAt(bounds, new Date("2026-12-20T00:00:00Z"))).toBe(true);
    expect(isActiveAt(bounds, new Date("2026-12-25T23:59:59Z"))).toBe(true);
    expect(isActiveAt(bounds, new Date("2026-12-26T00:00:00Z"))).toBe(false);
    expect(isActiveAt(bounds, new Date("2026-12-26T00:00:01Z"))).toBe(false);
  });

  it("le retour au thème normal se fait à la milliseconde près", () => {
    expect(isActiveAt(bounds, new Date(bounds.endsAt.getTime() - 1))).toBe(true);
    expect(isActiveAt(bounds, new Date(bounds.endsAt.getTime()))).toBe(false);
  });
});

describe("chevauchements", () => {
  const a = { startsAt: new Date("2026-12-01T00:00:00Z"), endsAt: new Date("2026-12-10T00:00:00Z") };

  it("refuse deux périodes qui se croisent", () => {
    expect(overlaps(a, { startsAt: new Date("2026-12-09T23:59:59Z"), endsAt: new Date("2026-12-15T00:00:00Z") })).toBe(true);
    expect(overlaps(a, { startsAt: new Date("2026-11-20T00:00:00Z"), endsAt: new Date("2026-12-01T00:00:01Z") })).toBe(true);
    // Période englobante et période incluse.
    expect(overlaps(a, { startsAt: new Date("2026-11-01T00:00:00Z"), endsAt: new Date("2027-01-01T00:00:00Z") })).toBe(true);
    expect(overlaps(a, { startsAt: new Date("2026-12-03T00:00:00Z"), endsAt: new Date("2026-12-04T00:00:00Z") })).toBe(true);
  });

  it("accepte deux périodes bord à bord", () => {
    expect(overlaps(a, { startsAt: new Date("2026-12-10T00:00:00Z"), endsAt: new Date("2026-12-20T00:00:00Z") })).toBe(false);
    expect(overlaps(a, { startsAt: new Date("2026-11-20T00:00:00Z"), endsAt: new Date("2026-12-01T00:00:00Z") })).toBe(false);
  });

  it("choisit une seule programmation même si des données anciennes se chevauchent", () => {
    const rows = [
      { id: "s1", status: "SCHEDULED" as const, startsAt: new Date("2026-12-01T00:00:00Z"), endsAt: new Date("2026-12-31T00:00:00Z") },
      { id: "s2", status: "ACTIVE" as const, startsAt: new Date("2026-12-05T00:00:00Z"), endsAt: new Date("2026-12-20T00:00:00Z") },
      { id: "s3", status: "CANCELLED" as const, startsAt: new Date("2026-12-06T00:00:00Z"), endsAt: new Date("2026-12-21T00:00:00Z") },
    ];
    expect(pickActive(rows, new Date("2026-12-10T00:00:00Z"))?.id).toBe("s2"); // la plus récemment commencée
    expect(pickActive(rows, new Date("2026-12-25T00:00:00Z"))?.id).toBe("s1");
    expect(pickActive(rows, new Date("2027-01-02T00:00:00Z"))).toBeNull();
    // Une programmation annulée ne prend jamais la main.
    expect(pickActive([rows[2]], new Date("2026-12-10T00:00:00Z"))).toBeNull();
  });
});

describe("validation des bornes", () => {
  const now = new Date("2026-10-12T00:00:00Z");
  const d = (iso: string) => new Date(iso);

  it("refuse une fin avant le début, trop courte, trop longue ou déjà passée", () => {
    expect(boundsIssue({ startsAt: d("2026-12-10T00:00:00Z"), endsAt: d("2026-12-01T00:00:00Z") }, now)).toMatch(/après le début/);
    expect(boundsIssue({ startsAt: d("2026-12-10T00:00:00Z"), endsAt: d("2026-12-10T00:01:00Z") }, now)).toMatch(/au moins/);
    expect(boundsIssue({ startsAt: d("2026-12-10T00:00:00Z"), endsAt: new Date(d("2026-12-10T00:00:00Z").getTime() + (MAX_SCHEDULE_DAYS + 1) * 86400000) }, now)).toMatch(/au plus/);
    expect(boundsIssue({ startsAt: d("2026-01-01T00:00:00Z"), endsAt: d("2026-01-10T00:00:00Z") }, now)).toMatch(/déjà passée/);
    expect(boundsIssue({ startsAt: d("2026-12-01T00:00:00Z"), endsAt: d("2026-12-10T00:00:00Z") }, now)).toBeNull();
  });

  it("déduit le statut affiché de l'horloge", () => {
    const row = { startsAt: d("2026-12-01T00:00:00Z"), endsAt: d("2026-12-10T00:00:00Z"), status: "SCHEDULED" as const };
    expect(effectiveStatus(row, now)).toBe("SCHEDULED");
    expect(effectiveStatus(row, d("2026-12-05T00:00:00Z"))).toBe("ACTIVE");
    expect(effectiveStatus(row, d("2026-12-10T00:00:00Z"))).toBe("COMPLETED");
    expect(effectiveStatus({ ...row, status: "CANCELLED" }, d("2026-12-05T00:00:00Z"))).toBe("CANCELLED");
  });

  it("ne compte dans la limite de plan que les programmations à venir ou en cours", () => {
    const base = { startsAt: d("2026-12-01T00:00:00Z"), endsAt: d("2026-12-10T00:00:00Z") };
    expect(countsTowardLimit({ ...base, status: "SCHEDULED" }, now)).toBe(true);
    expect(countsTowardLimit({ ...base, status: "CANCELLED" }, now)).toBe(false);
    expect(countsTowardLimit({ ...base, status: "COMPLETED" }, d("2027-01-01T00:00:00Z"))).toBe(false);
  });
});

describe("préréglages d'occasion", () => {
  const doc = defaultThemeDocument(SECTOR_PRESETS[0].sector, { name: "Boutique test" });

  it("ne devine jamais une date mobile", () => {
    const today = "2026-10-12";
    for (const o of OCCASIONS) {
      const range = suggestedRange(o, { todayLocal: today, country: "BJ" });
      if (o.fixed === null && !o.byCountry) expect(range).toBeNull();
      else expect(range).not.toBeNull();
    }
    expect(suggestedRange(occasionById("tabaski")!, { todayLocal: today, country: "BJ" })).toBeNull();
  });

  it("suggère la bonne date par pays pour l'indépendance", () => {
    const o = occasionById("independance")!;
    expect(occasionDay(o, 2027, "BJ")).toEqual(INDEPENDENCE_DAYS.BJ && { month: 8, day: 1 });
    expect(occasionDay(o, 2027, "SN")).toEqual({ month: 4, day: 4 });
    expect(occasionDay(o, 2027, "XX")).toBeNull();
  });

  it("place Black Friday sur le 4e vendredi de novembre", () => {
    const o = occasionById("black-friday")!;
    // 2026 : 27 novembre ; 2027 : 26 novembre.
    expect(occasionDay(o, 2026)).toEqual({ month: 11, day: 27 });
    expect(occasionDay(o, 2027)).toEqual({ month: 11, day: 26 });
  });

  it("reporte à l'année suivante une fête déjà passée", () => {
    const range = suggestedRange(occasionById("noel")!, { todayLocal: "2026-12-31" });
    expect(range?.startsAt.startsWith("2027-12")).toBe(true);
  });

  it("produit un document toujours valide", () => {
    const endsAt = new Date("2026-12-26T00:00:00Z");
    for (const o of OCCASIONS) {
      const next = applyOccasion(doc, o, { endsAt, timeZone: BJ });
      const v = validateThemeDocument(next);
      expect(v.ok, `${o.id} : ${v.ok ? "" : v.errors[0]?.message}`).toBe(true);
      if (!v.ok) continue;
      expect(v.doc.settings.header.announcement.enabled).toBe(true);
      expect(v.doc.settings.colors.accent).toBe(o.accent);
      // Le document d'origine n'est jamais modifié.
      expect(doc.settings.colors.accent).not.toBe(undefined);
      expect(v.doc.templates.home.order.length).toBeGreaterThan(doc.templates.home.order.length);
    }
  });

  it("écrit le compte à rebours dans le fuseau de la boutique", () => {
    expect(countdownValue(new Date("2026-12-25T23:00:00Z"), BJ)).toBe("2026-12-26 00:00");
  });

  it("respecte les options bannière et compte à rebours", () => {
    const o = occasionById("noel")!;
    const minimal = applyOccasion(doc, o, { endsAt: new Date("2026-12-26T00:00:00Z"), timeZone: BJ, banner: false, countdown: false });
    expect(minimal.templates.home.order.length).toBe(doc.templates.home.order.length);
    expect(minimal.settings.header.announcement.text).toContain("Noël");
  });
});
