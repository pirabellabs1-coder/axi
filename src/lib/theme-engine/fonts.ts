/**
 * Polices de la boutique (liste fermée `FontId`), chargées par next/font : fichiers auto-hébergés au build,
 * `display: swap`, aucune requête tierce chez le visiteur, aucun préchargement des polices non utilisées.
 * Geist est déjà chargée en local par le layout racine (variable --font-geist).
 * Repli : chaque pile CSS (theme-doc.ts → fontStack) se termine par des polices système ; si le réseau bloque
 * le build, retirer ce module et `storeFontClassName` vaut "" : la boutique s'affiche en polices système.
 */
import { Cormorant_Garamond, DM_Sans, Fraunces, Inter_Tight, Manrope, Outfit, Playfair_Display, Plus_Jakarta_Sans, Space_Grotesk } from "next/font/google";

// next/font exige des littéraux d'objet (pas de spread ni de constante partagée).
const interTight = Inter_Tight({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-sf-inter-tight" });
const manrope = Manrope({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-sf-manrope" });
const dmSans = DM_Sans({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-sf-dm-sans" });
const plusJakarta = Plus_Jakarta_Sans({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-sf-plus-jakarta" });
const outfit = Outfit({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-sf-outfit" });
const fraunces = Fraunces({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-sf-fraunces" });
const playfair = Playfair_Display({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-sf-playfair" });
const cormorant = Cormorant_Garamond({ subsets: ["latin"], display: "swap", preload: false, weight: ["400", "500", "600", "700"], variable: "--font-sf-cormorant" });
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-sf-space-grotesk" });

/** Classes définissant les variables --font-sf-* (les fichiers ne sont téléchargés que si la police est utilisée). */
export const storeFontClassName = [interTight, manrope, dmSans, plusJakarta, outfit, fraunces, playfair, cormorant, spaceGrotesk].map((f) => f.variable).join(" ");
