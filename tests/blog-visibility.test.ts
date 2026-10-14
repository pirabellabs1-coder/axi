import { describe, expect, it } from "vitest";
import { effectiveStatus, isPostPublic, postDate, publicPostWhere, resolvePublication, utcToZonedLocal, zonedLocalToUtc } from "@/lib/blog/visibility";

/** Lot 2 D : visibilité des articles, publication programmée résolue à la lecture (sans tâche planifiée). */

const NOW = new Date("2026-10-11T12:00:00Z");
const past = new Date("2026-10-11T11:59:00Z");
const future = new Date("2026-10-11T12:01:00Z");

describe("isPostPublic", () => {
  it("publié : visible", () => expect(isPostPublic({ status: "PUBLISHED", publishedAt: past }, NOW)).toBe(true));
  it("brouillon et archivé : jamais visibles", () => {
    expect(isPostPublic({ status: "DRAFT", publishedAt: past }, NOW)).toBe(false);
    expect(isPostPublic({ status: "ARCHIVED", publishedAt: past }, NOW)).toBe(false);
  });
  it("programmé : invisible avant l'heure, visible à l'heure exacte et après", () => {
    expect(isPostPublic({ status: "SCHEDULED", publishedAt: future }, NOW)).toBe(false);
    expect(isPostPublic({ status: "SCHEDULED", publishedAt: NOW }, NOW)).toBe(true);
    expect(isPostPublic({ status: "SCHEDULED", publishedAt: past.toISOString() }, NOW)).toBe(true);
  });
  it("programmé sans date : invisible", () => expect(isPostPublic({ status: "SCHEDULED", publishedAt: null }, NOW)).toBe(false));
  it("le même article bascule sans aucune écriture quand l'heure passe", () => {
    const post = { status: "SCHEDULED", publishedAt: future };
    expect(isPostPublic(post, NOW)).toBe(false);
    expect(isPostPublic(post, new Date(future.getTime() + 1))).toBe(true);
  });
});

describe("publicPostWhere", () => {
  it("filtre toujours par boutique et applique la même règle", () => {
    const w = publicPostWhere("store_A", NOW);
    expect(w.storeId).toBe("store_A");
    expect(w.OR).toEqual([{ status: "PUBLISHED" }, { status: "SCHEDULED", publishedAt: { lte: NOW } }]);
  });
});

describe("effectiveStatus / postDate", () => {
  it("programmé échu affiché « Publié »", () => {
    expect(effectiveStatus({ status: "SCHEDULED", publishedAt: past }, NOW)).toBe("PUBLISHED");
    expect(effectiveStatus({ status: "SCHEDULED", publishedAt: future }, NOW)).toBe("SCHEDULED");
    expect(effectiveStatus({ status: "WHATEVER", publishedAt: null }, NOW)).toBe("DRAFT");
  });
  it("date d'article : publication, sinon création", () => {
    expect(postDate({ publishedAt: null, createdAt: past }).getTime()).toBe(past.getTime());
    expect(postDate({ publishedAt: future, createdAt: past }).getTime()).toBe(future.getTime());
  });
});

describe("resolvePublication", () => {
  it("publier : maintenant, ou date de première publication conservée", () => {
    expect(resolvePublication("publish", { now: NOW })).toEqual({ ok: true, status: "PUBLISHED", publishedAt: NOW });
    expect(resolvePublication("publish", { now: NOW, previousPublishedAt: past })).toEqual({ ok: true, status: "PUBLISHED", publishedAt: past });
    // Ancienne date de programmation future : publication immédiate à maintenant.
    expect(resolvePublication("publish", { now: NOW, previousPublishedAt: future })).toEqual({ ok: true, status: "PUBLISHED", publishedAt: NOW });
  });
  it("programmer : date future obligatoire (≥ 2 min, ≤ 1 an)", () => {
    expect(resolvePublication("schedule", { now: NOW, scheduledAt: null }).ok).toBe(false);
    expect(resolvePublication("schedule", { now: NOW, scheduledAt: future }).ok).toBe(false);
    expect(resolvePublication("schedule", { now: NOW, scheduledAt: new Date(NOW.getTime() + 400 * 86_400_000) }).ok).toBe(false);
    const at = new Date("2026-10-12T08:00:00Z");
    expect(resolvePublication("schedule", { now: NOW, scheduledAt: at })).toEqual({ ok: true, status: "SCHEDULED", publishedAt: at });
  });
  it("brouillon et archive conservent la date de publication", () => {
    expect(resolvePublication("draft", { now: NOW, previousPublishedAt: past })).toEqual({ ok: true, status: "DRAFT", publishedAt: past });
    expect(resolvePublication("archive", { now: NOW })).toEqual({ ok: true, status: "ARCHIVED", publishedAt: null });
  });
});

describe("fuseau de la boutique", () => {
  it("heure locale de Cotonou (UTC+1) → UTC, et retour", () => {
    const d = zonedLocalToUtc("2026-10-12T09:30", "Africa/Porto-Novo");
    expect(d?.toISOString()).toBe("2026-10-12T08:30:00.000Z");
    expect(utcToZonedLocal(d!, "Africa/Porto-Novo")).toBe("2026-10-12T09:30");
  });
  it("Abidjan (UTC) et saisie invalide", () => {
    expect(zonedLocalToUtc("2026-10-12T09:30", "Africa/Abidjan")?.toISOString()).toBe("2026-10-12T09:30:00.000Z");
    expect(zonedLocalToUtc("12/10/2026 09:30", "Africa/Abidjan")).toBeNull();
  });
});
