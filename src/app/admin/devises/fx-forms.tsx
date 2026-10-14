"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { adminRefreshFxRates, adminSetPlatformRate } from "@/lib/currency/actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";

export function FxRefreshButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      loading={pending}
      onClick={() =>
        start(async () => {
          const r = await adminRefreshFxRates();
          if (r.ok) {
            toast.success(r.message ?? "Taux mis à jour");
            router.refresh();
          } else toast.error(r.error);
        })
      }
    >
      <RefreshCw className="size-4" aria-hidden /> Rafraîchir maintenant
    </Button>
  );
}

export function FxRateForm({ canEdit }: { canEdit: boolean }) {
  const router = useRouter();
  const [base, setBase] = useState("EUR");
  const [quote, setQuote] = useState("");
  const [rate, setRate] = useState("");
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData();
        fd.set("base", base);
        fd.set("quote", quote);
        fd.set("rate", rate);
        start(async () => {
          const r = await adminSetPlatformRate(undefined, fd);
          if (r.ok) {
            toast.success(r.message ?? "Taux enregistré");
            setErrors({});
            setRate("");
            router.refresh();
          } else {
            setErrors(r.fieldErrors ?? {});
            toast.error(r.error);
          }
        });
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field id="fx-base" label="Devise de base" hint="Code ISO, ex. EUR" error={errors.base?.[0]}>
          {(p) => <Input {...p} value={base} maxLength={3} disabled={!canEdit} autoComplete="off" className="uppercase" onChange={(e) => setBase(e.target.value.toUpperCase())} />}
        </Field>
        <Field id="fx-quote" label="Devise cotée" hint="Ex. NGN" error={errors.quote?.[0]}>
          {(p) => <Input {...p} value={quote} maxLength={3} disabled={!canEdit} autoComplete="off" className="uppercase" onChange={(e) => setQuote(e.target.value.toUpperCase())} />}
        </Field>
      </div>
      <Field id="fx-rate" label={`1 ${base || "…"} = x ${quote || "…"}`} hint="Jusqu'à 10 décimales, point ou virgule." error={errors.rate?.[0]}>
        {(p) => <Input {...p} value={rate} inputMode="decimal" disabled={!canEdit} autoComplete="off" placeholder="1650.25" onChange={(e) => setRate(e.target.value)} />}
      </Field>
      {canEdit && (
        <Button type="submit" size="sm" loading={pending} disabled={base.length !== 3 || quote.length !== 3 || !rate.trim()}>
          Enregistrer le taux
        </Button>
      )}
    </form>
  );
}
