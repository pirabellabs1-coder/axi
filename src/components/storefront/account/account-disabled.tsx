import Link from "next/link";
import { AccountCard, AccountShell } from "./account-shell";

/** Comptes désactivés par le commerçant : la commande sans compte reste possible. */
export function AccountDisabled({ slug }: { slug: string }) {
  return (
    <AccountShell slug={slug} title="Compte client" hideNav>
      <AccountCard className="text-center">
        <p className="text-base font-semibold text-ink">Les comptes clients ne sont pas proposés par cette boutique.</p>
        <p className="mt-1 text-sm text-ink-muted">Vous pouvez commander sans compte, comme d&apos;habitude.</p>
        <Link href={`/s/${slug}`} className="sf-btn sf-btn-solid mt-5 h-12 px-6 text-[15px]">
          Retour à la boutique
        </Link>
      </AccountCard>
    </AccountShell>
  );
}
