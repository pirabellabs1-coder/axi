"use client";

import { ChevronDown, Download, FileSpreadsheet, Sparkles } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { DropdownMenu, DropdownItem, DropdownLabel, DropdownSeparator } from "@/components/ui/dropdown-menu";

/**
 * Menu d'export de la liste. `exportHref = null` : fonction non incluse dans le plan (item désactivé + mention du plan).
 * L'export est un route handler (téléchargement) : navigation complète plutôt que <Link>.
 */
export function ExportMenu({ exportHref, planName, upgradeHref }: { exportHref: string | null; planName: string; upgradeHref: string }) {
  return (
    <DropdownMenu
      label="Exporter les commandes"
      trigger={(p) => (
        <button {...p} className={buttonClasses({ variant: "outline", size: "sm", className: "h-11 sm:h-9" })}>
          <Download className="size-4" aria-hidden /> Exporter
          <ChevronDown className="size-3.5 text-ink-muted" aria-hidden />
        </button>
      )}
    >
      <DropdownLabel>Liste filtrée</DropdownLabel>
      {exportHref ? (
        <DropdownItem href={exportHref} download icon={FileSpreadsheet} hint="CSV">
          Exporter en CSV
        </DropdownItem>
      ) : (
        <>
          <DropdownItem icon={FileSpreadsheet} disabled hint={`Plan ${planName}`}>
            Exporter en CSV
          </DropdownItem>
          <DropdownSeparator />
          <DropdownItem href={upgradeHref} icon={Sparkles}>
            Voir le plan {planName}
          </DropdownItem>
        </>
      )}
    </DropdownMenu>
  );
}
