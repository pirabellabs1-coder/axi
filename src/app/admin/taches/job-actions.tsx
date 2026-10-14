"use client";

import { useTransition } from "react";
import { Play, RotateCcw } from "lucide-react";
import { retryJob, runJobsNow, retryNotification } from "@/lib/admin/actions";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import type { ActionResult } from "@/lib/action";

function useRun() {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult<unknown>>) =>
    start(async () => {
      const res = await fn();
      if (res.ok) toast.success(res.message ?? "Terminé");
      else toast.error(res.error);
    });
  return { pending, run };
}

export function RunJobsButton() {
  const { pending, run } = useRun();
  return (
    <Button variant="primary" size="sm" loading={pending} onClick={() => run(runJobsNow)}>
      <Play className="size-4" aria-hidden /> Exécuter maintenant
    </Button>
  );
}

export function RetryJobButton({ jobId }: { jobId: string }) {
  const { pending, run } = useRun();
  return (
    <Button variant="outline" size="sm" loading={pending} onClick={() => run(() => retryJob(jobId))} aria-label="Rejouer cette tâche">
      <RotateCcw className="size-4" aria-hidden /> Rejouer
    </Button>
  );
}

export function RetryNotificationButton({ notificationId }: { notificationId: string }) {
  const { pending, run } = useRun();
  return (
    <Button variant="outline" size="sm" loading={pending} onClick={() => run(() => retryNotification(notificationId))} aria-label="Réessayer cette notification">
      <RotateCcw className="size-4" aria-hidden /> Réessayer
    </Button>
  );
}
