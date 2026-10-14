"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { revokeBuyerSessions } from "@/lib/buyer/merchant-actions";
import { ConfirmButton } from "@/components/ui/dialog";
import { buttonClasses } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

/** Bouton marchand (fiche client, panneau « Compte client ») : déconnecte tous les appareils du client. */
export function RevokeSessionsButton({ storeId, customerId, disabled }: { storeId: string; customerId: string; disabled?: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <ConfirmButton
      title="Déconnecter tous les appareils ?"
      description="Le client devra se reconnecter avec un code. Ses commandes, adresses et favoris sont conservés."
      confirmLabel="Déconnecter"
      disabled={disabled || pending}
      className={buttonClasses({ variant: "outline", className: "w-full" })}
      onConfirm={() =>
        new Promise<void>((resolve) =>
          start(async () => {
            const r = await revokeBuyerSessions(storeId, customerId);
            if (r.ok) toast.success(r.message ?? "Sessions révoquées");
            else toast.error(r.error);
            router.refresh();
            resolve();
          }),
        )
      }
    >
      <LogOut className="size-4" aria-hidden /> Déconnecter tous les appareils
    </ConfirmButton>
  );
}
