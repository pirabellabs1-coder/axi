import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { PageHeader, Alert, KeyValue } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "Paramètres" };

export default async function DeveloperSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");

  const latest = await db.app.findFirst({ where: { developerUserId: user.id }, orderBy: { updatedAt: "desc" }, select: { developerName: true } });
  const count = await db.app.count({ where: { developerUserId: user.id } });

  return (
    <>
      <PageHeader title="Paramètres développeur" description="Votre identité publique sur le catalogue d'applications Axi." />
      <div className="space-y-6">
        <Card>
          <CardHeader title="Profil public" description="Le nom de développeur s'affiche sur la fiche de chacune de vos applications." />
          <CardBody>
            <ProfileForm defaultName={latest?.developerName ?? user.name ?? ""} disabled={count === 0} />
            {count === 0 && <p className="mt-3 text-sm text-ink-muted">Créez d&apos;abord une application : le nom public est enregistré sur vos applications.</p>}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Compte" description="Identité de connexion (modifiable depuis votre compte Axi)." />
          <CardBody>
            <KeyValue items={[{ label: "Nom", value: user.name }, { label: "E-mail de connexion", value: user.email }, { label: "Applications", value: count }]} />
          </CardBody>
        </Card>

        <Alert tone="info" title="E-mail de contact et site web : bientôt">
          Le modèle de données ne comporte pas encore de profil développeur (e-mail de contact public, site web). En attendant, renseignez l&apos;URL
          de support dans la fiche catalogue de chaque application : c&apos;est elle que voient les marchands.
        </Alert>
      </div>
    </>
  );
}
