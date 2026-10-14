"use client";

import { ChevronDown, Download, LayoutGrid, Upload, Boxes } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { DropdownMenu, DropdownItem, DropdownLabel, DropdownSeparator } from "@/components/ui/dropdown-menu";

/** Actions secondaires de la liste produits : collections, inventaire, import et export CSV. */
export function ProductsActionsMenu({
  storeId,
  canImport,
  canExport,
  showExport,
  importPlan,
  exportPlan,
  stockTracking,
}: {
  storeId: string;
  canImport: boolean;
  canExport: boolean;
  showExport: boolean;
  importPlan: string;
  exportPlan: string;
  stockTracking: boolean;
}) {
  const base = `/app/${storeId}/produits`;
  return (
    <DropdownMenu
      label="Actions du catalogue"
      trigger={(p) => (
        <button {...p} className={buttonClasses({ variant: "outline", size: "md" })}>
          Actions <ChevronDown className="size-4 text-ink-muted" aria-hidden />
        </button>
      )}
    >
      <DropdownLabel>Catalogue</DropdownLabel>
      <DropdownItem icon={LayoutGrid} href={`/app/${storeId}/collections`}>
        Collections
      </DropdownItem>
      {stockTracking && (
        <DropdownItem icon={Boxes} href={`${base}/stock`}>
          Inventaire par variante
        </DropdownItem>
      )}
      <DropdownSeparator />
      <DropdownLabel>Fichiers CSV</DropdownLabel>
      <DropdownItem icon={Upload} href={canImport ? `${base}/import` : undefined} disabled={!canImport} hint={canImport ? undefined : `Plan ${importPlan}`}>
        Importer des produits
      </DropdownItem>
      {showExport && (
        <DropdownItem icon={Download} href={canExport ? `${base}/export` : undefined} download={canExport ? true : undefined} disabled={!canExport} hint={canExport ? undefined : `Plan ${exportPlan}`}>
          Exporter le catalogue
        </DropdownItem>
      )}
      {(!canImport || (showExport && !canExport)) && (
        <>
          <DropdownSeparator />
          <DropdownItem href={`/app/${storeId}/abonnement#plans`}>Voir les plans</DropdownItem>
        </>
      )}
    </DropdownMenu>
  );
}
