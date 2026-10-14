import type { Metadata } from "next";
import { SlidersHorizontal } from "lucide-react";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { listMetafieldDefinitions } from "@/lib/metafields/read";
import { definitionLimit, metafieldsEnabled } from "@/lib/metafields/server";
import { isMetafieldOwner, METAFIELD_OWNERS, METAFIELD_TYPE_META, OWNER_LABELS, ownerCanBePublic, type MetafieldOwnerType } from "@/lib/metafields/types";
import { PageHeader, EmptyState, Alert } from "@/components/ui/misc";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Segmented } from "@/components/ui/segmented";
import { PlanGate } from "@/components/app/plan-gate";
import { DefinitionDialogButton, DefinitionRowActions } from "./definitions-manager";

export const metadata: Metadata = { title: "Champs personnalisés" };

/** Types d'éléments proposés dans l'écran (les variantes, commandes et articles restent accessibles par l'API et le MCP). */
const TABS: MetafieldOwnerType[] = ["PRODUCT", "COLLECTION", "PAGE", "CUSTOMER", "VARIANT", "ORDER", "STORE", "BLOG_POST"];

export default async function MetafieldDefinitionsPage({ params, searchParams }: { params: Promise<{ storeId: string }>; searchParams: Promise<{ type?: string }> }) {
  const { storeId } = await params;
  const sp = await searchParams;
  const ctx = await getStoreContext(storeId, "theme.manage");
  const base = `/app/${ctx.store.id}`;
  const owner: MetafieldOwnerType = isMetafieldOwner(sp.type) ? sp.type : "PRODUCT";
  const enabled = metafieldsEnabled(ctx.planId);
  const limit = definitionLimit(ctx.planId);

  const [all, counts] = await Promise.all([
    listMetafieldDefinitions(ctx.store.id),
    db.metafieldValue.groupBy({ by: ["definitionId"], where: { storeId: ctx.store.id }, _count: { _all: true } }),
  ]);
  const usage = new Map(counts.map((c) => [c.definitionId, c._count._all]));
  const defs = all.filter((d) => d.ownerType === owner);
  const back = { href: `${base}/parametres`, label: "Paramètres" };
  const canCreate = enabled && (limit === null || all.length < limit);

  if (!enabled && all.length === 0) {
    return (
      <>
        <PageHeader back={back} title="Champs personnalisés" />
        <PlanGate
          storeId={ctx.store.id}
          feature="metafields"
          unlocks={["Vos propres informations sur les produits, collections, pages et clients", "Affichage en boutique par sources dynamiques", "Import et export dans le CSV produit", "10 champs avec Starter, 100 avec Business"]}
        />
      </>
    );
  }

  const tabCounts = new Map<MetafieldOwnerType, number>();
  for (const d of all) tabCounts.set(d.ownerType, (tabCounts.get(d.ownerType) ?? 0) + 1);

  return (
    <>
      <PageHeader
        back={back}
        title="Champs personnalisés"
        description={`Ajoutez vos propres informations (matière, origine, entretien…) aux produits, collections, pages et clients. ${limit === null ? `${all.length} champ${all.length > 1 ? "s" : ""}, sans limite.` : `${all.length} sur ${limit} champs de votre plan.`}`}
        actions={<DefinitionDialogButton storeId={ctx.store.id} ownerType={owner} disabled={!canCreate} />}
      />

      {!enabled && (
        <Alert tone="warning" className="mb-5">
          Votre plan n&apos;inclut plus les champs personnalisés : les champs existants restent affichés en boutique, mais vous ne pouvez plus en créer ni modifier leurs valeurs.
        </Alert>
      )}
      {enabled && limit !== null && all.length >= limit && (
        <PlanGate storeId={ctx.store.id} feature="metafields" plan={ctx.planId === "STARTER" ? "BUSINESS" : "SCALE"} compact limit={{ label: "champs", used: all.length, max: limit }} className="mb-5" />
      )}

      <div className="mb-5">
        <Segmented
          label="Type d'élément"
          value={owner}
          options={TABS.filter((t) => METAFIELD_OWNERS.includes(t)).map((t) => ({ value: t, label: OWNER_LABELS[t], href: `${base}/parametres/champs?type=${t}`, count: tabCounts.get(t) }))}
        />
      </div>

      {!ownerCanBePublic(owner) && (
        <p className="mb-4 max-w-[60ch] text-sm text-ink-muted">
          Les champs des {OWNER_LABELS[owner].toLowerCase()} restent privés : ils ne sont jamais affichés dans la boutique.
        </p>
      )}

      {defs.length === 0 ? (
        <EmptyState
          icon={SlidersHorizontal}
          title={`Aucun champ pour les ${OWNER_LABELS[owner].toLowerCase()}`}
          description={owner === "PRODUCT" ? "Exemple : « Matière » (texte), « Fait main » (oui / non), « Poids » (poids). Ils apparaissent ensuite dans la fiche de chaque produit." : "Créez un champ : il apparaîtra dans le formulaire de chaque élément."}
          action={<DefinitionDialogButton storeId={ctx.store.id} ownerType={owner} disabled={!canCreate} />}
        />
      ) : (
        <Table minWidth={760}>
          <THead>
            <TR>
              <TH>Champ</TH>
              <TH>Type</TH>
              <TH>Boutique</TH>
              <TH>Formulaire</TH>
              <TH align="right">Valeurs</TH>
              <TH align="right"><span className="sr-only">Actions</span></TH>
            </TR>
          </THead>
          <TBody>
            {defs.map((d, i) => (
              <TR key={d.id}>
                <TD>
                  <span className="font-medium text-ink">{d.name}</span>
                  <span className="block font-mono text-xs text-ink-muted">{d.namespace}.{d.key}</span>
                </TD>
                <TD>{METAFIELD_TYPE_META[d.type].label}</TD>
                <TD>{d.storefrontVisible ? <Badge tone="success" dot>Visible</Badge> : <Badge>Privé</Badge>}</TD>
                <TD>{d.pinnedPosition !== null ? <Badge tone="primary">Épinglé</Badge> : <span className="text-ink-muted">Replié</span>}</TD>
                <TD align="right"><span className="tabular-nums">{usage.get(d.id) ?? 0}</span></TD>
                <TD align="right">
                  <DefinitionRowActions
                    storeId={ctx.store.id}
                    definition={d}
                    values={usage.get(d.id) ?? 0}
                    canEdit={enabled}
                    first={d.pinnedPosition !== null && i === 0}
                    last={d.pinnedPosition !== null && (i === defs.length - 1 || defs[i + 1]?.pinnedPosition === null)}
                  />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </>
  );
}
