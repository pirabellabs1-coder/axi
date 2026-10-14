import type { Metadata } from "next";
import Link from "next/link";
import { BellOff, ArrowUpRight } from "lucide-react";
import { getStoreContext } from "@/lib/auth/permissions";
import { getActionItems, getFeed } from "@/lib/notifications/service";
import { getStorePrefs } from "@/lib/notifications/prefs";
import { KIND_LABELS } from "@/lib/notifications/kinds";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Card, CardHeader, Bezel } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime, relativeTime } from "@/lib/utils";
import { KindIcon, MarkSeen, PrefsForm } from "./notifications-client";

export const metadata: Metadata = { title: "Notifications" };

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Aujourd'hui";
  if (d.toDateString() === y.toDateString()) return "Hier";
  return new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" }).format(d);
}

export default async function NotificationsPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const ctx = await getStoreContext(storeId, "store.view");
  const [{ items, seenAt }, todo, prefs] = await Promise.all([getFeed(ctx.store.id, { userId: ctx.user.id, limit: 80 }), getActionItems(ctx.store.id, ctx.can), getStorePrefs(ctx.store.id)]);
  const unread = items.filter((i) => i.unread).length;

  const groups: { label: string; items: typeof items }[] = [];
  for (const it of items) {
    const label = dayLabel(it.createdAt);
    const g = groups.at(-1);
    if (g && g.label === label) g.items.push(it);
    else groups.push({ label, items: [it] });
  }

  return (
    <>
      <MarkSeen storeId={ctx.store.id} />
      <PageHeader
        title="Notifications"
        description={unread > 0 ? `${unread} nouvelle${unread > 1 ? "s" : ""} depuis votre dernière visite.` : "Vous êtes à jour. Les nouveautés de votre boutique s'affichent ici."}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="min-w-0 space-y-6">
          <section aria-labelledby="todo-title">
            <h2 id="todo-title" className="mb-3 text-lg font-semibold tracking-[-0.02em] text-ink">
              À traiter
            </h2>
            {todo.length === 0 ? (
              <Card className="px-5 py-6 text-sm text-ink-muted">Rien n'attend votre action pour le moment.</Card>
            ) : (
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {todo.map((t) => (
                  <li key={t.key}>
                    <Link
                      href={t.href}
                      className="group flex h-full min-h-[76px] items-start gap-3 rounded-[var(--radius-lg)] bg-surface px-4 py-3.5 ring-1 ring-line shadow-[var(--shadow-card)] transition-[box-shadow,transform] duration-200 ease-out hover:ring-line-strong active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2"
                    >
                      <KindIcon kind={t.kind} tone={t.tone} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="font-medium text-ink">{t.label}</span>
                          {t.kind !== "credits" && t.kind !== "invoice.due" && (
                            <Badge tone={t.tone === "danger" ? "danger" : t.tone === "warning" ? "warning" : "info"}>
                              <span className="tabular">{t.count}</span>
                            </Badge>
                          )}
                        </span>
                        <span className="mt-0.5 block text-[13px] leading-snug text-ink-muted">{t.detail}</span>
                      </span>
                      <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-ink-faint transition-transform duration-200 ease-out group-hover:-translate-y-px group-hover:translate-x-px" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="feed-title">
            <h2 id="feed-title" className="mb-3 text-lg font-semibold tracking-[-0.02em] text-ink">
              Activité
            </h2>
            {items.length === 0 ? (
              <EmptyState icon={BellOff} title="Aucune notification" description="Nouvelles commandes, paiements, avis, stock bas et alertes de crédits apparaîtront ici." />
            ) : (
              <Card>
                {groups.map((g, gi) => (
                  <div key={g.label + gi} className={gi > 0 ? "border-t border-line" : undefined}>
                    <h3 className="px-5 pb-1 pt-4 text-xs font-medium uppercase tracking-[0.08em] text-ink-faint first-letter:uppercase sm:px-6">{g.label}</h3>
                    <ul className="divide-y divide-line">
                      {g.items.map((n) => {
                        const body = (
                          <>
                            <KindIcon kind={n.kind} />
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-center gap-x-2">
                                <span className={n.unread ? "font-semibold text-ink" : "font-medium text-ink"}>{n.title}</span>
                                {n.unread && (
                                  <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                                    <span className="size-1.5 rounded-full bg-accent ring-1 ring-primary/30" aria-hidden />
                                    Nouveau
                                  </span>
                                )}
                              </span>
                              {n.text && <span className="mt-0.5 block text-sm leading-relaxed text-ink-muted [overflow-wrap:anywhere]">{n.text}</span>}
                              <span className="mt-1 block text-xs text-ink-faint">
                                {KIND_LABELS[n.kind]} · <time dateTime={n.createdAt} title={formatDateTime(n.createdAt)}>{relativeTime(n.createdAt)}</time>
                              </span>
                            </span>
                          </>
                        );
                        return (
                          <li key={n.id}>
                            {n.href ? (
                              <Link href={n.href} className="flex items-start gap-3 px-5 py-3.5 transition-colors hover:bg-surface-2/60 focus-visible:outline-2 focus-visible:-outline-offset-2 sm:px-6">
                                {body}
                              </Link>
                            ) : (
                              <div className="flex items-start gap-3 px-5 py-3.5 sm:px-6">{body}</div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </Card>
            )}
            <p className="mt-3 text-xs text-ink-faint">Dernière consultation : {formatDateTime(seenAt)}. Les 80 dernières notifications sont affichées.</p>
          </section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-6">
          <Bezel coreClassName="p-5">
            <h2 className="text-[15px] font-semibold tracking-tight text-ink">Préférences</h2>
            <p className="mt-1 text-sm text-ink-muted">Pour toute la boutique.</p>
            {ctx.can("store.settings") ? (
              <PrefsForm storeId={ctx.store.id} dailyReport={prefs.dailyReport} lowStockThreshold={prefs.lowStockThreshold} />
            ) : (
              <p className="mt-4 text-sm text-ink-muted">Seuls le propriétaire et les gérants peuvent modifier ces réglages.</p>
            )}
          </Bezel>
          <Card>
            <CardHeader title="Automatiser les messages" description="Confirmations, relances et alertes envoyées pour vous." />
            <div className="px-5 pb-5 pt-3 sm:px-6">
              <Link href={`/app/${ctx.store.id}/automatisations`} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline">
                Voir les automatisations <ArrowUpRight className="size-4" aria-hidden />
              </Link>
            </div>
          </Card>
        </aside>
      </div>
    </>
  );
}
