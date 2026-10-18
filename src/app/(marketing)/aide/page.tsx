import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Bot, CreditCard, Globe2, MessageCircle, Palette, Rocket, Truck, Wallet, type LucideIcon } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Faq, type FaqItem } from "@/components/marketing/faq";
import { SITE } from "@/config/site";
import { TRIAL_DAYS } from "@/config/plans";
import { PageHero } from "@/components/marketing/section";

export const metadata: Metadata = {
  title: "Centre d'aide",
  description: "Guides pas à pas pour créer votre boutique Axi, personnaliser votre thème, gérer votre catalogue, vendre sur WhatsApp, encaisser en Mobile Money ou par carte, vendre à l'international, brancher un assistant IA et gérer votre abonnement.",
  alternates: { canonical: "/aide" },
};

type Guide = { id: string; icon: LucideIcon; title: string; intro: string; items: FaqItem[] };

const Steps = ({ items }: { items: string[] }) => (
  <ol className="list-decimal space-y-2 pl-5 marker:font-semibold marker:text-primary">
    {items.map((s) => (
      <li key={s} className="pl-1">
        {s}
      </li>
    ))}
  </ol>
);

const GUIDES: Guide[] = [
  {
    id: "demarrer",
    icon: Rocket,
    title: "Démarrer",
    intro: "De l'inscription à la première commande, en moins d'une heure.",
    items: [
      {
        q: "Créer mon compte et ma boutique",
        a: (
          <Steps
            items={[
              "Rendez-vous sur « Créer ma boutique » et indiquez votre e-mail, votre numéro WhatsApp et un mot de passe.",
              "Confirmez votre adresse e-mail avec le code reçu.",
              "Donnez un nom à votre boutique : l'adresse (ex. axi.africa/s/votre-nom) est générée automatiquement, vous pouvez la modifier.",
              "Choisissez votre catégorie et votre pays : la devise, les opérateurs Mobile Money et le fuseau horaire s'adaptent.",
              `Votre boutique démarre avec ${TRIAL_DAYS} jours de Business offerts, sans carte bancaire.`,
            ]}
          />
        ),
      },
      {
        q: "Ajouter mes premiers produits",
        a: (
          <>
            <Steps
              items={[
                "Dans « Produits », cliquez sur « Nouveau produit ».",
                "Renseignez le nom, le prix dans la devise de votre boutique et une ou plusieurs photos (depuis votre galerie, elles sont compressées automatiquement).",
                "Ajoutez des variantes si besoin (taille, couleur) avec leur propre prix.",
                "Enregistrez : le produit est visible dès qu'il est « actif ».",
              ]}
            />
            <p className="mt-3">Astuce : une bonne photo prise à la lumière du jour, sur fond uni, vend mieux qu&apos;un montage.</p>
          </>
        ),
      },
      {
        q: "Publier et partager ma boutique",
        a: (
          <Steps
            items={[
              "Vérifiez votre numéro WhatsApp dans « WhatsApp » : c'est lui qui recevra les commandes.",
              "Dans « Tableau de bord », cliquez sur « Publier ».",
              "Copiez votre lien ou téléchargez le QR code, puis partagez-le en statut WhatsApp, en bio Instagram ou Facebook, et dans vos messages.",
              "Passez une commande test depuis votre propre téléphone pour voir ce que reçoit un client.",
            ]}
          />
        ),
      },
    ],
  },
  {
    id: "boutique",
    icon: Palette,
    title: "Boutique et catalogue",
    intro: "Personnaliser le thème, organiser les produits, reprendre un catalogue existant.",
    items: [
      {
        q: "Personnaliser ma boutique avec l'éditeur",
        a: (
          <>
            <Steps
              items={[
                "Ouvrez « Apparence » : la liste des sections est à gauche, l'aperçu au centre, les réglages à droite.",
                "Cliquez sur une section de l'aperçu pour ouvrir ses réglages, ou glissez-la pour la déplacer.",
                "Utilisez « Ajouter une section » pour piocher dans la bibliothèque, ou réutiliser une section que vous avez enregistrée.",
                "Surveillez l'onglet « Qualité » : accessibilité, performance et référencement se mettent à jour en direct, avec une correction en un clic.",
                "Cliquez sur « Publier » quand le résultat vous convient. Les versions précédentes restent accessibles.",
              ]}
            />
            <p className="mt-3">Astuce : enregistrez une section réussie pour la réutiliser sur une autre page sans tout refaire.</p>
          </>
        ),
      },
      {
        q: "Laisser l'IA créer une première version",
        a: <p>Depuis l&apos;éditeur, décrivez votre activité en une phrase : l&apos;IA propose une direction complète (couleurs, typographie, sections et textes). Une génération est offerte par boutique, les suivantes consomment des crédits IA. Rien n&apos;est publié sans votre validation, et vous pouvez tout ajuster ensuite.</p>,
      },
      {
        q: "Importer un catalogue existant",
        a: (
          <>
            <Steps
              items={[
                "Exportez votre catalogue depuis votre plateforme actuelle au format CSV.",
                "Dans « Produits », cliquez sur « Importer » et déposez le fichier.",
                "Vérifiez la correspondance des colonnes proposée : le format des exports Shopify est reconnu directement.",
                "Lancez l'import, puis contrôlez quelques fiches avant de publier.",
              ]}
            />
            <p className="mt-3">L&apos;import est disponible à partir du plan Business. Pour une reprise automatisée, l&apos;API REST permet de créer les produits un par un.</p>
          </>
        ),
      },
      {
        q: "Variantes, options et collections",
        a: (
          <>
            <p>
              Une <strong>variante</strong> a son propre prix, sa photo et son stock (taille S, M, L). Une <strong>option</strong> ajoute un choix ou un supplément au moment de la commande (emballage cadeau, sauce piquante).
            </p>
            <p className="mt-3">
              Les <strong>collections</strong> rangent vos produits : à la main, ou automatiquement avec une règle (toutes les nouveautés, tout ce qui est en promotion). Une collection peut devenir une section de votre page d&apos;accueil.
            </p>
          </>
        ),
      },
    ],
  },
  {
    id: "whatsapp",
    icon: MessageCircle,
    title: "Vendre sur WhatsApp",
    intro: "Comment les commandes arrivent, et comment y répondre vite.",
    items: [
      {
        q: "Comment une commande arrive-t-elle sur WhatsApp ?",
        a: (
          <>
            <p>
              Quand un client valide son panier, Axi enregistre la commande puis ouvre WhatsApp sur son téléphone avec un message prérempli : référence, produits, quantités, mode de livraison et total. Il n&apos;a plus qu&apos;à appuyer sur « Envoyer ». Vous recevez ce message sur votre numéro habituel.
            </p>
            <p className="mt-3">La commande est aussi dans votre tableau de bord, même si le client n&apos;envoie finalement pas le message WhatsApp : vous pouvez le rappeler.</p>
          </>
        ),
      },
      {
        q: "Faut-il WhatsApp Business ?",
        a: <p>Non. Un compte WhatsApp classique suffit pour recevoir les commandes. WhatsApp Business apporte des réponses rapides et un catalogue, mais Axi fonctionne avec les deux. Le WhatsApp officiel (messages automatiques, boîte partagée, campagnes) est inclus dès le plan Business et nécessite un compte Meta Business, que nous vous aidons à configurer.</p>,
      },
      {
        q: "Confirmer, préparer et clôturer une commande",
        a: (
          <Steps
            items={[
              "Ouvrez la commande depuis la notification ou depuis « Commandes ».",
              "Cliquez sur « Confirmer » une fois le paiement reçu ou la commande validée par téléphone.",
              "Passez-la en « Prête » quand elle est emballée, puis « En livraison » ou « Retirée ».",
              "Le client reçoit un lien de suivi. Vous pouvez aussi lui envoyer un message WhatsApp en un clic depuis la commande.",
            ]}
          />
        ),
      },
    ],
  },
  {
    id: "paiements",
    icon: Wallet,
    title: "Paiements et Mobile Money",
    intro: "Encaissez directement, sans commission, avec une trace de chaque paiement.",
    items: [
      {
        q: "Activer le paiement Mobile Money",
        a: (
          <Steps
            items={[
              "Dans « Paiements », activez l'opérateur souhaité (MTN MoMo, Moov Money, Wave, Orange Money… selon votre pays).",
              "Indiquez le numéro à créditer et le nom du titulaire tels qu'ils doivent apparaître au client.",
              "Ajoutez éventuellement des instructions (ex. « Mettez la référence de commande en motif »).",
              "Au paiement, le client voit ces informations, envoie l'argent et saisit la référence de transaction.",
              "Vous vérifiez la réception sur votre téléphone, puis cliquez sur « Confirmer le paiement » dans la commande.",
            ]}
          />
        ),
      },
      {
        q: "Paiement à la livraison ou au retrait",
        a: <p>Activez « Espèces » dans « Paiements ». La commande est marquée « à encaisser » ; au moment de la remise, passez-la en « Payée ». Vous pouvez limiter cette option aux commandes sous un certain montant.</p>,
      },
      {
        q: "Connecter une passerelle en ligne (FedaPay, KkiaPay, PayDunya, Stripe)",
        a: (
          <>
            <p>Dès le plan Starter, si vous avez un compte chez l&apos;un de ces prestataires, saisissez vos clés API dans « Paiements » : elles sont chiffrées et ne sont jamais affichées. Les paiements confirmés par la passerelle marquent automatiquement la commande « payée ». Les frais éventuels du prestataire sont les vôtres ; Axi n&apos;en ajoute aucun.</p>
          </>
        ),
      },
      {
        q: "Une commande peut-elle être marquée payée par erreur ?",
        a: <p>Non. Une commande n&apos;est « payée » que si vous la confirmez manuellement ou si une passerelle connectée l&apos;a confirmée par un message signé. La saisie d&apos;une référence par le client la met seulement « en attente de vérification ».</p>,
      },
    ],
  },
  {
    id: "livraison",
    icon: Truck,
    title: "Livraison et retrait",
    intro: "Zones, frais, créneaux et suivi : organisez la remise des commandes.",
    items: [
      {
        q: "Créer mes zones de livraison",
        a: (
          <Steps
            items={[
              "Dans « Livraison », cliquez sur « Nouvelle zone ».",
              "Nommez-la (ex. « Cotonou centre »), fixez les frais et le délai annoncé.",
              "Précisez éventuellement un montant minimum de commande et un seuil de livraison offerte.",
              "Ordonnez vos zones : le client choisit la sienne au moment de la commande.",
            ]}
          />
        ),
      },
      {
        q: "Proposer le retrait en boutique avec des créneaux",
        a: <p>Activez « Retrait » dans « Livraison » et indiquez votre adresse. Dès le plan Starter, définissez des créneaux (jour, heure de début, heure de fin, nombre de commandes maximum) : le client choisit un créneau disponible, idéal pour la restauration et la pâtisserie.</p>,
      },
      {
        q: "Donner un accès à mon livreur",
        a: <p>Dès le plan Business, invitez-le dans « Équipe » avec le rôle « Équipe ». Il verra uniquement les commandes à livrer, pourra les passer en « Livrée » et contacter le client, sans accès aux prix, aux paiements ni aux paramètres.</p>,
      },
      {
        q: "Le lien de suivi client",
        a: <p>À chaque commande, un lien de suivi signé est généré (axi.africa/suivi/…). Il ne demande aucun compte, affiche le statut en temps réel et expire après un délai. Le client le reçoit dans le message WhatsApp et sur la page de confirmation.</p>,
      },
    ],
  },
  {
    id: "international",
    icon: Globe2,
    title: "International et facturation",
    intro: "Plusieurs devises, TVA, factures numérotées et blog.",
    items: [
      {
        q: "Afficher mes prix dans une autre devise",
        a: (
          <>
            <Steps
              items={[
                "Ouvrez « Devises » et ajoutez les devises que vous voulez proposer.",
                "Choisissez la règle d'arrondi (par exemple au millier le plus proche) et, si besoin, une marge de change.",
                "Fixez un prix précis dans une devise quand la conversion automatique ne vous convient pas.",
                "Enregistrez : vos acheteurs peuvent alors changer de devise depuis l'en-tête de la boutique.",
              ]}
            />
            <p className="mt-3">La devise d&apos;encaissement reste celle de votre boutique : l&apos;affichage multi-devises sert à rassurer l&apos;acheteur, pas à changer votre comptabilité.</p>
          </>
        ),
      },
      {
        q: "Appliquer la TVA et éditer des factures",
        a: <p>Dans « Taxes », indiquez vos taux par pays et si vos prix sont affichés TTC ou HT. Les mentions correspondantes apparaissent au panier et sur la facture. Chaque commande payée peut donner lieu à une facture numérotée, et chaque remboursement à un avoir. La numérotation est continue, sans trou, et s&apos;exporte pour votre comptable.</p>,
      },
      {
        q: "Publier des articles de blog",
        a: <p>Le blog sert à être trouvé sans publicité : recettes, guides des tailles, conseils d&apos;entretien. Créez vos catégories, rédigez (l&apos;IA peut proposer un brouillon), programmez la publication, et affichez vos derniers articles dans une section de la page d&apos;accueil. Un flux RSS et le plan du site sont générés automatiquement.</p>,
      },
    ],
  },
  {
    id: "ia",
    icon: Bot,
    title: "Assistant et connecteur IA",
    intro: "Piloter la boutique depuis Claude ou ChatGPT, en toute sécurité.",
    items: [
      {
        q: "Connecter Claude ou ChatGPT à ma boutique",
        a: (
          <>
            <Steps
              items={[
                "Ouvrez « Connecteurs IA » dans votre espace.",
                "Choisissez votre outil : Claude.ai, ChatGPT, Claude Desktop, Cursor ou un autre client compatible.",
                "Sur Claude.ai et ChatGPT (plan Business et au-delà), ajoutez le connecteur avec l'adresse indiquée, puis autorisez l'accès à votre boutique : aucun jeton à copier.",
                "Pour un outil local, créez un jeton, choisissez ses autorisations et sa durée, puis collez-le dans la configuration de l'outil.",
              ]}
            />
            <p className="mt-3">Le secret d&apos;un jeton n&apos;est affiché qu&apos;une seule fois : conservez-le dans votre gestionnaire de mots de passe.</p>
          </>
        ),
      },
      {
        q: "Que peut faire l'assistant, et que ne peut-il pas faire ?",
        a: (
          <>
            <p>Il peut lire vos ventes, votre stock et vos commandes, et, si vous l&apos;y autorisez, modifier des produits, ajuster du stock, faire avancer des commandes ou créer des promotions.</p>
            <p className="mt-3">Il ne peut jamais déclencher un paiement ou un remboursement, modifier votre équipe, votre abonnement ou vos clés de paiement, ni supprimer votre boutique. Chaque appel est journalisé et tout accès se révoque en un clic.</p>
          </>
        ),
      },
      {
        q: "Mes produits peuvent-ils être trouvés par les assistants de mes clients ?",
        a: <p>Oui, si votre boutique est publiée. Les assistants peuvent consulter votre catalogue public, vérifier la disponibilité et préparer un lien de panier, que votre client ouvre et valide lui-même. Aucune donnée client, aucune commande et aucun paiement ne sont exposés, et vous pouvez désactiver cette ouverture à tout moment.</p>,
      },
    ],
  },
  {
    id: "abonnement",
    icon: CreditCard,
    title: "Abonnement et facturation",
    intro: "Essai, plans, paiement de l'abonnement et données.",
    items: [
      {
        q: "Que comprend l'essai gratuit ?",
        a: <p>{TRIAL_DAYS} jours de plan Business à l&apos;inscription : produits illimités, WhatsApp officiel et boîte partagée, fichier clients, fidélité, domaine personnalisé, rapports avancés. Aucune carte n&apos;est demandée.</p>,
      },
      {
        q: "Que se passe-t-il à la fin de l'essai ?",
        a: <p>Vous recevez un rappel 3 jours puis 1 jour avant la fin. Sans plan payant à la date de fin, votre boutique est mise en pause : vos clients voient « Boutique momentanément fermée » et ne peuvent plus commander. Rien n&apos;est supprimé : votre espace reste accessible, et la boutique rouvre automatiquement dès que le paiement de votre plan est confirmé.</p>,
      },
      {
        q: "Payer ou changer mon abonnement",
        a: (
          <Steps items={["Dans « Abonnement », choisissez Starter, Business ou Scale, au mois ou à l'année (2 mois offerts). Le prix est en FCFA ou en euros selon le pays de votre boutique.", "Réglez en Mobile Money ou par carte.", "Votre facture est disponible immédiatement dans le même écran.", "Pour monter de plan, cliquez sur « Changer » : la différence est calculée au prorata. Une descente prend effet en fin de période."]} />
        ),
      },
      {
        q: "Exporter ou supprimer mes données",
        a: <p>Vous pouvez exporter vos commandes en CSV dès le plan Starter, vos produits et clients dès Business, ou en faire la demande au support (tous plans). Pour supprimer votre compte, rendez-vous dans « Paramètres » : la boutique est d&apos;abord archivée 30 jours, puis définitivement effacée.</p>,
      },
    ],
  },
];

export default function HelpPage() {
  return (
    <>
      <PageHero eyebrow="Centre d'aide" title="Comment pouvons-nous vous aider ?" description="Des guides courts, pas à pas, pensés pour être lus sur un téléphone entre deux clients." />

      <nav aria-label="Thèmes de l'aide" className="container-x">
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {GUIDES.map((g, i) => (
            <li key={g.id} className="reveal" style={{ transitionDelay: `${i * 50}ms` }}>
              <a
                href={`#${g.id}`}
                className="group flex h-full flex-col rounded-[var(--radius-xl)] bg-surface p-5 ring-1 ring-line shadow-[var(--shadow-card)] transition-transform duration-500 ease-spring hover:-translate-y-0.5"
              >
                <span className="flex items-center justify-between">
                  <g.icon className="size-6 text-primary" aria-hidden />
                  <ArrowUpRight className="size-4 text-ink-faint transition-transform duration-500 ease-spring group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden />
                </span>
                <span className="mt-6 text-[16px] font-semibold text-ink">{g.title}</span>
                <span className="mt-1 text-[13.5px] leading-relaxed text-ink-muted">{g.intro}</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="container-x space-y-20 py-24 md:space-y-28 md:py-32">
        {GUIDES.map((g) => (
          <section key={g.id} id={g.id} aria-labelledby={`${g.id}-title`} className="grid grid-cols-1 scroll-mt-28 gap-8 lg:grid-cols-[300px_1fr] lg:gap-16">
            <div className="reveal lg:sticky lg:top-28 lg:self-start">
              <span className="inline-flex size-12 items-center justify-center rounded-full bg-primary-soft text-primary">
                <g.icon className="size-5" aria-hidden />
              </span>
              <h2 id={`${g.id}-title`} className="mt-5 text-h3 font-semibold text-ink">
                {g.title}
              </h2>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">{g.intro}</p>
            </div>
            <Faq items={g.items} name={`help-${g.id}`} />
          </section>
        ))}
      </div>

      <section aria-labelledby="contact-title" className="pb-24 md:pb-32">
        <div className="container-x">
          <div className="reveal grid grid-cols-1 gap-8 rounded-[var(--radius-2xl)] bg-forest p-8 text-white md:grid-cols-[1.3fr_1fr] md:items-end md:p-12">
            <div>
              <h2 id="contact-title" className="text-h2 font-semibold text-white">
                Vous n&apos;avez pas trouvé ?
              </h2>
              <p className="mt-4 max-w-[52ch] text-[16px] leading-relaxed text-white/75">Un humain vous répond en français sous 24 h ouvrées. Indiquez le nom de votre boutique et, si possible, la référence de la commande.</p>
              <p className="mt-4 text-sm text-white/65">
                Par e-mail :{" "}
                <Link href={`mailto:${SITE.supportEmail}`} className="font-medium text-white underline underline-offset-4">
                  {SITE.supportEmail}
                </Link>
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row md:flex-col lg:flex-row md:items-start">
              <ButtonLink href="/contact?sujet=aide" variant="accent" size="lg" trailing>
                Nous écrire
              </ButtonLink>
              <ButtonLink href={`https://wa.me/${SITE.supportWhatsapp}`} variant="inverse" size="lg" target="_blank" rel="noopener noreferrer">
                <MessageCircle className="size-4" aria-hidden />
                WhatsApp
              </ButtonLink>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

