import { SECTION_RENDERERS } from "@/lib/theme-engine/render-registry";
import { resolveTemplate } from "@/lib/theme-engine/alternates";
import { evaluateVisibility, type AudienceContext } from "@/lib/theme-engine/audience";
import { resolveSection } from "@/lib/theme-engine/dynamic-sources";
import { effectiveMotion, type MotionEnv } from "@/lib/theme-engine/motion";
import type { SectionInstance, TemplateId, ThemeDocument } from "@/lib/theme-engine/types";
import type { RenderData } from "@/lib/storefront/render-types";
import type { RenderCtx } from "./render-context";
import { dynamicContextFromData } from "./dynamic-context";

/**
 * Rend les sections d'un modèle dans l'ordre du document.
 * Lot 4 :
 *  - modèle alternatif : `alternates[template][templateSuffix] ?? templates[template]` (§6) ;
 *  - visibilité par audience évaluée sur `audience` (§12 ; absent = audience par défaut : sections sans règle seulement
 *    garanties visibles, les règles sont évaluées contre un visiteur anonyme en accès direct) ;
 *  - sources dynamiques résolues avant le composant ; `hide_if_empty` masque la section si une source est vide (§5) ;
 *  - animations effectives (§2), jamais sur la première section rendue (LCP).
 */
export function TemplateRenderer({
  doc,
  template,
  data,
  preview = false,
  templateSuffix,
  audience,
  motionEnv,
}: {
  doc: ThemeDocument;
  template: TemplateId;
  data: RenderData;
  preview?: boolean;
  templateSuffix?: string | null;
  audience?: AudienceContext | null;
  motionEnv?: MotionEnv;
}) {
  const { template: tpl } = resolveTemplate(doc, template, templateSuffix);
  const base = `/s/${data.store.slug}${data.store.localePrefix ?? ""}`; // lot 2 : segment de langue des liens
  const motion = effectiveMotion(doc.settings.motion, motionEnv);
  const aud: AudienceContext = audience ?? { customer: ["anonymous"], source: "direct", now: new Date(data.now) };
  const dyn = dynamicContextFromData(data);

  const sections: SectionInstance[] = [];
  for (const id of tpl.order) {
    const raw = tpl.sections[id];
    if (!raw || raw.disabled || !SECTION_RENDERERS[raw.type]) continue;
    if (!evaluateVisibility(raw.visibility, aud)) continue;
    const { section, hidden } = resolveSection(raw, dyn);
    if (hidden) continue;
    sections.push(section);
  }

  return (
    <>
      {sections.map((section, i) => {
        const Comp = SECTION_RENDERERS[section.type];
        const ctx: RenderCtx = { doc, settings: doc.settings, data, template, base, preview, first: i === 0, motion };
        return <Comp key={section.id} section={section} ctx={ctx} />;
      })}
    </>
  );
}
