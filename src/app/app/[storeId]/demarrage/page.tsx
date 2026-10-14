import type { Metadata } from "next";
import Link from "next/link";
import {
  Check,
  ChevronDown,
  CreditCard,
  ExternalLink,
  MessageCircle,
  Package,
  Palette,
  Rocket,
  ShoppingBag,
  Sparkles,
  Truck,
  type LucideIcon,
} from "lucide-react";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { getCountry } from "@/config/site";
import { ADD_ONS, ZONE_CURRENCY, zoneForCurrency, type PricingZone } from "@/config/plans";
import { formatMoney } from "@/lib/money";
import { PageHeader, StatusDot } from "@/components/ui/misc";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { ContactForm } from "./contact-form";
import { PublishPanel, ShareLink } from "./publish-panel";

export const metadata: Metadata = { title: "Démarrage" };

type Step = { id: string; title: string; summary: string; done: boolean; icon: LucideIcon; body: React.ReactNode };

export default async function OnboardingPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const ctx = await getStoreContext(storeId, "store.view");
  const store = ctx.store;
  const base = `/app/${store.id}`;
  const country = getCountry(store.country);
  const publicPath = `/s/${store.slug}`;
  const storeUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}${publicPath}`;

  const [activeProducts, zones, methods, orders] = await Promise.all([
    db.product.count({ where: { storeId: store.id, status: "ACTIVE" } }),
    db.deliveryZone.count({ where: { storeId: store.id, active: true } }),
    db.paymentMethod.count({ where: { storeId: store.id, active: true } }),
    db.order.count({ where: { storeId: store.id } }),
  ]);

  const published = store.status === "PUBLISHED";
  const canSettings = ctx.can("store.settings");
  const canProducts = ctx.can("products.manage");
  const canTheme = ctx.can("theme.manage");
  const canPublish = ctx.can("store.publish");
  const fulfilment = zones > 0 || store.pickupEnabled;
  const branded = !!store.logoUrl || !!store.bannerUrl;

  const zone: PricingZone = (store.subscription?.zone as PricingZone | undefined) ?? zoneForCurrency(store.currency);
  const dfy = ADD_ONS.find((a) => a.id === "DONE_FOR_YOU");
  const dfyPrice = dfy ? formatMoney(dfy.price[zone], ZONE_CURRENCY[zone]) : null;

  const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

  const steps: Step[] = [
    {
      id: "contact",
      title: "Coordonnées et WhatsApp",
      icon: MessageCircle,
      done: !!store.whatsappNumber,
      summary: store.whatsappNumber ? `Commandes reçues sur +${store.whatsappNumber}` : "Indiquez le numéro qui recevra les commandes.",
      body: canSettings ? (
        <ContactForm
          storeId={store.id}
          dialCode={country.dialCode}
          defaults={{ whatsappNumber: store.whatsappNumber, contactEmail: store.contactEmail, address: store.address, tagline: store.tagline, contactPhone: store.contactPhone }}
        />
      ) : (
        <p className="text-sm text-ink-muted">Seul un gestionnaire ou le propriétaire peut modifier les coordonnées.</p>
      ),
    },
    {
      id: "product",
      title: "Premier produit",
      icon: Package,
      done: activeProducts > 0,
      summary: activeProducts > 0 ? `${plural(activeProducts, "produit actif", "produits actifs")}` : "Ajoutez au moins un produit avec photo et prix.",
      body: (
        <div>
          <p className="text-sm text-ink-muted">Une bonne photo, un nom clair et un prix suffisent. Vous compléterez plus tard.</p>
          {canProducts && (
            <div className="mt-4 flex flex-wrap gap-2">
              <ButtonLink href={`${base}/produits/nouveau`} variant={activeProducts > 0 ? "outline" : "primary"} size="sm">
                <Package className="size-4" aria-hidden /> {activeProducts > 0 ? "Ajouter un autre produit" : "Ajouter mon premier produit"}
              </ButtonLink>
              {activeProducts > 0 && (
                <ButtonLink href={`${base}/produits`} variant="ghost" size="sm">
                  Voir le catalogue
                </ButtonLink>
              )}
            </div>
          )}
        </div>
      ),
    },
    {
      id: "delivery",
      title: "Livraison et paiement",
      icon: Truck,
      done: fulfilment && methods > 0,
      summary:
        fulfilment && methods > 0
          ? `${zones > 0 ? plural(zones, "zone de livraison", "zones de livraison") : "Retrait en boutique"}, ${plural(methods, "moyen de paiement", "moyens de paiement")}`
          : "Choisissez comment vos clients reçoivent et paient leurs commandes.",
      body: (
        <div>
          <ul className="space-y-2 text-sm">
            <li>
              <StatusDot tone={fulfilment ? "success" : "neutral"}>
                {zones > 0 ? plural(zones, "zone de livraison active", "zones de livraison actives") : store.pickupEnabled ? "Retrait en boutique activé" : "Aucune zone de livraison ni retrait"}
              </StatusDot>
            </li>
            <li>
              <StatusDot tone={methods > 0 ? "success" : "neutral"}>
                {methods > 0 ? plural(methods, "moyen de paiement actif", "moyens de paiement actifs") : "Aucun moyen de paiement actif"}
              </StatusDot>
            </li>
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            <ButtonLink href={`${base}/livraison`} variant="outline" size="sm">
              <Truck className="size-4" aria-hidden /> Livraison et retrait
            </ButtonLink>
            <ButtonLink href={`${base}/paiements`} variant="outline" size="sm">
              <CreditCard className="size-4" aria-hidden /> Moyens de paiement
            </ButtonLink>
          </div>
        </div>
      ),
    },
    {
      id: "appearance",
      title: "Apparence et aperçu",
      icon: Palette,
      done: branded,
      summary: branded ? "Logo ou bannière en place" : "Ajoutez votre logo et vérifiez le rendu sur téléphone.",
      body: (
        <div>
          <p className="text-sm text-ink-muted">Un thème adapté à votre secteur est déjà appliqué. Ajoutez votre logo, une bannière et vos couleurs.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {canTheme && (
              <ButtonLink href={`${base}/apparence`} variant={branded ? "outline" : "primary"} size="sm">
                <Palette className="size-4" aria-hidden /> Personnaliser l&apos;apparence
              </ButtonLink>
            )}
            <ButtonLink href={publicPath} target="_blank" rel="noopener" variant="ghost" size="sm">
              <ExternalLink className="size-4" aria-hidden /> Voir la boutique
              <span className="sr-only">(nouvel onglet)</span>
            </ButtonLink>
          </div>
        </div>
      ),
    },
    {
      id: "publish",
      title: "Publication",
      icon: Rocket,
      done: published,
      summary: published ? "Votre boutique est en ligne" : "Rendez votre boutique visible pour vos clients.",
      body: published ? (
        <div>
          <p className="text-sm text-ink-muted">Partagez ce lien dans vos statuts WhatsApp, sur Facebook, Instagram ou TikTok.</p>
          <ShareLink url={storeUrl} className="mt-4" />
        </div>
      ) : canPublish ? (
        <div>
          <p className="text-sm text-ink-muted">Il faut un numéro WhatsApp, un produit actif et un moyen de paiement. Vous pourrez fermer la boutique temporairement à tout moment.</p>
          <div className="mt-4">
            <PublishPanel storeId={store.id} ready={!!store.whatsappNumber && activeProducts > 0 && methods > 0} />
          </div>
        </div>
      ) : (
        <p className="text-sm text-ink-muted">Seul le propriétaire ou un gestionnaire peut publier.</p>
      ),
    },
    {
      id: "test-order",
      title: "Commande test",
      icon: ShoppingBag,
      done: orders > 0,
      summary: orders > 0 ? plural(orders, "commande reçue", "commandes reçues") : "Passez une commande comme un client pour tout vérifier.",
      body: (
        <div>
          <p className="text-sm text-ink-muted">
            Ouvrez votre boutique sur votre téléphone, ajoutez un produit au panier et validez. Vous verrez la commande arriver dans Axi et le message WhatsApp
            préparé pour vous. Vous pourrez ensuite l&apos;annuler.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <ButtonLink href={publicPath} target="_blank" rel="noopener" variant={orders > 0 ? "outline" : "primary"} size="sm">
              <ShoppingBag className="size-4" aria-hidden /> Commander sur ma boutique
              <span className="sr-only">(nouvel onglet)</span>
            </ButtonLink>
            {orders > 0 && ctx.can("orders.view") && (
              <ButtonLink href={`${base}/commandes`} variant="ghost" size="sm">
                Voir les commandes
              </ButtonLink>
            )}
          </div>
          {!published && <p className="mt-3 text-xs text-ink-muted">Astuce : publiez d&apos;abord la boutique pour que la commande passe dans les mêmes conditions que pour vos clients.</p>}
        </div>
      ),
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;
  const firstTodo = steps.find((s) => !s.done)?.id;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={allDone ? "Tout est prêt" : "Démarrage"}
        description={allDone ? "Votre boutique est en ligne et a déjà reçu une commande. Bonnes ventes." : "Six étapes pour vendre en ligne. Vous pouvez revenir ici à tout moment."}
      />

      {canTheme && !allDone && (
        <section aria-labelledby="ai-start-title" className="mb-6 overflow-hidden rounded-[var(--radius-xl)] bg-forest text-white">
          <div className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-7">
            <div className="max-w-xl">
              <span className="inline-flex size-10 items-center justify-center rounded-full bg-white/10 text-lime">
                <Sparkles className="size-5" aria-hidden />
              </span>
              <h2 id="ai-start-title" className="mt-4 text-xl font-semibold tracking-[-0.025em]">
                Créez votre boutique en 2 minutes avec l&apos;IA
              </h2>
              <p className="mt-1.5 text-sm text-white/70">
                Décrivez votre activité : l&apos;IA génère une direction complète — design, sections et textes. Vous ajustez ensuite. Une génération offerte par boutique.
              </p>
            </div>
            <ButtonLink href={`${base}/apparence/generer`} variant="accent" size="lg" trailing className="shrink-0">
              Générer ma boutique
            </ButtonLink>
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div>
          <Card className="mb-5 px-5 py-4 sm:px-6">
            <Progress
              value={doneCount}
              max={steps.length}
              tone="primary"
              label="Progression"
              showValue
              valueLabel={`${doneCount} sur ${steps.length} étapes`}
            />
          </Card>

          <ol className="space-y-3">
            {steps.map((step, i) => (
              <li key={step.id}>
                <details
                  open={step.id === firstTodo}
                  className="group rounded-[var(--radius-lg)] bg-surface ring-1 ring-line shadow-[var(--shadow-card)] open:ring-line-strong"
                >
                  <summary className="flex min-h-16 cursor-pointer list-none items-center gap-4 rounded-[var(--radius-lg)] px-4 py-3.5 sm:px-5 [&::-webkit-details-marker]:hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                    <span
                      aria-hidden
                      className={cn(
                        "inline-flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
                        step.done ? "bg-primary text-on-primary" : "bg-surface-2 text-ink-muted ring-1 ring-inset ring-line",
                      )}
                    >
                      {step.done ? <Check className="size-4" /> : i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-[15px] font-semibold tracking-tight text-ink">{step.title}</span>
                        {step.done ? <Badge tone="success">Fait</Badge> : <Badge tone="neutral">À faire</Badge>}
                      </span>
                      <span className="mt-0.5 block truncate text-sm text-ink-muted">{step.summary}</span>
                    </span>
                    <step.icon className="hidden size-4 shrink-0 text-ink-faint sm:block" aria-hidden />
                    <ChevronDown className="size-4 shrink-0 text-ink-muted transition-transform duration-300 ease-spring group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
                  </summary>
                  <div className="border-t border-line px-4 pb-5 pt-4 sm:px-5 sm:pl-[4.25rem]">{step.body}</div>
                </details>
              </li>
            ))}
          </ol>
        </div>

        <aside className="space-y-4" aria-label="Votre boutique">
          <Card className="p-5">
            <p className="truncate text-[15px] font-semibold tracking-tight text-ink">{store.name}</p>
            <p className="mt-0.5 truncate font-mono text-xs text-ink-muted">{publicPath}</p>
            <div className="mt-3">
              {published ? <StatusDot tone="success">En ligne</StatusDot> : <StatusDot tone="neutral">Brouillon, non visible</StatusDot>}
            </div>
            <ButtonLink href={publicPath} target="_blank" rel="noopener" variant="outline" size="sm" className="mt-4 w-full">
              <ExternalLink className="size-4" aria-hidden /> Ouvrir la boutique
              <span className="sr-only">(nouvel onglet)</span>
            </ButtonLink>
          </Card>

          {dfy && dfyPrice && !allDone && (
            <div className="rounded-[var(--radius-lg)] bg-forest p-5 text-white ring-1 ring-white/10">
              <p className="inline-flex items-center gap-1.5 text-xs font-medium text-lime">
                <Sparkles className="size-3.5" aria-hidden /> Pas le temps ?
              </p>
              <p className="mt-2 text-[15px] font-semibold tracking-tight">{dfy.name}</p>
              <p className="mt-1 text-sm text-white/70">{dfy.description}</p>
              <p className="mt-3 text-sm">
                <span className="tabular font-semibold">{dfyPrice}</span> <span className="text-white/60">une fois</span>
              </p>
              <Link
                href={`${base}/options?addon=DONE_FOR_YOU`}
                className="mt-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-lime underline-offset-4 hover:underline"
              >
                En savoir plus
              </Link>
            </div>
          )}

          <p className="px-1 text-xs text-ink-muted">
            Une question ?{" "}
            <Link href="/aide" className="inline-flex min-h-8 items-center text-primary underline-offset-4 hover:underline">
              Consultez le centre d&apos;aide
            </Link>
          </p>
        </aside>
      </div>
    </div>
  );
}
