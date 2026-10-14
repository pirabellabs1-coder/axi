import { CheckCheck, MessageCircle } from "lucide-react";
import { Bezel } from "@/components/ui/card";

/**
 * Aperçu du message prérempli, tel qu'il s'ouvre dans WhatsApp côté client.
 * Couleurs : tokens de marque WhatsApp (`whatsapp`, `whatsapp-deep`) et tokens de thème, aucun hex.
 */
export function MessagePreview({ storeName, message }: { storeName: string; message: string }) {
  return (
    <Bezel as="section" className="lg:sticky lg:top-6" coreClassName="overflow-hidden p-0">
      <div className="px-5 pt-5 pb-4">
        <h2 id="preview-title" className="text-[15px] font-semibold tracking-tight text-ink">Aperçu du message</h2>
        <p className="mt-1 text-sm text-ink-muted">Ce que votre client envoie en touchant « Commander sur WhatsApp ».</p>
      </div>
      <figure aria-labelledby="preview-title" className="mx-4 mb-4 overflow-hidden rounded-[var(--radius-md)] ring-1 ring-line">
        <div className="flex items-center gap-3 bg-whatsapp-deep px-3.5 py-2.5 text-white">
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-white/15" aria-hidden>
            <MessageCircle className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{storeName}</p>
            <p className="text-xs text-white/90">Compte WhatsApp Business</p>
          </div>
        </div>
        <div className="bg-whatsapp/10 px-3 py-4">
          <div className="ml-auto max-w-[290px] rounded-[var(--radius-md)] rounded-tr-sm bg-surface px-3 pt-2 pb-1.5 shadow-[var(--shadow-card)] ring-1 ring-whatsapp/25">
            <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink [overflow-wrap:anywhere]">{message}</p>
            <p className="mt-1 flex items-center justify-end gap-1 text-[11px] text-ink-faint">
              Maintenant <CheckCheck className="size-3.5 text-info" aria-label="Lu" />
            </p>
          </div>
        </div>
      </figure>
      <p className="border-t border-line px-5 py-3.5 text-xs leading-relaxed text-ink-muted">
        Le clic est enregistré comme une intention d'achat. Seule la commande confirmée dans la boutique compte comme vente.
      </p>
    </Bezel>
  );
}
