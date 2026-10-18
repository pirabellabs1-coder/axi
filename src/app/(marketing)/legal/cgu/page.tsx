import type { Metadata } from "next";
import Link from "next/link";
import { LegalLayout } from "@/components/marketing/legal-layout";
import { SITE } from "@/config/site";
import { TRIAL_DAYS, PAST_DUE_GRACE_DAYS } from "@/config/plans";

export const metadata: Metadata = {
  title: "Conditions générales d'utilisation",
  description: "Conditions générales d'utilisation de la plateforme Axi pour les commerçants et les acheteurs.",
  alternates: { canonical: "/legal/cgu" },
};

const UPDATED = "10 octobre 2026";

const TOC: [string, string][] = [
  ["objet", "1. Objet"],
  ["definitions", "2. Définitions"],
  ["compte", "3. Création de compte et de boutique"],
  ["plans", "4. Plans, essai et abonnement"],
  ["paiements", "5. Paiements des ventes"],
  ["obligations", "6. Obligations du Commerçant"],
  ["contenus", "7. Contenus et produits interdits"],
  ["acheteurs", "8. Acheteurs"],
  ["donnees", "9. Données et confidentialité"],
  ["disponibilite", "10. Disponibilité et support"],
  ["responsabilite", "11. Responsabilité"],
  ["suspension", "12. Suspension et résiliation"],
  ["propriete", "13. Propriété intellectuelle"],
  ["modifications", "14. Modifications des CGU"],
  ["droit", "15. Droit applicable et litiges"],
];

export default function TermsPage() {
  return (
    <LegalLayout title="Conditions générales d'utilisation" updated={UPDATED} toc={TOC}>
      <h2 id="objet">1. Objet</h2>
      <p>
        Les présentes conditions générales d&apos;utilisation (« CGU ») régissent l&apos;accès et l&apos;utilisation de la plateforme Axi (le « Service »), éditée par {SITE.company}, dont le siège est situé à {SITE.address} (« Axi », « nous »). Le Service permet à des commerçants de créer une boutique en ligne, de recevoir des commandes, notamment via WhatsApp, et de gérer leurs produits, paiements, livraisons et clients.
      </p>
      <p>En créant un compte ou en utilisant une boutique propulsée par Axi, vous acceptez les présentes CGU. Si vous les acceptez pour le compte d&apos;une entreprise, vous déclarez avoir le pouvoir de l&apos;engager.</p>

      <h2 id="definitions">2. Définitions</h2>
      <ul>
        <li>
          <strong>Commerçant</strong> : personne physique ou morale titulaire d&apos;un compte Axi et exploitant une ou plusieurs Boutiques.
        </li>
        <li>
          <strong>Boutique</strong> : espace de vente en ligne créé par un Commerçant, accessible via une adresse fournie par Axi ou un domaine personnalisé.
        </li>
        <li>
          <strong>Acheteur</strong> : toute personne passant commande auprès d&apos;une Boutique.
        </li>
        <li>
          <strong>Membre</strong> : utilisateur invité par le Commerçant à accéder à une Boutique avec un rôle défini.
        </li>
        <li>
          <strong>Marketplace</strong> : annuaire public des Boutiques ayant choisi d&apos;y figurer.
        </li>
      </ul>

      <h2 id="compte">3. Création de compte et de boutique</h2>
      <p>Pour créer un compte, vous devez avoir au moins 18 ans (ou l&apos;âge de la majorité légale dans votre pays) et fournir des informations exactes : adresse e-mail valide, numéro de téléphone WhatsApp et nom de la boutique. Vous êtes responsable de la confidentialité de vos identifiants et de toute activité réalisée depuis votre compte.</p>
      <p>Chaque Boutique dispose d&apos;une adresse de la forme <code>{SITE.domain}/s/nom-de-boutique</code> (ou sous-domaine). Certains noms sont réservés. Axi peut refuser ou modifier un nom portant atteinte aux droits de tiers ou prêtant à confusion avec le Service.</p>
      <p>Vous pouvez inviter des Membres et leur attribuer des rôles. Vous restez responsable des actions réalisées par vos Membres dans votre Boutique.</p>

      <h2 id="plans">4. Plans, essai et abonnement</h2>
      <p>
        Le Service est proposé selon plusieurs plans décrits sur la page{" "}
        <Link href="/tarifs">Tarifs</Link>, qui fait partie intégrante des présentes. Les plans (Starter, Business, Scale) sont facturés d&apos;avance, mensuellement ou annuellement, hors taxes, en francs CFA (XOF) pour les Boutiques situées en Afrique francophone et en euros pour les autres, les taxes applicables étant ajoutées le cas échéant. Le plan Enterprise fait l&apos;objet d&apos;un devis. Aucune commission n&apos;est prélevée sur les ventes, quel que soit le plan. Des options (membres, numéros, packs de messages ou de crédits, services) peuvent s&apos;ajouter à l&apos;abonnement.
      </p>
      <p>
        <strong>Essai gratuit.</strong> À la création d&apos;une Boutique, les fonctionnalités du plan Business sont offertes pendant {TRIAL_DAYS} jours, sans moyen de paiement requis. Le titulaire est prévenu trois jours puis un jour avant la fin de l&apos;essai. À l&apos;issue de l&apos;essai, et sauf souscription, la Boutique est mise en pause : la vitrine est fermée au public et aucune commande ne peut être passée, l&apos;espace marchand restant accessible. Aucune donnée n&apos;est supprimée du fait de cette mise en pause ; la Boutique est rouverte automatiquement à la confirmation du paiement d&apos;un plan. Les mêmes règles s&apos;appliquent à l&apos;échéance d&apos;un abonnement résilié ou impayé.
      </p>
      <p>
        <strong>Dépassement de limites.</strong> Une fois les quotas du plan atteints, l&apos;ajout de nouveaux produits et l&apos;enregistrement de nouvelles commandes sont bloqués jusqu&apos;au mois suivant ou à un changement de plan. Les produits, commandes et clients existants restent accessibles.
      </p>
      <p>
        <strong>Changement de plan et résiliation.</strong> Vous pouvez changer de plan à tout moment ; une montée en gamme s&apos;applique immédiatement au prorata. Un passage à un plan inférieur ou une résiliation prend effet à la fin de la période payée ; aucun remboursement n&apos;est dû pour la période en cours, sauf disposition légale contraire.
      </p>
      <p>
        <strong>Défaut de paiement.</strong> En cas d&apos;échec de paiement, Axi vous en informe et procède à des relances. Au-delà de {PAST_DUE_GRACE_DAYS} jours sans régularisation, les fonctionnalités payantes sont suspendues ; vos données sont conservées et le service rétabli dès paiement.
      </p>

      <h2 id="paiements">5. Paiements des ventes</h2>
      <p>
        <strong>Axi n&apos;encaisse pas les ventes des Commerçants et ne prélève aucune commission sur celles-ci.</strong> Les Acheteurs règlent directement le Commerçant par les moyens que celui-ci active : Mobile Money, espèces, virement ou passerelle de paiement en ligne connectée avec les identifiants du Commerçant.
      </p>
      <p>Le Commerçant est seul responsable de la vérification des paiements reçus (notamment des références de transaction Mobile Money saisies par les Acheteurs), de l&apos;émission des reçus et factures, et du respect de ses obligations fiscales et comptables. Les frais éventuellement facturés par les opérateurs ou passerelles sont à la charge du Commerçant.</p>
      <p>Lorsque le Commerçant connecte une passerelle de paiement, il garantit disposer des droits nécessaires sur le compte concerné et accepte les conditions de ce prestataire. Axi conserve les identifiants sous forme chiffrée et ne les communique jamais à des tiers.</p>

      <h2 id="obligations">6. Obligations du Commerçant</h2>
      <p>Le Commerçant s&apos;engage à :</p>
      <ul>
        <li>disposer des autorisations nécessaires à son activité et respecter la réglementation applicable (droit de la consommation, fiscalité, règles sectorielles, notamment pour l&apos;alimentaire et les cosmétiques) ;</li>
        <li>décrire ses produits de manière exacte et afficher des prix complets et clairs, y compris les frais de livraison ;</li>
        <li>honorer les commandes acceptées et informer les Acheteurs des délais et conditions de livraison, retrait, retour et remboursement ;</li>
        <li>utiliser WhatsApp et les autres canaux de communication dans le respect de leurs conditions d&apos;utilisation et sans sollicitation non désirée ;</li>
        <li>traiter les données personnelles de ses Acheteurs conformément à la réglementation (voir article 9) ;</li>
        <li>ne pas tenter de contourner les limites techniques du Service ni d&apos;accéder aux données d&apos;autres Boutiques.</li>
      </ul>

      <h2 id="contenus">7. Contenus et produits interdits</h2>
      <p>Il est interdit de proposer via le Service, sans que cette liste soit limitative : des produits contrefaits ; des armes, munitions et explosifs ; des stupéfiants et substances réglementées sans autorisation ; des médicaments soumis à prescription ; des produits issus d&apos;espèces protégées ; des contenus pornographiques ou incitant à la haine ou à la violence ; des services financiers non agréés ; des produits ou services illégaux dans le pays du Commerçant ou de l&apos;Acheteur.</p>
      <p>Axi peut retirer tout contenu et suspendre toute Boutique contrevenant à cet article, sans préavis en cas d&apos;illégalité manifeste.</p>

      <h2 id="acheteurs">8. Acheteurs</h2>
      <p>Les Acheteurs contractent directement avec le Commerçant. Axi n&apos;est pas partie à la vente, ne garantit pas les produits et n&apos;intervient pas dans les litiges commerciaux, sauf pour fournir, sur demande justifiée, les informations nécessaires au traitement d&apos;une réclamation. Les Acheteurs peuvent passer commande sans créer de compte ; un lien de suivi, à durée limitée, leur est fourni.</p>

      <h2 id="donnees">9. Données et confidentialité</h2>
      <p>
        Les données des Boutiques (produits, commandes, clients) sont isolées les unes des autres et demeurent la propriété du Commerçant. Axi agit comme sous-traitant pour les données des Acheteurs collectées par le Commerçant et comme responsable de traitement pour les données de compte des Commerçants. Les modalités sont détaillées dans la <Link href="/legal/confidentialite">politique de confidentialité</Link> et la <Link href="/legal/cookies">politique relative aux cookies</Link>.
      </p>
      <p>Le Commerçant peut exporter ses données à tout moment (selon son plan ou sur demande au support) et demander la suppression de sa Boutique. Après archivage de 30 jours, les données sont effacées, sous réserve des obligations légales de conservation.</p>

      <h2 id="disponibilite">10. Disponibilité et support</h2>
      <p>
        Axi s&apos;efforce d&apos;assurer une disponibilité continue du Service mais ne garantit pas l&apos;absence d&apos;interruptions, notamment en cas de maintenance, de panne de prestataires (hébergement, opérateurs télécoms, Mobile Money, Meta) ou de force majeure. L&apos;état du Service est consultable sur la <Link href="/statut">page de statut</Link>. Le support est fourni par e-mail et WhatsApp aux heures indiquées sur la page <Link href="/contact">Contact</Link> ; un niveau de service contractuel (SLA) n&apos;est proposé que dans le cadre du plan Enterprise.
      </p>

      <h2 id="responsabilite">11. Responsabilité</h2>
      <p>Le Service est fourni « en l&apos;état ». Dans les limites permises par la loi, la responsabilité d&apos;Axi envers un Commerçant est limitée, toutes causes confondues, au montant des abonnements payés par ce Commerçant au cours des douze mois précédant le fait générateur. Axi n&apos;est pas responsable des pertes indirectes (manque à gagner, perte de clientèle, atteinte à l&apos;image), ni des dommages résultant d&apos;un usage non conforme du Service, d&apos;une défaillance de tiers ou d&apos;une négligence dans la protection des identifiants.</p>
      <p>Le Commerçant garantit Axi contre toute réclamation de tiers liée à ses produits, ses contenus ou son activité.</p>

      <h2 id="suspension">12. Suspension et résiliation</h2>
      <p>Axi peut suspendre ou résilier un compte ou une Boutique en cas de violation des présentes CGU, de risque pour la sécurité du Service ou des utilisateurs, de demande d&apos;une autorité compétente, ou d&apos;inactivité prolongée (plus de 12 mois sans connexion, après notification). Sauf urgence, le Commerçant est informé des motifs et dispose d&apos;un délai pour y remédier. Les actions de suspension sont journalisées.</p>
      <p>Le Commerçant peut supprimer son compte à tout moment depuis ses paramètres.</p>

      <h2 id="propriete">13. Propriété intellectuelle</h2>
      <p>Le Service, sa marque, son interface, son code et sa documentation sont la propriété d&apos;Axi ou de ses concédants. Le Commerçant reçoit un droit d&apos;utilisation personnel, non exclusif et non cessible, limité à la durée de son abonnement. Le Commerçant conserve tous droits sur ses contenus (textes, images, logos) et accorde à Axi une licence limitée pour les héberger, les afficher et les diffuser dans le cadre du Service, y compris sur la Marketplace s&apos;il y a consenti.</p>

      <h2 id="modifications">14. Modifications des CGU</h2>
      <p>Axi peut modifier les présentes CGU. Les modifications substantielles sont notifiées par e-mail ou dans l&apos;espace marchand au moins 15 jours avant leur entrée en vigueur. La poursuite de l&apos;utilisation du Service après cette date vaut acceptation. En cas de désaccord, le Commerçant peut résilier sans frais avant l&apos;entrée en vigueur.</p>

      <h2 id="droit">15. Droit applicable et litiges</h2>
      <p>Les présentes CGU sont régies par le droit de la République du Bénin, et notamment par la loi n° 2017-20 du 20 avril 2018 portant code du numérique, ainsi que par les Actes uniformes de l&apos;OHADA applicables. En cas de litige, les parties recherchent une solution amiable ; à défaut, les tribunaux compétents de Cotonou sont seuls compétents, sous réserve des règles impératives protégeant les consommateurs.</p>
      <p>
        Pour toute question relative aux présentes : <a href={`mailto:${SITE.supportEmail}`}>{SITE.supportEmail}</a>.
      </p>
    </LegalLayout>
  );
}
