"use client";

import { useTransition } from "react";
import { Check } from "lucide-react";
import { acceptInvitation } from "@/lib/team/actions";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

export function AcceptButton({ token, storeName }: { token: string; storeName: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="accent"
      className="w-full"
      loading={pending}
      trailing={Check}
      onClick={() =>
        start(async () => {
          const r = await acceptInvitation(token);
          if (r && !r.ok) toast.error(r.error);
        })
      }
    >
      Rejoindre l&apos;équipe<span className="sr-only"> de {storeName}</span>
    </Button>
  );
}
