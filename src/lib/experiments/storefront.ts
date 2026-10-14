import "server-only";
import { cookies, headers } from "next/headers";
import { isBotUserAgent } from "@/lib/theme-engine/audience";
import type { TemplateKey } from "@/lib/theme-engine/alternates";
import type { ThemeDocument } from "@/lib/theme-engine/types";
import type { RuntimeAssignment } from "@/components/experiments/experiment-runtime";
import { SOURCE_COOKIE, VISITOR_COOKIE } from "./assign";
import { freshVisitorId, resolveExperiments } from "./service";
import { readSignedVisitorId, signedVisitorCookie } from "./vid-signature";
import { detectFirstTouchSource } from "./visitor";

/**
 * Lot 4 §12 et §13 : branchement des tests A/B et des cookies de visiteur sur le rendu de la boutique.
 *
 *  - robots d'indexation : AUCUN test, aucun cookie (anti-cloaking et mesures propres) ;
 *  - aperçu de l'éditeur : aucun test (le marchand voit son thème, pas une variante) ;
 *  - l'identifiant visiteur est lu dans `axi_vid`, sinon tiré ici (128 bits) et persisté par l'îlot client :
 *    la variante affichée est donc déjà la variante définitive ;
 *  - la source de premier contact (`axi_src`, §12) est calculée et persistée de la même manière.
 */

export type ExperimentRuntimeData = {
  visitorId: string;
  /** Valeur SIGNÉE à poser dans `axi_vid` (`<id>.<hmac>`) : le client ne fait que la recopier. */
  visitorCookie: string;
  persistVisitor: boolean;
  source: string | null;
  persistSource: boolean;
  assignments: RuntimeAssignment[];
};

export async function applyExperiments(
  store: { id: string },
  opts: { doc: ThemeDocument; templateKey: TemplateKey; preview: boolean; searchParams?: Record<string, string | string[] | undefined> },
): Promise<{ doc: ThemeDocument; runtime: ExperimentRuntimeData | null }> {
  const [h, jar] = await Promise.all([headers(), cookies()]);
  if (isBotUserAgent(h.get("user-agent"))) return { doc: opts.doc, runtime: null };

  // Cookie SIGNÉ (mineur n° 11) : une valeur non signée par ce serveur — forgée, ou posée avant ce
  // correctif — est ignorée ; le visiteur reçoit un nouvel identifiant signé.
  const existingVid = readSignedVisitorId(jar.get(VISITOR_COOKIE)?.value);
  const visitorId = existingVid ?? freshVisitorId();
  const persistVisitor = !existingVid;
  const visitorCookie = signedVisitorCookie(visitorId);

  const existingSrc = jar.get(SOURCE_COOKIE)?.value;
  const persistSource = !existingSrc;
  const source = persistSource ? detectFirstTouchSource({ searchParams: opts.searchParams, referer: h.get("referer"), host: h.get("host") }) : null;

  if (opts.preview) return { doc: opts.doc, runtime: { visitorId, visitorCookie, persistVisitor, source, persistSource, assignments: [] } };

  const resolved = await resolveExperiments(store.id, { doc: opts.doc, templateKey: opts.templateKey, visitorId });
  return {
    doc: resolved.doc,
    runtime: {
      visitorId,
      visitorCookie,
      persistVisitor,
      source,
      persistSource,
      assignments: resolved.assignments.map((a) => ({ experimentId: a.experimentId, anchorId: a.anchorId })),
    },
  };
}
