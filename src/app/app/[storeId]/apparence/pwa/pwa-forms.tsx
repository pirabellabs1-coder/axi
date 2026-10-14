"use client";

import { useActionState, useRef, useState } from "react";
import Image from "next/image";
import { ImagePlus, Send } from "lucide-react";
import type { PwaConfig } from "@/lib/pwa/config";
import { savePwaSettings } from "@/lib/pwa/actions";
import { sendPushCampaign, sendTestPush } from "@/lib/push/actions";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage, fieldError } from "@/components/forms/form-message";
import { ActionButton } from "@/components/app/action-controls";

/**
 * Formulaires de l'écran « Boutique installable et notifications » (lot 4D).
 * Les icônes sont générées DANS LE NAVIGATEUR (canvas) à partir de l'image choisie : deux PNG carrés
 * (192 et 512), téléversés par l'API média existante, puis enregistrés comme URL dans `Store.pwaConfig`.
 */

type IconState = { icon192: string; icon512: string };

/** Redimensionne une image en PNG carré, fond blanc (les icônes PNG transparentes s'affichent mal en « maskable »). */
async function squarePng(file: File, size: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("Canvas indisponible");
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, size, size);
  // Recadrage « cover » centré, avec une marge de 8 % pour que l'icône reste lisible une fois masquée.
  const pad = Math.round(size * 0.08);
  const inner = size - pad * 2;
  const ratio = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - ratio) / 2;
  const sy = (bitmap.height - ratio) / 2;
  g.imageSmoothingQuality = "high";
  g.drawImage(bitmap, sx, sy, ratio, ratio, pad, pad, inner, inner);
  bitmap.close?.();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Conversion PNG impossible");
  return blob;
}

async function uploadIcon(storeId: string, blob: Blob): Promise<string> {
  const res = await fetch(`/api/stores/${storeId}/media?purpose=theme`, { method: "POST", headers: { "Content-Type": "image/png" }, body: blob });
  const json = (await res.json().catch(() => null)) as { url?: string; error?: { message?: string } } | null;
  if (!res.ok || !json?.url) throw new Error(json?.error?.message ?? "Téléversement impossible");
  return json.url;
}

export function PwaSettingsForm({ storeId, storeName, config }: { storeId: string; storeName: string; config: PwaConfig }) {
  const [state, action] = useActionState(savePwaSettings, undefined);
  const [icons, setIcons] = useState<IconState>({ icon192: config.icon192 ?? "", icon512: config.icon512 ?? "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
      setError("Choisissez une image PNG, JPG ou WebP.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Image trop lourde (5 Mo maximum).");
      return;
    }
    setBusy(true);
    try {
      const [small, large] = await Promise.all([squarePng(file, 192), squarePng(file, 512)]);
      const [icon192, icon512] = await Promise.all([uploadIcon(storeId, small), uploadIcon(storeId, large)]);
      setIcons({ icon192, icon512 });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Génération des icônes impossible");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <form action={action} noValidate className="space-y-5">
      <FormMessage state={state} />
      <input type="hidden" name="storeId" value={storeId} />
      <input type="hidden" name="icon192" value={icons.icon192} />
      <input type="hidden" name="icon512" value={icons.icon512} />

      <div className="flex items-center gap-4">
        <span className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-[18px] bg-surface-2 ring-1 ring-inset ring-line">
          {icons.icon192 ? (
            <Image src={icons.icon192} alt="Aperçu de l'icône de la boutique" width={64} height={64} className="size-16 object-cover" />
          ) : (
            <ImagePlus className="size-5 text-ink-faint" aria-hidden />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <label htmlFor="pwa-icon" className="text-sm font-medium text-ink">
            Icône de l&apos;application
          </label>
          <input
            ref={input}
            id="pwa-icon"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => void onPick(e.target.files?.[0])}
            disabled={busy}
            className="mt-1 block w-full text-sm text-ink-muted file:mr-3 file:min-h-11 file:rounded-full file:border-0 file:bg-surface-2 file:px-4 file:text-sm file:font-medium file:text-ink"
          />
          <p className="mt-1 text-xs text-ink-muted" aria-live="polite">
            {busy ? "Génération des icônes…" : error ? error : "Carré, 512 pixels minimum. Les deux tailles sont fabriquées automatiquement."}
          </p>
        </div>
      </div>

      <Field id="pwa-name" label="Nom affiché à l'installation" hint={`Laissez vide pour utiliser « ${storeName} ».`} error={fieldError(state, "name")}>
        {(p) => <Input {...p} name="name" defaultValue={config.name ?? ""} maxLength={60} autoComplete="off" />}
      </Field>
      <Field id="pwa-short" label="Nom court (sous l'icône)" hint="12 caractères maximum." error={fieldError(state, "shortName")}>
        {(p) => <Input {...p} name="shortName" defaultValue={config.shortName ?? ""} maxLength={12} autoComplete="off" />}
      </Field>
      <Field id="pwa-offline" label="Message hors ligne" hint="Affiché quand le client n'a plus de réseau." error={fieldError(state, "offlineText")}>
        {(p) => <Textarea {...p} name="offlineText" defaultValue={config.offlineText ?? ""} maxLength={200} rows={2} />}
      </Field>

      <Checkbox name="enabled" defaultChecked={config.enabled} label="Rendre la boutique installable" description="Le manifeste et le service worker sont servis, les pages déjà vues restent consultables hors ligne." />
      <Checkbox name="prompt" defaultChecked={config.prompt} label="Proposer l'installation aux visiteurs" description="Bandeau discret à partir de la deuxième visite ou dès qu'un panier existe. Refus mémorisé 30 jours." />

      <div className="flex justify-end border-t border-line pt-4">
        <SubmitButton disabled={busy}>Enregistrer</SubmitButton>
      </div>
    </form>
  );
}

export function PushTestButton({ storeId }: { storeId: string }) {
  return (
    <ActionButton action={() => sendTestPush(storeId)} variant="outline" size="sm" className="min-h-11">
      <Send className="size-4" aria-hidden /> Envoyer un essai
    </ActionButton>
  );
}

export function PushCampaignForm({ storeId, slug, marketing }: { storeId: string; slug: string; marketing: number }) {
  const [state, action] = useActionState(sendPushCampaign, undefined);
  return (
    <form action={action} noValidate className="space-y-5">
      <FormMessage state={state} />
      <input type="hidden" name="storeId" value={storeId} />
      <input type="hidden" name="topic" value="marketing" />
      <Field id="push-title" label="Titre" required error={fieldError(state, "title")} hint="80 caractères maximum.">
        {(p) => <Input {...p} name="title" maxLength={80} autoComplete="off" placeholder="Nouveautés de la semaine" />}
      </Field>
      <Field id="push-body" label="Message" required error={fieldError(state, "body")} hint="240 caractères maximum.">
        {(p) => <Textarea {...p} name="body" maxLength={240} rows={2} placeholder="3 nouveaux modèles viennent d'arriver. Livraison le jour même à Cotonou." />}
      </Field>
      <Field id="push-url" label="Lien ouvert au clic" error={fieldError(state, "url")} hint={`Chemin de la boutique, par exemple /s/${slug}/catalogue.`}>
        {(p) => <Input {...p} name="url" defaultValue={`/s/${slug}/catalogue`} maxLength={400} autoComplete="off" />}
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className="text-xs text-ink-muted">
          Envoyé à {marketing.toLocaleString("fr-FR")} client{marketing > 1 ? "s" : ""} ayant accepté les offres. Aucun crédit WhatsApp n&apos;est débité.
        </p>
        <SubmitButton disabled={marketing === 0}>Envoyer la notification</SubmitButton>
      </div>
    </form>
  );
}
