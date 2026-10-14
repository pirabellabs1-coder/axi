"use client";

import { useState, useTransition } from "react";
import { Download, MessageCircle, Send } from "lucide-react";
import { resendDownloadLink } from "@/lib/digital/actions";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/utils";

export type DownloadRow = {
  grantId: string;
  itemName: string;
  files: number;
  downloadCount: number;
  downloadLimit: number | null;
  expiresAt: string | null;
  lastDownloadAt: string | null;
  notifiedAt: string | null;
  expired: boolean;
  exhausted: boolean;
};

/**
 * Suivi des téléchargements d'une commande (vague 2) : où en est chaque acheteur, et renvoi du lien.
 * Le jeton n'est jamais affiché : « Renvoyer le lien » en émet un NOUVEAU et désactive l'ancien.
 */
export function DownloadsCard({ storeId, rows, canManage }: { storeId: string; rows: DownloadRow[]; canManage: boolean }) {
  const [pending, start] = useTransition();
  const [waLinks, setWaLinks] = useState<Record<string, string>>({});
  if (rows.length === 0) return null;

  const resend = (grantId: string) =>
    start(async () => {
      const res = await resendDownloadLink(storeId, grantId);
      if (!res.ok) return toast.error("Envoi impossible", res.error);
      if (res.data?.waLink) setWaLinks((cur) => ({ ...cur, [grantId]: res.data!.waLink! }));
      toast.success(res.message ?? "Lien renvoyé");
    });

  return (
    <Card>
      <CardHeader title="Téléchargements" description="Fichiers remis à l'acheteur après le paiement. Chaque téléchargement est compté." />
      <CardBody className="pt-3">
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.grantId} className="py-4 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium text-ink">
                    <Download className="size-4 text-ink-muted" aria-hidden />
                    <span className="truncate">{r.itemName}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {r.files} fichier{r.files > 1 ? "s" : ""} · {r.downloadCount} téléchargement{r.downloadCount > 1 ? "s" : ""}
                    {r.downloadLimit != null ? ` sur ${r.downloadLimit}` : " (illimité)"}
                    {r.lastDownloadAt ? ` · dernier le ${formatDateTime(new Date(r.lastDownloadAt))}` : " · jamais téléchargé"}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {r.expiresAt ? `Lien valable jusqu'au ${formatDateTime(new Date(r.expiresAt))}` : "Lien sans date limite"}
                    {r.notifiedAt ? ` · envoyé par e-mail le ${formatDateTime(new Date(r.notifiedAt))}` : " · aucun e-mail envoyé (pas d'adresse)"}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  {r.expired ? <Badge tone="warning">Expiré</Badge> : r.exhausted ? <Badge tone="warning">Limite atteinte</Badge> : <Badge tone="success">Actif</Badge>}
                  {canManage && (
                    <Button type="button" variant="outline" size="sm" loading={pending} onClick={() => resend(r.grantId)}>
                      <Send className="size-4" aria-hidden /> Renvoyer le lien
                    </Button>
                  )}
                  {waLinks[r.grantId] && (
                    <a
                      href={waLinks[r.grantId]}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-9 items-center gap-1.5 rounded-full bg-whatsapp-deep px-3 text-xs font-semibold text-white"
                    >
                      <MessageCircle className="size-4" aria-hidden /> Envoyer sur WhatsApp
                    </a>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-ink-muted">Renvoyer le lien en crée un nouveau : l&apos;ancien cesse immédiatement de fonctionner.</p>
      </CardBody>
    </Card>
  );
}
