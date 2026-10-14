import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { PageHeader, Alert } from "@/components/ui/misc";
import { Breadcrumbs } from "../../_components/breadcrumbs";
import { AppForm } from "../app-form";
import { devBase } from "@/app/app/[storeId]/developpeur/_components/dev-base";

export const metadata: Metadata = { title: "Créer une application" };

export default async function NewAppPage({ params }: { params: Promise<{ storeId: string }> }) {
  const dev = devBase((await params).storeId);
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");

  return (
    <>
      <Breadcrumbs items={[{ href: `${dev}`, label: "Espace développeur" }, { href: `${dev}/apps`, label: "Mes applications" }, { label: "Nouvelle application" }]} />
      <PageHeader
        title="Créer une application"
        description="Déclarez votre application, puis enregistrez-la : vous recevrez un client_id et un client_secret OAuth (le secret s'affiche une seule fois)."
      />
      {!user.emailVerified && (
        <Alert tone="warning" className="mb-6" title="Adresse e-mail non vérifiée">
          Vérifiez votre adresse e-mail pour pouvoir créer une application.
        </Alert>
      )}
      <AppForm mode="create" />
    </>
  );
}
