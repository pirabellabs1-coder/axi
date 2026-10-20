/**
 * Polices de la boutique (liste fermée `FontId`), AUTO-HÉBERGÉES : les fichiers `.woff2` (sous-ensemble latin)
 * sont versionnés dans `./fonts/` et chargés par `next/font/local`. Le build ne fait AUCUN appel réseau (ni à
 * Google) : il est 100 % déterministe (plus de flake `next/font/google` en CI ni en prod). `display: swap`,
 * aucune requête tierce chez le visiteur, aucun préchargement des polices non utilisées (`preload: false`).
 * Geist est déjà chargée en local par le layout racine (variable --font-geist).
 *
 * Fichiers : un woff2 variable par famille (axe `wght` ; les axes secondaires comme `opsz`/`SOFT`/`WONK` ne sont
 * pas embarqués — rendu identique à l'usage). Pour régénérer après une mise à jour d'une police, retélécharger le
 * woff2 latin depuis Google Fonts (css2, en-tête navigateur) et remplacer le fichier.
 * Repli : chaque pile CSS (theme-doc.ts → fontStack) se termine par des polices système.
 */
import localFont from "next/font/local";

// next/font exige des littéraux d'objet (pas de spread ni de constante partagée). Plage de graisses = axe wght.
const interTight = localFont({ src: "./fonts/inter-tight.woff2", display: "swap", preload: false, weight: "100 900", style: "normal", variable: "--font-sf-inter-tight" });
const manrope = localFont({ src: "./fonts/manrope.woff2", display: "swap", preload: false, weight: "200 800", style: "normal", variable: "--font-sf-manrope" });
const dmSans = localFont({ src: "./fonts/dm-sans.woff2", display: "swap", preload: false, weight: "100 1000", style: "normal", variable: "--font-sf-dm-sans" });
const plusJakarta = localFont({ src: "./fonts/plus-jakarta.woff2", display: "swap", preload: false, weight: "200 800", style: "normal", variable: "--font-sf-plus-jakarta" });
const outfit = localFont({ src: "./fonts/outfit.woff2", display: "swap", preload: false, weight: "100 900", style: "normal", variable: "--font-sf-outfit" });
const fraunces = localFont({ src: "./fonts/fraunces.woff2", display: "swap", preload: false, weight: "100 900", style: "normal", variable: "--font-sf-fraunces" });
const playfair = localFont({ src: "./fonts/playfair.woff2", display: "swap", preload: false, weight: "400 900", style: "normal", variable: "--font-sf-playfair" });
const cormorant = localFont({ src: "./fonts/cormorant.woff2", display: "swap", preload: false, weight: "400 700", style: "normal", variable: "--font-sf-cormorant" });
const spaceGrotesk = localFont({ src: "./fonts/space-grotesk.woff2", display: "swap", preload: false, weight: "300 700", style: "normal", variable: "--font-sf-space-grotesk" });

/** Classes définissant les variables --font-sf-* (les fichiers ne sont servis que si la police est utilisée). */
export const storeFontClassName = [interTight, manrope, dmSans, plusJakarta, outfit, fraunces, playfair, cormorant, spaceGrotesk].map((f) => f.variable).join(" ");
