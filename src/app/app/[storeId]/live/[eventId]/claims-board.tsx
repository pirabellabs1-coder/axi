"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { BellRing, Download, MessageSquareText, X } from "lucide-react";
import { cancelLiveClaim, remindLiveClaim } from "@/lib/live/claim-actions";
import { formatMoney } from "@/lib/money";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/misc";
import { Table, THead, TH, TBody, TR, TD } from "@/components/ui/table";
import { ActionButton, ConfirmActionButton, CopyButton } from "@/components/app/action-controls";
import { ButtonLink } from "@/components/ui/button";

export type BoardRow = {
  id: string;
  createdAt: string;
  platform: "FACEBOOK" | "INSTAGRAM";
  authorName: string | null;
  commentText: string;
  code: string;
  productLabel: string;
  quantity: number;
  amount: number;
  currency: string;
  status: "RESERVED" | "MESSAGED" | "PAID" | "EXPIRED" | "CANCELLED";
  ordered: boolean;
  expiresAt: string;
  lastError: string | null;
  link: string;
  orderId: string | null;
};

const LABEL: Record<BoardRow["status"], string> = { RESERVED: "Réservé", MESSAGED: "Lien envoyé", PAID: "Payé", EXPIRED: "Expiré", CANCELLED: "Annulé" };
const TONE: Record<BoardRow["status"], BadgeTone> = { RESERVED: "warning", MESSAGED: "info", PAID: "success", EXPIRED: "neutral", CANCELLED: "neutral" };

function time(iso: string) {
  return new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

/** Tableau des réservations : rafraîchi toutes les 5 s pendant le direct (onglet visible uniquement). */
export function ClaimsBoard({ storeId, eventId, live, rows }: { storeId: string; eventId: string; live: boolean; rows: BoardRow[] }) {
  const router = useRouter();
  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 5000);
    return () => window.clearInterval(id);
  }, [live, router]);

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={MessageSquareText}
        title="Aucune réservation pour l'instant"
        description="Dès qu'un spectateur commente un mot-clé pendant le direct, sa réservation apparaît ici."
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <ButtonLink href={`/app/${storeId}/live/${eventId}/export`} variant="secondary" size="sm" className="min-h-11" prefetch={false}>
          <Download className="size-4" aria-hidden /> Exporter (CSV)
        </ButtonLink>
      </div>
      <Table minWidth={860}>
        <THead>
          <TR>
            <TH>Heure</TH>
            <TH>Client</TH>
            <TH>Article</TH>
            <TH align="right">Montant</TH>
            <TH>Statut</TH>
            <TH align="right">Actions</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((r) => {
            const active = (r.status === "RESERVED" || r.status === "MESSAGED") && !r.ordered;
            return (
              <TR key={r.id}>
                <TD className="whitespace-nowrap text-ink-muted">{time(r.createdAt)}</TD>
                <TD>
                  <span className="block font-medium text-ink">{r.authorName ?? "Client"}</span>
                  <span className="block max-w-[16rem] truncate text-xs text-ink-muted" title={r.commentText}>
                    {r.platform === "FACEBOOK" ? "Facebook" : "Instagram"} · « {r.commentText} »
                  </span>
                </TD>
                <TD>
                  <span className="block text-ink">
                    {r.quantity} × {r.productLabel}
                  </span>
                  <span className="block text-xs text-ink-muted">Code {r.code.toUpperCase()}</span>
                </TD>
                <TD align="right" className="whitespace-nowrap">
                  {formatMoney(r.amount, r.currency)}
                </TD>
                <TD>
                  <Badge tone={TONE[r.status]}>{r.ordered && r.status !== "PAID" ? "Commandé" : LABEL[r.status]}</Badge>
                  {active && <span className="mt-1 block text-xs text-ink-muted">jusqu&apos;à {time(r.expiresAt)}</span>}
                  {r.lastError && active && <span className="mt-1 block max-w-[14rem] text-xs text-danger">{r.lastError}</span>}
                </TD>
                <TD align="right">
                  <div className="flex flex-wrap justify-end gap-1">
                    {r.orderId && (
                      <ButtonLink href={`/app/${storeId}/commandes/${r.orderId}`} variant="ghost" size="sm" className="min-h-11">
                        Commande
                      </ButtonLink>
                    )}
                    {active && (
                      <>
                        <CopyButton value={r.link} label="Lien" className="min-h-11" />
                        <ActionButton action={() => remindLiveClaim(storeId, r.id)} variant="secondary" size="sm" className="min-h-11">
                          <BellRing className="size-4" aria-hidden /> Relancer
                        </ActionButton>
                        <ConfirmActionButton
                          action={() => cancelLiveClaim(storeId, r.id)}
                          className="min-h-11"
                          title="Annuler cette réservation ?"
                          description="L'article est remis en vente immédiatement. Le lien envoyé au client ne fonctionnera plus."
                          confirmLabel="Annuler la réservation"
                        >
                          <X className="size-4" aria-hidden />
                          <span className="sr-only">Annuler la réservation de {r.authorName ?? "ce client"}</span>
                        </ConfirmActionButton>
                      </>
                    )}
                  </div>
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </div>
  );
}
