import "server-only";
import { MonitorSmartphone, ShieldCheck } from "lucide-react";
import { db } from "@/lib/db";
import { formatDate, formatDateTime, relativeTime } from "@/lib/utils";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/misc";
import { RevokeSessionsButton } from "@/components/storefront/account/revoke-sessions-button";

/** Agent utilisateur résumé (jamais l'IP affichée) : « Android · Chrome ». */
function deviceLabel(ua: string | null): string {
  if (!ua) return "Appareil inconnu";
  const os = /iphone|ipad/i.test(ua) ? "iPhone" : /android/i.test(ua) ? "Android" : /windows/i.test(ua) ? "Windows" : /mac os/i.test(ua) ? "Mac" : /linux/i.test(ua) ? "Linux" : "Appareil";
  const browser = /edg\//i.test(ua) ? "Edge" : /chrome|crios/i.test(ua) ? "Chrome" : /firefox|fxios/i.test(ua) ? "Firefox" : /safari/i.test(ua) ? "Safari" : "Navigateur";
  return `${os} · ${browser}`;
}

/**
 * Fiche client : compte acheteur (badge « Compte vérifié le … », sessions actives, demande de suppression,
 * révocation des sessions par `customers.manage`). Server Component autonome, toujours borné à la boutique.
 *
 *   <BuyerAccountPanel storeId={sid} customerId={customer.id} canManage={canManage} />
 */
export async function BuyerAccountPanel({ storeId, customerId, canManage }: { storeId: string; customerId: string; canManage: boolean }) {
  const now = new Date();
  const [customer, sessions, deletion] = await Promise.all([
    db.customer.findFirst({ where: { id: customerId, storeId }, select: { phoneVerifiedAt: true, emailVerifiedAt: true, lastLoginAt: true } }),
    db.customerSession.findMany({
      where: { storeId, customerId, revokedAt: null, expiresAt: { gt: now } },
      orderBy: { lastSeenAt: "desc" },
      take: 10,
      select: { id: true, userAgent: true, lastSeenAt: true, createdAt: true },
    }),
    db.auditLog.findFirst({ where: { storeId, action: "customer.deletion_requested", target: customerId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);
  if (!customer) return null;
  const verified = !!customer.phoneVerifiedAt;

  return (
    <Card>
      <CardHeader title="Compte client" description={verified ? undefined : "Ce client ne s'est jamais connecté à la boutique."} />
      <CardBody className="space-y-4 pt-2">
        {deletion && (
          <Alert tone="warning" title="Suppression demandée">
            Le client a demandé la suppression de son compte le {formatDate(deletion.createdAt)}. Anonymisez sa fiche depuis « Données personnelles ».
          </Alert>
        )}
        {verified ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="success">
              <ShieldCheck className="size-3.5" aria-hidden /> Compte vérifié le {formatDate(customer.phoneVerifiedAt!)}
            </Badge>
            {customer.emailVerifiedAt && <Badge tone="neutral">E-mail vérifié</Badge>}
          </div>
        ) : null}
        {customer.lastLoginAt && <p className="text-sm text-ink-muted">Dernière connexion {relativeTime(customer.lastLoginAt)}.</p>}
        {verified && (
          <div>
            <p className="mb-2 text-sm font-medium text-ink">
              {sessions.length ? `${sessions.length} session${sessions.length > 1 ? "s" : ""} active${sessions.length > 1 ? "s" : ""}` : "Aucune session active"}
            </p>
            {sessions.length > 0 && (
              <ul className="space-y-2">
                {sessions.map((s) => (
                  <li key={s.id} className="flex items-start gap-2.5 text-sm">
                    <MonitorSmartphone className="mt-0.5 size-4 shrink-0 text-ink-faint" aria-hidden />
                    <span>
                      <span className="block text-ink">{deviceLabel(s.userAgent)}</span>
                      <span className="block text-xs text-ink-muted" title={formatDateTime(s.lastSeenAt)}>
                        Actif {relativeTime(s.lastSeenAt)} · depuis le {formatDate(s.createdAt)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {canManage && sessions.length > 0 && <RevokeSessionsButton storeId={storeId} customerId={customerId} />}
      </CardBody>
    </Card>
  );
}
