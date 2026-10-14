import type { Metadata } from "next";
import { Code2 } from "lucide-react";
import { getStoreContext } from "@/lib/auth/permissions";
import { DevNav } from "./_components/dev-nav";

export const metadata: Metadata = {
  title: { default: "Espace développeur", template: "%s · Espace développeur" },
  robots: { index: false, follow: false },
};

/**
 * Espace développeur, intégré à l'admin de la boutique : hérite de l'AppShell (barre latérale, menu mobile,
 * sélecteur de boutique). Les apps restent rattachées au COMPTE (developerUserId), pas à la boutique : la boutique
 * courante sert de contexte de navigation et de boutique de test par défaut.
 */
export default async function DeveloperSpaceLayout({ children, params }: { children: React.ReactNode; params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  await getStoreContext(storeId, "store.view");
  return (
    <div className="min-w-0">
      <p className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-2.5 py-1 text-xs font-medium text-primary-deep">
        <Code2 className="size-3.5" aria-hidden /> Espace développeur
      </p>
      <DevNav />
      {children}
    </div>
  );
}
