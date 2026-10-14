import type { Metadata } from "next";
import { canEditApp } from "@/lib/apps/dev-logic";
import { Alert } from "@/components/ui/misc";
import { AppForm } from "../../app-form";
import { formDefaults, loadAppTab } from "../_data";

export const metadata: Metadata = { title: "Configuration" };

export default async function AppConfigurationPage({ params }: { params: Promise<{ storeId: string; appId: string }> }) {
  const { app, client } = await loadAppTab(params);
  const editable = canEditApp(app.status);

  return (
    <div className="space-y-6">
      <Alert tone="info" title="Votre application est hébergée chez vous">
        Axi n&apos;exécute pas votre code. Votre serveur (Node, PHP, Python…) expose une page https affichée dans l&apos;admin du marchand,
        reçoit le marchand après l&apos;autorisation OAuth et, si vous le souhaitez, les événements par webhook.
      </Alert>
      {app.status === "PUBLISHED" && (
        <Alert tone="warning">
          Application publiée : modifier les autorisations ou les adresses de redirection la renvoie en revue (et la retire du catalogue) jusqu&apos;à validation.
        </Alert>
      )}
      {editable ? (
        <AppForm mode="edit" appId={app.id} defaults={formDefaults(app, client?.redirectUris ?? [])} sections={["config"]} />
      ) : (
        <Alert tone="info">
          {app.status === "IN_REVIEW"
            ? "Application en cours de revue : la configuration est verrouillée jusqu'à la décision de l'équipe Axi."
            : "Application suspendue : la configuration n'est plus modifiable."}
        </Alert>
      )}
    </div>
  );
}
