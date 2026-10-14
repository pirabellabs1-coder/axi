import type { Metadata } from "next";
import { canEditApp } from "@/lib/apps/dev-logic";
import { Alert } from "@/components/ui/misc";
import { AppForm } from "../../app-form";
import { formDefaults, loadAppTab } from "../_data";

export const metadata: Metadata = { title: "Fiche catalogue" };

export default async function AppListingPage({ params }: { params: Promise<{ storeId: string; appId: string }> }) {
  const { app, client } = await loadAppTab(params);
  const editable = canEditApp(app.status);

  return (
    <div className="space-y-6">
      <p className="text-sm text-ink-muted">
        Ce que les marchands voient dans le catalogue d&apos;applications : nom, accroche, description, icône, support et tarif.
        Les changements de fiche d&apos;une app publiée sont en ligne immédiatement.
      </p>
      {editable ? (
        <AppForm mode="edit" appId={app.id} defaults={formDefaults(app, client?.redirectUris ?? [])} sections={["catalog"]} />
      ) : (
        <Alert tone="info">
          {app.status === "IN_REVIEW" ? "Application en cours de revue : la fiche est verrouillée jusqu'à la décision de l'équipe Axi." : "Application suspendue : la fiche n'est plus modifiable."}
        </Alert>
      )}
      <Alert tone="info" title="Captures d'écran : bientôt">
        Le catalogue n&apos;affiche pas encore de captures d&apos;écran (aucun champ prévu dans le modèle actuel). Décrivez les écrans de votre application dans la description en attendant.
      </Alert>
    </div>
  );
}
