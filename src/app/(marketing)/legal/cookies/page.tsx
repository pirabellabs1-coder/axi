import type { Metadata } from "next";
import Link from "next/link";
import { LegalLayout } from "@/components/marketing/legal-layout";
import { SITE } from "@/config/site";

export const metadata: Metadata = {
  title: "Politique relative aux cookies",
  description: "Quels cookies et stockages locaux Axi utilise, pourquoi, et comment les contrôler.",
  alternates: { canonical: "/legal/cookies" },
};

const UPDATED = "10 octobre 2026";

const TOC: [string, string][] = [
  ["quoi", "1. Qu'est-ce qu'un cookie ?"],
  ["liste", "2. Cookies et stockages utilisés"],
  ["tiers", "3. Services tiers"],
  ["controle", "4. Comment les contrôler"],
  ["contact", "5. Contact"],
];

const COOKIES: { name: string; type: string; purpose: string; duration: string; essential: boolean }[] = [
  { name: "axi_session", type: "Cookie (HttpOnly, Secure, SameSite=Lax)", purpose: "Maintenir votre connexion à l'espace marchand et à l'administration.", duration: "30 jours, renouvelé à chaque visite", essential: true },
  { name: "axi_cart_{boutique}", type: "Cookie (Secure, SameSite=Lax)", purpose: "Conserver le panier en cours sur une boutique entre deux pages.", duration: "7 jours", essential: true },
  { name: "axi_csrf", type: "Cookie (Secure, SameSite=Strict)", purpose: "Protéger les formulaires contre les requêtes forgées.", duration: "Session", essential: true },
  { name: "axi_consent", type: "Cookie", purpose: "Mémoriser vos choix en matière de cookies non essentiels, le cas échéant.", duration: "12 mois", essential: true },
  { name: "Stockage local (localStorage)", type: "Stockage navigateur", purpose: "Mémoriser des préférences d'affichage (ex. mode compact du tableau de bord) sans transmission au serveur.", duration: "Jusqu'à suppression par vous", essential: true },
];

export default function CookiesPage() {
  return (
    <LegalLayout title="Politique relative aux cookies" updated={UPDATED} toc={TOC}>
      <p>
        Axi utilise un nombre volontairement réduit de cookies et de stockages locaux, uniquement pour faire fonctionner le Service et le sécuriser. <strong>Nous n&apos;utilisons aucun cookie publicitaire ni traceur tiers de profilage</strong> sur {SITE.domain} et sur les boutiques propulsées par Axi.
      </p>

      <h2 id="quoi">1. Qu&apos;est-ce qu&apos;un cookie ?</h2>
      <p>Un cookie est un petit fichier texte déposé par un site sur votre appareil, qui permet par exemple de vous reconnaître d&apos;une page à l&apos;autre. Le « stockage local » est un mécanisme similaire, géré par votre navigateur, qui ne transmet rien au serveur. Les cookies dits « essentiels » sont nécessaires au fonctionnement du site et ne requièrent pas de consentement ; les autres ne sont déposés qu&apos;avec votre accord.</p>

      <h2 id="liste">2. Cookies et stockages utilisés</h2>
      <div className="relative -mx-4 overflow-x-auto px-4">
      <table className="min-w-[640px]">
        <thead>
          <tr>
            <th>Nom</th>
            <th>Type</th>
            <th>Finalité</th>
            <th>Durée</th>
          </tr>
        </thead>
        <tbody>
          {COOKIES.map((c) => (
            <tr key={c.name}>
              <td>
                <code className="font-mono text-[13px]">{c.name}</code>
                <span className="mt-0.5 block text-xs text-ink-muted">{c.essential ? "Essentiel" : "Soumis à consentement"}</span>
              </td>
              <td>{c.type}</td>
              <td>{c.purpose}</td>
              <td>{c.duration}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <p>Les noms exacts peuvent évoluer avec le Service ; cette liste est mise à jour en conséquence. Aucun cookie non essentiel n&apos;est déposé à ce jour. Si nous introduisons un outil de mesure d&apos;audience, il sera soit configuré pour être exempté de consentement (données anonymisées, pas de recoupement), soit soumis à votre accord préalable via un bandeau.</p>

      <h2 id="tiers">3. Services tiers</h2>
      <ul>
        <li>
          <strong>Polices de caractères</strong> : les polices sont servies depuis nos propres serveurs ; aucune requête n&apos;est envoyée à Google Fonts lors de votre navigation.
        </li>
        <li>
          <strong>WhatsApp</strong> : le bouton « Commander sur WhatsApp » ouvre l&apos;application ou le site WhatsApp (Meta). Aucun script de Meta n&apos;est chargé sur nos pages ; une fois sur WhatsApp, la politique de confidentialité de Meta s&apos;applique.
        </li>
        <li>
          <strong>Passerelles de paiement</strong> : lorsqu&apos;un Commerçant active un paiement en ligne (FedaPay, KkiaPay, PayDunya, Stripe), la page de paiement du prestataire peut déposer ses propres cookies, régis par sa politique.
        </li>
        <li>
          <strong>Hébergement</strong> : notre hébergeur peut déposer un cookie technique de répartition de charge ou de protection contre les attaques, strictement nécessaire.
        </li>
      </ul>

      <h2 id="controle">4. Comment les contrôler</h2>
      <p>Vous pouvez à tout moment supprimer les cookies ou configurer votre navigateur pour les refuser (menus « Confidentialité » ou « Paramètres du site » de Chrome, Safari, Firefox, Samsung Internet, Opera). Le refus des cookies essentiels empêchera la connexion à l&apos;espace marchand et la conservation du panier sur les boutiques.</p>
      <p>Pour le stockage local, utilisez la fonction « Effacer les données du site » de votre navigateur.</p>

      <h2 id="contact">5. Contact</h2>
      <p>
        Pour toute question sur les cookies ou vos données : <a href={`mailto:${SITE.supportEmail}`}>{SITE.supportEmail}</a>. Consultez aussi notre <Link href="/legal/confidentialite">politique de confidentialité</Link> et nos <Link href="/legal/cgu">conditions générales d&apos;utilisation</Link>.
      </p>
    </LegalLayout>
  );
}
