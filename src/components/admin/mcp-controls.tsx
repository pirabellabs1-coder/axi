"use client";

import { useState, useTransition } from "react";
import { setMcpKillSwitch } from "@/lib/mcp/admin-actions";
import { Button } from "@/components/ui/button";
import { Field, Switch, Textarea } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";

/** Arrêt d'urgence global des connecteurs IA (MCP marchand, MCP vitrine, OAuth). */
export function McpKillSwitchForm({ enabled, message, canEdit }: { enabled: boolean; message: string; canEdit: boolean }) {
  const [on, setOn] = useState(enabled);
  const [msg, setMsg] = useState(message);
  const [pending, start] = useTransition();
  const dirty = on !== enabled || msg !== message;
  return (
    <div className="space-y-4">
      <Switch checked={on} onChange={setOn} label={on ? "Connecteurs IA suspendus" : "Connecteurs IA actifs"} disabled={!canEdit || pending} />
      <Field id="mcp-msg" label="Message renvoyé aux assistants et affiché aux marchands" hint="Ex. : maintenance en cours, retour prévu à 14 h.">
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
              const r = await setMcpKillSwitch(on, msg);
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
