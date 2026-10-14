import { Mail, MapPin, MessageCircle, Navigation, Phone } from "lucide-react";
import { S } from "@/lib/storefront/theme-doc";
import { formatPhone } from "@/lib/utils";
import { waLink } from "@/lib/whatsapp";
import type { SectionProps } from "../render-context";
import { OpenStatus } from "../open-status";
import { btnClass, SectionHeading, SectionShell } from "../ui";

export default function Contact({ section, ctx }: SectionProps) {
  const s = ctx.data.store;
  const place = [s.address, s.city].filter(Boolean).join(", ");
  if (!s.phone && !place && !s.email && !s.whatsappNumber) return null;
  const row = "flex min-h-12 items-center gap-3 text-[16px] text-ink";
  const digits = s.phone?.replace(/\D/g, "") ?? "";
  return (
    <SectionShell section={section} ctx={ctx}>
      <SectionHeading section={section} ctx={ctx} fallback="Nous trouver" aside={s.openNow !== null ? <OpenStatus open={s.openNow} /> : undefined} />
      <div className="grid grid-cols-1 gap-4 rounded-[var(--store-card-radius)] bg-surface p-6 ring-1 ring-line sm:p-8 md:grid-cols-[1fr_auto] md:items-center">
        <div className="grid gap-1">
          {place && (
            <p className={row}>
              <MapPin className="size-5 shrink-0 text-[var(--store-primary)]" aria-hidden />
              {place}
            </p>
          )}
          {digits && (
            <a href={`tel:+${digits}`} className={`${row} hover:underline`}>
              <Phone className="size-5 shrink-0 text-[var(--store-primary)]" aria-hidden />
              {formatPhone(digits)}
            </a>
          )}
          {s.email && (
            <a href={`mailto:${s.email}`} className={`${row} break-all hover:underline`}>
              <Mail className="size-5 shrink-0 text-[var(--store-primary)]" aria-hidden />
              {s.email}
            </a>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {s.whatsappNumber && (
            <a href={waLink(s.whatsappNumber, `Bonjour ${s.name}, j'ai une question.`)} target="_blank" rel="noopener noreferrer" className="sf-btn sf-btn-whatsapp h-12 px-5 text-sm">
              <MessageCircle className="size-4" aria-hidden /> WhatsApp
            </a>
          )}
          {place && S.bool(section.settings, "show_map_link", true) && (
            <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${s.name} ${place}`)}`} target="_blank" rel="noopener noreferrer" className={btnClass("outline")}>
              <Navigation className="size-4" aria-hidden /> Itinéraire
            </a>
          )}
        </div>
      </div>
    </SectionShell>
  );
}
