"use client";

import { useState, useTransition } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Select, Switch } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";
import { TAX_CATEGORY_LABELS } from "@/config/taxes";
import { updateProductTax } from "./actions";

/**
 * Fiscalité d'un produit existant (Product.taxable, Product.taxCategory), enregistrée immédiatement.
 * Indépendant du formulaire produit : à insérer sous <ProductForm> dans la page d'édition (voir la doc de l'équipe T).
 * Un produit nouveau prend les défauts du schéma (taxable, taux normal).
 */
export function ProductTaxFields({ storeId, productId, taxable, taxCategory }: { storeId: string; productId: string; taxable: boolean; taxCategory: string }) {
  const [value, setValue] = useState({ taxable, taxCategory });
  const [pending, start] = useTransition();

  const save = (next: { taxable: boolean; taxCategory: string }) => {
    const prev = value;
    setValue(next);
    start(async () => {
      const r = await updateProductTax(storeId, productId, next);
      if (r.ok) toast.success(r.message ?? "Enregistré");
      else {
        setValue(prev);
        toast.error(r.error);
      }
    });
  };

  return (
    <Card className="mt-6">
      <CardHeader title="Taxes" description="Utilisé si la TVA est activée dans Paramètres, Taxes et factures. Enregistré immédiatement." />
      <CardBody className="grid gap-4 sm:grid-cols-2 sm:items-end">
        <div className="flex min-h-11 items-center">
          <Switch label="Soumis à la TVA" checked={value.taxable} disabled={pending} onChange={(c) => save({ ...value, taxable: c })} />
        </div>
        <Field id={`tax-category-${productId}`} label="Catégorie fiscale" hint="Taux normal, réduit ou exonéré selon vos taux.">
          {(p) => (
            <Select {...p} value={value.taxCategory} disabled={pending || !value.taxable} onChange={(e) => save({ ...value, taxCategory: e.target.value })}>
              {Object.entries(TAX_CATEGORY_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </CardBody>
    </Card>
  );
}
