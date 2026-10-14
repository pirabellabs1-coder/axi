import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, FileText, LinkIcon, PackageSearch } from "lucide-react";
import { documentsForTrackingToken } from "@/lib/tax/invoice";
import { InvoiceDocument, INVOICE_PRINT_CSS } from "@/lib/tax/invoice-document";
import { STORE_LIGHT_TOKENS } from "@/lib/storefront/theme";
import { EmptyState } from "@/components/ui/misc";
import { PrintInvoiceButton } from "./print-button";

export const metadata: Metadata = { title: "Facture", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Factures et avoirs côté acheteur : accès par jeton de suivi valide et non expiré, rien d'autre. */
export default async function TrackingInvoicePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const res = await documentsForTrackingToken(token);
  const back = `/suivi/${encodeURIComponent(token)}`;

  return (
    <div data-theme="light" style={STORE_LIGHT_TOKENS as React.CSSProperties} className="min-h-dvh bg-canvas text-ink">
      <style>{INVOICE_PRINT_CSS}</style>
      <main className="invoice-root mx-auto w-full max-w-3xl px-4 pb-12 pt-6 sm:px-6">
        {res.status !== "ok" ? (
          <EmptyState
            icon={res.status === "expired" ? LinkIcon : PackageSearch}
            title={res.status === "expired" ? "Lien expiré" : "Facture introuvable"}
            description={res.status === "expired" ? "Ce lien n'est plus valable. Contactez la boutique pour obtenir votre facture." : "Vérifiez le lien reçu : il doit être copié en entier, sans espace."}
          />
        ) : (
          <>
            <div data-print-hide className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <Link href={back} className="inline-flex min-h-11 items-center gap-1.5 text-sm text-ink-muted hover:text-ink">
                  <ArrowLeft className="size-4" aria-hidden /> Suivi de la commande
                </Link>
                <h1 className="text-[22px] font-semibold tracking-[-0.03em]">Facture · {res.reference}</h1>
                <p className="text-sm text-ink-muted">{res.storeName}</p>
              </div>
              {res.documents.length > 0 && <PrintInvoiceButton />}
            </div>
            {res.documents.length === 0 ? (
              <EmptyState icon={FileText} title="Pas encore de facture" description="La facture est émise par la boutique après le paiement. Revenez plus tard ou contactez la boutique." />
            ) : (
              <div className="space-y-6">
                {res.documents.map((d) => (
                  <InvoiceDocument key={d.id} doc={d.snapshot} />
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
