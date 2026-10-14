import type { Metadata } from "next";
import { CheckCircle2, CircleDashed } from "lucide-react";
import { getAdminContext } from "@/lib/admin/context";
import { getManualPaymentDetails, getMarketplaceMaintenance, integrationStatuses } from "@/lib/admin/settings";
import { PageHeader, Alert } from "@/components/ui/misc";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MaintenanceForm, ManualPaymentForm } from "@/components/admin/settings-forms";

export const metadata: Metadata = { title: "Paramètres" };

export default async function AdminSettings() {
  const ctx = await getAdminContext();
  const canEdit = ctx.can("settings.manage");
  const [maintenance, manual] = await Promise.all([getMarketplaceMaintenance(), getManualPaymentDetails()]);
  const groups = integrationStatuses();
  const missing = groups.flatMap((g) => g.items).filter((i) => !i.configured).length;

  return (
    <>
      <PageHeader title="Paramètres" description="État des intégrations, coordonnées de paiement manuel et maintenance de la marketplace. Aucun secret n'est jamais affiché : seulement sa présence." />
      {!canEdit && <Alert tone="info" className="mb-6" title="Lecture seule">Les paramètres sont modifiables par les super-administrateurs.</Alert>}

      <section aria-labelledby="integrations" className="mb-8">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="integrations" className="text-[15px] font-semibold tracking-tight text-ink">Intégrations</h2>
            <p className="mt-0.5 text-sm text-ink-muted">Lues depuis les variables d&apos;environnement du serveur (voir docs/DEPLOIEMENT.md).</p>
          </div>
          {missing > 0 ? <Badge tone="warning">{missing} à configurer</Badge> : <Badge tone="success" dot>Tout est configuré</Badge>}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {groups.map((g) => (
            <Card key={g.group} as="section" aria-label={g.group}>
              <CardHeader title={g.group} />
              <ul className="mt-2 divide-y divide-line border-t border-line">
                {g.items.map((i) => (
                  <li key={i.key} className="flex items-start gap-3 px-5 py-3.5 sm:px-6">
                    {i.configured ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden /> : <CircleDashed className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />}
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                        {i.label}
                        {i.mode && <span className="rounded-full bg-surface-2 px-2 py-px text-[11px] font-medium text-ink-muted ring-1 ring-inset ring-line">{i.mode}</span>}
                      </p>
                      <p className="mt-0.5 text-[13px] text-ink-muted">{i.detail}</p>
                      {i.vars.length > 0 && <p className="mt-1 font-mono text-[11px] text-ink-faint [overflow-wrap:anywhere]">{i.vars.join(" · ")}</p>}
                    </div>
                    <span className="shrink-0 text-xs font-medium">{i.configured ? <span className="text-primary">Configuré</span> : <span className="text-warning">Manquant</span>}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card as="section" aria-labelledby="manual">
          <CardHeader
            title={<span id="manual">Paiement manuel des abonnements</span>}
            description={manual.source === "environment" ? "Valeurs actuelles lues depuis l'environnement (PLATFORM_MOMO_NUMBER, PLATFORM_BANK_DETAILS). Enregistrer ici les remplace." : "Coordonnées enregistrées dans la console."}
          />
          <div className="px-5 pb-5 pt-3 sm:px-6">
            <ManualPaymentForm initial={{ momoNumber: manual.momoNumber, momoName: manual.momoName, bankDetails: manual.bankDetails, instructions: manual.instructions }} canEdit={canEdit} />
          </div>
        </Card>
        <Card as="section" aria-labelledby="maintenance">
          <CardHeader title={<span id="maintenance">Maintenance de la marketplace</span>} description="Masque la liste publique des boutiques. Les boutiques restent accessibles par leur propre lien." />
          <div className="px-5 pb-5 pt-3 sm:px-6">
            <MaintenanceForm enabled={maintenance.enabled} message={maintenance.message} canEdit={canEdit} />
          </div>
        </Card>
      </div>
    </>
  );
}
