import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, ArrowUpRight } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { listUserStores, ROLE_LABELS } from "@/lib/auth/permissions";
import { Logo } from "@/components/ui/logo";
import { ButtonLink } from "@/components/ui/button";
import { Avatar, StatusDot } from "@/components/ui/misc";
import { UserMenu } from "@/components/app/user-menu";
import { Alert } from "@/components/ui/misc";
import { db } from "@/lib/db";
import { enforceAccountStoreLimit, getAccountStoresQuota } from "@/lib/store/account-quota-service";
import { OVER_STORE_LIMIT_REASON, storesQuotaLabel } from "@/lib/store/account-quota";

export const metadata = { title: "Vos boutiques" };

const STATUS: Record<string, { label: string; tone: "neutral" | "success" | "warning" | "danger" }> = {
  DRAFT: { label: "Brouillon", tone: "neutral" },
  PUBLISHED: { label: "En ligne", tone: "success" },
  CLOSED_TEMPORARILY: { label: "Fermée temporairement", tone: "warning" },
  SUSPENDED: { label: "Suspendue", tone: "danger" },
  ARCHIVED: { label: "Archivée", tone: "neutral" },
  PAUSED: { label: "En pause : choisir un plan", tone: "warning" },
};

export default async function AppHome() {
  const user = (await getCurrentUser())!;
  const stores = (await listUserStores(user.id)).filter((s) => s.status !== "ARCHIVED");
  // Le super-administrateur n'est pas un commerçant : sans boutique, il va sur sa console.
  if (stores.length === 0) redirect(user.isPlatformAdmin ? "/admin" : "/app/nouvelle-boutique");
  if (stores.length === 1) redirect(`/app/${stores[0].id}`);
  // Fin de période d'une option « Boutique en plus » : les boutiques au-delà de la limite du compte sont dépubliées.
  await enforceAccountStoreLimit(user.id).catch(() => undefined);
  const [quota, overLimit] = await Promise.all([
    getAccountStoresQuota(user.id),
    db.store.findMany({ where: { id: { in: stores.map((s) => s.id) }, status: "DRAFT", statusReason: OVER_STORE_LIMIT_REASON }, select: { id: true, name: true } }),
  ]);

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 border-b border-line bg-canvas/85 backdrop-blur-xl">
        <div className="container-x flex h-14 items-center justify-between">
          <Logo href="/app" size={28} />
          <UserMenu name={user.name} email={user.email} isAdmin={user.isPlatformAdmin} />
        </div>
      </header>
      <main className="container-x max-w-[960px] py-10 sm:py-14">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[30px] font-semibold tracking-[-0.035em] text-ink">Vos boutiques</h1>
            <p className="mt-1 text-sm text-ink-muted">
              {stores.length} boutiques accessibles{quota.firstStore ? "" : `, dont ${storesQuotaLabel(quota)} possédées`}. Choisissez celle à gérer.
            </p>
          </div>
          <ButtonLink href="/app/nouvelle-boutique" variant="accent" trailing={Plus}>
            Nouvelle boutique
          </ButtonLink>
        </div>
        {overLimit.length > 0 && (
          <Alert tone="warning" title="Boutique hors limite, mise hors ligne" className="mb-6">
            {overLimit.map((s) => s.name).join(", ")} : {OVER_STORE_LIMIT_REASON}{" "}
            {quota.primaryStoreId && (
              <Link href={`/app/${quota.primaryStoreId}/options`} className="font-medium underline underline-offset-4">
                Voir les options
              </Link>
            )}
          </Alert>
        )}
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {stores.map((s) => (
            <li key={s.id}>
              <Link href={`/app/${s.id}`} className="bezel group block !rounded-[22px] !p-[4px] transition-transform duration-150 ease-out active:scale-[0.99]">
                <div className="bezel-core flex items-center gap-4 !rounded-[18px] p-4">
                  {s.logoUrl ? (
                    <Avatar name={s.name} src={s.logoUrl} size={48} className="rounded-[14px]" />
                  ) : (
                    <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-[14px] bg-forest text-lg font-semibold text-lime" aria-hidden>
                      {s.name.trim().charAt(0).toUpperCase()}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold text-ink">{s.name}</p>
                    <p className="truncate text-sm text-ink-muted">
                      /{s.slug}, {ROLE_LABELS[s.role]}
                    </p>
                    <div className="mt-1.5">
                      <StatusDot tone={STATUS[s.status].tone}>
                        <span className="text-xs text-ink-muted">{STATUS[s.status].label}</span>
                      </StatusDot>
                    </div>
                  </div>
                  <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-muted transition-transform duration-300 ease-spring group-hover:-translate-y-px group-hover:translate-x-0.5 group-hover:text-ink" aria-hidden>
                    <ArrowUpRight className="size-4" />
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
