import { Mail, MessageCircle } from "lucide-react";
import { S } from "@/lib/storefront/theme-doc";
import { waLink } from "@/lib/whatsapp";
import type { SectionProps } from "../render-context";
import { btnClass, headingClass, SectionShell } from "../ui";

/**
 * Inscription aux nouveautés : le visiteur écrit lui-même à la boutique (WhatsApp ou e-mail).
 * Aucune donnée collectée par la page : consentement explicite par l'envoi du message.
 */
export default function Newsletter({ section, ctx }: SectionProps) {
  const store = ctx.data.store;
  const channel = S.str(section.settings, "channel", "whatsapp");
  const heading = S.str(section.settings, "heading", "Restez informé");
  const text = S.str(section.settings, "text");
  const href =
    channel === "email" && store.email
      ? `mailto:${store.email}?subject=${encodeURIComponent(`Inscription aux nouveautés de ${store.name}`)}`
      : store.whatsappNumber
        ? waLink(store.whatsappNumber, `Bonjour ${store.name}, je souhaite recevoir vos nouveautés et offres sur WhatsApp.`)
        : null;
  if (!href) return null;
  const isMail = href.startsWith("mailto:");
  return (
    <SectionShell section={section} ctx={ctx} label={heading}>
      <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
        <h2 className={headingClass(S.str(section.settings, "heading_size", "md"))}>{heading}</h2>
        {text && <p className="mt-3 max-w-[52ch] text-[16px] leading-relaxed text-ink-muted">{text}</p>}
        <a href={href} {...(isMail ? {} : { target: "_blank", rel: "noopener noreferrer" })} className={`${btnClass("solid", "lg")} mt-7`}>
          {isMail ? <Mail className="size-5" aria-hidden /> : <MessageCircle className="size-5" aria-hidden />}
          {isMail ? "S'inscrire par e-mail" : "S'inscrire sur WhatsApp"}
        </a>
        <p className="mt-3 text-xs text-ink-muted">Vous pouvez vous désinscrire à tout moment en le demandant à la boutique.</p>
      </div>
    </SectionShell>
  );
}
