"use client";

import { useState, useTransition } from "react";
import { Globe2 } from "lucide-react";
import { setPricingZone } from "@/lib/admin/actions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";

type Zone = "WORLD" | "AFRICA";
const LABEL: Record<Zone, string> = { WORLD: "Monde (EUR)", AFRICA: "Afrique francophone (FCFA)" };

/** Bascule de la zone tarifaire d'un abonnement, avec motif obligatoire (audit). */
export function ZoneSwitchButton({ storeId, zone }: { storeId: string; zone: Zone }) {
  const target: Zone = zone === "AFRICA" ? "WORLD" : "AFRICA";
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [pending, start] = useTransition();

  const submit = () => {
    if (reason.trim().length < 5) {
      setError("Motif obligatoire (5 caractères minimum).");
      return;
    }
    start(async () => {
      const res = await setPricingZone(storeId, target, reason);
      if (res.ok) {
        toast.success(res.message ?? "Zone mise à jour");
        setOpen(false);
        setReason("");
        setError(undefined);
      } else setError(res.error);
    });
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Globe2 className="size-4" aria-hidden /> Passer en {target === "AFRICA" ? "FCFA" : "EUR"}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Passer en zone ${LABEL[target]}`}
        description="Les prochaines factures seront émises dans la devise de cette zone. Les factures existantes ne changent pas."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Annuler</Button>
            <Button loading={pending} onClick={submit}>Changer la zone</Button>
          </>
        }
      >
        <Field id={`zone-reason-${storeId}`} label="Motif" required error={error}>
          {(p) => <Textarea {...p} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex. marchand installé à Paris qui encaisse en FCFA, accord commercial" />}
        </Field>
      </Dialog>
    </>
  );
}
