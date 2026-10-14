import { describe, expect, it } from "vitest";
import {
  customerSegments,
  defaultAudience,
  deviceFromHints,
  disallowedRuleTypes,
  evaluateVisibility,
  isBotUserAgent,
  matchesSchedule,
  sourceFromSignals,
  visibleSectionIds,
} from "@/lib/theme-engine/audience";
import type { SectionVisibility, Template } from "@/lib/theme-engine/types";

// 2026-10-12 est un lundi. Porto-Novo = UTC+1.
const mondayAt = (hhmm: string) => new Date(`2026-10-12T${hhmm}:00+01:00`);

describe("evaluateVisibility", () => {
  it("sans visibilité ou sans règle : visible", () => {
    expect(evaluateVisibility(undefined, {})).toBe(true);
    expect(evaluateVisibility(null, {})).toBe(true);
    expect(evaluateVisibility({ match: "all", mode: "show", rules: [] }, {})).toBe(true);
  });

  it("show : visible seulement si les règles correspondent", () => {
    const v: SectionVisibility = { match: "all", mode: "show", rules: [{ type: "customer", values: ["loyal"] }] };
    expect(evaluateVisibility(v, { customer: ["returning", "loyal"] })).toBe(true);
    expect(evaluateVisibility(v, { customer: ["anonymous"] })).toBe(false);
    expect(evaluateVisibility(v, {})).toBe(false); // anonyme par défaut
  });

  it("hide : inverse", () => {
    const v: SectionVisibility = { match: "all", mode: "hide", rules: [{ type: "device", values: ["mobile"] }] };
    expect(evaluateVisibility(v, { device: "mobile" })).toBe(false);
    expect(evaluateVisibility(v, { device: "desktop" })).toBe(true);
    expect(evaluateVisibility(v, {})).toBe(true); // appareil inconnu : la règle ne correspond pas
  });

  it("all / any", () => {
    const rules: SectionVisibility["rules"] = [
      { type: "city", values: ["Cotonou"] },
      { type: "source", values: ["whatsapp"] },
    ];
    const ctx = { city: "cotonou", source: "instagram" as const };
    expect(evaluateVisibility({ match: "all", mode: "show", rules }, ctx)).toBe(false);
    expect(evaluateVisibility({ match: "any", mode: "show", rules }, ctx)).toBe(true);
  });

  it("ville : casse, accents et espaces ignorés", () => {
    const v: SectionVisibility = { match: "all", mode: "show", rules: [{ type: "city", values: ["Abomey-Calavi"] }] };
    expect(evaluateVisibility(v, { city: " abomey calavi " })).toBe(true);
    const p: SectionVisibility = { match: "all", mode: "show", rules: [{ type: "city", values: ["Porto-Novo"] }] };
    expect(evaluateVisibility(p, { city: "PORTO NOVO" })).toBe(true);
  });

  it("langue : code de base", () => {
    const v: SectionVisibility = { match: "all", mode: "show", rules: [{ type: "locale", values: ["en"] }] };
    expect(evaluateVisibility(v, { locale: "en-GB" })).toBe(true);
    expect(evaluateVisibility(v, { locale: "fr" })).toBe(false);
  });

  it("robots : audience par défaut (anti-cloaking)", () => {
    const loyal: SectionVisibility = { match: "all", mode: "show", rules: [{ type: "customer", values: ["loyal"] }] };
    expect(evaluateVisibility(loyal, { customer: ["loyal"], isBot: true })).toBe(false);
    const hideAnon: SectionVisibility = { match: "all", mode: "hide", rules: [{ type: "customer", values: ["anonymous"] }] };
    expect(evaluateVisibility(hideAnon, { customer: ["loyal"], isBot: true })).toBe(false);
    expect(evaluateVisibility({ match: "all", mode: "show", rules: [{ type: "source", values: ["direct"] }] }, { source: "whatsapp", isBot: true })).toBe(true);
    expect(defaultAudience().customer).toEqual(["anonymous"]);
  });
});

describe("horaires (fuseau de la boutique)", () => {
  const weekdays = { type: "schedule" as const, days: [1, 2, 3, 4, 5], from: "08:00", to: "18:00" };
  it("plage simple, bornes [from, to[", () => {
    expect(matchesSchedule(weekdays, mondayAt("08:00"))).toBe(true);
    expect(matchesSchedule(weekdays, mondayAt("17:59"))).toBe(true);
    expect(matchesSchedule(weekdays, mondayAt("18:00"))).toBe(false);
    expect(matchesSchedule(weekdays, mondayAt("07:59"))).toBe(false);
  });
  it("fuseau appliqué : 07:30 UTC = 08:30 à Porto-Novo", () => {
    expect(matchesSchedule(weekdays, new Date("2026-10-12T07:30:00Z"))).toBe(true);
    expect(matchesSchedule(weekdays, new Date("2026-10-12T07:30:00Z"), "UTC")).toBe(false);
  });
  it("plage qui passe minuit (jour de début)", () => {
    const night = { type: "schedule" as const, days: [5], from: "22:00", to: "02:00" }; // vendredi soir
    expect(matchesSchedule(night, new Date("2026-10-16T23:00:00+01:00"))).toBe(true);
    expect(matchesSchedule(night, new Date("2026-10-17T01:30:00+01:00"))).toBe(true); // samedi 01:30
    expect(matchesSchedule(night, new Date("2026-10-17T02:00:00+01:00"))).toBe(false);
    expect(matchesSchedule(night, new Date("2026-10-15T23:00:00+01:00"))).toBe(false); // jeudi
  });
  it("sans horloge ou fuseau inconnu : ne correspond pas", () => {
    expect(matchesSchedule(weekdays, undefined)).toBe(false);
    expect(matchesSchedule(weekdays, mondayAt("10:00"), "Mars/Olympus")).toBe(false);
  });
});

describe("signaux", () => {
  it("segments client", () => {
    expect(customerSegments({ loggedIn: false })).toEqual(["anonymous"]);
    expect(customerSegments({ loggedIn: true, orderCount: 0 })).toEqual(["new"]);
    expect(customerSegments({ loggedIn: true, orderCount: 3, points: 10 })).toEqual(["returning", "loyal", "has_points"]);
  });
  it("appareil", () => {
    expect(deviceFromHints({ chUaMobile: "?1", userAgent: "Windows" })).toBe("mobile");
    expect(deviceFromHints({ userAgent: "Mozilla/5.0 (Linux; Android 13) Mobile Safari" })).toBe("mobile");
    expect(deviceFromHints({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" })).toBe("desktop");
    expect(deviceFromHints({})).toBeNull();
  });
  it("robots", () => {
    expect(isBotUserAgent("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).toBe(true);
    expect(isBotUserAgent("facebookexternalhit/1.1")).toBe(true);
    expect(isBotUserAgent("WhatsApp/2.23.20.0 A")).toBe(true);
    expect(isBotUserAgent("Mozilla/5.0 (Linux; Android 12; CUBOT X30) Mobile Safari/537.36")).toBe(false);
    expect(isBotUserAgent("Mozilla/5.0 (Windows NT 10.0) HeadlessChrome/120 Safari/537.36")).toBe(false);
    expect(isBotUserAgent("")).toBe(true);
  });
  it("source de premier contact", () => {
    expect(sourceFromSignals({ utmSource: "WhatsApp" })).toBe("whatsapp");
    expect(sourceFromSignals({ ref: "ig" })).toBe("instagram");
    expect(sourceFromSignals({ utmSource: "newsletter-oct" })).toBe("campaign");
    expect(sourceFromSignals({ referrer: "https://l.facebook.com/x" })).toBe("facebook");
    expect(sourceFromSignals({ referrer: "https://www.google.bj/" })).toBe("google");
    expect(sourceFromSignals({ referrer: "pas une url" })).toBe("direct");
    expect(sourceFromSignals({})).toBe("direct");
  });
  it("contrôle de plan : types de règle hors offre", () => {
    const v: SectionVisibility = { match: "any", mode: "show", rules: [{ type: "customer", values: ["new"] }, { type: "city", values: ["Parakou"] }] };
    expect(disallowedRuleTypes(v, ["customer"])).toEqual(["city"]);
    expect(disallowedRuleTypes(v, ["customer", "city"])).toEqual([]);
  });
});

it("visibleSectionIds : ordre conservé, masquées et hors audience exclues", () => {
  const t: Template = {
    order: ["a", "b", "c"],
    sections: {
      a: { id: "a", type: "rich-text", settings: {}, blocks: [] },
      b: { id: "b", type: "rich-text", settings: {}, blocks: [], disabled: true },
      c: { id: "c", type: "rich-text", settings: {}, blocks: [], visibility: { match: "all", mode: "show", rules: [{ type: "customer", values: ["loyal"] }] } },
    },
  };
  expect(visibleSectionIds(t, {})).toEqual(["a"]);
  expect(visibleSectionIds(t, { customer: ["loyal"] })).toEqual(["a", "c"]);
});
