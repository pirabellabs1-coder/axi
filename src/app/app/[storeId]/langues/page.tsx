import type { Metadata } from "next";
import Link from "next/link";
import { Languages, Info } from "lucide-react";
import { getStoreContext } from "@/lib/auth/permissions";
import { PLANS } from "@/config/plans";
import { PageHeader, Alert, EmptyState } from "@/components/ui/misc";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PlanGate } from "@/components/app/plan-gate";
import { PLATFORM_LOCALES, localeLabel, localeEndonym, storeLocales } from "@/i18n/locales";
import { dictionaryCoverage } from "@/i18n/dictionary";
import { RESOURCE_META, TRANSLATABLE_RESOURCES, type TranslatableResourceType } from "@/lib/i18n/resources";
import { countResources, loadResources, resourceStates, RESOURCE_PAGE_SIZE } from "@/lib/i18n/service";
import { parseGlossary } from "@/lib/i18n/translate-ai";
import { GlossaryForm, LanguagesForm, ResourceTabs, TranslateAllButton, TranslationList } from "./langues-client";

export const metadata: Metadata = { title: "Langues" };

type SP = { langue?: string; type?: string; page?: string };

export default async function LanguagesPage({ params, searchParams }: { params: Promise<{ storeId: string }>; searchParams: Promise<SP> }) {
  const [{ storeId }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getStoreContext(storeId, "store.settings");
  const store = ctx.store;
  const plan = PLANS[ctx.planId];
  const limit = plan.limits.languages;
  const locales = storeLocales(store, limit);
  const quotaReached = limit != null && locales.all.length >= limit;

  // Langue et ressource affichées dans le tableau (l'URL fait foi, comme pour la vitrine).
  const locale = locales.secondary.includes(sp.langue ?? "") ? sp.langue! : locales.secondary[0] ?? null;
  const type = (TRANSLATABLE_RESOURCES as readonly string[]).includes(sp.type ?? "") ? (sp.type as TranslatableResourceType) : "PRODUCT";
  const page = Math.max(1, Math.min(200, Number(sp.page) || 1));

  const [entries, total] = locale
    ? await Promise.all([loadResources(store.id, type, null, { skip: (page - 1) * RESOURCE_PAGE_SIZE, take: RESOURCE_PAGE_SIZE }), countResources(store.id, type)])
    : [[], 0];
  const states = locale ? await resourceStates(store.id, locale, entries) : [];
  const glossary = parseGlossary(store.i18nConfig);
  const coverage = dictionaryCoverage(locale ?? store.locale);
  const pages = Math.max(1, Math.ceil(total / RESOURCE_PAGE_SIZE));

  return (
    <>
      <PageHeader
        title="Langues"
        description="Proposez votre boutique dans plusieurs langues. L'adresse porte la langue (/en/…), les prix et les commandes ne changent pas."
      />

      {limit === 1 && locales.secondary.length === 0 ? (
        <PlanGate storeId={store.id} plan="BUSINESS" title="Boutique multilingue" description={`Votre plan ${plan.name} permet une seule langue. Le plan Business en permet 2, Scale 5, Enterprise sans limite.`} />
      ) : null}

      <div className="space-y-6">
        <Alert tone="info" title="Comment ça marche">
          Votre langue principale reste accessible sans préfixe. Chaque langue ajoutée crée des adresses comme
          <span className="tabular"> /en/p/mon-produit</span> et des liens <span className="tabular">hreflang</span> pour les moteurs de recherche. Un texte sans traduction s&apos;affiche
          dans la langue principale : aucun champ ne reste vide, et deux langues ne se mélangent jamais dans un même champ.
        </Alert>

        <Card as="section" aria-labelledby="lang-title">
          <CardHeader
            className="pb-4"
            title={
              <span id="lang-title" className="inline-flex flex-wrap items-center gap-2">
                Langues de la boutique
                <Badge tone={quotaReached ? "sun" : "neutral"}>
                  <span className="tabular">{limit == null ? `${locales.all.length} active(s), sans limite` : `${locales.all.length} / ${limit}`}</span>
                </Badge>
              </span>
            }
            description="La langue principale est celle de vos contenus d'origine. Les autres langues utilisent vos traductions, avec repli sur la principale."
          />
          <div className="border-t border-line p-4 sm:p-5">
            <LanguagesForm
              storeId={store.id}
              primary={locales.primary}
              secondary={locales.secondary}
              overQuota={locales.overQuota}
              limit={limit}
              options={PLATFORM_LOCALES.map((l) => ({ code: l.code, label: `${l.label} · ${l.endonym}`, rtl: l.dir === "rtl" }))}
            />
            {locales.overQuota.length > 0 && (
              <Alert tone="warning" title="Langues désactivées par votre plan" className="mt-4">
                {locales.overQuota.map(localeLabel).join(", ")} ne {locales.overQuota.length > 1 ? "sont" : "est"} plus servie{locales.overQuota.length > 1 ? "s" : ""} : les adresses correspondantes
                redirigent vers la langue principale. Vos traductions sont conservées et reviendront si vous repassez à un plan supérieur.
              </Alert>
            )}
          </div>
        </Card>

        <Card as="section" aria-labelledby="gloss-title">
          <CardHeader
            className="pb-4"
            title={<span id="gloss-title">Glossaire</span>}
            description="Termes à ne jamais traduire : nom de la boutique, marques, références. Un terme par ligne."
          />
          <div className="border-t border-line p-4 sm:p-5">
            <GlossaryForm storeId={store.id} terms={glossary} />
          </div>
        </Card>

        {locale ? (
          <Card as="section" aria-labelledby="tr-title">
            <CardHeader
              className="pb-4"
              title={
                <span id="tr-title" className="inline-flex flex-wrap items-center gap-2">
                  Traductions · {localeEndonym(locale)}
                  <Badge tone="neutral">{localeLabel(locale)}</Badge>
                </span>
              }
              description={`Source, traduction et état de chaque champ. Les libellés de l'interface (panier, bouton d'ajout) sont déjà traduits à ${Math.round((coverage.translated / coverage.total) * 100)} % pour cette langue.`}
            />
            <div className="border-t border-line">
              <ResourceTabs
                storeId={store.id}
                locale={locale}
                locales={locales.secondary.map((code) => ({ code, label: localeEndonym(code) }))}
                type={type}
                types={TRANSLATABLE_RESOURCES.map((t) => ({ value: t, label: RESOURCE_META[t].plural }))}
              />
              {states.length === 0 ? (
                <EmptyState compact icon={Languages} title="Aucun contenu" description={`Vous n'avez pas encore de ${RESOURCE_META[type].plural.toLowerCase()}.`} />
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
                    <p className="text-sm text-ink-muted">
                      {states.reduce((n, s) => n + s.translated, 0)} champ(s) traduit(s) sur {states.reduce((n, s) => n + s.total, 0)} affiché(s)
                      {states.reduce((n, s) => n + s.stale, 0) > 0 ? ` · ${states.reduce((n, s) => n + s.stale, 0)} à revoir` : ""}
                    </p>
                    <TranslateAllButton
                      storeId={store.id}
                      locale={locale}
                      resourceType={type}
                      available={plan.features.aiTranslation}
                      planName={plan.name}
                      chars={states.reduce((n, s) => n + s.fieldStates.filter((f) => f.value === null).reduce((m, f) => m + f.source.length, 0), 0)}
                    />
                  </div>
                  <TranslationList storeId={store.id} locale={locale} resourceType={type} resources={states} />
                  {pages > 1 && (
                    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 sm:px-5">
                      <PageLink storeId={store.id} locale={locale} type={type} page={page - 1} disabled={page <= 1} label="Précédent" />
                      <span className="text-sm text-ink-muted tabular">
                        Page {page} / {pages}
                      </span>
                      <PageLink storeId={store.id} locale={locale} type={type} page={page + 1} disabled={page >= pages} label="Suivant" />
                    </nav>
                  )}
                </>
              )}
            </div>
          </Card>
        ) : (
          <Card as="section">
            <div className="p-6">
              <p className="flex items-center gap-2 text-sm text-ink-muted">
                <Info className="size-4 shrink-0" aria-hidden /> Ajoutez une deuxième langue pour commencer à traduire vos contenus.
              </p>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}

function PageLink({ storeId, locale, type, page, disabled, label }: { storeId: string; locale: string; type: string; page: number; disabled: boolean; label: string }) {
  if (disabled) return <span className="inline-flex min-h-11 items-center text-sm text-ink-faint">{label}</span>;
  return (
    <Link href={`/app/${storeId}/langues?langue=${locale}&type=${type}&page=${page}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-ink underline underline-offset-4">
      {label}
    </Link>
  );
}
