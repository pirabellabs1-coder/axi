import type { Metadata } from "next";
import Link from "next/link";
import { Search, Store } from "lucide-react";
import type { Prisma, StoreStatus, PlanId } from "@prisma/client";
import { requirePlatformAdmin } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { PLANS, PLAN_ORDER } from "@/config/plans";
import { COUNTRIES } from "@/config/site";
import { formatDate } from "@/lib/utils";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Input, Select } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { STORE_STATUS, SUB_STATUS, StatusBadge, Pagination, PAGE_SIZE, pageParam, str } from "@/components/app/admin-bits";

export const metadata: Metadata = { title: "Boutiques" };

const STATUSES: StoreStatus[] = ["DRAFT", "PUBLISHED", "CLOSED_TEMPORARILY", "SUSPENDED", "ARCHIVED"];

export default async function AdminStores({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const q = str(sp.q);
  const status = str(sp.status);
  const country = str(sp.country);
  const plan = str(sp.plan);
  const page = pageParam(sp.page);

  const where: Prisma.StoreWhereInput = {
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { slug: { contains: q, mode: "insensitive" as const } }, { whatsappNumber: { contains: q } }, { contactEmail: { contains: q, mode: "insensitive" as const } }] } : {}),
    ...(status && STATUSES.includes(status as StoreStatus) ? { status: status as StoreStatus } : {}),
    ...(country ? { country } : {}),
    ...(plan && PLAN_ORDER.includes(plan as PlanId) ? { subscription: { planId: plan as PlanId } } : {}),
  };

  const [total, stores] = await Promise.all([
    db.store.count({ where }),
    db.store.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true, name: true, slug: true, country: true, city: true, status: true, isFeatured: true, listedInMarketplace: true, createdAt: true,
        subscription: { select: { planId: true, status: true } },
        _count: { select: { orders: true, products: true } },
      },
    }),
  ]);

  const params = { q, status, country, plan };

  return (
    <>
      <PageHeader title="Boutiques" description={`${total} boutique${total > 1 ? "s" : ""} correspondant aux filtres.`} />

      <form method="get" className="mb-5 grid grid-cols-1 gap-3 rounded-[var(--radius-lg)] bg-surface p-3 ring-1 ring-line shadow-[var(--shadow-card)] sm:grid-cols-2 lg:grid-cols-[1fr_160px_160px_160px_auto]" role="search" aria-label="Filtrer les boutiques">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-faint" aria-hidden />
          <Input fieldSize="sm" name="q" defaultValue={q} placeholder="Nom, adresse, e-mail, WhatsApp…" aria-label="Recherche" className="pl-10" />
        </div>
        <Select fieldSize="sm" name="status" defaultValue={status} aria-label="Statut">
          <option value="">Tous statuts</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{STORE_STATUS[s].label}</option>
          ))}
        </Select>
        <Select fieldSize="sm" name="country" defaultValue={country} aria-label="Pays">
          <option value="">Tous pays</option>
          {COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>{c.name}</option>
          ))}
        </Select>
        <Select fieldSize="sm" name="plan" defaultValue={plan} aria-label="Plan">
          <option value="">Tous plans</option>
          {PLAN_ORDER.map((p) => (
            <option key={p} value={p}>{PLANS[p].name}</option>
          ))}
        </Select>
        <Button type="submit" variant="secondary" size="sm" className="h-11 sm:h-9">Filtrer</Button>
      </form>

      {stores.length === 0 ? (
        <EmptyState icon={Store} title="Aucune boutique" description="Aucune boutique ne correspond à ces critères." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Boutique</TH>
              <TH>Pays</TH>
              <TH>Plan</TH>
              <TH>Statut</TH>
              <TH align="right">Produits</TH>
              <TH align="right">Commandes</TH>
              <TH align="right">Créée</TH>
            </TR>
          </THead>
          <TBody>
            {stores.map((s) => (
              <TR key={s.id}>
                <TD>
                  <Link href={`/admin/boutiques/${s.id}`} className="font-medium text-ink hover:text-primary">{s.name}</Link>
                  <span className="block text-xs text-ink-muted">
                    /{s.slug}
                    {s.city ? ` · ${s.city}` : ""}
                    {s.isFeatured && <Badge tone="sun" className="ml-2">Vedette</Badge>}
                    {!s.listedInMarketplace && <Badge tone="neutral" className="ml-2">Non listée</Badge>}
                  </span>
                </TD>
                <TD>{s.country}</TD>
                <TD>
                  {s.subscription ? (
                    <span className="inline-flex items-center gap-2">
                      {PLANS[s.subscription.planId].name}
                      <StatusBadge map={SUB_STATUS} value={s.subscription.status} />
                    </span>
                  ) : "-"}
                </TD>
                <TD><StatusBadge map={STORE_STATUS} value={s.status} /></TD>
                <TD align="right">{s._count.products}</TD>
                <TD align="right">{s._count.orders}</TD>
                <TD align="right"><span className="text-ink-muted">{formatDate(s.createdAt)}</span></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      <Pagination page={page} total={total} basePath="/admin/boutiques" params={params} />
    </>
  );
}
