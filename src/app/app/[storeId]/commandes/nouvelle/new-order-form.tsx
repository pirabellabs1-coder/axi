"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, UserRound, UserRoundPlus, Search, Store, Truck, MessageCircle } from "lucide-react";
import { createManualOrder } from "@/lib/orders/actions";
import { effectivePrice } from "@/lib/commerce/pricing";
import { formatMoney } from "@/lib/money";
import { cn, formatPhone } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea, Checkbox } from "@/components/ui/field";
import { Card, CardHeader, CardBody, Bezel } from "@/components/ui/card";
import { Alert, Avatar } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/segmented";
import { toast } from "@/components/ui/toast";

type Product = { id: string; name: string; price: number; promoPrice: number | null; promoStart: string | null; promoEnd: string | null; trackStock: boolean; stock: number; inventoryPolicy?: "DENY" | "CONTINUE"; variants: { id: string; name: string; price: number | null; stock: number; inventoryPolicy?: "DENY" | "CONTINUE" }[] };
type Customer = { id: string; name: string; phone: string; email: string | null; address: string | null; storeCreditBalance?: number };
type Line = { key: string; productId: string; variantId: string; quantity: number };

export function NewOrderForm({
  storeId,
  currency,
  dialCode,
  products,
  zones,
  methods,
  customers,
  initialCustomerId = "",
  pickupEnabled,
  deliveryEnabled,
  whatsappOrdering,
  canUseStoreCredit = false,
}: {
  storeId: string;
  currency: string;
  dialCode: string;
  products: Product[];
  zones: { id: string; name: string; fee: number }[];
  methods: { id: string; label: string }[];
  customers: Customer[];
  initialCustomerId?: string;
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  whatsappOrdering: boolean;
  /** Lot 1 : capacité customers.manage (utiliser l'avoir du client). */
  canUseStoreCredit?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [mode, setMode] = useState<"existing" | "new">(customers.length ? "existing" : "new");
  const [customerId, setCustomerId] = useState(initialCustomerId);
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [fulfillment, setFulfillment] = useState<"PICKUP" | "DELIVERY" | "WHATSAPP">(pickupEnabled ? "PICKUP" : deliveryEnabled ? "DELIVERY" : "WHATSAPP");
  const [zoneId, setZoneId] = useState(zones[0]?.id ?? "");
  const [address, setAddress] = useState("");
  const [methodId, setMethodId] = useState(methods[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [useCredit, setUseCredit] = useState(false);
  const [lines, setLines] = useState<Line[]>([{ key: crypto.randomUUID(), productId: products[0]?.id ?? "", variantId: "", quantity: 1 }]);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const filteredCustomers = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return customers.slice(0, 20).concat(customerId && !customers.slice(0, 20).some((c) => c.id === customerId) ? customers.filter((c) => c.id === customerId) : []);
    const digits = s.replace(/\D/g, "");
    return customers.filter((c) => c.name.toLowerCase().includes(s) || (digits.length > 0 && c.phone.includes(digits))).slice(0, 20);
  }, [customers, search, customerId]);
  const selected = customers.find((c) => c.id === customerId);
  // Avoir utilisable : client existant, solde positif, rôle avec customers.manage.
  const creditAvailable = canUseStoreCredit && mode === "existing" ? (selected?.storeCreditBalance ?? 0) : 0;

  const now = new Date();
  const lineInfo = (l: Line) => {
    const p = products.find((x) => x.id === l.productId);
    if (!p) return null;
    const v = p.variants.find((x) => x.id === l.variantId) ?? null;
    const unit = v?.price ?? effectivePrice({ price: p.price, promoPrice: p.promoPrice, promoStart: p.promoStart ? new Date(p.promoStart) : null, promoEnd: p.promoEnd ? new Date(p.promoEnd) : null }, now).price;
    const stock = p.trackStock ? (v ? v.stock : p.stock) : null;
    // « Continuer à vendre en cas de rupture » : la commande passe au-delà du stock (précommande).
    const continueSelling = (v ? v.inventoryPolicy : p.inventoryPolicy) === "CONTINUE";
    return { p, v, unit, stock, continueSelling };
  };
  const estimate = lines.reduce((s, l) => s + (lineInfo(l)?.unit ?? 0) * l.quantity, 0);
  const zone = zones.find((z) => z.id === zoneId);
  const fee = fulfillment === "DELIVERY" ? (zone?.fee ?? 0) : 0;

  const updateLine = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const submit = () =>
    start(async () => {
      setError(null);
      setFieldErrors({});
      const customerName = mode === "existing" ? selected?.name ?? "" : name;
      const customerPhone = mode === "existing" ? selected?.phone ?? "" : phone;
      if (!customerName || !customerPhone) {
        setError(mode === "existing" ? "Choisissez un client." : "Indiquez le nom et le téléphone du client.");
        return;
      }
      const res = await createManualOrder({
        storeId,
        idempotencyKey,
        customerName,
        customerPhone,
        customerEmail: mode === "existing" ? selected?.email ?? "" : email,
        fulfillmentType: fulfillment,
        deliveryZoneId: fulfillment === "DELIVERY" ? zoneId : "",
        deliveryAddress: fulfillment === "DELIVERY" ? address || selected?.address || "" : "",
        paymentMethodId: fulfillment === "WHATSAPP" ? "" : methodId,
        note,
        useStoreCredit: creditAvailable > 0 && useCredit,
        items: lines.filter((l) => l.productId).map((l) => ({ productId: l.productId, variantId: l.variantId || null, quantity: l.quantity })),
      });
      if (res.ok && res.data) {
        toast.success(res.message ?? "Commande créée");
        router.push(`/app/${storeId}/commandes/${res.data.orderId}`);
      } else if (!res.ok) {
        setError(res.error);
        setFieldErrors(res.fieldErrors ?? {});
        toast.error("Commande non créée", res.error);
      }
    });


  const fe = (k: string) => fieldErrors[k]?.[0];
  const MODES = [
    { v: "PICKUP" as const, label: "Retrait", hint: "En boutique", icon: Store, enabled: pickupEnabled },
    { v: "DELIVERY" as const, label: "Livraison", hint: zones.length > 0 ? `${zones.length} zone${zones.length > 1 ? "s" : ""} active${zones.length > 1 ? "s" : ""}` : "Aucune zone active", icon: Truck, enabled: deliveryEnabled && zones.length > 0 },
    { v: "WHATSAPP" as const, label: "À convenir", hint: "Sur WhatsApp", icon: MessageCircle, enabled: whatsappOrdering },
  ];
  const itemCount = lines.reduce((s, l) => s + (l.productId ? l.quantity : 0), 0);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]"
      noValidate
    >
      <div className="min-w-0 space-y-6">
        {error && <Alert tone="danger">{error}</Alert>}

        <Card>
          <CardHeader
            title="Client"
            action={
              <Segmented
                label="Type de client"
                size="sm"
                value={mode}
                onChange={(v) => setMode(v)}
                options={[
                  {
                    value: "existing",
                    label: (
                      <>
                        <UserRound className="size-3.5" aria-hidden /> Existant
                      </>
                    ),
                  },
                  {
                    value: "new",
                    label: (
                      <>
                        <UserRoundPlus className="size-3.5" aria-hidden /> Nouveau
                      </>
                    ),
                  },
                ]}
              />
            }
          />
          <CardBody className="space-y-4 pt-4">
            {mode === "existing" ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field id="customer-search" label="Rechercher un client" hint={customers.length === 0 ? "Aucun client enregistré : créez-en un nouveau." : undefined}>
                  {(p) => (
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-faint" aria-hidden />
                      <Input {...p} type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nom ou téléphone" className="pl-10" />
                    </div>
                  )}
                </Field>
                <Field id="customerId" label="Client" required error={fe("customerName") ?? fe("customerPhone")}>
                  {(p) => (
                    <Select {...p} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                      <option value="">Choisir un client</option>
                      {filteredCustomers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}, {formatPhone(c.phone)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                {selected && (
                  <div className="flex items-center gap-3 rounded-[var(--radius-md)] bg-surface-2/60 px-3.5 py-3 ring-1 ring-inset ring-line sm:col-span-2">
                    <Avatar name={selected.name} size={36} />
                    <div className="min-w-0 text-sm">
                      <p className="truncate font-medium text-ink">{selected.name}</p>
                      <p className="truncate text-ink-muted tabular">
                        {formatPhone(selected.phone)}
                        {selected.address ? `, ${selected.address}` : ""}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field id="name" label="Nom" required error={fe("customerName") ?? fe("name")}>
                  {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />}
                </Field>
                <Field id="phone" label="Téléphone" required error={fe("customerPhone") ?? fe("phone")} hint={`Numéro local, indicatif +${dialCode} ajouté automatiquement.`}>
                  {(p) => <Input {...p} type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01 97 00 00 00" />}
                </Field>
                <Field id="email" label="E-mail (optionnel)" error={fe("customerEmail")} className="sm:col-span-2">
                  {(p) => <Input {...p} type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />}
                </Field>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Articles" description={`${itemCount} article${itemCount > 1 ? "s" : ""}`} />
          <ul className="mt-4 divide-y divide-line border-y border-line">
            {lines.map((l, idx) => {
              const info = lineInfo(l);
              const lowStock = info?.stock != null && info.stock < l.quantity;
              const preorder = lowStock && !!info?.continueSelling;
              return (
                <li key={l.key} className="grid grid-cols-1 gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_170px_96px_auto] sm:items-end sm:px-6">
                  <Field id={`line-${l.key}-product`} label={idx === 0 ? "Produit" : <span className="sm:sr-only">Produit</span>}>
                    {(p) => (
                      <Select {...p} value={l.productId} onChange={(e) => updateLine(l.key, { productId: e.target.value, variantId: "" })}>
                        {products.map((pr) => (
                          <option key={pr.id} value={pr.id}>
                            {pr.name}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <Field id={`line-${l.key}-variant`} label={idx === 0 ? "Variante" : <span className="sm:sr-only">Variante</span>}>
                    {(p) => (
                      <Select {...p} value={l.variantId} onChange={(e) => updateLine(l.key, { variantId: e.target.value })} disabled={!info || info.p.variants.length === 0}>
                        <option value="">{info && info.p.variants.length > 0 ? "Choisir" : "Sans variante"}</option>
                        {info?.p.variants.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <Field id={`line-${l.key}-qty`} label={idx === 0 ? "Quantité" : <span className="sm:sr-only">Quantité</span>}>
                    {(p) => (
                      <Input
                        {...p}
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={999}
                        value={l.quantity}
                        onChange={(e) => updateLine(l.key, { quantity: Math.max(1, Math.min(999, Number(e.target.value) || 1)) })}
                        className="tabular"
                      />
                    )}
                  </Field>
                  <div className="flex h-12 items-center justify-between gap-2 sm:justify-end">
                    <span className="text-right text-sm tabular">
                      <span className="block font-mono font-semibold text-ink">{info ? formatMoney(info.unit * l.quantity, currency) : "-"}</span>
                      {info?.stock != null && (
                        <span className={cn("block text-xs", preorder ? "font-medium text-ink" : lowStock ? "font-medium text-danger" : "text-ink-muted")}>
                          Stock : {info.stock}
                          {preorder && " · précommande (vente en rupture autorisée)"}
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : ls))}
                      disabled={lines.length === 1}
                      className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-danger-soft hover:text-danger disabled:pointer-events-none disabled:opacity-40"
                      aria-label={`Retirer la ligne ${idx + 1}`}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          <CardBody className="flex flex-wrap items-center justify-between gap-3 py-4">
            {fe("items") ? (
              <p className="text-sm font-medium text-danger" role="alert">
                {fe("items")}
              </p>
            ) : (
              <p className="text-xs text-ink-muted">Prix indicatifs : le serveur applique les promotions et vérifie le stock.</p>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-11 sm:h-9"
              onClick={() => setLines((ls) => [...ls, { key: crypto.randomUUID(), productId: products[0]?.id ?? "", variantId: "", quantity: 1 }])}
              disabled={lines.length >= 50}
            >
              <Plus className="size-4" aria-hidden /> Ajouter un article
            </Button>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Livraison et paiement" />
          <CardBody className="space-y-5 pt-4">
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-ink">Mode de remise</legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {MODES.map(({ v, label, hint, icon: Icon, enabled }) => (
                  <label
                    key={v}
                    className={cn(
                      "relative flex min-h-14 cursor-pointer items-center gap-3 rounded-[var(--radius-md)] bg-surface px-3.5 py-2.5 ring-1 ring-inset transition-[box-shadow,background-color] duration-200 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary",
                      fulfillment === v ? "bg-primary-soft/60 ring-2 ring-primary" : "ring-line-strong hover:bg-surface-2/60",
                      !enabled && "cursor-not-allowed opacity-50",
                    )}
                  >
                    <input type="radio" name="fulfillment" value={v} checked={fulfillment === v} onChange={() => setFulfillment(v)} disabled={!enabled} className="sr-only" />
                    <Icon className={cn("size-5 shrink-0", fulfillment === v ? "text-primary" : "text-ink-faint")} aria-hidden />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-ink">{label}</span>
                      <span className="block truncate text-xs text-ink-muted">{hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            {fulfillment === "DELIVERY" && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field id="zone" label="Zone de livraison" required error={fe("deliveryZoneId")}>
                  {(p) => (
                    <Select {...p} value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
                      {zones.map((z) => (
                        <option key={z.id} value={z.id}>
                          {z.name} ({formatMoney(z.fee, currency)})
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field id="address" label="Adresse ou repère" required error={fe("deliveryAddress")}>
                  {(p) => <Input {...p} value={address} onChange={(e) => setAddress(e.target.value)} placeholder={selected?.address ?? "Ex. Akpakpa, face pharmacie"} />}
                </Field>
              </div>
            )}
            {fulfillment !== "WHATSAPP" && (
              <Field id="method" label="Moyen de paiement" error={fe("paymentMethodId")}>
                {(p) => (
                  <Select {...p} value={methodId} onChange={(e) => setMethodId(e.target.value)}>
                    <option value="">Non précisé</option>
                    {methods.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            {creditAvailable > 0 && (
              <Checkbox
                label={`Utiliser l’avoir du client (${formatMoney(creditAvailable, currency)} disponibles)`}
                description="Déduit du montant à payer, dans la limite du total. Recrédité si la commande est annulée."
                checked={useCredit}
                onChange={(e) => setUseCredit(e.target.checked)}
              />
            )}
            <Field id="note" label="Note (optionnel)" hint="Visible par le client sur son suivi.">
              {(p) => <Textarea {...p} value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} className="min-h-20" />}
            </Field>
          </CardBody>
        </Card>
      </div>

      <aside className="min-w-0 lg:sticky lg:top-6" aria-label="Récapitulatif de la commande">
        <Bezel coreClassName="p-5">
          <h2 className="text-[15px] font-semibold tracking-tight text-ink">Récapitulatif</h2>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-muted">Client</dt>
              <dd className="truncate text-right text-ink">{mode === "existing" ? (selected?.name ?? "Non choisi") : name || "Non renseigné"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-muted">Articles</dt>
              <dd className="tabular text-ink">{itemCount}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-muted">Sous-total estimé</dt>
              <dd className="font-mono tabular text-ink">{formatMoney(estimate, currency)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-muted">Livraison</dt>
              <dd className="font-mono tabular text-ink">{fulfillment === "DELIVERY" ? formatMoney(fee, currency) : "Sans objet"}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 border-t border-line pt-3">
              <dt className="font-medium text-ink">Total estimé</dt>
              <dd className="font-mono text-lg font-semibold tabular text-ink">{formatMoney(estimate + fee, currency)}</dd>
            </div>
          </dl>
          <Button type="submit" loading={pending} className="mt-5 h-12 w-full">
            Créer la commande
          </Button>
          <p className="mt-3 text-center text-xs text-ink-muted">Montant définitif recalculé à la création (promotions, stock, frais).</p>
        </Bezel>
      </aside>
    </form>
  );
}
