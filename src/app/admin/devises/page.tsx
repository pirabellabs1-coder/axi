import type { Metadata } from "next";
import { getAdminContext } from "@/lib/admin/context";
import { db } from "@/lib/db";
import { PageHeader, Alert, EmptyState } from "@/components/ui/misc";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TH, TBody, TR, TD } from "@/components/ui/table";
import { formatDateTime } from "@/lib/utils";
import { FX_MAX_AGE_MS } from "@/lib/currency/convert";
import { FxRateForm, FxRefreshButton } from "./fx-forms";

export const metadata: Metadata = { title: "Taux de change" };

/** Taux automatique (BCE) de plus de 72 h : plus utilisé par les vitrines. */
function isStale(source: string, fetchedAt: Date): boolean {
  return source === "ECB" && Date.now() - fetchedAt.getTime() > FX_MAX_AGE_MS;
}

const SOURCE_LABEL: Record<string, string> = { ECB: "BCE", BCEAO_FIXED: "Parité fixe BCEAO", manual: "Manuel" };

/** Lot 2 : taux plateforme (BCE quotidienne, parités fixes, taux manuels). Écriture : `settings.manage`, audit `admin.fx.*`. */
export default async function AdminFxRates() {
  const ctx = await getAdminContext();
  const canEdit = ctx.can("settings.manage");
  const rows = await db.exchangeRate.findMany({ orderBy: [{ base: "asc" }, { quote: "asc" }], take: 300 });

  return (
    <>
      <PageHeader
        title="Taux de change"
        description="Taux utilisés pour afficher les prix des boutiques dans d'autres devises. Les paiements restent encaissés dans la devise de la boutique. Rafraîchissement automatique chaque jour (BCE) ; un taux automatique de plus de 72 h n'est plus utilisé."
        actions={canEdit ? <FxRefreshButton /> : undefined}
      />
      {!canEdit && (
        <Alert tone="info" className="mb-6" title="Lecture seule">
          Les taux sont modifiables par les administrateurs disposant de la gestion des paramètres.
        </Alert>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Card as="section" aria-labelledby="fx-rates">
          <CardHeader title={<span id="fx-rates">Taux enregistrés</span>} description={`${rows.length} taux`} />
          {rows.length === 0 ? (
            <div className="px-5 pb-5 sm:px-6">
              <EmptyState title="Aucun taux" description="Lancez un rafraîchissement pour enregistrer les parités fixes et les taux de la BCE." />
            </div>
          ) : (
            <Table bare minWidth={520}>
              <THead>
                <tr>
                  <TH>Paire</TH>
                  <TH align="right">Taux</TH>
                  <TH>Source</TH>
                  <TH>Mis à jour</TH>
                </tr>
              </THead>
              <TBody>
                {rows.map((r) => {
                  const stale = isStale(r.source, r.fetchedAt);
                  return (
                    <TR key={r.id}>
                      <TD className="font-medium">
                        {r.base} / {r.quote}
                      </TD>
                      <TD align="right" className="font-mono tabular">
                        1 {r.base} = {r.rate.toString()} {r.quote}
                      </TD>
                      <TD>
                        <Badge tone={r.source === "manual" ? "info" : "neutral"}>{SOURCE_LABEL[r.source] ?? r.source}</Badge>
                      </TD>
                      <TD className="text-ink-muted">
                        {formatDateTime(r.fetchedAt)}
                        {stale && (
                          <Badge tone="warning" className="ml-2">
                            Plus de 72 h
                          </Badge>
                        )}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </Card>
        <Card as="section" aria-labelledby="fx-manual">
          <CardHeader title={<span id="fx-manual">Taux manuel</span>} description="Pour une devise absente de la BCE (naira, cedi, dirham…). Les parités fixes FCFA / euro ne sont pas modifiables. Un taux manuel ne périme pas." />
          <div className="px-5 pb-5 pt-3 sm:px-6">
            <FxRateForm canEdit={canEdit} />
          </div>
        </Card>
      </div>
    </>
  );
}
