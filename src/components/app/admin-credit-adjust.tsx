"use client";

import { useState, useTransition } from "react";
import { SlidersHorizontal } from "lucide-react";
import { adjustCredits } from "@/lib/admin/actions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";

type CreditType = "WA_UTILITY" | "WA_MARKETING" | "AI";
const TYPES: { value: CreditType; label: string }[] = [
  { value: "WA_UTILITY", label: "Messages WhatsApp utilitaires" },
  { value: "WA_MARKETING", label: "Messages WhatsApp marketing" },
  { value: "AI", label: "Crédits IA" },
];

/** Ajustement audité d'un portefeuille de crédits (ajout sans échéance ou retrait FIFO). */
export function CreditAdjustButton({ storeId, storeName, balances, size = "sm" }: { storeId: string; storeName: string; balances?: Partial<Record<CreditType, number>>; size?: "sm" | "md" }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [type, setType] = useState<CreditType>("WA_UTILITY");
  const [direction, setDirection] = useState<"add" | "remove">("add");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<{ amount?: string; reason?: string; form?: string }>({});

  const close = () => {
    setOpen(false);
    setErrors({});
  };

  const submit = () => {
    const n = Number(amount);
    const next: typeof errors = {};
    if (!Number.isInteger(n) || n <= 0) next.amount = "Indiquez un nombre entier de crédits supérieur à 0.";
    if (reason.trim().length < 5) next.reason = "Motif obligatoire (5 caractères minimum), visible dans le journal d'audit.";
    setErrors(next);
    if (next.amount || next.reason) return;
    start(async () => {
      const res = await adjustCredits(storeId, type, direction === "add" ? n : -n, reason);
      if (res.ok) {
        toast.success(res.message ?? "Portefeuille ajusté");
        setAmount("");
        setReason("");
        close();
      } else {
        setErrors({ form: res.error });
      }
    });
  };

  const balance = balances?.[type];

  return (
    <>
      <Button variant="outline" size={size} onClick={() => setOpen(true)}>
        <SlidersHorizontal className="size-4" aria-hidden /> Ajuster
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title={`Ajuster les crédits de ${storeName}`}
        description="Un ajout est un geste commercial sans échéance. Un retrait consomme d'abord les crédits qui expirent le plus tôt."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={pending}>Annuler</Button>
            <Button loading={pending} onClick={submit}>{direction === "add" ? "Ajouter les crédits" : "Retirer les crédits"}</Button>
          </>
        }
      >
        <div className="space-y-4">
          {errors.form && (
            <p role="alert" className="rounded-[var(--radius-md)] bg-danger-soft px-3 py-2 text-sm text-danger">{errors.form}</p>
          )}
          <Field id={`ct-${storeId}`} label="Type de crédits" hint={balance != null ? `Solde actuel : ${balance.toLocaleString("fr-FR")}` : undefined}>
            {(p) => (
              <Select {...p} value={type} onChange={(e) => setType(e.target.value as CreditType)}>
                {TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </Select>
            )}
          </Field>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-ink">Opération</legend>
            <div className="grid grid-cols-2 gap-2">
              {(["add", "remove"] as const).map((d) => (
                <label key={d} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-[var(--radius-md)] px-3 text-sm ring-1 ring-inset ring-line has-[:checked]:bg-primary-soft has-[:checked]:ring-primary/40">
                  <input type="radio" name={`dir-${storeId}`} value={d} checked={direction === d} onChange={() => setDirection(d)} className="accent-[var(--c-primary)]" />
                  {d === "add" ? "Ajouter" : "Retirer"}
                </label>
              ))}
            </div>
          </fieldset>
          <Field id={`ca-${storeId}`} label="Nombre de crédits" required error={errors.amount}>
            {(p) => <Input {...p} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))} placeholder="Ex. 100" />}
          </Field>
          <Field id={`cr-${storeId}`} label="Motif" required error={errors.reason}>
            {(p) => <Textarea {...p} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex. geste commercial après une panne de l'API WhatsApp" />}
          </Field>
        </div>
      </Dialog>
    </>
  );
}
