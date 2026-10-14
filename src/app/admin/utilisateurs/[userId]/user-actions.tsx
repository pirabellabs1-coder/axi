"use client";

import { useTransition } from "react";
import { ShieldCheck, ShieldOff, LogOut } from "lucide-react";
import { setPlatformAdmin, revokeUserSessions } from "@/lib/admin/actions";
import { ConfirmButton } from "@/components/ui/dialog";
import { buttonClasses } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import type { ActionResult } from "@/lib/action";

export function UserAdminActions({ userId, isPlatformAdmin, isSelf, sessionsCount }: { userId: string; isPlatformAdmin: boolean; isSelf: boolean; sessionsCount: number }) {
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<ActionResult<unknown>>) =>
    new Promise<void>((resolve) => {
      start(async () => {
        const res = await fn();
        if (res.ok) toast.success(res.message ?? "Enregistré");
        else toast.error(res.error);
        resolve();
      });
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      {isPlatformAdmin ? (
        <ConfirmButton
          title="Retirer les droits d'administration"
          description="L'utilisateur perd l'accès à /admin immédiatement."
          confirmLabel="Rétrograder"
          tone="danger"
          disabled={isSelf || pending}
          onConfirm={() => run(() => setPlatformAdmin(userId, false))}
          className={buttonClasses({ variant: "danger", size: "sm" })}
        >
          <ShieldOff className="size-4" aria-hidden /> Rétrograder
        </ConfirmButton>
      ) : (
        <ConfirmButton
          title="Promouvoir administrateur plateforme"
          description="L'utilisateur aura accès à toutes les boutiques (SUPPORT implicite) et aux actions d'administration."
          confirmLabel="Promouvoir"
          tone="primary"
          disabled={isSelf || pending}
          onConfirm={() => run(() => setPlatformAdmin(userId, true))}
          className={buttonClasses({ variant: "primary", size: "sm" })}
        >
          <ShieldCheck className="size-4" aria-hidden /> Promouvoir admin
        </ConfirmButton>
      )}
      <ConfirmButton
        title="Révoquer toutes les sessions"
        description={`${sessionsCount} session${sessionsCount > 1 ? "s" : ""} active${sessionsCount > 1 ? "s" : ""} : l'utilisateur devra se reconnecter partout.`}
        confirmLabel="Révoquer"
        tone="danger"
        disabled={pending || sessionsCount === 0}
        onConfirm={() => run(() => revokeUserSessions(userId))}
        className={buttonClasses({ variant: "outline", size: "sm" })}
      >
        <LogOut className="size-4" aria-hidden /> Révoquer les sessions
      </ConfirmButton>
      {isSelf && <p className="text-xs text-ink-muted">Vous ne pouvez pas modifier votre propre rôle.</p>}
    </div>
  );
}
