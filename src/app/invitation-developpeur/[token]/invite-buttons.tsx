"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { acceptInvite, declineInvite } from "@/lib/apps/collaborator-actions";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

export function InviteButtons({ token, storeName }: { token: string; storeName: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [which, setWhich] = useState<"accept" | "decline" | null>(null);
  return (
    <div className="space-y-2">
      <Button
        variant="accent"
        className="w-full"
        loading={pending && which === "accept"}
        disabled={pending}
        trailing={Check}
        onClick={() => {
          setWhich("accept");
          start(async () => {
            const r = await acceptInvite(token);
            if (r && !r.ok) toast.error(r.error);
          });
        }}
      >
        Accepter<span className="sr-only"> l&apos;invitation de {storeName}</span>
      </Button>
      <Button
        variant="ghost"
        className="w-full"
        loading={pending && which === "decline"}
        disabled={pending}
        onClick={() => {
          setWhich("decline");
          start(async () => {
            const r = await declineInvite(token);
            if (!r.ok) toast.error(r.error);
            else {
              toast.success(r.message ?? "Invitation refusée");
              router.refresh();
            }
          });
        }}
      >
        Refuser
      </Button>
    </div>
  );
}
