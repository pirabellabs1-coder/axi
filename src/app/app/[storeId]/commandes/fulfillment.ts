import { Truck, Store as StoreIcon, MessageCircle, Gift } from "lucide-react";

// DIGITAL (lot 1) : panier composé uniquement de cartes cadeaux, sans livraison
export const FULFILLMENT_ICON = { PICKUP: StoreIcon, DELIVERY: Truck, WHATSAPP: MessageCircle, DIGITAL: Gift } as const;
export const FULFILLMENT_LABEL = { PICKUP: "Retrait", DELIVERY: "Livraison", WHATSAPP: "Commande WhatsApp", DIGITAL: "Envoi numérique" } as const;
export const CHANNEL_LABEL = { STORE: "Boutique en ligne", WHATSAPP: "WhatsApp", MANUAL: "Saisie manuelle", POS: "Caisse en magasin" } as const;
