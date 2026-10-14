"use client";

import { minorToInput, moneyStep } from "@/lib/money";
import { useActionState, useState } from "react";
import { updateStoreSettings } from "@/lib/store/actions";
import { STORE_CATEGORIES } from "@/config/site";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/field";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage, fieldError } from "@/components/forms/form-message";

export type SettingsDTO = {
  name: string;
  tagline: string;
  description: string;
  category: string;
  city: string;
  address: string;
  contactEmail: string;
  contactPhone: string;
  whatsappNumber: string;
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  whatsappOrdering: boolean;
  listedInMarketplace: boolean;
  minOrderAmount: number;
  orderNotes: string;
};

export function SettingsForm({ storeId, data, currency, dialCode }: { storeId: string; data: SettingsDTO; currency: string; dialCode: string }) {
  const [state, action] = useActionState(updateStoreSettings, undefined);
  const [toggles, setToggles] = useState({ pickupEnabled: data.pickupEnabled, deliveryEnabled: data.deliveryEnabled, whatsappOrdering: data.whatsappOrdering, listedInMarketplace: data.listedInMarketplace });
  const set = (k: keyof typeof toggles) => (v: boolean) => setToggles((t) => ({ ...t, [k]: v }));

  return (
    <form action={action} noValidate className="space-y-6">
      <FormMessage state={state} />
      <input type="hidden" name="storeId" value={storeId} />

      <Card as="section" aria-labelledby="identity-title">
        <CardHeader title={<span id="identity-title">Identité</span>} description="Ce que vos clients voient en premier." />
        <CardBody className="space-y-5">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field id="name" label="Nom de la boutique" required error={fieldError(state, "name")}>
              {(p) => <Input {...p} name="name" defaultValue={data.name} maxLength={60} />}
            </Field>
            <Field id="category" label="Catégorie" required error={fieldError(state, "category")}>
              {(p) => (
                <Select {...p} name="category" defaultValue={data.category}>
                  {STORE_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </Select>
              )}
            </Field>
          </div>
          <Field id="tagline" label="Slogan" error={fieldError(state, "tagline")} hint="Une phrase courte sous le nom. Ex. « Pâtisserie maison, livrée à Cotonou »">
            {(p) => <Input {...p} name="tagline" defaultValue={data.tagline} maxLength={120} />}
          </Field>
          <Field id="description" label="Description" error={fieldError(state, "description")} hint="Affichée sur la page boutique et dans la marketplace.">
            {(p) => <Textarea {...p} name="description" defaultValue={data.description} rows={4} maxLength={1000} />}
          </Field>
        </CardBody>
      </Card>

      <Card as="section" aria-labelledby="contact-title">
        <CardHeader title={<span id="contact-title">Coordonnées</span>} />
        <CardBody className="space-y-5">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field id="city" label="Ville" error={fieldError(state, "city")}>
              {(p) => <Input {...p} name="city" defaultValue={data.city} autoComplete="address-level2" />}
            </Field>
            <Field id="address" label="Adresse" error={fieldError(state, "address")} hint="Pour le retrait en boutique.">
              {(p) => <Input {...p} name="address" defaultValue={data.address} autoComplete="street-address" />}
            </Field>
            <Field id="contactEmail" label="E-mail de contact" error={fieldError(state, "contactEmail")} hint="Reçoit les notifications de commande.">
              {(p) => <Input {...p} name="contactEmail" type="email" inputMode="email" defaultValue={data.contactEmail} />}
            </Field>
            <Field id="contactPhone" label="Téléphone" error={fieldError(state, "contactPhone")}>
              {(p) => <Input {...p} name="contactPhone" inputMode="tel" defaultValue={data.contactPhone} />}
            </Field>
          </div>
          <Field id="whatsappNumber" label="Numéro WhatsApp" error={fieldError(state, "whatsappNumber")} hint={`Format international sans « + » (ex. ${dialCode}97000000) ou local.`}>
            {(p) => <Input {...p} name="whatsappNumber" inputMode="tel" defaultValue={data.whatsappNumber} />}
          </Field>
        </CardBody>
      </Card>

      <Card as="section" aria-labelledby="checkout-title">
        <CardHeader title={<span id="checkout-title">Commande et visibilité</span>} />
        <CardBody className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Switch name="pickupEnabled" checked={toggles.pickupEnabled} onChange={set("pickupEnabled")} label="Retrait en boutique" />
            <Switch name="deliveryEnabled" checked={toggles.deliveryEnabled} onChange={set("deliveryEnabled")} label="Livraison" />
            <Switch name="whatsappOrdering" checked={toggles.whatsappOrdering} onChange={set("whatsappOrdering")} label="Commande sur WhatsApp" />
            <Switch name="listedInMarketplace" checked={toggles.listedInMarketplace} onChange={set("listedInMarketplace")} label="Visible dans la marketplace Axi" />
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field id="minOrderAmount" label={`Minimum de commande (${currency})`} error={fieldError(state, "minOrderAmount")} hint="0 = pas de minimum.">
              {(p) => <Input {...p} name="minOrderAmount" type="number" inputMode={moneyStep(currency) === "1" ? "numeric" : "decimal"} min={0} step={moneyStep(currency)} defaultValue={minorToInput(data.minOrderAmount, currency)} />}
            </Field>
            <Field id="orderNotes" label="Note affichée au checkout" error={fieldError(state, "orderNotes")} hint="Ex. « Commandes avant 16 h livrées le jour même »">
              {(p) => <Input {...p} name="orderNotes" defaultValue={data.orderNotes} maxLength={200} />}
            </Field>
          </div>
        </CardBody>
        <CardFooter>
          <SubmitButton>Enregistrer les paramètres</SubmitButton>
        </CardFooter>
      </Card>
    </form>
  );
}
