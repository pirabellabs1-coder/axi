import type { Metadata } from "next";
import { LibraryBig } from "lucide-react";
import { getAdminContext } from "@/lib/admin/context";
import { db } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { SECTION_SCHEMAS } from "@/lib/theme-engine/schemas";
import type { SectionType } from "@/lib/theme-engine/types";
import { effectiveMinPlan } from "@/lib/section-library/rules";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { LibraryItemDialogButton, LibraryRowActions, type LibraryAdminDTO } from "./library-controls";

export const metadata: Metadata = { title: "Bibliothèque de sections" };

export default async function AdminLibraryPage() {
  const ctx = await getAdminContext();
  const canEdit = ctx.can("settings.manage");
  const rows = await db.sectionLibraryItem.findMany({ orderBy: [{ position: "asc" }, { createdAt: "asc" }], take: 300 });
  const items: LibraryAdminDTO[] = rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description ?? "",
    category: r.category,
    tags: r.tags,
    premium: r.premium,
    minPlan: r.minPlan,
    published: r.published,
    previewUrl: r.previewUrl,
    sectionType: r.sectionType,
    payloadJson: JSON.stringify(r.payload, null, 2),
  }));
  const published = rows.filter((r) => r.published).length;

  return (
    <>
      <PageHeader
        title="Bibliothèque de sections"
        description={`Compositions prêtes à l'emploi proposées dans l'éditeur de thème de chaque boutique. ${published} publiée${published > 1 ? "s" : ""} sur ${rows.length}.`}
        actions={<LibraryItemDialogButton canEdit={canEdit} />}
      />
      {rows.length === 0 ? (
        <EmptyState icon={LibraryBig} title="Bibliothèque vide" description="Ajoutez une section depuis son JSON (exporté de l'éditeur ou écrit à la main). Elle reste privée jusqu'à sa publication." action={<LibraryItemDialogButton canEdit={canEdit} />} />
      ) : (
        <Table minWidth={900}>
          <THead>
            <TR>
              <TH>Élément</TH>
              <TH>Section</TH>
              <TH>Catégorie</TH>
              <TH>Accès</TH>
              <TH>État</TH>
              <TH align="right"><span className="sr-only">Actions</span></TH>
            </TR>
          </THead>
          <TBody>
            {items.map((it, i) => {
              const required = effectiveMinPlan({ premium: it.premium, minPlan: it.minPlan });
              return (
                <TR key={it.id}>
                  <TD>
                    <div className="flex items-center gap-3">
                      <div className="h-12 w-20 shrink-0 overflow-hidden rounded-[10px] bg-surface-2 ring-1 ring-line">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {it.previewUrl && <img src={it.previewUrl} alt="" className="size-full object-cover" />}
                      </div>
                      <div className="min-w-0">
                        <span className="font-medium text-ink">{it.name}</span>
                        <span className="block font-mono text-xs text-ink-muted">{it.slug}</span>
                      </div>
                    </div>
                  </TD>
                  <TD>{SECTION_SCHEMAS[it.sectionType as SectionType]?.name ?? it.sectionType}</TD>
                  <TD>{it.category}</TD>
                  <TD>
                    {it.premium ? <Badge tone="accent">Premium</Badge> : <Badge>Gratuit</Badge>}
                    {required !== "FREE" && <span className="mt-1 block text-xs text-ink-muted">Dès {PLANS[required].name}</span>}
                  </TD>
                  <TD>{it.published ? <Badge tone="success" dot>Publié</Badge> : <Badge>Brouillon</Badge>}</TD>
                  <TD align="right">
                    <LibraryRowActions canEdit={canEdit} item={it} first={i === 0} last={i === items.length - 1} />
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}
      {!canEdit && <p className="mt-4 text-sm text-ink-muted">Lecture seule : la bibliothèque est gérée avec la permission « Paramètres plateforme ».</p>}
    </>
  );
}
