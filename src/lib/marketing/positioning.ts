/**
 * Positionnement du site vitrine : source unique des messages, domaines produit et preuves.
 *
 * Axi est une plateforme e-commerce complète **et** une plateforme de commerce conversationnel.
 * L'ancrage en Afrique francophone reste un avantage (Mobile Money, paiement à la livraison,
 * réseaux lents) sans être une limite : la facturation existe en euros comme en FCFA.
 *
 * Règles de contenu, à respecter dans toutes les pages marketing :
 *  - aucune donnée inventée (pas de faux témoignages, pas de chiffres d'usage non mesurés) ;
 *  - aucun prix de concurrent publié, aucune promesse de « dépasser » un concurrent nommé
 *    (`docs/ANALYSE-CONCURRENTIELLE.md` §8.4 et §9) ;
 *  - ne décrire que ce qui est réellement livré ; le reste porte la mention « Bientôt ».
 */
import type { PlanId } from "@/config/plans";

/* ───────────────────────── Promesse ───────────────────────── */

export const PROMISE = {
  /** Titre H1 de l'accueil, en deux temps (le second est atténué). */
  h1: ["Une plateforme de commerce complète.", "Pour vendre partout, encaisser partout."] as const,
  lede:
    "Boutique personnalisable, catalogue, paiements mondiaux et locaux, vente sur WhatsApp et connecteur IA — réunis dans un seul produit, sans commission sur vos ventes.",
  /** Résumé court réutilisé en description SEO et en pied de page. */
  short:
    "Plateforme e-commerce et commerce conversationnel : boutique personnalisable, catalogue, paiements du monde entier (carte bancaire et Mobile Money), WhatsApp intégré et connecteur IA. 0 % de commission, du monde entier à l'Afrique de l'Ouest.",
} as const;

/** Les cinq arguments qui distinguent réellement Axi, vérifiables dans le produit. */
export const DIFFERENTIATORS: { title: string; text: string; href: string }[] = [
  { title: "0 % de commission", text: "Sur tous les plans, essai compris. Vous gardez l'intégralité de vos ventes : Axi vit de l'abonnement.", href: "/tarifs" },
  { title: "Tout-en-un", text: "Boutique, catalogue, paiements, WhatsApp et IA dans un seul produit, les mêmes données, un seul abonnement.", href: "/fonctionnalites" },
  { title: "Paiements du monde entier", text: "Carte bancaire à l'international, Mobile Money (Wave, Orange Money, MTN, Moov) et paiement à la livraison, au cœur du produit.", href: "/paiements" },
  { title: "Connecteur IA", text: "Pilotez votre boutique depuis Claude ou ChatGPT, et laissez les assistants de vos acheteurs lire votre vitrine.", href: "/ia" },
  { title: "International, multi-devises", text: "Facturation en euros ou en FCFA selon votre pays, affichage multi-devises pour vos acheteurs, où qu'ils soient.", href: "/tarifs" },
];

/* ───────────────────────── Domaines produit ───────────────────────── */

export type DomainSlug = "boutique-en-ligne" | "paiements" | "whatsapp" | "ia";

export type Domain = {
  slug: DomainSlug;
  /** Libellé court (navigation, pastilles). */
  label: string;
  /** Titre de la page dédiée. */
  title: string;
  /** Phrase d'accroche de la page dédiée. */
  lede: string;
  /** Résumé d'une ligne pour les cartes de l'accueil et du hub fonctionnalités. */
  summary: string;
  /** Trois preuves courtes affichées sur les cartes. */
  proofs: string[];
};

export const DOMAINS: Domain[] = [
  {
    slug: "boutique-en-ligne",
    label: "Boutique et catalogue",
    title: "Une boutique que vous dessinez vous-même.",
    lede: "Éditeur à sections et blocs, bibliothèque de modèles, champs personnalisés, scores de qualité en direct. Et un catalogue qui tient la charge : variantes, collections, inventaire, import CSV.",
    summary: "Éditeur à sections, modèles alternatifs, champs personnalisés, variantes, collections, inventaire et import CSV.",
    proofs: ["Éditeur à sections et blocs", "Modèles alternatifs par produit", "Import CSV compatible Shopify"],
  },
  {
    slug: "paiements",
    label: "Paiements et livraison",
    title: "Encaissez comme vos clients paient.",
    lede: "Mobile Money, carte bancaire, virement ou espèces à la livraison. L'argent arrive sur vos propres comptes, Axi ne prend aucune commission.",
    summary: "Wave, Orange Money, MTN, Moov, carte bancaire, paiement à la livraison, TVA, factures et livraison par zones.",
    proofs: ["Mobile Money automatique", "Carte bancaire dans le monde entier", "Paiement à la livraison natif"],
  },
  {
    slug: "whatsapp",
    label: "WhatsApp et clients",
    title: "La conversation fait partie de la vente.",
    lede: "Vos clients écrivent avant d'acheter : Axi transforme ces échanges en commandes suivies, puis en clients qui reviennent.",
    summary: "Boîte partagée, catalogue synchronisé, entonnoir, campagnes, paniers abandonnés, fidélité et avis.",
    proofs: ["Boîte de réception partagée", "Catalogue WhatsApp synchronisé", "Relance des paniers abandonnés"],
  },
  {
    slug: "ia",
    label: "Intelligence artificielle",
    title: "Votre boutique parle aux assistants IA.",
    lede: "Dans les deux sens : vous la pilotez depuis Claude ou ChatGPT, et les assistants de vos acheteurs savent lire votre vitrine.",
    summary: "Connecteur MCP et OAuth, génération de boutique, traduction, brouillons de fiches, vitrine lisible par les IA.",
    proofs: ["Connecteur MCP et OAuth", "Boutique générée par l'IA", "Vitrine lisible par les assistants"],
  },
];

export function getDomain(slug: DomainSlug): Domain {
  const d = DOMAINS.find((x) => x.slug === slug);
  if (!d) throw new Error(`Domaine inconnu : ${slug}`);
  return d;
}

/* ───────────────────────── Capacités, par domaine et par groupe ───────────────────────── */

export type Capability = { title: string; text: string; plan: PlanId; soon?: boolean };
export type CapabilityGroup = { id: string; title: string; description: string; domain: DomainSlug; items: Capability[] };

export const CAPABILITY_GROUPS: CapabilityGroup[] = [
  {
    id: "design",
    domain: "boutique-en-ligne",
    title: "Design et personnalisation",
    description: "L'éditeur de thème d'Axi travaille par sections et par blocs, avec aperçu cliquable et versions.",
    items: [
      { title: "Éditeur à sections et blocs", text: "Composez chaque page en empilant des sections, réglez chaque bloc dans l'aperçu, revenez à une version précédente.", plan: "FREE" },
      { title: "Édition directe dans l'aperçu", text: "Cliquez sur un texte de l'aperçu pour le corriger sur place, sans chercher le réglage correspondant.", plan: "FREE" },
      { title: "Scores de qualité en direct", text: "Accessibilité, performance et référencement notés pendant que vous construisez, avec correction en un clic.", plan: "FREE" },
      { title: "Préréglages d'animation", text: "Apparitions et parallaxes sobres, désactivées automatiquement si le visiteur réduit les animations.", plan: "FREE" },
      { title: "Boutique générée par l'IA", text: "Décrivez votre activité : l'IA propose une direction complète, textes compris. Une génération offerte par boutique.", plan: "FREE" },
      { title: "Sections enregistrées et bibliothèque", text: "Sauvegardez une section pour la réutiliser ailleurs, ou piochez dans la bibliothèque de sections prêtes.", plan: "STARTER" },
      { title: "Champs personnalisés", text: "Ajoutez vos propres informations (matière, origine, délai) et reliez-les à n'importe quelle section.", plan: "STARTER" },
      { title: "Domaine personnalisé", text: "Votre propre adresse au lieu d'un sous-domaine, avec certificat géré par Axi.", plan: "BUSINESS" },
      { title: "Modèles alternatifs", text: "Une fiche « luxe » et une fiche « promo » dans la même boutique, par produit, collection, page ou article.", plan: "BUSINESS" },
      { title: "Assistant de design", text: "Décrivez le changement voulu, l'assistant propose les réglages correspondants.", plan: "BUSINESS" },
      { title: "Thèmes programmés", text: "Basculez automatiquement pour la Tabaski, Noël ou les soldes, puis revenez au thème habituel.", plan: "BUSINESS" },
      { title: "Contenus par audience", text: "Un message différent pour un nouveau visiteur, un client fidèle, une ville ou une provenance.", plan: "BUSINESS" },
      { title: "Tests A/B de sections", text: "Deux versions d'une section, la conversion mesurée dans Axi.", plan: "SCALE" },
    ],
  },
  {
    id: "catalogue",
    domain: "boutique-en-ligne",
    title: "Catalogue et stock",
    description: "De cinq produits à un catalogue entier repris depuis une autre plateforme.",
    items: [
      { title: "Produits, options et variantes", text: "Tailles, couleurs et suppléments, avec prix, photo et stock par variante.", plan: "FREE" },
      { title: "Collections manuelles et automatiques", text: "Rangez vos produits à la main, ou laissez une règle le faire (marque, prix, étiquette).", plan: "FREE" },
      { title: "Suivi du stock et alertes", text: "Quantités décomptées à la commande, seuils d'alerte, produits masqués en rupture.", plan: "STARTER" },
      { title: "Import et export CSV", text: "Format compatible avec les exports Shopify : reprenez un catalogue existant sans ressaisie.", plan: "BUSINESS" },
      { title: "Produits numériques", text: "Fichiers, formations et billets livrés automatiquement après paiement.", plan: "BUSINESS" },
      { title: "Flux catalogues", text: "Flux publics pour Meta, Google et TikTok, mis à jour tout seuls.", plan: "BUSINESS" },
    ],
  },
  {
    id: "ventes",
    domain: "whatsapp",
    title: "Ventes, remises et fidélité",
    description: "Tout ce qui fait monter le panier et revenir le client.",
    items: [
      { title: "Comptes acheteurs", text: "Connexion par code, historique, adresses enregistrées, favoris et réachat en un clic.", plan: "FREE" },
      { title: "Coupons et codes promo", text: "Montant minimum, date de fin, usage unique par client.", plan: "STARTER" },
      { title: "Remises automatiques", text: "Paliers de panier et remises par produit, appliquées sans code à saisir.", plan: "STARTER" },
      { title: "Lots et « X achetés = Y offerts »", text: "Offres groupées calculées au panier, cumul maîtrisé.", plan: "BUSINESS" },
      { title: "Offres au panier", text: "Ventes croisées et montées en gamme proposées au bon moment.", plan: "BUSINESS" },
      { title: "Cartes cadeaux et avoirs", text: "Vendez des cartes cadeaux, remboursez en avoir utilisable au paiement.", plan: "BUSINESS" },
      { title: "Retours et échanges", text: "Demande par l'acheteur, validation par vous, remise en stock automatique.", plan: "BUSINESS" },
      { title: "Fidélité et avis clients", text: "Des points à chaque achat, utilisables au paiement, et des avis demandés après livraison.", plan: "BUSINESS" },
    ],
  },
  {
    id: "canaux",
    domain: "whatsapp",
    title: "WhatsApp et canaux",
    description: "Le canal où vos clients écrivent déjà, outillé comme une équipe commerciale.",
    items: [
      { title: "Commande par lien WhatsApp", text: "Le client valide son panier, le récapitulatif arrive sur votre numéro habituel. Aucun compte Meta requis.", plan: "FREE" },
      { title: "WhatsApp officiel (API Cloud)", text: "Confirmations, suivi et reçus envoyés depuis votre numéro professionnel.", plan: "BUSINESS" },
      { title: "Boîte de réception partagée", text: "Toute l'équipe répond depuis le même numéro, avec réponses rapides et attribution.", plan: "BUSINESS" },
      { title: "Entonnoir de vente", text: "Chaque conversation avance de « nouveau contact » à « commande payée ».", plan: "BUSINESS" },
      { title: "Campagnes WhatsApp", text: "Promotions envoyées aux clients qui ont accepté de les recevoir, avec suivi des retours.", plan: "BUSINESS" },
      { title: "Catalogue WhatsApp synchronisé", text: "Votre catalogue Axi alimente le Commerce Manager de Meta, panier WhatsApp converti en commande.", plan: "BUSINESS" },
      { title: "Messages Instagram et Facebook", text: "Les messages des réseaux sociaux dans la même boîte.", plan: "BUSINESS", soon: true },
      { title: "Relance des paniers abandonnés", text: "Un message au client qui n'a pas terminé sa commande.", plan: "SCALE" },
      { title: "Réponses automatiques", text: "Un robot métier répond aux questions fréquentes la nuit, puis passe la main.", plan: "SCALE", soon: true },
    ],
  },
  {
    id: "paiements",
    domain: "paiements",
    title: "Paiements",
    description: "Les moyens de paiement réellement utilisés par vos clients, sans commission Axi.",
    items: [
      { title: "Paiement à la livraison", text: "Espèces à la remise du colis, confirmation par vous ou par votre livreur.", plan: "FREE" },
      { title: "Paiement manuel vérifié", text: "Virement ou Mobile Money vers votre numéro, marqué payé après votre confirmation.", plan: "FREE" },
      { title: "Mobile Money automatique", text: "Wave, Orange Money, MTN MoMo et Moov Money par agrégateur, la commande passe payée toute seule.", plan: "STARTER" },
      { title: "Carte bancaire", text: "Paiement par carte pour vos clients hors zone Mobile Money, sur votre propre compte.", plan: "STARTER" },
      { title: "Rapprochement automatique", text: "Chaque transaction reliée à sa commande, avec sa référence. Plus de captures d'écran de reçus.", plan: "BUSINESS" },
      { title: "Remboursements", text: "Remboursement total ou partiel, déclenché depuis Axi chez les prestataires compatibles.", plan: "BUSINESS" },
    ],
  },
  {
    id: "livraison",
    domain: "paiements",
    title: "Livraison et retrait",
    description: "Zones, créneaux, livreurs et suivi : chaque commande sait où elle en est.",
    items: [
      { title: "Retrait en boutique", text: "Adresse, horaires et instructions de retrait affichés au paiement.", plan: "FREE" },
      { title: "Zones et frais de livraison", text: "Un tarif par quartier, par ville ou par région, calculé au panier.", plan: "STARTER" },
      { title: "Créneaux et capacité", text: "Nombre de commandes maximum par créneau, pour ne pas promettre l'impossible.", plan: "STARTER" },
      { title: "Commandes planifiées", text: "Le client choisit la date : gâteau pour samedi, plateau pour la semaine prochaine.", plan: "STARTER" },
      { title: "Livreurs internes et suivi", text: "Vos livreurs ont leur accès, le client suit sa commande par un lien.", plan: "BUSINESS" },
      { title: "Transporteurs", text: "Expédition vers d'autres villes avec vos partenaires.", plan: "SCALE" },
    ],
  },
  {
    id: "international",
    domain: "paiements",
    title: "International, fiscalité et contenu",
    description: "Vendre à la diaspora et à l'export sans tenir deux boutiques.",
    items: [
      { title: "Affichage multi-devises", text: "Vos prix convertis avec arrondis maîtrisés, marge de change et prix fixés quand vous le souhaitez.", plan: "STARTER" },
      { title: "TVA, prix TTC ou HT", text: "Taux par pays, mentions correctes au panier comme sur la facture.", plan: "STARTER" },
      { title: "Factures et avoirs numérotés", text: "Numérotation continue, sans trou, exportable pour votre comptabilité.", plan: "STARTER" },
      { title: "Blog de la boutique", text: "Articles, catégories, programmation et flux RSS, pour être trouvé sans publicité.", plan: "STARTER" },
      { title: "Traduction des contenus par l'IA", text: "Fiches et pages traduites à partir de vos crédits IA.", plan: "BUSINESS" },
      { title: "Boutique multilingue", text: "Interface et contenus dans plusieurs langues pour vos acheteurs (2 langues en Business, 5 en Scale).", plan: "BUSINESS" },
    ],
  },
  {
    id: "ia",
    domain: "ia",
    title: "Intelligence artificielle",
    description: "Une IA qui travaille sur vos vraies données, avec des autorisations que vous choisissez.",
    items: [
      { title: "Connecteur IA (MCP)", text: "Claude, ChatGPT, Cursor ou vos propres agents lisent et gèrent votre boutique. Lecture seule dès le plan Gratuit.", plan: "FREE" },
      { title: "Vitrine lisible par les IA", text: "Les assistants de vos acheteurs trouvent vos produits et préparent un panier que l'acheteur valide lui-même.", plan: "FREE" },
      { title: "Connexion en un clic (OAuth)", text: "Reliez Claude.ai ou ChatGPT à votre boutique sans manipuler de jeton.", plan: "BUSINESS" },
      { title: "Assistant de rédaction", text: "Fiches produits, descriptions de collections et réponses clients proposées en brouillon.", plan: "BUSINESS" },
      { title: "Résumés de ventes", text: "Ce qui a changé cette semaine, formulé en une phrase utile.", plan: "SCALE" },
    ],
  },
  {
    id: "pilotage",
    domain: "ia",
    title: "Équipe, pilotage et intégrations",
    description: "Travailler à plusieurs, mesurer, et relier Axi au reste de vos outils.",
    items: [
      { title: "Membres et rôles", text: "Vendeurs, préparateurs et livreurs, chacun avec son accès et ses droits.", plan: "BUSINESS" },
      { title: "Rapports avancés et Pixel Meta", text: "Ventes, panier moyen, produits qui partent, et vos campagnes publicitaires mesurées.", plan: "BUSINESS" },
      { title: "API REST et webhooks signés", text: "Reliez Axi à votre comptabilité, votre ERP ou vos automatisations.", plan: "BUSINESS" },
      { title: "Rôles personnalisés et journal d'audit", text: "Qui peut voir les prix, rembourser, modifier la boutique. Chaque action est tracée.", plan: "SCALE" },
      { title: "Plusieurs boutiques", text: "Trois boutiques sur le plan Scale, un nombre illimité sur Enterprise.", plan: "SCALE" },
      { title: "Caisse en magasin", text: "Encaisser au comptoir avec le même stock que la boutique en ligne, même sans connexion.", plan: "BUSINESS" },
      { title: "Revendeurs et marque blanche", text: "Pour les agences, réseaux et franchises.", plan: "ENTERPRISE" },
    ],
  },
];

export function groupsForDomain(domain: DomainSlug): CapabilityGroup[] {
  return CAPABILITY_GROUPS.filter((g) => g.domain === domain);
}

/* ───────────────────────── Paiements et canaux ───────────────────────── */

export type PaymentFamily = { title: string; text: string; methods: string[]; note?: string };

export const PAYMENT_FAMILIES: PaymentFamily[] = [
  {
    title: "Mobile Money",
    text: "Encaissement automatique par agrégateur, la commande passe payée sans intervention.",
    methods: ["Wave", "Orange Money", "MTN MoMo", "Moov Money", "Celtiis Cash", "Flooz", "T-Money", "Airtel Money"],
    note: "Via Paystack, pawaPay, CinetPay, FedaPay ou KkiaPay, selon votre pays et votre compte.",
  },
  {
    title: "Carte bancaire",
    text: "Pour vos clients hors zone Mobile Money, la diaspora et l'export.",
    methods: ["Visa", "Mastercard", "Stripe"],
    note: "Les fonds arrivent sur votre propre compte de paiement.",
  },
  {
    title: "Hors ligne",
    text: "Ce qui marche quand le paiement en ligne n'est pas une option.",
    methods: ["Espèces à la livraison", "Virement bancaire", "Paiement au retrait"],
    note: "La commande n'est jamais marquée payée sans votre confirmation.",
  },
];

export type Channel = { title: string; text: string };

export const CHANNELS: Channel[] = [
  { title: "Votre boutique", text: "Une adresse à vous, un lien et un QR code à partager partout." },
  { title: "WhatsApp", text: "Commande par lien, boîte partagée et catalogue synchronisé." },
  { title: "Instagram, Facebook, TikTok", text: "Flux catalogues publics, et les messages ramenés dans la même boîte." },
  { title: "Marketplace Axi", text: "Une place gratuite par ville et par catégorie pour les boutiques publiées." },
  { title: "Assistants IA", text: "Une vitrine lisible par Claude, ChatGPT et les agents d'achat." },
  { title: "En personne", text: "Retrait en boutique, QR code sur l'étal, caisse en magasin, même hors connexion." },
];

/* ───────────────────────── Parcours par profil ───────────────────────── */

export type Profile = { title: string; need: string; answer: string; href: string; cta: string };

export const PROFILES: Profile[] = [
  {
    title: "Je vends déjà sur WhatsApp",
    need: "Vous envoyez vos photos une par une et vous notez les commandes à la main.",
    answer: "Publiez un catalogue en ligne, répondez par un lien, et laissez Axi suivre les commandes, les paiements et les livraisons.",
    href: "/whatsapp",
    cta: "Voir le commerce conversationnel",
  },
  {
    title: "J'ouvre ma première boutique",
    need: "Vous partez de zéro et vous ne voulez pas d'un chantier technique.",
    answer: "Décrivez votre activité, l'IA propose une boutique complète, vous ajustez dans l'éditeur et vous publiez le jour même.",
    href: "/boutique-en-ligne",
    cta: "Voir la boutique et l'éditeur",
  },
  {
    title: "Je migre depuis une autre plateforme",
    need: "Vous avez déjà un catalogue, des clients et des habitudes.",
    answer: "Importez votre catalogue au format CSV compatible Shopify, branchez votre domaine, vos webhooks et l'API REST.",
    href: "/developpeurs",
    cta: "Voir l'API et les webhooks",
  },
  {
    title: "Je vends à la diaspora et à l'export",
    need: "Vos acheteurs ne sont pas tous dans le même pays, ni dans la même devise.",
    answer: "Affichez vos prix en plusieurs devises, gérez la TVA et les factures, encaissez en Mobile Money comme en carte.",
    href: "/paiements",
    cta: "Voir les paiements",
  },
];

/* ───────────────────────── Preuves par le produit (captures réelles) ───────────────────────── */

export type Shot = {
  /** Fichier dans /public/vitrine, produit par `node scripts/vitrine-captures.mjs produit`. */
  src: string;
  width: number;
  height: number;
  alt: string;
  caption: string;
  /** Une capture d'interface marchande (thème sombre) ou de vitrine acheteur (thème clair). */
  tone: "dark" | "light";
};

const DESK = { width: 1440, height: 900 } as const;
const PHONE = { width: 390, height: 844 } as const;

export const SHOTS = {
  editeur: {
    src: "/vitrine/editeur.webp",
    width: 1440,
    height: 700,
    tone: "dark",
    alt: "Éditeur de thème Axi : la liste des sections à gauche, l'aperçu cliquable de la boutique au centre, les réglages à droite, et un score de qualité de 94 sur 100.",
    caption: "L'éditeur de thème : sections, blocs, aperçu cliquable et score de qualité en direct.",
  },
  produits: {
    src: "/vitrine/produits.webp",
    ...DESK,
    tone: "dark",
    alt: "Liste des produits d'une boutique Axi, avec prix, stock et statut.",
    caption: "Le catalogue : variantes, collections, stock et import CSV.",
  },
  commandes: {
    src: "/vitrine/commandes.webp",
    ...DESK,
    tone: "dark",
    alt: "Liste des commandes d'une boutique Axi, avec statut de paiement et de livraison.",
    caption: "Les commandes, du paiement à la livraison, avec leur référence.",
  },
  paiements: {
    src: "/vitrine/paiements.webp",
    ...DESK,
    tone: "dark",
    alt: "Réglages des moyens de paiement d'une boutique Axi : Mobile Money, carte et paiement à la livraison.",
    caption: "Les moyens de paiement, branchés sur vos propres comptes.",
  },
  conversations: {
    src: "/vitrine/conversations.webp",
    ...DESK,
    tone: "dark",
    alt: "Boîte de réception partagée d'Axi : liste des conversations WhatsApp et fil de discussion.",
    caption: "La boîte partagée : toute l'équipe répond depuis le même numéro.",
  },
  entonnoir: {
    src: "/vitrine/entonnoir.webp",
    ...DESK,
    tone: "dark",
    alt: "Entonnoir de vente d'Axi : colonnes Nouveau, Intéressé, Commande et Payé, avec la valeur en jeu.",
    caption: "L'entonnoir : chaque conversation avance jusqu'à la commande payée.",
  },
  connecteurIa: {
    src: "/vitrine/connecteur-ia.webp",
    width: 1440,
    height: 660,
    tone: "dark",
    alt: "Page Connecteurs IA d'Axi : jetons actifs, applications connectées, quotas et étapes de connexion à Claude.",
    caption: "Le connecteur IA : jetons, quotas et connexion en un clic.",
  },
  ficheProduit: {
    src: "/vitrine/fiche-produit.webp",
    ...PHONE,
    tone: "light",
    alt: "Fiche produit d'une boutique Axi sur mobile : photo plein cadre, note des avis clients, prix en FCFA et choix de la taille.",
    caption: "La fiche produit vue par l'acheteur, avec ses avis et ses variantes.",
  },
  boutiqueMobile: {
    src: "/vitrine/boutique-mobile.webp",
    width: 390,
    height: 690,
    tone: "light",
    alt: "Page d'accueil d'une boutique Axi sur mobile : bannière plein cadre, nom de la boutique et bouton vers le catalogue.",
    caption: "La boutique publiée, telle que la voit votre client.",
  },
  boutiqueBureau: {
    src: "/vitrine/boutique-bureau.webp",
    ...DESK,
    tone: "light",
    alt: "Page d'accueil d'une boutique Axi sur grand écran : bannière, produits mis en avant et avis.",
    caption: "La même boutique sur grand écran.",
  },
} satisfies Record<string, Shot>;

export type ShotKey = keyof typeof SHOTS;
