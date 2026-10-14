"use client";

import { MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { logWhatsappClick } from "@/lib/storefront/actions";

/**
 * Lien wa.me prérempli. Le clic est journalisé comme tentative (OrderEvent "whatsapp_click") :
 * rien n'est envoyé automatiquement, c'est l'utilisateur qui envoie depuis WhatsApp.
 */
export function WhatsappOrderButton({ href, orderId, trackingToken, children, size = "lg", className }: { href: string; orderId: string; trackingToken: string; children: React.ReactNode; size?: "md" | "lg"; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => {
        void logWhatsappClick(orderId, trackingToken).catch(() => undefined);
      }}
      className={cn(
        "inline-flex w-full items-center justify-center gap-2 rounded-full bg-whatsapp-deep font-semibold text-white shadow-sm transition-transform active:scale-[0.98]",
        size === "lg" ? "h-14 px-6 text-base" : "h-11 px-4 text-sm",
        className,
      )}
    >
      <MessageCircle className={size === "lg" ? "size-6" : "size-5"} aria-hidden />
      {children}
    </a>
  );
}
