"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { adjustStock } from "@/lib/products/actions";
import { Field, Input, Select } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage, fieldError } from "@/components/forms/form-message";

export function StockAdjustForm({ storeId, productId, variants }: { storeId: string; productId: string; variants: { id: string; name: string; stock: number }[] }) {
  const [state, action] = useActionState(adjustStock, undefined);
  const [sign, setSign] = useState<"+" | "-">("+");
  const [qty, setQty] = useState("");
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      setQty("");
      router.refresh();
    }
  }, [state, router]);

  return (
    <form ref={formRef} action={action} className="space-y-4" noValidate>
      <input type="hidden" name="storeId" value={storeId} />
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="delta" value={qty ? `${sign === "-" ? "-" : ""}${qty}` : ""} />
      <FormMessage state={state} />
      {variants.length > 0 && (
        <Field id="variantId" label="Variante" required error={fieldError(state, "variantId")}>
          {(p) => (
            <Select {...p} name="variantId" defaultValue={variants[0]?.id}>
              {variants.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} (stock : {v.stock})
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      <div>
        <p className="mb-1.5 text-sm font-medium text-ink" id="stock-sign-label">
          Sens du mouvement
        </p>
        <Segmented
          label="Sens du mouvement"
          value={sign}
          onChange={setSign}
          className="w-full [&>button]:flex-1 [&>button]:justify-center"
          options={[
            { value: "+", label: "Entrée (+)" },
            { value: "-", label: "Sortie (-)" },
          ]}
        />
      </div>
      <Field id="qty" label="Quantité" required error={fieldError(state, "delta")}>
        {(p) => <Input {...p} type="number" inputMode="numeric" min={1} value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d]/g, ""))} />}
      </Field>
      <Field id="note" label="Motif (optionnel)" error={fieldError(state, "note")}>
        {(p) => <Input {...p} name="note" maxLength={200} placeholder="Ex. Réception fournisseur" />}
      </Field>
      <SubmitButton className="w-full" disabled={!qty} variant={sign === "-" ? "outline" : "primary"}>
        Enregistrer l&apos;ajustement
      </SubmitButton>
    </form>
  );
}
