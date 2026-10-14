"use client";

import { useState, useTransition } from "react";
import { setMarketplaceMaintenance, saveManualPayment } from "@/lib/admin/platform-actions";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea, Switch } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";

export function MaintenanceForm({ enabled, message, canEdit }: { enabled: boolean; message: string; canEdit: boolean }) {
  const [on, setOn] = useState(enabled);
  const [msg, setMsg] = useState(message);
  const [pending, start] = useTransition();
  const dirty = on !== enabled || msg !== message;
  return (
    <div className="space-y-4">
      <Switch checked={on} onChange={setOn} label={on ? "Marketplace en maintenance" : "Marketplace ouverte"} disabled={!canEdit || pending} />
      <Field id="mt-msg" label="Message affiché aux visiteurs" hint="Ex. : la marketplace revient à 14 h. Les boutiques restent accessibles par leur lien.">
        {(p) => <Textarea {...p} value={msg} maxLength={240} disabled={!canEdit} onChange={(e) => setMsg(e.target.value)} className="min-h-20" />}
      </Field>
      {canEdit && (
        <Button
          size="sm"
          disabled={!dirty}
          loading={pending}
          onClick={() =>
            start(async () => {
              const r = await setMarketplaceMaintenance(on, msg);
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

type Manual = { momoNumber: string; momoName: string; bankDetails: string; instructions: string };

export function ManualPaymentForm({ initial, canEdit }: { initial: Manual; canEdit: boolean }) {
  const [v, setV] = useState<Manual>(initial);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();
  const set = (k: keyof Manual, val: string) => setV((s) => ({ ...s, [k]: val }));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="mp-number" label="Numéro Mobile Money (zone Afrique)" error={errors.momoNumber?.[0]}>
          {(p) => <Input {...p} value={v.momoNumber} disabled={!canEdit} inputMode="tel" onChange={(e) => set("momoNumber", e.target.value)} placeholder="+229 01 97 00 00 00" />}
        </Field>
        <Field id="mp-name" label="Nom du titulaire" error={errors.momoName?.[0]}>
          {(p) => <Input {...p} value={v.momoName} disabled={!canEdit} onChange={(e) => set("momoName", e.target.value)} placeholder="Axi SAS" />}
        </Field>
      </div>
      <Field id="mp-bank" label="Coordonnées bancaires (zone Monde)" error={errors.bankDetails?.[0]} hint="IBAN, BIC, titulaire. Affichées sur les factures en paiement manuel.">
        {(p) => <Textarea {...p} value={v.bankDetails} disabled={!canEdit} maxLength={400} onChange={(e) => set("bankDetails", e.target.value)} className="min-h-20 font-mono text-sm" />}
      </Field>
      <Field id="mp-instr" label="Consignes au marchand" error={errors.instructions?.[0]}>
        {(p) => <Textarea {...p} value={v.instructions} disabled={!canEdit} maxLength={400} onChange={(e) => set("instructions", e.target.value)} className="min-h-20" placeholder="Indiquez le numéro de facture en motif du paiement." />}
      </Field>
      {canEdit && (
        <Button
          size="sm"
          loading={pending}
          onClick={() =>
            start(async () => {
              const r = await saveManualPayment(v);
              if (r.ok) {
                toast.success(r.message ?? "Enregistré");
                setErrors({});
              } else {
                setErrors(r.fieldErrors ?? {});
                toast.error(r.error);
              }
            })
          }
        >
          Enregistrer les coordonnées
        </Button>
      )}
    </div>
  );
}
