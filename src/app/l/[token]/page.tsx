import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShoppingBag } from "lucide-react";
import { claimView, openClaimCheckout, CHECKOUT_REFUSAL_MESSAGES, CLAIM_TOKEN_RE, type CheckoutRefusal } from "@/lib/live/claims";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { formatMoney } from "@/lib/money";
import { Card, CardBody } from "@/components/ui/card";
import { Alert, EmptyState } from "@/components/ui/misc";
import { SubmitButton } from "@/components/forms/submit-button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Votre réservation", robots: { index: false, follow: false } };

/**
 * Lien court envoyé en message privé (« commenter pour acheter ») : /l/{jeton}.
 * GET = résumé seul (les aperçus de liens de Messenger / Instagram ne consomment rien) ; le bouton (POST, action
 * serveur) crée le panier de la boutique avec l'article réservé et y redirige. Aucune donnée de l'auteur affichée.
 */
export default async function ClaimLinkPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ erreur?: string }> }) {
  const { token } = await params;
  const { erreur } = await searchParams;
  const view = CLAIM_TOKEN_RE.test(token) ? await claimView(token) : null;
  // Message d'erreur choisi dans une liste fermée (jamais de texte libre venu de l'URL).
  const errorText = erreur === "limite" ? "Trop de tentatives. Réessayez dans quelques minutes." : erreur && Object.hasOwn(CHECKOUT_REFUSAL_MESSAGES, erreur) ? CHECKOUT_REFUSAL_MESSAGES[erreur as CheckoutRefusal] : null;

  async function proceed() {
    "use server";
    if (!CLAIM_TOKEN_RE.test(token)) redirect("/");
    const ip = await clientIp();
    const rl = await rateLimit(`live-link:${ip}`, 30, 600);
    if (!rl.ok) redirect(`/l/${token}?erreur=limite`);
    const r = await openClaimCheckout(token);
    redirect(r.ok ? r.url : `/l/${token}?erreur=${r.code}`);
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      {!view ? (
        <EmptyState icon={ShoppingBag} title="Lien invalide" description="Ce lien de réservation n'existe pas ou a été mal copié." />
      ) : (
        <Card>
          <CardBody className="space-y-4">
            <p className="text-sm text-ink-muted">{view.storeName}</p>
            <h1 className="text-xl font-semibold text-ink">
              {view.quantity} × {view.productLabel}
            </h1>
            <p className="text-lg font-semibold text-ink">{formatMoney(view.total, view.currency)}</p>
            {errorText && <Alert tone="danger">{errorText}</Alert>}
            {view.state === "open" || view.state === "in_cart" ? (
              <>
                {view.state === "open" && (
                  <p className="text-sm text-ink-muted">
                    Article réservé pour vous jusqu&apos;à {view.expiresAt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: view.timezone })}. Choisissez la livraison et
                    payez sur la boutique.
                  </p>
                )}
                <form action={proceed}>
                  <SubmitButton className="min-h-12 w-full">Finaliser ma commande</SubmitButton>
                </form>
                <p className="text-xs text-ink-muted">Prix et disponibilité confirmés au moment de la commande.</p>
              </>
            ) : (
              <Alert tone={view.state === "paid" || view.state === "ordered" ? "success" : "info"}>
                {view.state === "paid"
                  ? "Cette réservation est payée. Merci !"
                  : view.state === "ordered"
                    ? "Votre commande est enregistrée. Suivez-la depuis le message de confirmation."
                    : view.state === "cancelled"
                      ? "Cette réservation a été annulée par la boutique."
                      : "Le délai de cette réservation est dépassé : l'article a été remis en vente."}
              </Alert>
            )}
          </CardBody>
        </Card>
      )}
    </main>
  );
}
