"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { changeOrderStatus } from "@/lib/orders/actions";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

export function QuickConfirm({ storeId, orderId, className }: { storeId: string; orderId: string; className?: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      size="sm"
      className={className}
      loading={pending}
      onClick={() =>
        start(async () => {
          const res = await changeOrderStatus(storeId, orderId, "CONFIRMED");
          if (res.ok) {
            toast.success("Commande confirmée");
            router.refresh();
          } else toast.error("Impossible de confirmer", res.error);
        })
      }
    >
      <Check className="size-4" aria-hidden /> Confirmer
    </Button>
  );
}
