import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PackageCheck } from "lucide-react";
import { loadCourierView } from "@/lib/shipping/courier";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/misc";
import { formatMoney } from "@/lib/money";
import { CourierActions } from "./courier-client";

export const metadata: Metadata = { title: "Livraison", robots: { index: false, follow: false } };

/**
 * Page livreur (lot 3 §1.2). Accès par jeton aléatoire expirant 7 jours après la création de
 * l'expédition : aucun compte n'est nécessaire. Données personnelles minimisées (prénom, téléphone
 * partiellement masqué) ; le numéro complet n'est révélé qu'à la demande, et la révélation est
 * journalisée.
 */
export default async function CourierPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await loadCourierView(token);
  if (!view) notFound();

  // Lien expiré ou révoqué (mineur n° 6) : UNIQUEMENT le bandeau. Ni adresse, ni téléphone, ni montant
  // à encaisser, ni détail du colis — un lien fuité ne reste pas une fiche client consultable.
  if (view.expired) {
    return (
      <main className="mx-auto w-full max-w-lg space-y-4 px-4 py-6">
        <header className="space-y-1">
          <p className="text-sm text-ink-muted">{view.storeName}</p>
          <h1 className="text-[24px] font-semibold tracking-tight text-ink">Livraison</h1>
        </header>
        <Alert tone="warning" title="Lien de livraison expiré">
          Ce lien n&apos;est plus valable. Demandez-en un nouveau au commerçant.
        </Alert>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-lg space-y-4 px-4 py-6">
      <header className="space-y-1">
        <p className="text-sm text-ink-muted">{view.storeName}</p>
        <h1 className="text-[24px] font-semibold tracking-tight text-ink">Livraison {view.reference}</h1>
        <Badge tone={view.status === "DELIVERED" ? "success" : view.status === "FAILED_ATTEMPT" ? "warning" : "info"}>{view.statusLabel}</Badge>
      </header>

      <Card>
        <CardHeader title="Destinataire" />
        <CardBody className="space-y-2 text-sm">
          <p className="text-[17px] font-semibold text-ink">{view.recipientFirstName}</p>
          <p className="tabular text-ink">{view.phoneMasked}</p>
          {view.address && <p className="text-ink">{view.address}</p>}
          {view.city && <p className="text-ink-muted">{view.city}</p>}
          {view.note && <p className="italic text-ink-muted">Repère : {view.note}</p>}
          {view.cashToCollect > 0 && (
            <p className="rounded-[var(--radius-md)] bg-warning-soft px-3 py-2 font-semibold text-warning">
              À encaisser : {formatMoney(view.cashToCollect, view.currency)}
            </p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Colis" description={`${view.items.reduce((s, i) => s + i.quantity, 0)} article(s)`} />
        <CardBody>
          <ul className="space-y-1 text-sm text-ink">
            {view.items.map((item, index) => (
              <li key={`${item.name}-${index}`} className="flex items-start gap-2">
                <PackageCheck className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden />
                <span>
                  {item.quantity} × {item.name}
                  {item.variantName ? ` (${item.variantName})` : ""}
                </span>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <CourierActions token={token} status={view.status} requiresCode={view.requiresCode} attemptsLeft={view.codeAttemptsLeft} hasProofPhoto={view.hasProofPhoto} />
    </main>
  );
}
