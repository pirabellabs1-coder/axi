/**
 * Lot 4 §1 (refactor jour 1) : `schemas.ts` devenu agrégateur de `section-schemas/<type>.ts`.
 * L'instantané `fixtures/section-schemas.snapshot.json` a été capturé AVANT le découpage : toute valeur exportée
 * (SECTION_SCHEMAS, ordre des clés, sectionsForTemplate, SECTION_CATEGORIES) doit rester identique.
 * Les sections ajoutées ensuite par d'autres équipes (blog, premium…) sont tolérées EN PLUS, jamais à la place.
 *
 * Changements VOULUS reportés dans l'instantané depuis sa capture (toute autre différence reste une régression) :
 * - consolidation vague 2 : bloc `metafield` (« Champ personnalisé ») ajouté à `main-product` (après « Texte libre »)
 *   et à `main-collection` (nouvelle clé `blocks`, placée avant `presets`). Voir `metafieldBlock` dans `_shared.ts`.
 * - vague 2 (recherche) : le modèle `search` a sa propre section `main-search` (requise) ; « search » a donc été retiré
 *   de `main-collection.templates` et de `byTemplate.search`.
 * - vague 3 (lot 4D, équipe CAN) : sections `shoppable-video`, `stories` et `live-shopping` ajoutées EN PLUS, à la fin
 *   de l'agrégateur (`_can-sections.ts`). Aucun schéma du cœur n'est modifié : l'instantané reste inchangé.
 */
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SECTION_CATEGORIES, SECTION_SCHEMAS, sectionsForTemplate } from "@/lib/theme-engine/schemas";
import { BLOG_SECTION_SCHEMAS } from "@/lib/blog/section-schemas";
import { T3_SECTION_SCHEMAS } from "@/lib/theme-engine/section-schemas/_t3-sections";
import { CAN_SECTION_SCHEMAS } from "@/lib/theme-engine/section-schemas/_can-sections"; // Lot 4D (CAN)
import type { TemplateId } from "@/lib/theme-engine/types";

const snap = JSON.parse(readFileSync(new URL("./fixtures/section-schemas.snapshot.json", import.meta.url), "utf8")) as {
  keys: string[];
  schemas: Record<string, unknown>;
  byTemplate: Record<string, string[]>;
  categories: string[];
};
const extra = new Set([...BLOG_SECTION_SCHEMAS, ...T3_SECTION_SCHEMAS, ...CAN_SECTION_SCHEMAS].map((s) => s.type as string));
const json = (v: unknown) => JSON.parse(JSON.stringify(v));

describe("section-schemas : découpage sans changement de valeur", () => {
  it("mêmes types, même ordre (sections ajoutées par d'autres équipes à la fin seulement)", () => {
    const keys = Object.keys(SECTION_SCHEMAS);
    expect(keys.slice(0, snap.keys.length)).toEqual(snap.keys);
    for (const k of keys.slice(snap.keys.length)) expect(extra.has(k)).toBe(true);
  });

  it("chaque schéma du cœur est strictement égal à l'instantané", () => {
    for (const k of snap.keys) expect(json(SECTION_SCHEMAS[k as keyof typeof SECTION_SCHEMAS])).toStrictEqual(snap.schemas[k]);
  });

  it("sectionsForTemplate identique pour chaque modèle", () => {
    for (const [t, types] of Object.entries(snap.byTemplate)) {
      expect(sectionsForTemplate(t as TemplateId).map((s) => s.type).filter((x) => !extra.has(x))).toEqual(types);
    }
  });

  it("bloc « Champ personnalisé » déclaré sur la fiche produit et la collection (changement voulu)", () => {
    for (const t of ["main-product", "main-collection"] as const) {
      const b = SECTION_SCHEMAS[t].blocks?.find((x) => x.type === "metafield");
      expect(b?.name).toBe("Champ personnalisé");
      expect(b?.settings.map((s) => ("id" in s ? s.id : null))).toEqual(["label", "value"]);
    }
  });

  it("SECTION_CATEGORIES identique", () => {
    expect([...SECTION_CATEGORIES]).toEqual(snap.categories);
  });

  it("un fichier par section du cœur, qui exporte `schema` du bon type", async () => {
    const dir = new URL("../src/lib/theme-engine/section-schemas/", import.meta.url);
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.startsWith("_"));
    for (const k of snap.keys) expect(files).toContain(`${k}.ts`);
    for (const f of files) {
      if (!snap.keys.includes(f.replace(/\.ts$/, ""))) continue; // sections d'autres équipes : enregistrées par leur propre liste
      const mod = (await import(/* @vite-ignore */ new URL(f, dir).href)) as { schema: { type: string } };
      expect(mod.schema.type).toBe(f.replace(/\.ts$/, ""));
      expect(SECTION_SCHEMAS[mod.schema.type as keyof typeof SECTION_SCHEMAS]).toBe(mod.schema);
    }
  });
});
