"use client";

import { Send, Ban, Trash2 } from "lucide-react";
import type { CampaignStatus } from "@prisma/client";
import { sendCampaignNow, cancelCampaign, deleteCampaign } from "@/lib/campaigns/actions";
import { ConfirmActionButton } from "@/components/app/action-controls";

const btn = "inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors duration-150 disabled:opacity-50";

export function CampaignActions({ storeId, id, status, apiActive }: { storeId: string; id: string; status: CampaignStatus; apiActive: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      {(status === "DRAFT" || status === "SCHEDULED") && (
        <ConfirmActionButton
          action={() => sendCampaignNow(storeId, id)}
          title="Envoyer la campagne maintenant ?"
          description={apiActive ? "Les crédits marketing sont débités pour chaque destinataire consentant. Cette action est définitive." : "L'API WhatsApp n'est pas connectée : les messages seront préparés pour un envoi manuel depuis WhatsApp. Aucun crédit n'est débité."}
          confirmLabel="Envoyer"
          tone="primary"
          className={`${btn} bg-primary text-on-primary hover:bg-primary-hover`}
        >
          <Send className="size-3.5" aria-hidden /> Envoyer
        </ConfirmActionButton>
      )}
      {status === "SCHEDULED" && (
        <ConfirmActionButton action={() => cancelCampaign(storeId, id)} title="Annuler la planification ?" confirmLabel="Annuler l'envoi" className={`${btn} text-ink-muted hover:bg-surface-2 hover:text-ink`}>
          <Ban className="size-3.5" aria-hidden /> Annuler
        </ConfirmActionButton>
      )}
      {(status === "DRAFT" || status === "CANCELLED") && (
        <ConfirmActionButton action={() => deleteCampaign(storeId, id)} title="Supprimer cette campagne ?" description="Le brouillon sera définitivement supprimé." confirmLabel="Supprimer" className={`${btn} text-danger hover:bg-danger-soft`}>
          <Trash2 className="size-3.5" aria-hidden />
          <span className="sr-only">Supprimer</span>
        </ConfirmActionButton>
      )}
    </div>
  );
}
