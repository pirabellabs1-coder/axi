/**
 * Éléments de démonstration de la bibliothèque (seed). Module pur : uniquement des types de sections existants,
 * aucune référence d'identifiant (collections et produits laissés vides), images https publiques (Unsplash).
 * Chaque charge est vérifiée par `validateLibraryPayload` dans les tests.
 */
const img = (id: string, w = 1600, h?: number) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&q=72${h ? `&h=${h}` : ""}`;

export type DemoLibraryItem = {
  slug: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  premium: boolean;
  minPlan: "FREE" | "STARTER" | "BUSINESS";
  payload: Record<string, unknown>;
};

export const DEMO_LIBRARY_ITEMS: DemoLibraryItem[] = [
  {
    slug: "hero-atelier-wax",
    name: "Bannière atelier",
    description: "Grande image d'atelier, titre court et deux boutons : idéale pour une page d'accueil mode ou artisanat.",
    category: "Mise en avant",
    tags: ["accueil", "mode", "artisanat"],
    premium: false,
    minPlan: "FREE",
    payload: {
      type: "hero-banner",
      settings: { image: { url: img("photo-1790943780822-9918073fe9f1"), alt: "Deux couturières en tenues en pagne au travail" }, height: "large", layout: "overlay", content_position: "bottom-left", overlay_opacity: 35, scheme: "inverse" },
      blocks: [
        { type: "heading", settings: { text: "Cousu main, porté avec fierté", size: "xl" } },
        { type: "text", settings: { text: "Des pièces en wax et en pagne tissé, coupées à la commande dans notre atelier." } },
        { type: "button", settings: { button_label: "Voir la collection", button_link: "/catalogue", button_style: "solid" } },
        { type: "button", settings: { button_label: "Commander sur WhatsApp", button_link: "/catalogue", button_style: "outline" } },
      ],
    },
  },
  {
    slug: "garanties-mobile-money",
    name: "Garanties : livraison, paiement, échange",
    description: "Quatre engagements rassurants avec icônes, à placer sous la bannière ou avant le pied de page.",
    category: "Confiance",
    tags: ["confiance", "réassurance", "paiement"],
    premium: false,
    minPlan: "FREE",
    payload: {
      type: "trust-badges",
      settings: { scheme: "surface", padding_top: 32, padding_bottom: 32 },
      blocks: [
        { type: "badge", settings: { icon: "truck", title: "Livraison en 24 h", text: "Dans votre ville, suivie sur WhatsApp." } },
        { type: "badge", settings: { icon: "shield", title: "Paiement Mobile Money", text: "Wave, Orange Money, MTN ou à la livraison." } },
        { type: "badge", settings: { icon: "refresh", title: "Échange sous 7 jours", text: "Taille ou couleur, sans complication." } },
        { type: "badge", settings: { icon: "chat", title: "Une vraie personne", text: "Réponse rapide, du lundi au samedi." } },
      ],
    },
  },
  {
    slug: "faq-commande-livraison",
    name: "Questions fréquentes : commande et livraison",
    description: "Les cinq questions que posent tous les clients avant d'acheter, avec des réponses à adapter.",
    category: "Texte",
    tags: ["faq", "livraison", "paiement"],
    premium: false,
    minPlan: "FREE",
    payload: {
      type: "faq",
      settings: { heading: "Avant de commander", heading_size: "lg", scheme: "default", padding_top: 64, padding_bottom: 64 },
      blocks: [
        { type: "question", settings: { question: "Comment passer commande ?", answer: "Ajoutez vos articles au panier puis validez : nous confirmons chaque commande sur **WhatsApp** dans l'heure." } },
        { type: "question", settings: { question: "Quels moyens de paiement acceptez-vous ?", answer: "Mobile Money (Wave, Orange Money, MTN, Moov) ou espèces à la livraison." } },
        { type: "question", settings: { question: "Combien coûte la livraison ?", answer: "Les frais s'affichent au moment de commander, selon votre quartier ou votre ville." } },
        { type: "question", settings: { question: "Sous quel délai suis-je livré ?", answer: "24 à 48 h en ville, 2 à 4 jours pour les autres villes." } },
        { type: "question", settings: { question: "Puis-je échanger un article ?", answer: "Oui, sous 7 jours, s'il n'a pas été porté. Écrivez-nous pour organiser l'échange." } },
      ],
    },
  },
  {
    slug: "histoire-image-texte",
    name: "Notre histoire",
    description: "Portrait du fondateur ou de l'atelier à côté d'un texte court : la section qui crée la confiance.",
    category: "Mise en avant",
    tags: ["à propos", "marque", "histoire"],
    premium: false,
    minPlan: "STARTER",
    payload: {
      type: "image-with-text",
      settings: { image: { url: img("photo-1687422809069-0fa3546b8471", 1200, 1500), alt: "Couturier souriant à sa machine à coudre" }, image_position: "left", image_ratio: "portrait", scheme: "default", padding_top: 80, padding_bottom: 80 },
      blocks: [
        { type: "heading", settings: { text: "Un atelier, une famille, un savoir-faire", size: "lg" } },
        { type: "text", settings: { text: "Tout a commencé avec une machine à coudre et un étal au marché. Aujourd'hui, chaque pièce est encore **coupée et cousue à la main**, avec des tissus choisis un par un.\n\nRacontez ici votre histoire : qui vous êtes, ce qui vous rend fier, pourquoi vos clients reviennent." } },
        { type: "button", settings: { button_label: "Découvrir nos créations", button_link: "/catalogue", button_style: "link" } },
      ],
    },
  },
  {
    slug: "lookbook-galerie-mosaique",
    name: "Lookbook en mosaïque",
    description: "Galerie éditoriale en mosaïque avec légendes : mettez en scène une collection comme un magazine.",
    category: "Médias",
    tags: ["lookbook", "galerie", "mode"],
    premium: true,
    minPlan: "BUSINESS",
    payload: {
      type: "image-gallery",
      settings: { heading: "Le lookbook de la saison", heading_size: "lg", layout: "masonry", scheme: "default", padding_top: 64, padding_bottom: 64 },
      blocks: [
        { type: "image", settings: { image: { url: img("photo-1709809081557-78f803ce93a0", 1000, 1300), alt: "Robe en wax portée en extérieur" }, caption: "Robe Abomey, wax hollandais", link: "/catalogue" } },
        { type: "image", settings: { image: { url: img("photo-1768212565426-58b089b6386d", 1000, 800), alt: "Pagnes colorés exposés à la vente" }, caption: "Nos tissus, choisis au marché", link: "" } },
        { type: "image", settings: { image: { url: img("photo-1696962678565-bee84e6b9cb6", 1000, 1300), alt: "Robe jaune en pagne" }, caption: "Couleurs de saison", link: "/catalogue" } },
        { type: "image", settings: { image: { url: img("photo-1763823133159-c6f8ec380e33", 1000, 1300), alt: "Chemise homme en wax" }, caption: "Chemise homme, coupe droite", link: "/catalogue" } },
        { type: "image", settings: { image: { url: img("photo-1655682604476-96976c1917fb", 1000, 800), alt: "Sac en tissu wax" }, caption: "Accessoires assortis", link: "/catalogue" } },
      ],
    },
  },
  {
    slug: "temoignages-clients-grille",
    name: "Avis clients en grille",
    description: "Trois témoignages à remplir avec de VRAIS avis de vos clients (prénom et ville), note sur 5.",
    category: "Confiance",
    tags: ["avis", "témoignages", "confiance"],
    premium: true,
    minPlan: "BUSINESS",
    payload: {
      type: "testimonials",
      settings: { heading: "Ce que disent nos clientes", heading_size: "lg", layout: "grid", scheme: "surface", padding_top: 64, padding_bottom: 64 },
      blocks: [
        { type: "testimonial", settings: { quote: "Remplacez ce texte par l'avis d'un client réel, avec son accord.", author: "Prénom du client", role: "Ville", rating: 5 } },
        { type: "testimonial", settings: { quote: "Un deuxième avis réel : ce qui lui a plu, la livraison, la qualité.", author: "Prénom du client", role: "Ville", rating: 5 } },
        { type: "testimonial", settings: { quote: "Un troisième avis réel. Évitez les avis inventés : vos clients le sentent.", author: "Prénom du client", role: "Ville", rating: 5 } },
      ],
    },
  },
];
