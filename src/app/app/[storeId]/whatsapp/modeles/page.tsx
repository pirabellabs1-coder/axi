import type { Metadata } from "next";
import Link from "next/link";
import { FileText, ShieldCheck, Gauge, Plus, ArrowLeft } from "lucide-react";
import { getStoreContext } from "@/lib/auth/permissions";
import { PLANS } from "@/config/plans";
import { loadWabaCreds, listTemplates, phoneHealth, type WaTemplate, type PhoneHealth } from "@/lib/whatsapp/templates";
import { deleteWhatsappTemplate } from "@/lib/whatsapp/actions";
import { PageHeader, EmptyState, Alert } from "@/components/ui/misc";
import { Card, CardBody, CardHeader, Bezel } from "@/components/ui/card";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { ButtonLink, buttonClasses } from "@/components/ui/button";
import { ConfirmActionButton } from "@/components/app/action-controls";
import { PlanGate } from "@/components/app/plan-gate";
import { TemplateForm } from "./template-form";

export const metadata: Metadata = { title: "Modèles de messages WhatsApp" };

const STATUS_TONE: Record<string, BadgeTone> = { APPROVED: "success", PENDING: "sun", REJECTED: "danger", PAUSED: "neutral", DISABLED: "neutral" };
const STATUS_LABEL: Record<string, string> = { APPROVED: "Approuvé", PENDING: "En validation", REJECTED: "Rejeté", PAUSED: "Suspendu", DISABLED: "Désactivé" };
const CATEGORY_LABEL: Record<string, string> = { MARKETING: "Marketing", UTILITY: "Utilitaire", AUTHENTICATION: "Authentification" };
const QUALITY_TONE: Record<string, BadgeTone> = { GREEN: "success", YELLOW: "sun", RED: "danger" };
const QUALITY_LABEL: Record<string, string> = { GREEN: "Bonne", YELLOW: "Moyenne", RED: "Faible", UNKNOWN: "Inconnue" };

export default async function TemplatesPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const ctx = await getStoreContext(storeId, "store.settings");
  const store = ctx.store;
  const plan = PLANS[ctx.planId];
  const canManage = ctx.can("integrations.manage");

  const backLink = (
    <Link href={`/app/${store.id}/whatsapp`} className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-ink">
      <ArrowLeft className="size-4" aria-hidden /> Retour à WhatsApp
    </Link>
  );

  if (!plan.features.whatsappApi) {
    return (
      <>
        <div className="mb-4">{backLink}</div>
        <PageHeader title="Modèles de messages" description="Les modèles permettent d'écrire à vos clients au-delà de la fenêtre de 24 h (confirmations, suivis, promotions)." />
        <PlanGate
          storeId={store.id}
          feature="whatsappApi"
          description="Créez et gérez vos modèles de messages WhatsApp validés par Meta pour notifier vos clients à tout moment."
          unlocks={["Modèles utilitaires et marketing", "Statut de validation Meta en direct", "Santé et note de qualité du numéro"]}
        />
      </>
    );
  }

  const creds = await loadWabaCreds(store.id);

  if ("error" in creds) {
    return (
      <>
        <div className="mb-4">{backLink}</div>
        <PageHeader title="Modèles de messages" description="Les modèles permettent d'écrire à vos clients au-delà de la fenêtre de 24 h." />
        <EmptyState
          icon={FileText}
          title="Connectez d'abord votre numéro"
          description="Les modèles de messages sont gérés sur votre compte WhatsApp Business. Connectez votre numéro pour les créer et suivre leur validation."
          action={<ButtonLink href={`/app/${store.id}/whatsapp`}>Connecter WhatsApp</ButtonLink>}
        />
      </>
    );
  }

  // Les appels Meta peuvent échouer (jeton expiré, réseau) : on dégrade proprement sans casser la page.
  let templates: WaTemplate[] = [];
  let templatesError: string | null = null;
  let health: PhoneHealth | null = null;
  const [tplRes, healthRes] = await Promise.allSettled([listTemplates(creds), phoneHealth(creds)]);
  if (tplRes.status === "fulfilled") templates = tplRes.value;
  else templatesError = tplRes.reason instanceof Error ? tplRes.reason.message : "Lecture des modèles impossible.";
  if (healthRes.status === "fulfilled") health = healthRes.value;

  return (
    <>
      <div className="mb-4">{backLink}</div>
      <PageHeader
        title="Modèles de messages"
        description="Écrivez à vos clients au-delà de la fenêtre de 24 h. Chaque modèle est validé par Meta avant de pouvoir être envoyé."
      />

      {health && (
        <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Bezel coreClassName="flex items-center gap-3 p-4">
            <ShieldCheck className="size-5 shrink-0 text-primary" aria-hidden />
            <div>
              <p className="text-xs text-ink-muted">Nom vérifié</p>
              <p className="text-[15px] font-semibold text-ink">{health.verifiedName ?? "—"}</p>
            </div>
          </Bezel>
          <Bezel coreClassName="flex items-center gap-3 p-4">
            <Gauge className="size-5 shrink-0 text-primary" aria-hidden />
            <div>
              <p className="text-xs text-ink-muted">Qualité du numéro</p>
              <Badge tone={QUALITY_TONE[health.qualityRating ?? "UNKNOWN"] ?? "neutral"} dot>
                {QUALITY_LABEL[health.qualityRating ?? "UNKNOWN"] ?? health.qualityRating}
              </Badge>
            </div>
          </Bezel>
          <Bezel coreClassName="flex items-center gap-3 p-4">
            <FileText className="size-5 shrink-0 text-primary" aria-hidden />
            <div>
              <p className="text-xs text-ink-muted">Numéro</p>
              <p className="text-[15px] font-semibold tabular text-ink">{health.displayPhoneNumber ?? "—"}</p>
            </div>
          </Bezel>
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section aria-labelledby="list-title">
          <div className="mb-4 flex items-center justify-between gap-2">
            <h2 id="list-title" className="text-lg font-semibold tracking-[-0.02em] text-ink">Vos modèles</h2>
            {templates.length > 0 && <p className="text-sm text-ink-muted">{templates.length} modèle{templates.length > 1 ? "s" : ""}</p>}
          </div>
          {templatesError ? (
            <Alert tone="danger" title="Lecture des modèles impossible">{templatesError}</Alert>
          ) : templates.length === 0 ? (
            <EmptyState icon={FileText} title="Aucun modèle" description="Créez votre premier modèle avec le formulaire. Il sera envoyé à Meta pour validation." />
          ) : (
            <Table minWidth={640}>
              <THead>
                <tr>
                  <TH>Nom</TH>
                  <TH>Catégorie</TH>
                  <TH>Langue</TH>
                  <TH>Statut</TH>
                  {canManage && <TH>Action</TH>}
                </tr>
              </THead>
              <TBody>
                {templates.map((t) => (
                  <TR key={`${t.name}:${t.language}`}>
                    <TD className="font-mono text-xs">{t.name}</TD>
                    <TD>{CATEGORY_LABEL[t.category] ?? t.category}</TD>
                    <TD className="tabular uppercase">{t.language}</TD>
                    <TD>
                      <Badge tone={STATUS_TONE[t.status] ?? "neutral"} dot>{STATUS_LABEL[t.status] ?? t.status}</Badge>
                    </TD>
                    {canManage && (
                      <TD>
                        <ConfirmActionButton
                          title="Supprimer ce modèle ?"
                          description={`Le modèle « ${t.name} » sera supprimé de votre compte WhatsApp Business.`}
                          confirmLabel="Supprimer"
                          action={() => deleteWhatsappTemplate(store.id, t.name)}
                          className={buttonClasses({ variant: "ghost", size: "sm", className: "text-danger hover:bg-danger-soft" })}
                        >
                          Supprimer
                        </ConfirmActionButton>
                      </TD>
                    )}
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </section>

        {canManage ? (
          <Card>
            <CardHeader
              title={
                <span className="inline-flex items-center gap-2">
                  <Plus className="size-4 text-primary" aria-hidden /> Nouveau modèle
                </span>
              }
              description="Texte simple. Les variables {{1}}, {{2}}… sont remplacées à l'envoi."
            />
            <CardBody>
              <TemplateForm storeId={store.id} />
            </CardBody>
          </Card>
        ) : (
          <Alert tone="info" title="Lecture seule">Votre rôle ne permet pas de créer ou supprimer des modèles.</Alert>
        )}
      </div>
    </>
  );
}
