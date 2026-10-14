import Link from "next/link";
import { Logo } from "@/components/ui/logo";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { SITE } from "@/config/site";
import { PROMISE } from "@/lib/marketing/positioning";

const COLS = [
  {
    title: "Plateforme",
    links: [
      { href: "/fonctionnalites", label: "Toutes les fonctionnalités" },
      { href: "/boutique-en-ligne", label: "Boutique et catalogue" },
      { href: "/paiements", label: "Paiements et livraison" },
      { href: "/whatsapp", label: "WhatsApp et clients" },
      { href: "/ia", label: "Intelligence artificielle" },
      { href: "/tarifs", label: "Tarifs" },
    ],
  },
  {
    title: "Vendre",
    links: [
      { href: "/boutique-en-ligne#design", label: "Éditeur de boutique" },
      { href: "/boutique-en-ligne#catalogue", label: "Catalogue et stock" },
      { href: "/paiements#international", label: "Multi-devises et TVA" },
      { href: "/whatsapp#ventes", label: "Remises et fidélité" },
      { href: "/marketplace", label: "Marketplace Axi" },
      { href: "/fonctionnalites#secteurs", label: "Modèles par secteur" },
    ],
  },
  {
    title: "Développeurs",
    links: [
      { href: "/developpeurs", label: "Vue d'ensemble" },
      { href: "/developpeurs#api", label: "API REST" },
      { href: "/developpeurs#webhooks", label: "Webhooks signés" },
      { href: "/developpeurs#outils", label: "Connecteur IA (MCP)" },
      { href: "/developpeurs#vitrine", label: "Commerce agentique" },
    ],
  },
  {
    title: "Ressources",
    links: [
      { href: "/aide", label: "Centre d'aide" },
      { href: "/aide#demarrer", label: "Bien démarrer" },
      { href: "/statut", label: "Statut du service" },
      { href: "/contact", label: "Contact" },
      { href: "/a-propos", label: "À propos" },
    ],
  },
  {
    title: "Société",
    links: [
      { href: "/legal/cgu", label: "Conditions d'utilisation" },
      { href: "/legal/confidentialite", label: "Confidentialité" },
      { href: "/legal/cookies", label: "Cookies" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-canvas-deep">
      <div className="container-x pb-10 pt-16 md:pt-20">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[1fr_2.6fr]">
          <div className="max-w-sm">
            <Logo />
            <p className="mt-5 text-[15px] leading-relaxed text-ink-muted">{PROMISE.short}</p>
            <div className="mt-6 flex items-center gap-3">
              <span className="text-sm text-ink-muted">
                Apparence
              </span>
              <ThemeToggle />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 lg:grid-cols-5">
            {COLS.map((c) => (
              <nav key={c.title} aria-label={c.title}>
                <p className="text-sm font-semibold text-ink">{c.title}</p>
                <ul className="mt-4 space-y-1">
                  {c.links.map((l) => (
                    <li key={l.href}>
                      <Link href={l.href} className="inline-flex min-h-9 items-center text-[14px] text-ink-muted transition-colors duration-300 hover:text-ink">
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        <div className="mt-16 flex flex-col gap-3 border-t border-line pt-6 text-[13px] text-ink-faint md:flex-row md:items-center md:justify-between">
          <p>
            © {new Date().getFullYear()} {SITE.company}, {SITE.address}. Tous droits réservés.
          </p>
          <p>Prix hors taxes, en euros ou en FCFA selon le pays de votre boutique. 0 % de commission sur vos ventes.</p>
        </div>
      </div>
    </footer>
  );
}
