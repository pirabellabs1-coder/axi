"use client";

import { usePathname } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { waLink } from "@/lib/whatsapp";

/**
 * Bouton WhatsApp flottant : ouvre wa.me avec un message de contact (aucun envoi automatique).
 * Masqué là où une barre d'action collante occupe le bas de l'écran (fiche produit, commande, confirmation).
 */
export function WhatsappFab({ number, storeName }: { number: string; storeName: string }) {
  const pathname = usePathname() ?? "";
  if (/\/(commander|merci|p|panier)(\/|$)/.test(pathname)) return null;
  const href = waLink(number, `Bonjour ${storeName}, j'ai une question sur votre boutique.`);
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Contacter ${storeName} sur WhatsApp`}
      className="fixed bottom-5 right-4 z-40 inline-flex size-14 items-center justify-center gap-2 rounded-full bg-whatsapp-deep text-sm font-semibold text-white shadow-[0_16px_40px_-12px_rgb(15_122_92/0.7)] transition-transform duration-200 ease-out active:scale-[0.96] sm:bottom-6 sm:right-6 sm:w-auto sm:pl-4 sm:pr-5"
    >
      <MessageCircle className="size-6" aria-hidden />
      <span className="hidden sm:inline">WhatsApp</span>
    </a>
  );
}
