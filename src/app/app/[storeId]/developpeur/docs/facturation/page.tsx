import type { Metadata } from "next";
import { APP_PLATFORM_FEE_PCT } from "@/lib/apps/types";
import { C, DocTitle, H2, OL, P, Table, UL } from "../_ui";

export const metadata: Metadata = { title: "Facturation et revue" };

export default function BillingReviewDocPage() {
  return (
    <>
      <DocTitle
        title="Facturation et revue"
        lead="Choisissez un modèle tarifaire dans la fiche catalogue ; Axi facture le marchand et vous reverse le montant net de commission. Toute application passe une revue avant d'apparaître au catalogue."
      />

      <H2 id="tarifs">Modèles tarifaires</H2>
      <Table
        head={["Modèle", "Facturation", "Remarques"]}
        rows={[
          ["Gratuit", "Aucune", "—"],
          ["Abonnement", "Mensuel ou annuel, en FCFA (montant entier)", "Essai gratuit facultatif (0 à 365 jours) : pas de revenu pendant l'essai."],
          ["Achat unique", "Une fois, à l'installation", "Non compté dans le revenu récurrent."],
        ]}
      />
      <UL>
        <li>Commission de la plateforme : <strong>{APP_PLATFORM_FEE_PCT} %</strong> du montant brut. La page Revenus affiche le revenu mensuel récurrent net (abonnements actifs, annuel ramené au mois).</li>
        <li>Les reversements sont opérés par la plateforme, en dehors de ce tableau de bord.</li>
        <li>Les <strong>installations de test</strong> (onglet Tests) ne sont jamais facturées (<C>billingStatus: none</C>) et ne comptent pas dans vos installations.</li>
      </UL>

      <H2 id="revue">Revue</H2>
      <OL>
        <li><strong>Brouillon</strong> : vous modifiez librement et testez sur vos boutiques.</li>
        <li><strong>En revue</strong> (après « Soumettre à la revue ») : la configuration et la fiche sont verrouillées ; l&apos;installation de test reste possible.</li>
        <li><strong>Publiée</strong> : visible au catalogue, installable par tous les marchands.</li>
        <li><strong>Refusée</strong> : l&apos;app revient en brouillon et le motif s&apos;affiche dans l&apos;onglet Statut et revue.</li>
        <li><strong>Suspendue</strong> : retirée par la plateforme ; jetons refusés, installation impossible.</li>
      </OL>
      <P>
        Une app publiée qui change ses <strong>autorisations</strong> ou ses <strong>adresses de redirection</strong> repasse automatiquement en revue (et quitte le catalogue)
        jusqu&apos;à validation. Les changements de texte, d&apos;icône ou de tarif restent en ligne.
      </P>

      <H2 id="criteres">Ce que l&apos;équipe Axi vérifie</H2>
      <UL>
        <li>Autorisations limitées au strict nécessaire (une écriture doit être justifiée par une fonctionnalité visible).</li>
        <li>Installation fonctionnelle : hmac vérifié, échange du code, page embarquée qui vérifie la session.</li>
        <li>Désinstallation propre (webhook <C>app.uninstalled</C> traité).</li>
        <li>Fiche claire en français : accroche, description, icône, URL de support, tarif exact.</li>
        <li>Aucun secret dans le navigateur ; données personnelles des clients traitées uniquement pour le service décrit.</li>
      </UL>
    </>
  );
}
