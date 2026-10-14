"use client";

import { useRef } from "react";
import { ChevronDown, LogOut, Settings, ShieldCheck, Store } from "lucide-react";
import { logout } from "@/lib/auth/actions";
import { Avatar } from "@/components/ui/misc";
import { DropdownMenu, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { cn } from "@/lib/utils";

/** Menu du compte : boutiques, compte, administration, thème, déconnexion. */
export function UserMenu({ name, email, isAdmin, compact = false }: { name: string; email: string; isAdmin?: boolean; compact?: boolean }) {
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <>
      <DropdownMenu
        label="Compte"
        className="w-[264px]"
        trigger={(p) => (
          <button
            {...p}
            aria-label={`Compte de ${name}`}
            className={cn(
              "flex h-10 items-center gap-1.5 rounded-full pl-1 pr-2 text-sm transition-colors hover:bg-surface-2 aria-expanded:bg-surface-2",
              !compact && "bg-surface ring-1 ring-inset ring-line",
            )}
          >
            <Avatar name={name} size={30} />
            {!compact && <span className="hidden max-w-[140px] truncate font-medium sm:block">{name}</span>}
            <ChevronDown className="size-4 text-ink-faint" aria-hidden />
          </button>
        )}
      >
        <div className="flex items-center gap-3 px-3 pb-3 pt-2">
          <Avatar name={name} size={36} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink">{name}</p>
            <p className="truncate text-xs text-ink-muted">{email}</p>
          </div>
        </div>
        <DropdownSeparator />
        <DropdownItem href="/app" icon={Store}>Mes boutiques</DropdownItem>
        <DropdownItem href="/app/compte" icon={Settings}>Mon compte</DropdownItem>
        {isAdmin && <DropdownItem href="/admin" icon={ShieldCheck}>Administration</DropdownItem>}
        <DropdownSeparator />
        <div className="flex items-center justify-between gap-3 px-3 py-1.5">
          <span className="text-sm text-ink-muted">Thème</span>
          <ThemeToggle />
        </div>
        <DropdownSeparator />
        <DropdownItem icon={LogOut} onSelect={() => formRef.current?.requestSubmit()}>
          Se déconnecter
        </DropdownItem>
      </DropdownMenu>
      <form ref={formRef} action={logout} className="hidden" />
    </>
  );
}
