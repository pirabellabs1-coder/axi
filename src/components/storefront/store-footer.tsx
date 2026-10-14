import Link from "next/link";
import { AtSign, MapPin, MessageCircle, Music2, Phone, Play, ThumbsUp } from "lucide-react";
import { AxiMark } from "@/components/ui/logo";
import { formatPhone } from "@/lib/utils";
import { waLink } from "@/lib/whatsapp";
import type { GlobalSettings } from "@/lib/theme-engine/types";
import type { RenderData } from "@/lib/storefront/render-types";
import { ReportStoreButton } from "./report-store";
import { ConsentSettingsButton } from "./store-analytics";
import { chargeNotice } from "@/lib/storefront/currency-view";
import { FooterExtras } from "./pwa/footer-extras"; // Lot 4D (CAN) : mode économie de données et notifications

const MENU_TITLES: Record<string, string> = { footer: "Informations", main: "Boutique", legal: "Mentions" };

/** Pied de page piloté par `settings.footer` : texte, menus, contact, réseaux, moyens de paiement, signalement. */
export function StoreFooter({ settings, data, minimal = false }: { settings: GlobalSettings; data: RenderData; minimal?: boolean }) {
  const f = settings.footer;
  const s = data.store;
  const year = new Date(data.now).getUTCFullYear();
  const place = [s.address, s.city].filter(Boolean).join(", ");
  const digits = s.phone?.replace(/\D/g, "") ?? "";
  const menus = (f.menus.length ? f.menus : ["footer"]).map((h) => ({ handle: h, links: data.menus[h] ?? [] })).filter((m) => m.links.length);
  // Lot 2 (devises) : mention d'encaissement, présente au moins une fois sur chaque page de la boutique.
  const currencyNotice = chargeNotice(data.currency);
  const social = [
    f.social.instagram && { href: f.social.instagram, label: "Instagram", icon: AtSign },
    f.social.facebook && { href: f.social.facebook, label: "Facebook", icon: ThumbsUp },
    f.social.tiktok && { href: f.social.tiktok, label: "TikTok", icon: Music2 },
    f.social.youtube && { href: f.social.youtube, label: "YouTube", icon: Play },
    (f.social.whatsapp || s.whatsappNumber) && { href: waLink(f.social.whatsapp || s.whatsappNumber!, `Bonjour ${s.name}`), label: "WhatsApp", icon: MessageCircle },
  ].filter((x): x is { href: string; label: string; icon: typeof AtSign } => !!x);

  if (minimal) {
    return (
      <footer className="mt-16 border-t border-line">
        <div className="sf-container flex flex-wrap items-center justify-between gap-3 py-6 text-xs text-ink-muted">
          <p>
            © {year} {s.name}
          </p>
          {currencyNotice && <p className="order-last w-full">{currencyNotice}</p>}
          {(s.metaPixelId || s.gaMeasurementId) && <ConsentSettingsButton className="text-xs" />}
          {s.showPoweredBy && (
            <Link href="/" className="inline-flex min-h-10 items-center gap-2 font-medium hover:text-ink">
              <AxiMark size={16} /> Propulsé par Axi
            </Link>
          )}
        </div>
      </footer>
    );
  }

  return (
    <footer data-section-group="footer" className="relative mt-12 border-t border-line bg-surface">
      <div className="sf-container grid grid-cols-1 gap-10 py-12 sm:grid-cols-2 lg:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div>
          <p className="text-lg font-semibold tracking-[-0.02em] text-ink" style={{ fontFamily: "var(--store-font-heading)" }}>
            {s.name}
          </p>
          {(f.text || s.tagline) && <p className="mt-2 max-w-[42ch] whitespace-pre-line text-sm leading-relaxed text-ink-muted">{f.text || s.tagline}</p>}
          {f.showSocial && social.length > 0 && (
            <ul className="mt-5 flex flex-wrap gap-2" aria-label="Réseaux sociaux">
              {social.map(({ href, label, icon: Icon }) => (
                <li key={label}>
                  <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center gap-2 rounded-full bg-surface-2 px-4 text-sm font-medium text-ink transition-colors hover:bg-[var(--store-primary)] hover:text-[var(--store-primary-contrast)]">
                    <Icon className="size-4" aria-hidden />
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
        {menus.map((m) => (
          <nav key={m.handle} aria-label={MENU_TITLES[m.handle] ?? m.handle} className="text-sm">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-ink-muted">{MENU_TITLES[m.handle] ?? "Liens"}</p>
            <ul>
              {m.links.map((l, i) => (
                <li key={i}>
                  <Link href={l.href} className="inline-flex min-h-10 items-center text-ink-muted hover:text-ink">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
        {(place || digits) && (
          <div className="space-y-1 text-sm">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-ink-muted">Contact</p>
            {place && (
              <p className="flex items-start gap-2 py-2 text-ink-muted">
                <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{place}</span>
              </p>
            )}
            {digits && (
              <a href={`tel:+${digits}`} className="flex min-h-10 items-center gap-2 text-ink-muted hover:text-ink">
                <Phone className="size-4 shrink-0" aria-hidden />
                {formatPhone(digits)}
              </a>
            )}
          </div>
        )}
      </div>
      {f.showPaymentIcons && s.paymentLabels.length > 0 && (
        <div className="sf-container pb-6">
          <p className="sr-only">Moyens de paiement acceptés</p>
          <ul className="flex flex-wrap gap-2">
            {s.paymentLabels.map((p) => (
              <li key={p} className="rounded-[8px] bg-surface-2 px-3 py-1.5 text-xs font-medium text-ink-muted ring-1 ring-inset ring-line">
                {p}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="border-t border-line">
        <div className="sf-container flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-4 text-xs text-ink-muted">
          <p>
            © {year} {s.name}
          </p>
          {currencyNotice && <p className="order-last w-full max-w-[70ch]">{currencyNotice}</p>}
          <div className="flex flex-wrap items-center gap-x-3">
            <FooterExtras />
            {(s.metaPixelId || s.gaMeasurementId) && <ConsentSettingsButton className="text-xs" />}
            <ReportStoreButton slug={s.slug} storeName={s.name} className="text-xs" />
            {s.showPoweredBy && (
              <Link href="/" className="inline-flex min-h-11 items-center gap-2 rounded-full px-1 font-medium hover:text-ink">
                <AxiMark size={16} /> Propulsé par Axi
              </Link>
            )}
          </div>
        </div>
      </div>
    </footer>
  );
}
