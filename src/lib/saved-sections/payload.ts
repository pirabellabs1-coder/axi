/**
 * Charge utile d'une section enregistrée ou de bibliothèque (lot 4 §4) : une `SectionInstance` SANS identifiants.
 * Module pur (client et serveur, testé) :
 *  - `validateSectionPayload` : validation stricte par le moteur (`validateThemeDocument`) dans un document sonde,
 *    réglages manquants complétés ; sections obligatoires d'un modèle (fiche produit…) refusées ;
 *  - `toPayload` / `clonePayload` : retrait des identifiants, puis clonage avec de NOUVEAUX identifiants
 *    (fabrique `uniqueIdFactory(doc)` du moteur, pour l'unicité dans le document cible) ;
 *  - `payloadRefs` / `stripMissingRefs` : références (produit, collection, menu) vérifiées et retirées si absentes ;
 *  - `idReferences` : références d'identifiant présentes (interdites dans la bibliothèque).
 */
import { SECTION_SCHEMAS, sectionsForTemplate } from "@/lib/theme-engine/schemas";
import { fallbackThemeDocument, TEMPLATE_IDS } from "@/lib/theme-engine/editor-defaults";
import { validateThemeDocument } from "@/lib/theme-engine/validate";
import type { IdFactory } from "@/lib/theme-engine/operations";
import type { SectionAnimation, SectionInstance, SectionType, SectionVisibility, SettingField, Settings, TemplateId } from "@/lib/theme-engine/types";

export type SectionPayload = {
  type: SectionType;
  settings: Settings;
  blocks: { type: string; settings: Settings; disabled?: boolean }[];
  disabled?: boolean;
  animation?: SectionAnimation;
  visibility?: SectionVisibility;
};

export type PayloadCheck = { ok: true; payload: SectionPayload } | { ok: false; errors: string[] };

const PROBE_ID = "axi-probe-section";

/** Retire les identifiants (section et blocs). */
export function toPayload(section: SectionInstance): SectionPayload {
  return {
    type: section.type,
    settings: structuredClone(section.settings),
    blocks: section.blocks.map((b) => ({ type: b.type, settings: structuredClone(b.settings), ...(b.disabled ? { disabled: true } : {}) })),
    ...(section.disabled ? { disabled: true } : {}),
    ...(section.animation ? { animation: section.animation } : {}),
    ...(section.visibility ? { visibility: structuredClone(section.visibility) } : {}),
  };
}

/** Nouvelle instance avec de nouveaux identifiants (aucun identifiant de la charge n'est réutilisé). */
export function clonePayload(payload: SectionPayload, nextId: IdFactory): SectionInstance {
  const p = structuredClone(payload);
  return {
    id: nextId(p.type),
    type: p.type,
    settings: p.settings,
    blocks: p.blocks.map((b) => ({ id: nextId(b.type), type: b.type, settings: b.settings, ...(b.disabled ? { disabled: true } : {}) })),
    ...(p.disabled ? { disabled: true } : {}),
    ...(p.animation ? { animation: p.animation } : {}),
    ...(p.visibility ? { visibility: p.visibility } : {}),
  };
}

/** Modèles de page où ce type de section peut être inséré. */
export function compatibleTemplates(type: SectionType): TemplateId[] {
  return TEMPLATE_IDS.filter((t) => sectionsForTemplate(t).some((s) => s.type === type));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * Valide une charge (ou une SectionInstance : les identifiants fournis sont ignorés) et la renvoie normalisée.
 * Erreurs en français, prêtes à afficher.
 */
export function validateSectionPayload(raw: unknown): PayloadCheck {
  if (!isRecord(raw)) return { ok: false, errors: ["Section attendue (objet JSON)."] };
  const type = raw.type;
  if (typeof type !== "string" || !(type in SECTION_SCHEMAS)) return { ok: false, errors: ["Type de section inconnu."] };
  const schema = SECTION_SCHEMAS[type as SectionType];
  if (schema.required) return { ok: false, errors: [`« ${schema.name} » est propre à son modèle de page et ne peut pas être enregistrée.`] };
  const templates = compatibleTemplates(schema.type);
  if (!templates.length) return { ok: false, errors: [`« ${schema.name} » n'est disponible sur aucun modèle.`] };
  const template = templates.includes("home") ? "home" : templates[0];
  if (raw.blocks !== undefined && !Array.isArray(raw.blocks)) return { ok: false, errors: ["Blocs : liste attendue."] };
  const rawBlocks = (raw.blocks as unknown[] | undefined) ?? [];
  if (rawBlocks.length > 50) return { ok: false, errors: ["50 blocs maximum."] };

  const { id: _ignored, blocks: _b, ...rest } = raw;
  void _ignored;
  void _b;
  const probeSection = {
    ...rest,
    id: PROBE_ID,
    settings: isRecord(raw.settings) ? raw.settings : {},
    blocks: rawBlocks.map((b, i) => {
      if (!isRecord(b)) return b;
      const { id: _bid, ...brest } = b;
      void _bid;
      return { ...brest, id: `${PROBE_ID}-b${i}`, settings: isRecord(b.settings) ? b.settings : {} };
    }),
  };
  const doc = fallbackThemeDocument();
  const t = doc.templates[template];
  const probe = { ...doc, templates: { ...doc.templates, [template]: { order: [...t.order, PROBE_ID], sections: { ...t.sections, [PROBE_ID]: probeSection } } } };
  const res = validateThemeDocument(probe);
  if (!res.ok) {
    const errors = res.errors.filter((e) => e.path.includes(PROBE_ID)).map((e) => e.message);
    return { ok: false, errors: errors.length ? [...new Set(errors)].slice(0, 10) : [res.errors[0]?.message ?? "Section invalide."] };
  }
  const section = res.doc.templates[template].sections[PROBE_ID];
  if (!section) return { ok: false, errors: ["Section invalide."] };
  return { ok: true, payload: toPayload(section) };
}

/* ───────────── Références ───────────── */

export type PayloadRefs = { productIds: string[]; collectionIds: string[]; menuHandles: string[] };

function fieldsOf(payload: SectionPayload): { fields: SettingField[]; settings: Settings }[] {
  const schema = SECTION_SCHEMAS[payload.type];
  if (!schema) return [];
  const out = [{ fields: schema.settings, settings: payload.settings }];
  for (const b of payload.blocks) {
    const bs = schema.blocks?.find((x) => x.type === b.type);
    if (bs) out.push({ fields: bs.settings, settings: b.settings });
  }
  return out;
}

/** Références d'identifiants (produits, collections) et de menus présentes dans la charge. */
export function payloadRefs(payload: SectionPayload): PayloadRefs {
  const products = new Set<string>();
  const collections = new Set<string>();
  const menus = new Set<string>();
  for (const { fields, settings } of fieldsOf(payload)) {
    for (const f of fields) {
      if (!("id" in f)) continue;
      const v = settings[f.id];
      if (f.type === "product" && typeof v === "string" && v) products.add(v);
      if (f.type === "collection" && typeof v === "string" && v) collections.add(v);
      if (f.type === "product_list" && Array.isArray(v)) v.forEach((x) => typeof x === "string" && x && products.add(x));
      if (f.type === "menu" && typeof v === "string" && v) menus.add(v);
    }
  }
  return { productIds: [...products], collectionIds: [...collections], menuHandles: [...menus] };
}

/** Identifiants de boutique présents (produit, collection) : interdits dans la bibliothèque de la plateforme. */
export function idReferences(payload: SectionPayload): string[] {
  const r = payloadRefs(payload);
  return [...r.productIds, ...r.collectionIds];
}

/**
 * Retire les références absentes de la boutique (produit / collection : null ; liste : filtrée ; menu : vide).
 * `removed` = nombre de références retirées.
 */
export function stripMissingRefs(payload: SectionPayload, existing: { productIds: Set<string>; collectionIds: Set<string>; menuHandles: Set<string> }): { payload: SectionPayload; removed: number } {
  const next = structuredClone(payload);
  let removed = 0;
  for (const { fields, settings } of fieldsOf(next)) {
    for (const f of fields) {
      if (!("id" in f)) continue;
      const v = settings[f.id];
      if ((f.type === "product" || f.type === "collection") && typeof v === "string" && v) {
        const ok = f.type === "product" ? existing.productIds.has(v) : existing.collectionIds.has(v);
        if (!ok) {
          settings[f.id] = null;
          removed++;
        }
      }
      if (f.type === "product_list" && Array.isArray(v)) {
        const kept = v.filter((x) => typeof x === "string" && existing.productIds.has(x));
        removed += v.length - kept.length;
        settings[f.id] = kept;
      }
      if (f.type === "menu" && typeof v === "string" && v && !existing.menuHandles.has(v)) {
        settings[f.id] = "";
        removed++;
      }
    }
  }
  return { payload: next, removed };
}

/** Médias téléversés par une boutique (`/media/stores/…`) présents dans la charge (interdits dans la bibliothèque). */
export function storedMediaUrls(payload: SectionPayload): string[] {
  const out: string[] = [];
  const visit = (v: unknown) => {
    if (typeof v === "string") {
      if (v.startsWith("/media/") || v.startsWith("data:")) out.push(v);
    } else if (Array.isArray(v)) v.forEach(visit);
    else if (isRecord(v)) Object.values(v).forEach(visit);
  };
  visit(payload.settings);
  payload.blocks.forEach((b) => visit(b.settings));
  return out;
}
