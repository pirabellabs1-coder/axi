import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, ExternalLink, FolderTree, ImageIcon, Newspaper, Plus, Rss } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { planRank } from "@/config/plans";
import { PageHeader, EmptyState, Alert } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { LinkTabs } from "@/components/ui/tabs";
import { PlanGate } from "@/components/app/plan-gate";
import { formatDate, relativeTime } from "@/lib/utils";
import { BLOG_STATUS_LABELS, type BlogStatus } from "@/lib/blog/constants";
import { blogPlan, coverOf } from "@/lib/blog/service";
import { effectiveStatus } from "@/lib/blog/visibility";
import { PostRowActions } from "./post-row-actions";

export const metadata: Metadata = { title: "Blog" };

const TONES: Record<BlogStatus, BadgeTone> = { PUBLISHED: "success", SCHEDULED: "info", DRAFT: "neutral", ARCHIVED: "warning" };
const FILTERS = [
  { key: "", label: "Tous" },
  { key: "publies", label: "Publiés" },
  { key: "programmes", label: "Programmés" },
  { key: "brouillons", label: "Brouillons" },
  { key: "archives", label: "Archivés" },
] as const;

function whereFor(storeId: string, filter: string, now: Date): Prisma.BlogPostWhereInput {
  switch (filter) {
    case "publies":
      return { storeId, OR: [{ status: "PUBLISHED" }, { status: "SCHEDULED", publishedAt: { lte: now } }] };
    case "programmes":
      return { storeId, status: "SCHEDULED", publishedAt: { gt: now } };
    case "brouillons":
      return { storeId, status: "DRAFT" };
    case "archives":
      return { storeId, status: "ARCHIVED" };
    default:
      return { storeId };
  }
}

export default async function BlogPage({ params, searchParams }: { params: Promise<{ storeId: string }>; searchParams: Promise<{ statut?: string }> }) {
  const [{ storeId }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getStoreContext(storeId, "store.settings");
  const store = ctx.store;
  const base = `/app/${store.id}/blog`;
  const plan = blogPlan(ctx.planId);

  if (!plan.enabled) {
    return (
      <>
        <PageHeader title="Blog" description="Conseils, coulisses, nouveautés : des articles qui font revenir vos clients et vous rendent visible sur Google." />
        <PlanGate
          storeId={store.id}
          feature="blog"
          title="Blog de la boutique"
          description="Publiez des articles sur votre boutique : 20 articles avec le plan Starter, illimités à partir de Business."
          unlocks={["Articles avec images, catégories et étiquettes", "Publication programmée", "Section « Derniers articles » sur l'accueil", "Flux RSS et référencement (Google)"]}
        />
      </>
    );
  }

  const now = new Date();
  const filter = FILTERS.some((f) => f.key === sp.statut) ? (sp.statut as string) : "";
  const [posts, total, counts, categories] = await Promise.all([
    db.blogPost.findMany({
      where: whereFor(store.id, filter, now),
      orderBy: [{ updatedAt: "desc" }],
      take: 200,
      select: { id: true, slug: true, title: true, status: true, publishedAt: true, updatedAt: true, coverImage: true, readingMinutes: true, category: { select: { name: true } } },
    }),
    db.blogPost.count({ where: { storeId: store.id } }),
    Promise.all(FILTERS.map((f) => db.blogPost.count({ where: whereFor(store.id, f.key, now) }))),
    db.blogCategory.count({ where: { storeId: store.id } }),
  ]);
  const atLimit = plan.limit !== null && total >= plan.limit;

  return (
    <>
      <PageHeader
        title="Blog"
        description={plan.limit === null ? "Articles de votre boutique : conseils, coulisses, nouveautés." : `${total} sur ${plan.limit} articles inclus dans votre plan.`}
        actions={
          <div className="flex flex-wrap gap-2">
            <ButtonLink href={`${base}/categories`} variant="outline" trailing={FolderTree}>
              Catégories{categories ? ` (${categories})` : ""}
            </ButtonLink>
            {atLimit ? (
              <ButtonLink href={`/app/${store.id}/abonnement`} variant="outline">
                Plus d&apos;articles avec Business
              </ButtonLink>
            ) : (
              <ButtonLink href={`${base}/nouveau`} trailing={Plus}>
                Nouvel article
              </ButtonLink>
            )}
          </div>
        }
      />

      {atLimit && planRank(ctx.planId) < planRank("BUSINESS") && (
        <Alert tone="info" className="mb-5">
          Vous avez atteint les {plan.limit} articles de votre plan. Archivez ou supprimez un article, ou passez au plan Business pour des articles illimités.
        </Alert>
      )}

      {total === 0 ? (
        <EmptyState
          icon={Newspaper}
          title="Aucun article pour l'instant"
          description="Un article répond aux questions de vos clients, montre votre savoir-faire et vous fait trouver sur Google. Commencez par un conseil simple."
          action={
            <ButtonLink href={`${base}/nouveau`} trailing={Plus}>
              Écrire un article
            </ButtonLink>
          }
        />
      ) : (
        <>
          <LinkTabs param="statut" className="mb-4" items={FILTERS.map((f, i) => ({ href: f.key ? `${base}?statut=${f.key}` : base, label: f.label, count: counts[i] }))} />
          {posts.length === 0 ? (
            <EmptyState compact icon={Newspaper} title="Aucun article dans cette catégorie de statut" description="Changez de filtre pour voir vos autres articles." />
          ) : (
            <Card as="section" aria-label="Articles du blog">
              <ul className="divide-y divide-line">
                {posts.map((p) => {
                  const status = effectiveStatus(p, now);
                  const cover = coverOf(p.coverImage);
                  return (
                    <li key={p.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                      <span className="relative inline-flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-sm)] bg-surface-2 text-ink-muted">
                        {cover ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={cover.url} alt="" width={48} height={48} loading="lazy" className="size-full object-cover" />
                        ) : (
                          <ImageIcon className="size-4" aria-hidden />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <Link href={`${base}/${p.id}`} className="truncate font-medium text-ink hover:text-primary hover:underline">
                            {p.title}
                          </Link>
                          <Badge tone={TONES[status]}>{BLOG_STATUS_LABELS[status]}</Badge>
                        </div>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-ink-muted">
                          {status === "SCHEDULED" && p.publishedAt ? (
                            <span className="inline-flex items-center gap-1 text-info">
                              <CalendarClock className="size-3.5" aria-hidden /> le {formatDate(p.publishedAt, { hour: "2-digit", minute: "2-digit", timeZone: store.timezone || "UTC" })}
                            </span>
                          ) : status === "PUBLISHED" && p.publishedAt ? (
                            <span>publié le {formatDate(p.publishedAt, { timeZone: store.timezone || "UTC" })}</span>
                          ) : (
                            <span>modifié {relativeTime(p.updatedAt)}</span>
                          )}
                          {p.category && <span>· {p.category.name}</span>}
                          <span className="hidden sm:inline">· {p.readingMinutes} min</span>
                        </p>
                      </div>
                      <PostRowActions storeId={store.id} storeSlug={store.slug} id={p.id} slug={p.slug} title={p.title} status={status} />
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
          <p className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink-muted">
            <span className="inline-flex items-center gap-1.5">
              <ExternalLink className="size-4" aria-hidden /> Blog public :{" "}
              <Link href={`/s/${store.slug}/blog`} target="_blank" className="font-medium text-primary hover:underline">
                /s/{store.slug}/blog
              </Link>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Rss className="size-4" aria-hidden />
              <Link href={`/s/${store.slug}/blog/rss.xml`} target="_blank" className="font-medium text-primary hover:underline">
                Flux RSS
              </Link>
            </span>
            <span>Ajoutez la section « Derniers articles » à votre accueil depuis Apparence.</span>
          </p>
        </>
      )}
    </>
  );
}
