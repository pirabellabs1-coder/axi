import Link from "next/link";
import { SlidersHorizontal } from "lucide-react";
import { db } from "@/lib/db";
import { loadStoreContext, type Capability } from "@/lib/auth/permissions";
import { getOwnerMetafields } from "@/lib/metafields/read";
import { metafieldsEnabled, ownerExists } from "@/lib/metafields/server";
import { OWNER_LABELS, type MetafieldOwnerType } from "@/lib/metafields/types";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PlanGate } from "@/components/app/plan-gate";
import { MetafieldsEditorClient } from "./metafields-editor-client";

/**
 * Éditeur générique des champs personnalisés d'un élément (Server Component).
 * Insertion en UNE ligne dans une page d'édition, hors de tout <form> existant :
 *   <MetafieldsEditor storeId={ctx.store.id} ownerType="PRODUCT" ownerId={product.id} />
 * Vérifie la boutique, le rôle (capacité du type d'élément), le propriétaire et le plan ; ne rend rien si
 * l'utilisateur n'a pas le droit de modifier l'élément.
 */

const CAPABILITY: Record<MetafieldOwnerType, Capability> = {
  PRODUCT: "products.manage",
  VARIANT: "products.manage",
  COLLECTION: "products.manage",
  CUSTOMER: "customers.manage",
  ORDER: "orders.manage",
  STORE: "store.settings",
  PAGE: "store.settings",
  BLOG_POST: "store.settings",
};

export async function MetafieldsEditor({ storeId, ownerType, ownerId, className }: { storeId: string; ownerType: MetafieldOwnerType; ownerId: string; className?: string }) {
  const ctx = await loadStoreContext(storeId);
  if (!ctx || !ctx.can(CAPABILITY[ownerType])) return null;
  if (!(await ownerExists(db, ctx.store.id, ownerType, ownerId))) return null;
  const enabled = metafieldsEnabled(ctx.planId);
  const data = await getOwnerMetafields(ctx.store.id, ownerType, ownerId);
  const manageHref = `/app/${ctx.store.id}/parametres/champs?type=${ownerType}`;
  const canManage = ctx.can("theme.manage");

  if (!enabled && data.definitions.length === 0) {
    return (
      <div className={className ?? "mt-6"}>
        <PlanGate storeId={ctx.store.id} feature="metafields" compact description="Ajoutez vos propres informations (matière, origine, entretien…) et affichez-les dans votre boutique, à partir du plan Starter." />
      </div>
    );
  }

  if (data.definitions.length === 0) {
    return (
      <Card as="section" className={className ?? "mt-6"} aria-labelledby={`mf-${ownerId}-title`}>
        <CardHeader
          title={<span id={`mf-${ownerId}-title`} className="inline-flex items-center gap-2"><SlidersHorizontal className="size-4 text-primary" aria-hidden /> Champs personnalisés</span>}
          description={`Aucun champ défini pour les ${OWNER_LABELS[ownerType].toLowerCase()}. Créez par exemple « Matière » ou « Origine » pour enrichir vos fiches.`}
        />
        {canManage && (
          <CardBody>
            <Link href={manageHref} className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline">
              Créer un champ personnalisé
            </Link>
          </CardBody>
        )}
      </Card>
    );
  }

  const needsProducts = data.definitions.some((d) => d.type === "product_reference");
  const needsCollections = data.definitions.some((d) => d.type === "collection_reference");
  const [products, collections] = await Promise.all([
    needsProducts ? db.product.findMany({ where: { storeId: ctx.store.id, status: { not: "ARCHIVED" } }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 300 }) : [],
    needsCollections ? db.category.findMany({ where: { storeId: ctx.store.id }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 300 }) : [],
  ]);
  // Une référence actuelle absente des 300 premiers reste sélectionnable.
  const withCurrent = (list: { id: string; name: string }[], type: "product_reference" | "collection_reference") => {
    const ids = new Set(list.map((x) => x.id));
    const current = data.definitions.filter((d) => d.type === type).map((d) => data.values[d.id]).filter((v): v is string => typeof v === "string");
    const extra = current.filter((id) => !ids.has(id) && data.refTitles[id]).map((id) => ({ id, name: data.refTitles[id] }));
    return [...list, ...extra];
  };

  return (
    <MetafieldsEditorClient
      className={className ?? "mt-6"}
      storeId={ctx.store.id}
      ownerType={ownerType}
      ownerId={ownerId}
      currency={ctx.store.currency}
      definitions={data.definitions}
      initialValues={data.values}
      products={needsProducts ? withCurrent(products, "product_reference") : []}
      collections={needsCollections ? withCurrent(collections, "collection_reference") : []}
      manageHref={canManage ? manageHref : null}
      locked={!enabled}
    />
  );
}
