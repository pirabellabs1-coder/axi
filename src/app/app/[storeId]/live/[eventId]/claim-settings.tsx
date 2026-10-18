"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { Plus, Radio, Trash2 } from "lucide-react";
import { clearSocialLives, detectSocialLives, saveClaimSettings, saveLiveKeywords } from "@/lib/live/claim-actions";
import { Field, Input, Select, Textarea, Checkbox } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage, fieldError } from "@/components/forms/form-message";
import { ActionButton } from "@/components/app/action-controls";
import { toast } from "@/components/ui/toast";

type EventSettings = {
  id: string;
  claimsEnabled: boolean;
  claimHoldMinutes: number;
  claimMaxPerAuthor: number;
  claimActiveCapUnits: number | null;
  claimActiveCapPercent: number;
  claimMessage: string;
  claimPublicReply: boolean;
  claimPublicText: string;
};

export function ClaimSettingsForm({ storeId, event, defaults }: { storeId: string; event: EventSettings; defaults: { message: string; publicText: string } }) {
  const [state, action] = useActionState(saveClaimSettings, undefined);
  return (
    <form action={action} noValidate className="space-y-4">
      <FormMessage state={state} />
      <input type="hidden" name="storeId" value={storeId} />
      <input type="hidden" name="eventId" value={event.id} />
      <Checkbox name="claimsEnabled" defaultChecked={event.claimsEnabled} label="Réserver par commentaire pendant ce direct" description="Actif uniquement quand le direct est en cours." />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="claimHoldMinutes" label="Délai pour payer (minutes)" required error={fieldError(state, "claimHoldMinutes")} hint="5 à 60 minutes ; ensuite, l'article est remis en vente.">
          {(p) => <Input {...p} type="number" inputMode="numeric" min={5} max={60} name="claimHoldMinutes" defaultValue={event.claimHoldMinutes} />}
        </Field>
        <Field id="claimMaxPerAuthor" label="Articles max. par client" required error={fieldError(state, "claimMaxPerAuthor")} hint="1 à 5, sur l'ensemble du direct.">
          {(p) => <Input {...p} type="number" inputMode="numeric" min={1} max={5} name="claimMaxPerAuthor" defaultValue={event.claimMaxPerAuthor} />}
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="claimActiveCapPercent" label="Réservations en attente max. (% du stock)" required error={fieldError(state, "claimActiveCapPercent")} hint="Par article ; protège le stock contre les faux comptes.">
          {(p) => <Input {...p} type="number" inputMode="numeric" min={1} max={100} name="claimActiveCapPercent" defaultValue={event.claimActiveCapPercent} />}
        </Field>
        <Field id="claimActiveCapUnits" label="Ou nombre fixe d'unités" error={fieldError(state, "claimActiveCapUnits")} hint="Facultatif : remplace le pourcentage.">
          {(p) => <Input {...p} type="number" inputMode="numeric" min={1} name="claimActiveCapUnits" defaultValue={event.claimActiveCapUnits ?? ""} />}
        </Field>
      </div>
      <Field
        id="claimMessage"
        label="Message privé"
        error={fieldError(state, "claimMessage")}
        hint="Variables : {nom} {produit} {quantite} {total} {delai} {boutique} {lien} ({lien} obligatoire). Vide : message par défaut."
      >
        {(p) => <Textarea {...p} name="claimMessage" rows={4} maxLength={600} defaultValue={event.claimMessage} placeholder={defaults.message} />}
      </Field>
      <Checkbox name="claimPublicReply" defaultChecked={event.claimPublicReply} label="Répondre aussi publiquement sous le commentaire" />
      <Field id="claimPublicText" label="Réponse publique" error={fieldError(state, "claimPublicText")}>
        {(p) => <Input {...p} name="claimPublicText" maxLength={200} defaultValue={event.claimPublicText} placeholder={defaults.publicText} />}
      </Field>
      <div className="flex justify-end border-t border-line pt-4">
        <SubmitButton>Enregistrer</SubmitButton>
      </div>
    </form>
  );
}

type ProductOpt = { id: string; name: string; variants: { id: string; name: string }[] };
type Row = { key: number; code: string; productId: string; variantId: string | null };

/** Éditeur des mots-clés : code → produit (+ variante). Enregistrement groupé, revérifié côté serveur. */
export function KeywordsEditor({ storeId, eventId, initial, products }: { storeId: string; eventId: string; initial: { code: string; productId: string; variantId: string | null }[]; products: ProductOpt[] }) {
  const [rows, setRows] = useState<Row[]>(() => initial.map((k, i) => ({ key: i, ...k })));
  const [seq, setSeq] = useState(initial.length);
  const [pending, start] = useTransition();
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const update = (key: number, patch: Partial<Row>) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const add = () => {
    if (rows.length >= 50 || !products.length) return;
    const p = products[0];
    const used = new Set(rows.map((r) => r.code));
    let n = rows.length + 1;
    while (used.has(String(n))) n++;
    setRows((prev) => [...prev, { key: seq, code: String(n), productId: p.id, variantId: p.variants[0]?.id ?? null }]);
    setSeq((s) => s + 1);
  };
  const save = () =>
    start(async () => {
      const r = await saveLiveKeywords(storeId, eventId, rows.map(({ code, productId, variantId }) => ({ code, productId, variantId })));
      if (r.ok) toast.success(r.message ?? "Enregistré");
      else toast.error(r.error);
    });

  if (!products.length) return <p className="text-sm text-ink-muted">Ajoutez d&apos;abord des produits actifs.</p>;

  return (
    <div className="space-y-3">
      {rows.length === 0 && <p className="text-sm text-ink-muted">Aucun mot-clé. Ajoutez-en un par article présenté (ex. 12 → Robe wax M).</p>}
      <ul className="space-y-3">
        {rows.map((r) => {
          const product = byId.get(r.productId);
          return (
            <li key={r.key} className="grid grid-cols-[5.5rem_1fr_auto] items-end gap-2 rounded-[var(--radius-md)] p-2 ring-1 ring-line">
              <Field id={`code-${r.key}`} label="Code">
                {(p) => <Input {...p} value={r.code} maxLength={24} autoComplete="off" spellCheck={false} className="font-mono uppercase" onChange={(e) => update(r.key, { code: e.target.value })} />}
              </Field>
              <div className="min-w-0 space-y-2">
                <Field id={`product-${r.key}`} label="Produit">
                  {(p) => (
                    <Select
                      {...p}
                      value={r.productId}
                      onChange={(e) => {
                        const next = byId.get(e.target.value);
                        update(r.key, { productId: e.target.value, variantId: next?.variants[0]?.id ?? null });
                      }}
                    >
                      {products.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                {product && product.variants.length > 0 && (
                  <Field id={`variant-${r.key}`} label="Variante">
                    {(p) => (
                      <Select {...p} value={r.variantId ?? ""} onChange={(e) => update(r.key, { variantId: e.target.value || null })}>
                        {product.variants.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                )}
              </div>
              <Button type="button" variant="ghost" size="icon" className="size-11" onClick={() => setRows((prev) => prev.filter((x) => x.key !== r.key))} aria-label={`Retirer le code ${r.code}`}>
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap justify-between gap-2">
        <Button type="button" variant="secondary" className="min-h-11" onClick={add} disabled={rows.length >= 50}>
          <Plus className="size-4" aria-hidden /> Ajouter un mot-clé
        </Button>
        <Button type="button" className="min-h-11" onClick={save} loading={pending}>
          Enregistrer les mots-clés
        </Button>
      </div>
    </div>
  );
}

export function SocialLink({ storeId, eventId, linked }: { storeId: string; eventId: string; linked: number }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-muted">
        {linked > 0
          ? `Relié à ${linked} identifiant${linked > 1 ? "s" : ""} de vidéo en direct : seuls ses commentaires réservent.`
          : "Non relié : pendant le direct, les commentaires de toutes vos publications Facebook et Instagram peuvent réserver."}
      </p>
      <div className="flex flex-wrap gap-2">
        <ActionButton action={() => detectSocialLives(storeId, eventId)} variant="secondary" size="sm" className="min-h-11">
          <Radio className="size-4" aria-hidden /> Détecter mon direct en cours
        </ActionButton>
        {linked > 0 && (
          <ActionButton action={() => clearSocialLives(storeId, eventId)} variant="ghost" size="sm" className="min-h-11">
            Retirer la liaison
          </ActionButton>
        )}
      </div>
    </div>
  );
}
