import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb } from "./helpers/fake-db";

/**
 * Lot 4 §11 et §13 (équipe EXP) : isolation entre boutiques, contrôle de plan et invariants des actions.
 * Un membre de la boutique A ne peut rien programmer ni tester sur la boutique B ; les chevauchements de
 * programmations et les tests multiples sur une même section sont refusés ; les limites de plan sont vérifiées
 * côté serveur. Le comptage des événements recalcule toujours la variante côté serveur.
 */

const A = "store_AAAAAAAA";
const B = "store_BBBBBBBB";

const state = vi.hoisted(() => ({
  fake: null as null | ReturnType<typeof import("./helpers/fake-db").createFakeDb>,
  member: "store_AAAAAAAA" as string,
  planId: "SCALE" as string,
  caps: new Set<string>(["theme.manage"]),
  rateOk: true,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.fake!.db;
  },
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => ({})) }));
vi.mock("@/lib/jobs", () => ({ enqueue: vi.fn(async () => ({ id: "job_1" })) }));
vi.mock("@/lib/notifications/service", () => ({ notifyStore: vi.fn(async () => null) }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ ok: state.rateOk, retryAfter: 0 })),
  rateLimitAll: vi.fn(async () => ({ ok: state.rateOk, retryAfter: 0 })),
  rateLimitMessage: () => "Trop de tentatives.",
  clientIp: async () => "1.2.3.4",
}));
vi.mock("@/lib/auth/permissions", () => {
  class AuthError extends Error {}
  return {
    AuthError,
    requireStore: vi.fn(async (storeId: string, cap: string) => {
      if (storeId !== state.member) throw new AuthError("Boutique introuvable ou accès refusé");
      if (!state.caps.has(cap)) throw new AuthError("Votre rôle ne permet pas cette action");
      const store = state.fake!.tables.store.find((s) => s.id === storeId)!;
      return { user: { id: "user_A" }, store, role: "OWNER", planId: state.planId, can: () => true };
    }),
  };
});

import { defaultThemeDocument } from "@/lib/theme-engine/defaults";
import { SECTOR_PRESETS } from "@/lib/storefront/theme";
import { cancelThemeSchedule, createThemeSchedule, deleteThemeSchedule, updateThemeSchedule } from "@/lib/theme-schedules/actions";
import { scheduledThemeAt } from "@/lib/theme-schedules/service";
import { applyExperimentWinner, createExperiment, pauseExperiment, startExperiment } from "@/lib/experiments/actions";
import { recordBeaconEvent, resolveExperiments } from "@/lib/experiments/service";
import { serializeVariants } from "@/lib/experiments/rules";
import { assignVariant } from "@/lib/experiments/assign";

const doc = defaultThemeDocument(SECTOR_PRESETS[0].sector, { name: "Boutique" });
const HOME_SECTION = doc.templates.home.order.find((id) => doc.templates.home.sections[id].type !== "announcement-bar")!;

function storeRow(id: string) {
  return {
    id,
    slug: id === A ? "boutique-a" : "boutique-b",
    name: `Boutique ${id === A ? "A" : "B"}`,
    sector: SECTOR_PRESETS[0].sector,
    themeId: SECTOR_PRESETS[0].id,
    themeConfig: null,
    themeDoc: doc,
    themeDocDraft: null,
    themeDraft: null,
    logoUrl: null,
    bannerUrl: null,
    tagline: null,
    description: null,
    whatsappNumber: null,
    timezone: "Africa/Porto-Novo",
    country: "BJ",
    currency: "XOF",
    city: "Cotonou",
  };
}

function fd(o: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
}

const future = (days: number, hours = 0) => {
  const d = new Date(Date.now() + days * 86_400_000 + hours * 3_600_000);
  // Saisie locale « AAAA-MM-JJTHH:MM » approximative : suffisante pour ces tests (fuseau UTC+1).
  return new Date(d.getTime() + 3_600_000).toISOString().slice(0, 16);
};

beforeEach(() => {
  state.member = A;
  state.planId = "SCALE";
  state.caps = new Set(["theme.manage"]);
  state.rateOk = true;
  state.fake = createFakeDb({ store: [storeRow(A), storeRow(B)] });
});

/* ───────────── Thèmes programmés ───────────── */

describe("thèmes programmés : isolation et invariants", () => {
  const base = { name: "Noël", occasion: "noel", source: "published", banner: "on", countdown: "on" };

  it("un membre de A ne peut pas programmer sur B", async () => {
    const r = await createThemeSchedule(undefined, fd({ ...base, storeId: B, startsAt: future(10), endsAt: future(20) }));
    expect(r.ok).toBe(false);
    expect(state.fake!.tables.themeSchedule ?? []).toHaveLength(0);
  });

  it("crée une programmation avec un document valide et des jobs de notification", async () => {
    const { enqueue } = await import("@/lib/jobs");
    const r = await createThemeSchedule(undefined, fd({ ...base, storeId: A, startsAt: future(10), endsAt: future(20) }));
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    const rows = state.fake!.tables.themeSchedule;
    expect(rows).toHaveLength(1);
    expect(rows[0].storeId).toBe(A);
    expect(rows[0].status).toBe("SCHEDULED");
    expect(rows[0].document.settings.header.announcement.enabled).toBe(true);
    expect(vi.mocked(enqueue).mock.calls.filter((c) => c[0] === "theme.schedule_notify")).toHaveLength(2);
    // Le thème de la boutique n'a pas été modifié.
    expect(state.fake!.tables.store.find((s) => s.id === A)!.themeDoc).toEqual(doc);
  });

  it("refuse un chevauchement, accepte une période bord à bord", async () => {
    await createThemeSchedule(undefined, fd({ ...base, storeId: A, startsAt: future(10), endsAt: future(20) }));
    const clash = await createThemeSchedule(undefined, fd({ ...base, name: "Autre", storeId: A, startsAt: future(19), endsAt: future(25) }));
    expect(clash.ok).toBe(false);
    expect(clash.ok === false && clash.error).toMatch(/chevauch/);
    const ok = await createThemeSchedule(undefined, fd({ ...base, name: "Suite", storeId: A, startsAt: future(20), endsAt: future(25) }));
    expect(ok.ok, ok.ok ? "" : ok.error).toBe(true);
    expect(state.fake!.tables.themeSchedule).toHaveLength(2);
  });

  it("refuse des dates invalides ou passées", async () => {
    expect((await createThemeSchedule(undefined, fd({ ...base, storeId: A, startsAt: "hier", endsAt: future(20) }))).ok).toBe(false);
    expect((await createThemeSchedule(undefined, fd({ ...base, storeId: A, startsAt: future(20), endsAt: future(10) }))).ok).toBe(false);
    expect((await createThemeSchedule(undefined, fd({ ...base, storeId: A, startsAt: future(-30), endsAt: future(-20) }))).ok).toBe(false);
    expect(state.fake!.tables.themeSchedule ?? []).toHaveLength(0);
  });

  it("applique la limite de plan (Business : 3) et refuse les plans sans la fonction", async () => {
    state.planId = "STARTER";
    const no = await createThemeSchedule(undefined, fd({ ...base, storeId: A, startsAt: future(10), endsAt: future(20) }));
    expect(no.ok).toBe(false);
    expect(no.ok === false && no.error).toMatch(/Business/);

    state.planId = "BUSINESS";
    for (let i = 0; i < 3; i++) {
      const r = await createThemeSchedule(undefined, fd({ ...base, name: `P${i}`, storeId: A, startsAt: future(10 + i * 10), endsAt: future(15 + i * 10) }));
      expect(r.ok, r.ok ? "" : r.error).toBe(true);
    }
    const over = await createThemeSchedule(undefined, fd({ ...base, name: "P4", storeId: A, startsAt: future(100), endsAt: future(110) }));
    expect(over.ok).toBe(false);
    expect(over.ok === false && over.error).toMatch(/3 programmation/);
  });

  it("résout la programmation active au rendu, et seulement dans ses bornes", async () => {
    await createThemeSchedule(undefined, fd({ ...base, storeId: A, startsAt: future(1), endsAt: future(3) }));
    const row = state.fake!.tables.themeSchedule[0];
    expect(await scheduledThemeAt(A, new Date(row.startsAt.getTime() - 1000))).toBeNull();
    const during = await scheduledThemeAt(A, new Date(row.startsAt.getTime()));
    expect(during?.name).toBe("Noël");
    expect(await scheduledThemeAt(A, new Date(row.endsAt.getTime()))).toBeNull();
    // Isolation : la boutique B n'a aucune programmation.
    expect(await scheduledThemeAt(B, new Date(row.startsAt.getTime() + 1000))).toBeNull();
  });

  it("une programmation annulée ne prend plus la main", async () => {
    await createThemeSchedule(undefined, fd({ ...base, storeId: A, startsAt: future(1), endsAt: future(3) }));
    const row = state.fake!.tables.themeSchedule[0];
    expect(await scheduledThemeAt(A, new Date(row.startsAt.getTime() + 1000))).not.toBeNull();
    const r = await cancelThemeSchedule(A, row.id);
    expect(r.ok).toBe(true);
    expect(await scheduledThemeAt(A, new Date(row.startsAt.getTime() + 1000))).toBeNull();
  });

  it("un membre de A ne peut ni modifier, ni annuler, ni supprimer une programmation de B", async () => {
    state.member = B;
    await createThemeSchedule(undefined, fd({ ...base, storeId: B, startsAt: future(10), endsAt: future(20) }));
    const row = state.fake!.tables.themeSchedule[0];
    state.member = A;
    expect((await updateThemeSchedule(undefined, fd({ storeId: B, scheduleId: row.id, name: "X", startsAt: future(11), endsAt: future(21) }))).ok).toBe(false);
    expect((await cancelThemeSchedule(B, row.id)).ok).toBe(false);
    expect((await deleteThemeSchedule(B, row.id)).ok).toBe(false);
    // Même en passant son propre storeId, la ligne de B reste introuvable.
    expect((await cancelThemeSchedule(A, row.id)).ok).toBe(false);
    expect(state.fake!.tables.themeSchedule).toHaveLength(1);
    expect(state.fake!.tables.themeSchedule[0].status).toBe("SCHEDULED");
  });

  it("refuse un rôle sans la capacité theme.manage", async () => {
    state.caps = new Set(["store.view"]);
    const r = await createThemeSchedule(undefined, fd({ ...base, storeId: A, startsAt: future(10), endsAt: future(20) }));
    expect(r.ok).toBe(false);
  });
});

/* ───────────── Tests A/B ───────────── */

describe("tests A/B : isolation et invariants", () => {
  const variantsJson = JSON.stringify([{ key: "A", kind: "current" }, { key: "B", kind: "hidden" }]);
  const base = () => ({ name: "Titre bannière", template: "home", sectionId: HOME_SECTION, goal: "ORDER", variantsJson });

  it("un membre de A ne peut pas créer de test sur B", async () => {
    const r = await createExperiment(undefined, fd({ ...base(), storeId: B }));
    expect(r.ok).toBe(false);
    expect(state.fake!.tables.experiment ?? []).toHaveLength(0);
  });

  it("crée un test en brouillon sur une section existante", async () => {
    const r = await createExperiment(undefined, fd({ ...base(), storeId: A }));
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    const row = state.fake!.tables.experiment[0];
    expect(row.storeId).toBe(A);
    expect(row.status).toBe("DRAFT");
    expect(row.variants).toHaveLength(2);
    expect(row.variants[0].weight + row.variants[1].weight).toBe(100);
  });

  it("refuse une section inconnue et des variantes invalides", async () => {
    expect((await createExperiment(undefined, fd({ ...base(), storeId: A, sectionId: "inconnue" }))).ok).toBe(false);
    expect((await createExperiment(undefined, fd({ ...base(), storeId: A, variantsJson: "[]" }))).ok).toBe(false);
    expect((await createExperiment(undefined, fd({ ...base(), storeId: A, variantsJson: "pas du json" }))).ok).toBe(false);
    expect((await createExperiment(undefined, fd({ ...base(), storeId: A, template: "inexistant" }))).ok).toBe(false);
    expect(state.fake!.tables.experiment ?? []).toHaveLength(0);
  });

  it("un seul test vivant par section", async () => {
    expect((await createExperiment(undefined, fd({ ...base(), storeId: A }))).ok).toBe(true);
    const second = await createExperiment(undefined, fd({ ...base(), name: "Autre", storeId: A }));
    expect(second.ok).toBe(false);
    expect(second.ok === false && second.error).toMatch(/teste déjà/);
    expect(state.fake!.tables.experiment).toHaveLength(1);
  });

  it("applique les limites de plan (Scale : 3 en cours ; Business : non inclus)", async () => {
    state.planId = "BUSINESS";
    const no = await createExperiment(undefined, fd({ ...base(), storeId: A }));
    expect(no.ok).toBe(false);
    expect(no.ok === false && no.error).toMatch(/Scale/);

    state.planId = "SCALE";
    const ids: string[] = [];
    for (const sectionId of doc.templates.home.order.slice(0, 4)) {
      const r = await createExperiment(undefined, fd({ ...base(), name: `T-${sectionId}`, storeId: A, sectionId }));
      if (r.ok && r.data) ids.push(r.data.id);
    }
    expect(ids.length).toBeGreaterThanOrEqual(4);
    for (let i = 0; i < 3; i++) expect((await startExperiment(A, ids[i])).ok, `test ${i}`).toBe(true);
    const over = await startExperiment(A, ids[3]);
    expect(over.ok).toBe(false);
    expect(over.ok === false && over.error).toMatch(/3 test/);
  });

  it("un membre de A ne peut ni démarrer, ni mettre en pause, ni appliquer un test de B", async () => {
    state.member = B;
    const created = await createExperiment(undefined, fd({ ...base(), storeId: B }));
    expect(created.ok).toBe(true);
    const id = created.ok && created.data ? created.data.id : "";
    state.member = A;
    expect((await startExperiment(B, id)).ok).toBe(false);
    expect((await pauseExperiment(B, id)).ok).toBe(false);
    expect((await applyExperimentWinner(B, id, "B")).ok).toBe(false);
    expect((await startExperiment(A, id)).ok).toBe(false);
    expect(state.fake!.tables.experiment[0].status).toBe("DRAFT");
    // Le brouillon de A n'a pas été touché.
    expect(state.fake!.tables.store.find((s) => s.id === A)!.themeDocDraft).toBeNull();
  });

  it("« Appliquer la gagnante » n'écrit QUE dans le brouillon", async () => {
    const created = await createExperiment(undefined, fd({ ...base(), storeId: A }));
    const id = created.ok && created.data ? created.data.id : "";
    const r = await applyExperimentWinner(A, id, "B");
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    const store = state.fake!.tables.store.find((s) => s.id === A)!;
    expect(store.themeDoc).toEqual(doc); // le thème en ligne est intact
    expect(store.themeDocDraft.templates.home.order).not.toContain(HOME_SECTION);
    const row = state.fake!.tables.experiment[0];
    expect(row.status).toBe("COMPLETED");
    expect(row.winnerKey).toBe("B");
  });

  it("refuse une variante inconnue", async () => {
    const created = await createExperiment(undefined, fd({ ...base(), storeId: A }));
    const id = created.ok && created.data ? created.data.id : "";
    expect((await applyExperimentWinner(A, id, "Z")).ok).toBe(false);
    expect((await applyExperimentWinner(A, id, "C")).ok).toBe(false);
  });
});

/* ───────────── Rendu et comptage ───────────── */

describe("rendu et comptage", () => {
  const variants = [
    { key: "A" as const, weight: 50, kind: "current" as const, section: null },
    { key: "B" as const, weight: 50, kind: "hidden" as const, section: null },
  ];

  function seedRunning(storeId: string, id = "exp_run") {
    state.fake!.tables.experiment = [
      {
        id,
        storeId,
        name: "Test",
        template: "home",
        sectionId: HOME_SECTION,
        goal: "ORDER",
        status: "RUNNING",
        variants: serializeVariants(variants),
        startedAt: new Date(Date.now() - 8 * 86_400_000),
        createdAt: new Date(),
      },
    ];
    return id;
  }

  it("n'applique que les tests de la boutique", async () => {
    seedRunning(B);
    const vid = "a".repeat(32);
    const resolved = await resolveExperiments(A, { doc, templateKey: "home", visitorId: vid });
    expect(resolved.assignments).toHaveLength(0);
    expect(resolved.doc).toBe(doc);
  });

  it("affecte une variante stable et fournit une ancre observable", async () => {
    const id = seedRunning(A);
    const vid = "b".repeat(32);
    const expected = assignVariant(variants, vid, id)!.key;
    const resolved = await resolveExperiments(A, { doc, templateKey: "home", visitorId: vid });
    expect(resolved.assignments).toHaveLength(1);
    expect(resolved.assignments[0].variantKey).toBe(expected);
    expect(resolved.assignments[0].anchorId).not.toBe("");
    if (expected === "B") expect(resolved.doc.templates.home.order).not.toContain(HOME_SECTION);
    else expect(resolved.doc.templates.home.order).toContain(HOME_SECTION);
  });

  it("sans identifiant visiteur, aucun test n'est appliqué", async () => {
    seedRunning(A);
    const resolved = await resolveExperiments(A, { doc, templateKey: "home", visitorId: null });
    expect(resolved.assignments).toHaveLength(0);
    expect(resolved.doc).toBe(doc);
  });

  it("un test est suspendu si la section n'est pas dans le modèle rendu", async () => {
    seedRunning(A);
    const without = { ...doc, templates: { ...doc.templates, home: { order: doc.templates.home.order.filter((i) => i !== HOME_SECTION), sections: doc.templates.home.sections } } };
    const resolved = await resolveExperiments(A, { doc: without, templateKey: "home", visitorId: "c".repeat(32) });
    expect(resolved.assignments).toHaveLength(0);
  });

  it("compte une exposition sur la variante calculée par le serveur et agrège par jour", async () => {
    const id = seedRunning(A);
    const vid = "d".repeat(32);
    const store = { id: A, timezone: "Africa/Porto-Novo" };
    const expected = assignVariant(variants, vid, id)!.key;
    expect(await recordBeaconEvent({ store, experimentId: id, metric: "exposure", visitorId: vid })).toBe("counted");
    const stats = state.fake!.tables.experimentStat;
    expect(stats).toHaveLength(1);
    expect(stats[0].variantKey).toBe(expected);
    expect(stats[0].metric).toBe("exposure");
    expect(stats[0].count).toBe(1);

    // Deuxième exposition le même jour : refusée par le dédoublonnage (fenêtre déjà consommée).
    state.rateOk = false;
    expect(await recordBeaconEvent({ store, experimentId: id, metric: "exposure", visitorId: vid })).toBe("duplicate");
    expect(state.fake!.tables.experimentStat).toHaveLength(1);
  });

  it("ignore un test qui n'est pas en cours ou qui appartient à une autre boutique", async () => {
    const id = seedRunning(A);
    const store = { id: A, timezone: "Africa/Porto-Novo" };
    expect(await recordBeaconEvent({ store, experimentId: "exp_inconnu", metric: "exposure", visitorId: "e".repeat(32) })).toBe("ignored");
    state.fake!.tables.experiment[0].status = "PAUSED";
    expect(await recordBeaconEvent({ store, experimentId: id, metric: "exposure", visitorId: "e".repeat(32) })).toBe("ignored");
    expect(state.fake!.tables.experimentStat ?? []).toHaveLength(0);
  });
});
