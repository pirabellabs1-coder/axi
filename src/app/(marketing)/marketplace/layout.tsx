import { Wrench } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { getMarketplaceMaintenance } from "@/lib/admin/settings";

/** Coupure de la marketplace pilotée depuis la console (Administration › Paramètres). */
export default async function MarketplaceLayout({ children }: { children: React.ReactNode }) {
  const maintenance = await getMarketplaceMaintenance();
  if (!maintenance.enabled) return children;
  return (
    <section className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center px-4 py-24 text-center">
      <span className="grid size-14 place-items-center rounded-full bg-primary/10 text-primary">
        <Wrench className="size-6" aria-hidden />
      </span>
      <h1 className="mt-6 text-3xl font-semibold tracking-tight text-ink">Marketplace en maintenance</h1>
      <p className="mt-3 text-ink-muted">
        {maintenance.message || "Nous améliorons la marketplace. Les boutiques restent accessibles directement par leur lien."}
      </p>
      <ButtonLink href="/" className="mt-8">Retour à l'accueil</ButtonLink>
    </section>
  );
}
