import Link from "next/link";
import { Alert } from "@/components/ui/misc";
import { TRIAL_PLAN, PLANS } from "@/config/plans";
import { formatDate } from "@/lib/utils";
import { pauseReasonOf, type PauseReason } from "@/lib/billing/rules";

const REASON: Record<PauseReason, string> = {
  trial_ended: "Votre essai gratuit est terminé.",
  cancelled: "Votre abonnement est arrivé à échéance.",
  unpaid: "Votre facture d'abonnement n'a pas été réglée.",
  no_plan: "Aucun plan n'est actif.",
};

type Sub = { status: string; trialEndsAt: Date | null; coveredBySubscriptionId: string | null } | null;

/**
 * Bandeau de l'espace marchand : boutique EN PAUSE (chemin direct vers le choix du plan et le paiement),
 * ou fin d'essai proche (3 jours ou moins). Composant serveur.
 */
export function BillingPauseBanner({ storeId, storeStatus, sub, canBill, now }: { storeId: string; storeStatus: string; sub: Sub; canBill: boolean; now: Date }) {
  const cta = "mt-2 inline-flex min-h-11 items-center rounded-full bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-deep focus-visible:outline-2 focus-visible:outline-offset-2";
  if (storeStatus === "PAUSED") {
    return (
      <Alert tone="warning" title="Boutique en pause" className="mb-6">
        <p>
          {REASON[pauseReasonOf(sub)]} Votre vitrine affiche « Boutique momentanément fermée » et ne prend plus de commandes. Rien n&apos;est supprimé : elle rouvre automatiquement dès la confirmation du paiement.
        </p>
        {sub?.coveredBySubscriptionId ? (
          <p className="mt-1">Cette boutique dépend de l&apos;abonnement de la boutique principale de votre compte : choisissez un plan depuis celle-ci.</p>
        ) : canBill ? (
          <Link href={`/app/${storeId}/abonnement`} className={cta}>
            Choisir un plan et payer
          </Link>
        ) : (
          <p className="mt-1">Demandez au propriétaire de la boutique de choisir un plan.</p>
        )}
      </Alert>
    );
  }
  if (sub?.status === "TRIALING" && sub.trialEndsAt && !sub.coveredBySubscriptionId) {
    const left = sub.trialEndsAt.getTime() - now.getTime();
    if (left > 0 && left <= 3 * 86_400_000) {
      return (
        <Alert tone="info" title={`Votre essai ${PLANS[TRIAL_PLAN].name} se termine le ${formatDate(sub.trialEndsAt)}`} className="mb-6">
          <p>Sans plan payant à cette date, votre boutique sera mise en pause (vitrine fermée, données conservées).</p>
          {canBill && (
            <Link href={`/app/${storeId}/abonnement`} className={cta}>
              Choisir un plan
            </Link>
          )}
        </Alert>
      );
    }
  }
  return null;
}
