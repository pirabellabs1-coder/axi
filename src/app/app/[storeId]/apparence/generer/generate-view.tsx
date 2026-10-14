"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ImagePlus, Loader2, Palette, RefreshCw, Sparkles, Trash2, Wand2 } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button, ButtonLink } from "@/components/ui/button";
import { Alert } from "@/components/ui/misc";
import { Hint, Input, Label, Select, Textarea } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { compressThemeImage, uploadImage, UploadFailedError } from "@/lib/storage/client";
import { extractLogoColors } from "@/lib/brand-kit/client";
import { BRAND_TONES, buildBrandKit, contrastReport, type BrandKit, type BrandTone } from "@/lib/brand-kit/palette";
import { saveBrandKit } from "@/lib/brand-kit/actions";
import { chooseDirection, generateStoreDesign, regenerateDirection, type DesignCandidate } from "@/lib/ai/design/actions";
import { Preview } from "@/components/theme-editor/preview";

/**
 * Lot 4 §7 et §9 : kit de marque (gratuit) puis génération de 3 directions.
 * Les 3 aperçus sont de vraies iframes de la boutique alimentées par `axi:theme-preview` : aucune écriture.
 */

const MAX_PHOTOS = 6;
const TONE_LABELS: Record<BrandTone, string> = { chaleureux: "Chaleureux", premium: "Premium", direct: "Direct", festif: "Festif" };

const AI_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type AiPhotoType = (typeof AI_PHOTO_TYPES)[number];
type Photo = { url: string; mediaType: AiPhotoType; data: string; name: string };

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

export function GenerateDesignView(p: {
  storeId: string;
  slug: string;
  storeName: string;
  sector: string;
  logoUrl: string | null;
  brandKit: BrandKit | null;
  aiBalance: number;
  gift: number;
  costs: { generate: number; withPhotos: number; regenerate: number };
  planName: string;
  enabled: boolean;
  configured: boolean;
  simulated: boolean;
  facts: { collections: number; products: number; hasReviews: boolean };
}) {
  const router = useRouter();

  /* ───────── §7 Kit de marque ───────── */
  const [kit, setKit] = React.useState<BrandKit | null>(p.brandKit);
  const [tone, setTone] = React.useState<BrandTone>(p.brandKit?.voice.tone ?? "chaleureux");
  const [logoUrl, setLogoUrl] = React.useState<string | null>(p.brandKit?.logoUrl ?? p.logoUrl);
  const [kitBusy, setKitBusy] = React.useState(false);
  const logoRef = React.useRef<HTMLInputElement>(null);

  const onLogo = async (file: File | undefined) => {
    if (!file) return;
    setKitBusy(true);
    try {
      const colors = await extractLogoColors(file, 5);
      const blob = await compressThemeImage(file, 512);
      const { url } = await uploadImage(p.storeId, "theme", blob);
      setLogoUrl(url);
      setKit(buildBrandKit({ colors, logoUrl: url, tone }));
      toast.success("Couleurs extraites du logo", "Vérifiez la palette, puis enregistrez votre kit de marque.");
    } catch (e) {
      toast.error("Extraction impossible", e instanceof Error ? e.message : undefined);
    } finally {
      setKitBusy(false);
      if (logoRef.current) logoRef.current.value = "";
    }
  };

  const onTone = (next: BrandTone) => {
    setTone(next);
    if (kit) setKit(buildBrandKit({ colors: kit.palette, logoUrl: kit.logoUrl, tone: next }));
  };

  const persistKit = async () => {
    if (!kit) return;
    setKitBusy(true);
    const r = await saveBrandKit(p.storeId, { ...kit, logoUrl: logoUrl ?? kit.logoUrl });
    setKitBusy(false);
    if (!r.ok) {
      toast.error("Enregistrement impossible", r.error);
      return;
    }
    setKit(r.data!.kit);
    toast.success(r.message ?? "Kit de marque enregistré", "L'IA, les campagnes et les visuels le réutilisent.");
    router.refresh();
  };

  const checks = kit ? contrastReport(kit.colors, kit.schemes) : [];

  /* ───────── §9 Formulaire ───────── */
  const [brief, setBrief] = React.useState("");
  const [audience, setAudience] = React.useState("");
  const [banned, setBanned] = React.useState("");
  const [photos, setPhotos] = React.useState<Photo[]>([]);
  const [photoBusy, setPhotoBusy] = React.useState(false);
  const photoRef = React.useRef<HTMLInputElement>(null);
  const [running, setRunning] = React.useState(false);
  const [result, setResult] = React.useState<{ generationId: string; candidates: DesignCandidate[] } | null>(null);
  const [chosen, setChosen] = React.useState<number | null>(null);
  const [busyIndex, setBusyIndex] = React.useState<number | null>(null);

  const onPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    setPhotoBusy(true);
    const added: Photo[] = [];
    for (const file of Array.from(files).slice(0, MAX_PHOTOS - photos.length)) {
      try {
        // Réduction à 1 024 px pour l'analyse (et pour le poids envoyé au modèle).
        const blob = await compressThemeImage(file, 1024);
        const { url } = await uploadImage(p.storeId, "theme", blob);
        const mediaType = (AI_PHOTO_TYPES as readonly string[]).includes(blob.type) ? (blob.type as AiPhotoType) : "image/webp";
        added.push({ url, mediaType, data: await toBase64(blob), name: file.name });
      } catch (e) {
        toast.error(`« ${file.name} » refusée`, e instanceof UploadFailedError ? e.message : "Essayez une autre image.");
      }
    }
    setPhotos((list) => [...list, ...added].slice(0, MAX_PHOTOS));
    setPhotoBusy(false);
    if (photoRef.current) photoRef.current.value = "";
  };

  const cost = photos.length ? p.costs.withPhotos : p.costs.generate;

  const generate = async () => {
    setRunning(true);
    setChosen(null);
    const r = await generateStoreDesign({
      storeId: p.storeId,
      brief,
      audience: audience.trim() || null,
      bannedWords: banned.split(",").map((w) => w.trim()).filter(Boolean).slice(0, 20),
      photos: photos.map((x) => x.url),
      images: photos.map((x) => ({ mediaType: x.mediaType, data: x.data })),
    });
    setRunning(false);
    if (!r.ok) {
      toast.error("Génération impossible", r.error);
      return;
    }
    setResult({ generationId: r.data!.generationId, candidates: r.data!.candidates });
    toast.success(r.message ?? "3 directions prêtes");
  };

  const regenerate = async (index: number) => {
    if (!result) return;
    setBusyIndex(index);
    const r = await regenerateDirection(p.storeId, result.generationId, index);
    setBusyIndex(null);
    if (!r.ok) {
      toast.error("Nouvelle proposition impossible", r.error);
      return;
    }
    setResult({ ...result, candidates: result.candidates.map((c, i) => (i === index ? r.data!.candidate : c)) });
    toast.success("Nouvelle direction proposée");
  };

  const choose = async (index: number) => {
    if (!result) return;
    setBusyIndex(index);
    const r = await chooseDirection(p.storeId, result.generationId, index);
    setBusyIndex(null);
    if (!r.ok) {
      toast.error("Impossible d'appliquer cette direction", r.error);
      return;
    }
    setChosen(index);
    toast.success(r.message ?? "Direction appliquée au brouillon");
  };

  const blocked = !p.enabled ? `La génération par l'IA n'est pas incluse dans le plan ${p.planName}.` : !p.configured ? "L'assistant IA n'est pas encore activé sur la plateforme." : p.aiBalance < cost ? `Crédits IA insuffisants : ${cost} crédits nécessaires, ${p.aiBalance} disponibles.` : null;

  return (
    <div className="space-y-6">
      {p.simulated && (
        <Alert tone="warning" title="Client IA simulé (AI_FAKE=1)">
          Les directions sont produites localement, sans appel au modèle. À n&apos;utiliser qu&apos;en développement et en recette.
        </Alert>
      )}
      {p.gift > 0 && <Alert tone="success" title={`${p.gift} crédits IA offerts`}>Vous avez de quoi générer une boutique complète. Les crédits offerts expirent dans 30 jours.</Alert>}

      {/* §7 Kit de marque */}
      <Card as="section" aria-labelledby="brand-kit-title">
        <CardHeader
          title={<span id="brand-kit-title" className="inline-flex items-center gap-2"><Palette className="size-4 text-primary" aria-hidden /> Kit de marque</span>}
          description="Importez votre logo : les couleurs sont lues dans votre navigateur, la palette est complétée et corrigée pour rester lisible. Gratuit, sans crédit."
        />
        <CardBody className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-[12px] bg-surface-2 ring-1 ring-line">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {logoUrl ? <img src={logoUrl} alt="" className="size-full object-contain" /> : <ImagePlus className="size-5 text-ink-faint" aria-hidden />}
            </div>
            <Button variant="secondary" onClick={() => logoRef.current?.click()} loading={kitBusy} disabled={kitBusy}>
              {logoUrl ? "Remplacer le logo" : "Importer le logo"}
            </Button>
            <input ref={logoRef} type="file" accept="image/png,image/jpeg,image/webp,image/avif" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void onLogo(e.target.files?.[0])} />
            <div className="min-w-[180px]">
              <Label htmlFor="brand-tone">Ton de la marque</Label>
              <Select id="brand-tone" fieldSize="sm" value={tone} onChange={(e) => onTone(e.target.value as BrandTone)}>
                {BRAND_TONES.map((t) => (
                  <option key={t} value={t}>
                    {TONE_LABELS[t]}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {kit ? (
            <>
              <ul className="flex flex-wrap gap-2" aria-label="Palette de la marque">
                {[
                  { id: "primary", label: "Principale", color: kit.colors.primary },
                  { id: "accent", label: "Accent", color: kit.colors.accent },
                  { id: "background", label: "Fond", color: kit.colors.background },
                  { id: "surface", label: "Cartes", color: kit.colors.surface },
                  { id: "text", label: "Texte", color: kit.colors.text },
                  { id: "muted", label: "Texte secondaire", color: kit.colors.muted },
                ].map((c) => (
                  <li key={c.id} className="flex items-center gap-2 rounded-full bg-surface-2 py-1 pl-1 pr-3 text-[12.5px] ring-1 ring-line">
                    <span className="size-6 rounded-full ring-1 ring-inset ring-black/10" style={{ background: c.color }} aria-hidden />
                    <span className="text-ink-muted">{c.label}</span>
                    <span className="tabular-nums font-medium">{c.color}</span>
                  </li>
                ))}
              </ul>
              <ul className="grid gap-1.5 text-[12.5px] sm:grid-cols-2" aria-label="Contrôle de contraste AA">
                {checks.map((c) => (
                  <li key={c.id} className={cn("flex items-center justify-between gap-2 rounded-[10px] px-2.5 py-1.5 ring-1 ring-inset", c.ok ? "ring-line text-ink-muted" : "bg-danger-soft text-danger ring-danger/30")}>
                    <span className="truncate">{c.label}</span>
                    <span className="tabular-nums font-medium">
                      {c.ratio.toFixed(2)}:1 {c.ok ? "OK" : `< ${c.min}`}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                <Button onClick={persistKit} loading={kitBusy} disabled={kitBusy}>
                  Enregistrer le kit de marque
                </Button>
                <p className="self-center text-[12.5px] text-ink-muted">Polices : {kit.fontPair.heading} / {kit.fontPair.body}</p>
              </div>
            </>
          ) : (
            <Hint>Aucun kit pour le moment. Sans logo, la génération part du préréglage de votre secteur.</Hint>
          )}
        </CardBody>
      </Card>

      {/* §9 Formulaire */}
      <Card as="section" aria-labelledby="generate-title">
        <CardHeader
          title={<span id="generate-title" className="inline-flex items-center gap-2"><Sparkles className="size-4 text-primary" aria-hidden /> Votre boutique en une phrase</span>}
          description={`Vos données réelles sont utilisées : ${p.facts.products} produit(s), ${p.facts.collections} collection(s), moyens de paiement, zones de livraison et horaires. ${p.facts.hasReviews ? "Vos avis clients peuvent être affichés." : "Sans avis réels, aucune section d'avis ni de témoignage n'est proposée."}`}
        />
        <CardBody className="space-y-4">
          <div>
            <Label htmlFor="brief" required>
              Décrivez votre activité
            </Label>
            <Textarea
              id="brief"
              rows={3}
              maxLength={500}
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="Pâtisserie fine à Cotonou, gâteaux d'anniversaire sur commande, ambiance chic et chaleureuse"
              aria-describedby="brief-hint"
            />
            <Hint id="brief-hint">{brief.length}/500 caractères. L&apos;IA n&apos;invente ni prix, ni promesse, ni avis.</Hint>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="audience">Audience visée</Label>
              <Input id="audience" fieldSize="sm" maxLength={160} value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="Familles, jeunes actifs, entreprises" />
            </div>
            <div>
              <Label htmlFor="banned">Mots interdits</Label>
              <Input id="banned" fieldSize="sm" maxLength={300} value={banned} onChange={(e) => setBanned(e.target.value)} placeholder="séparés par des virgules" />
            </div>
          </div>
          <div>
            <Label htmlFor="photos-btn">Photos (6 au maximum)</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Button id="photos-btn" variant="secondary" size="sm" onClick={() => photoRef.current?.click()} loading={photoBusy} disabled={photoBusy || photos.length >= MAX_PHOTOS}>
                <ImagePlus className="size-4" aria-hidden /> Ajouter des photos
              </Button>
              <input ref={photoRef} type="file" accept="image/png,image/jpeg,image/webp,image/avif" multiple className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void onPhotos(e.target.files)} />
              {photos.map((ph, i) => (
                <span key={ph.url} className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 py-1 pl-1 pr-2 text-[12px] ring-1 ring-line">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={ph.url} alt="" className="size-7 rounded-full object-cover" />
                  <span className="max-w-[90px] truncate">{ph.name}</span>
                  <button type="button" onClick={() => setPhotos((l) => l.filter((_, j) => j !== i))} className="inline-grid size-6 place-items-center rounded-full text-ink-muted hover:bg-danger-soft hover:text-danger" aria-label={`Retirer ${ph.name}`}>
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                </span>
              ))}
            </div>
            <Hint>Avec photos : {p.costs.withPhotos} crédits. Sans photo : {p.costs.generate} crédits. Solde actuel : {p.aiBalance}.</Hint>
          </div>
          {blocked && <Alert tone="warning">{blocked} <Link className="underline" href={`/app/${p.storeId}/abonnement`}>Voir les plans et les packs</Link></Alert>}
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={generate} loading={running} disabled={running || !!blocked || brief.trim().length < 10}>
              <Wand2 className="size-4" aria-hidden /> Générer 3 directions ({cost} crédits)
            </Button>
            <p className="text-[12.5px] text-ink-muted">Rien n&apos;est enregistré avant votre choix.</p>
          </div>
        </CardBody>
      </Card>

      {/* §9 Trois aperçus côte à côte */}
      {result && (
        <section aria-labelledby="candidates-title" className="space-y-3">
          <h2 id="candidates-title" className="text-[19px] font-semibold tracking-[-0.02em]">
            3 directions proposées
          </h2>
          <div className="grid gap-4 lg:grid-cols-3">
            {result.candidates.map((c) => (
              <Card key={`${c.index}-${c.id}`} as="article" className={cn(chosen === c.index && "ring-2 ring-primary")}>
                <CardHeader title={c.name} description={c.rationale} />
                <CardBody className="space-y-3">
                  <div className="h-[420px] overflow-hidden rounded-[12px] ring-1 ring-line">
                    <Preview slug={p.slug} template="home" device="mobile" doc={c.doc} selectedSectionId={null} />
                  </div>
                  {c.fallback && <Alert tone="warning">Direction simplifiée : seule la palette a été retenue (document refusé à la validation).</Alert>}
                  {c.notes.length > 0 && (
                    <details className="text-[12.5px] text-ink-muted">
                      <summary className="cursor-pointer">Garde-fous appliqués ({c.notes.length})</summary>
                      <ul className="mt-1 list-inside list-disc space-y-0.5">
                        {c.notes.map((n, i) => (
                          <li key={i}>{n}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => choose(c.index)} loading={busyIndex === c.index} disabled={busyIndex !== null}>
                      {chosen === c.index ? <><Check className="size-4" aria-hidden /> Appliquée</> : "Choisir cette direction"}
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => regenerate(c.index)} disabled={busyIndex !== null}>
                      <RefreshCw className="size-4" aria-hidden /> Régénérer ({p.costs.regenerate})
                    </Button>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
          {chosen !== null && (
            <Alert tone="success" title="Direction appliquée au brouillon">
              <p className="mb-2">Une version « Avant génération IA » a été enregistrée : vous pouvez revenir en arrière à tout moment. Rien n&apos;est publié.</p>
              <ButtonLink href={`/app/${p.storeId}/apparence`} size="sm">
                Ouvrir l&apos;éditeur
              </ButtonLink>
            </Alert>
          )}
        </section>
      )}
      {running && (
        <p role="status" className="flex items-center gap-2 text-sm text-ink-muted">
          <Loader2 className="size-4 animate-spin" aria-hidden /> L&apos;IA compose vos directions…
        </p>
      )}
    </div>
  );
}
