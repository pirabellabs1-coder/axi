"use client";

import { useId, useState, useTransition } from "react";
import type { ActionResult } from "@/lib/action";
import { Button } from "@/components/ui/button";
import { Field, Switch, Textarea } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";

/**
 * Interrupteur d'arrêt d'urgence générique (même ergonomie que celui des connecteurs IA) : état + message.
 * `action` est une action serveur qui contrôle elle-même la permission admin et journalise (`admin.*`).
 */
export function KillSwitchForm({
  enabled,
  message,
  canEdit,
  action,
  onLabel,
  offLabel,
  messageLabel = "Message affiché aux utilisateurs",
  messageHint,
}: {
  enabled: boolean;
  message: string;
  canEdit: boolean;
  action: (enabled: boolean, message: string) => Promise<ActionResult>;
  onLabel: string;
  offLabel: string;
  messageLabel?: string;
  messageHint?: string;
}) {
  const [on, setOn] = useState(enabled);
  const [msg, setMsg] = useState(message);
  const [pending, start] = useTransition();
  const id = useId();
  const dirty = on !== enabled || msg !== message;
  return (
    <div className="space-y-4">
      <Switch checked={on} onChange={setOn} label={on ? onLabel : offLabel} disabled={!canEdit || pending} />
      <Field id={`${id}-msg`} label={messageLabel} hint={messageHint}>
        {(p) => <Textarea {...p} value={msg} maxLength={240} disabled={!canEdit} onChange={(e) => setMsg(e.target.value)} className="min-h-20" />}
      </Field>
      {canEdit && (
        <Button
          size="sm"
          variant={on && !enabled ? "danger" : "primary"}
          disabled={!dirty}
          loading={pending}
          onClick={() =>
            start(async () => {
              const r = await action(on, msg);
              if (r.ok) toast.success(r.message ?? "Enregistré");
              else toast.error(r.error);
            })
          }
        >
          Enregistrer
        </Button>
      )}
    </div>
  );
}
