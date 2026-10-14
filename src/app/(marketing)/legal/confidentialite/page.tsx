import type { Metadata } from "next";
import Link from "next/link";
import { LegalLayout } from "@/components/marketing/legal-layout";
import { SITE } from "@/config/site";

export const metadata: Metadata = {
  title: "Politique de confidentialité",
  description: "Comment Axi collecte, utilise, protège et conserve les données personnelles des commerçants et des acheteurs.",
  alternates: { canonical: "/legal/confidentialite" },
};

const UPDATED = "10 octobre 2026";

const TOC: [string, string][] = [
  ["responsable", "1. Qui est responsable ?"],
  ["donnees", "2. Données collectées"],
  ["finalites", "3. Pourquoi nous les utilisons"],
  ["base", "4. Fondements du traitement"],
  ["acheteurs", "5. Données des acheteurs"],
  ["destinataires", "6. Qui y a accès"],
  ["transferts", "7. Hébergement et transferts"],
  ["conservation", "8. Durées de conservation"],
  ["securite", "9. Sécurité"],
  ["droits", "10. Vos droits"],
  ["mineurs", "11. Mineurs"],
  ["modifications", "12. Modifications"],
];

export default function PrivacyPage() {
  return (
    <LegalLayout title="Politique de confidentialité" updated={UPDATED} toc={TOC}>
      <p>
        Cette politique explique quelles données personnelles Axi traite, pourquoi, pendant combien de temps, et quels sont vos droits. Elle s&apos;applique au site {SITE.domain}, à l&apos;espace marchand, aux boutiques propulsées par Axi et aux pages de suivi de commande. Elle est rédigée conformément à la loi n° 2017-20 portant code du numérique en République du Bénin (livre V relatif à la protection des données à caractère personnel) et, le cas échéant, au Règlement (UE) 2016/679 (RGPD) pour les personnes situées dans l&apos;Union européenne.
      </p>

      <h2 id="responsable">1. Qui est responsable ?</h2>
      <p>
        Le responsable du traitement des données des Commerçants (comptes, abonnements, support) est {SITE.company}, {SITE.address}. Contact : <a href={`mailto:${SITE.supportEmail}`}>{SITE.supportEmail}</a>.
      </p>
      <p>Pour les données des Acheteurs collectées dans une Boutique (nom, téléphone, adresse de livraison, commandes), le responsable du traitement est le Commerçant qui exploite cette Boutique ; Axi agit alors comme sous-traitant, selon ses instructions et dans le cadre des <Link href="/legal/cgu">CGU</Link>.</p>

      <h2 id="donnees">2. Données collectées</h2>
      <h3>Commerçants et membres d&apos;équipe</h3>
      <ul>
        <li>Identité et contact : nom, adresse e-mail, numéro de téléphone WhatsApp, pays, ville.</li>
        <li>Compte : mot de passe (haché, jamais stocké en clair), sessions, adresses IP de connexion, journal des actions sensibles.</li>
        <li>Boutique : nom, description, logo, produits, horaires, zones de livraison, moyens de paiement affichés (numéros Mobile Money, coordonnées bancaires).</li>
        <li>Abonnement : plan, historique de facturation, références de paiement d&apos;abonnement (nous ne stockons pas de numéro de carte complet).</li>
        <li>Identifiants de passerelles de paiement connectées : stockés chiffrés, jamais affichés.</li>
        <li>Support : messages envoyés via le formulaire de contact, e-mail ou WhatsApp.</li>
      </ul>
      <h3>Acheteurs</h3>
      <ul>
        <li>Commande : nom, numéro de téléphone, adresse ou point de livraison, produits commandés, montant, mode de paiement choisi, référence de transaction saisie, notes éventuelles.</li>
        <li>Suivi : consultation du lien de suivi (horodatage).</li>
        <li>Navigation : données techniques minimales (voir <Link href="/legal/cookies">politique cookies</Link>).</li>
      </ul>
      <h3>Visiteurs du site</h3>
      <ul>
        <li>Adresse e-mail si vous vous inscrivez aux nouveautés ; contenu du formulaire de contact.</li>
        <li>Données techniques de navigation nécessaires au fonctionnement et à la sécurité (adresse IP, type de navigateur), conservées dans les journaux serveur.</li>
      </ul>

      <h2 id="finalites">3. Pourquoi nous les utilisons</h2>
      <ul>
        <li>Fournir le Service : créer et afficher votre Boutique, enregistrer et transmettre les commandes, générer les messages WhatsApp et les liens de suivi.</li>
        <li>Gérer votre compte et votre abonnement : authentification, facturation, relances de paiement.</li>
        <li>Assurer la sécurité : prévention de la fraude et des abus, journalisation des actions sensibles, détection des robots.</li>
        <li>Vous assister : réponse aux demandes de support.</li>
        <li>Vous informer : nouveautés du produit, uniquement si vous y avez consenti, avec désinscription à chaque envoi.</li>
        <li>Améliorer le Service : statistiques d&apos;usage agrégées, sans profilage individuel à des fins publicitaires.</li>
        <li>Respecter nos obligations légales (comptabilité, réponses aux autorités).</li>
      </ul>

      <h2 id="base">4. Fondements du traitement</h2>
      <p>Selon les cas : l&apos;exécution du contrat (CGU, commande), votre consentement (nouveautés par e-mail, cookies non essentiels), notre intérêt légitime (sécurité, amélioration du Service, prévention de la fraude) ou une obligation légale (conservation comptable).</p>

      <h2 id="acheteurs">5. Données des acheteurs : engagements d&apos;Axi comme sous-traitant</h2>
      <ul>
        <li>Nous ne traitons les données des Acheteurs que pour fournir le Service au Commerçant et ne les utilisons jamais pour notre propre prospection.</li>
        <li>Les données de chaque Boutique sont isolées : un Commerçant ne peut pas accéder aux clients d&apos;une autre Boutique.</li>
        <li>Nous ne vendons ni ne louons aucune donnée.</li>
        <li>Nous aidons le Commerçant à répondre aux demandes d&apos;exercice de droits des Acheteurs.</li>
        <li>À la suppression d&apos;une Boutique, les données des Acheteurs sont effacées dans les délais indiqués à l&apos;article 8.</li>
      </ul>
      <p>Les Acheteurs qui souhaitent exercer leurs droits sur leurs données de commande peuvent s&apos;adresser au Commerçant concerné (ses coordonnées figurent sur la Boutique) ou à Axi, qui transmettra.</p>

      <h2 id="destinataires">6. Qui y a accès</h2>
      <ul>
        <li>Le personnel autorisé d&apos;Axi, dans la limite de ses missions (support, exploitation). Les accès de support à une Boutique sont temporaires et journalisés.</li>
        <li>Les Membres que le Commerçant a invités, selon leur rôle.</li>
        <li>Nos sous-traitants techniques : hébergement et base de données, envoi d&apos;e-mails, passerelles de paiement d&apos;abonnement, et, lorsque le Commerçant l&apos;active, l&apos;API WhatsApp de Meta. Chacun est lié par un contrat garantissant un niveau de protection adéquat.</li>
        <li>Les autorités compétentes, sur demande légalement fondée.</li>
      </ul>
      <p>WhatsApp est édité par Meta Platforms ; les messages échangés entre Acheteur et Commerçant via WhatsApp sont soumis à la politique de confidentialité de WhatsApp. Axi n&apos;a pas accès au contenu de ces conversations, sauf notifications envoyées via l&apos;API officielle lorsqu&apos;elle est activée par le Commerçant.</p>

      <h2 id="transferts">7. Hébergement et transferts</h2>
      <p>Les données sont hébergées chez des prestataires d&apos;infrastructure dont les centres de données peuvent être situés hors du Bénin, notamment dans l&apos;Union européenne. Lorsque des données sont transférées hors de leur pays d&apos;origine, nous nous assurons de garanties appropriées (clauses contractuelles, niveau de protection reconnu) et, lorsque la loi l&apos;exige, procédons aux formalités requises auprès de l&apos;Autorité de protection des données personnelles (APDP) du Bénin.</p>

      <h2 id="conservation">8. Durées de conservation</h2>
      <table>
        <thead>
          <tr>
            <th>Données</th>
            <th>Durée</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Compte et Boutique</td>
            <td>Pendant la durée du compte, puis archivage 30 jours après suppression, puis effacement.</td>
          </tr>
          <tr>
            <td>Commandes et paiements</td>
            <td>Pendant la durée du compte ; les pièces comptables sont conservées 10 ans conformément au droit OHADA.</td>
          </tr>
          <tr>
            <td>Données des Acheteurs</td>
            <td>Tant que la Boutique existe, sauf demande d&apos;effacement ; anonymisées à la suppression de la Boutique (hors pièces comptables).</td>
          </tr>
          <tr>
            <td>Liens de suivi de commande</td>
            <td>Validité limitée dans le temps, puis désactivation.</td>
          </tr>
          <tr>
            <td>Journaux techniques et de sécurité</td>
            <td>12 mois.</td>
          </tr>
          <tr>
            <td>Demandes de support</td>
            <td>24 mois après clôture.</td>
          </tr>
          <tr>
            <td>Inscription aux nouveautés</td>
            <td>Jusqu&apos;à désinscription, puis 3 ans sans interaction.</td>
          </tr>
        </tbody>
      </table>

      <h2 id="securite">9. Sécurité</h2>
      <p>Nous appliquons des mesures techniques et organisationnelles adaptées : chiffrement des communications (HTTPS), hachage des mots de passe, chiffrement des secrets de paiement, cloisonnement des données par Boutique, contrôle d&apos;accès par rôle, journalisation des actions sensibles, sauvegardes régulières, vérification des signatures des notifications de paiement. En cas de violation de données susceptible d&apos;engendrer un risque pour vos droits, nous vous en informons et notifions l&apos;autorité compétente dans les délais légaux.</p>

      <h2 id="droits">10. Vos droits</h2>
      <p>Vous disposez d&apos;un droit d&apos;accès, de rectification, d&apos;effacement, de limitation, d&apos;opposition et de portabilité de vos données, ainsi que du droit de retirer votre consentement à tout moment et de définir des directives relatives au sort de vos données après votre décès.</p>
      <p>
        Pour les exercer : depuis votre espace marchand (modification du profil, export, suppression du compte) ou par e-mail à <a href={`mailto:${SITE.supportEmail}`}>{SITE.supportEmail}</a>. Nous répondons dans un délai d&apos;un mois, prolongeable en cas de demande complexe. Une preuve d&apos;identité peut être demandée en cas de doute raisonnable.
      </p>
      <p>Vous pouvez également introduire une réclamation auprès de l&apos;Autorité de protection des données personnelles du Bénin (APDP) ou, pour les personnes situées dans l&apos;Union européenne, auprès de l&apos;autorité de contrôle de leur pays de résidence.</p>

      <h2 id="mineurs">11. Mineurs</h2>
      <p>Le Service est destiné aux personnes majeures pour la création de compte. Les Boutiques peuvent être consultées par tous ; les Commerçants s&apos;engagent à ne pas proposer de produits réservés aux adultes sans contrôle approprié.</p>

      <h2 id="modifications">12. Modifications</h2>
      <p>Nous pouvons mettre à jour cette politique pour refléter l&apos;évolution du Service ou de la réglementation. La date de mise à jour figure en haut de page ; les changements importants vous sont notifiés par e-mail ou dans l&apos;espace marchand.</p>
    </LegalLayout>
  );
}
