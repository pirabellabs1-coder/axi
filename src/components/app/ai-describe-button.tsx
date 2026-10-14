"use client";

import { useState, useTransition } from "react";
import { Sparkles, Check, RotateCcw, Info } from "lucide-react";
import { generateProductDescription, getAiStatus, type AiStatus } from "@/lib/ai/actions";
import type { DescribeOutput } from "@/lib/ai/parse";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Textarea, Checkbox, Hint } from "@/components/ui/field";
import { Alert } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";

/**
 * Bouton « Rédiger avec l'IA » pour le formulaire produit.
 * Propose une description (et sa traduction anglaise) que le commerçant RELIT puis applique avec
 * « Utiliser ce texte » : rien n'est jamais inséré automatiquement.
 *
 * Exemple :
 *   <AiDescribeButton storeId={storeId} name={name} category={categoryName}
 *     onApply={({ description, descriptionEn }) => setDescription(description)} />
 */
export function AiDescribeButton({
  storeId,
  name,
  category,
  productId,
  status: initialStatus,
  onApply,
  className,
}: {
  storeId: string;
  name: string;
  category?: string | null;
  productId?: string | null;
  /** État pré-calculé côté serveur (facultatif : sinon chargé à l'ouverture). */
  status?: AiStatus;
  onApply: (r: { description: string; descriptionEn: string | null }) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<AiStatus | undefined>(initialStatus);
  const [keywords, setKeywords] = useState("");
  const [translate, setTranslate] = useState(false);
  const [result, setResult] = useState<(DescribeOutput & { creditsUsed: number }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [loadingStatus, startStatus] = useTransition();

  const openDialog = () => {
    setOpen(true);
    setError(null);
    if (!status) {
      startStatus(async () => {
        const r = await getAiStatus(storeId);
        if (r.ok && r.data) setStatus(r.data);
        else if (!r.ok) setStatus({ available: false, reason: r.error, balance: null });
      });
    }
  };

  const generate = () =>
    start(async () => {
      setError(null);
      const r = await generateProductDescription({ storeId, name, category: category ?? null, keywords, translate, productId: productId ?? null });
      if (r.ok && r.data) {
        setResult(r.data);
        setStatus((s) => (s && s.balance != null ? { ...s, balance: Math.max(0, s.balance - r.data!.creditsUsed) } : s));
      } else if (!r.ok) setError(r.error);
    });

  const unavailable = status && !status.available;
  const nameMissing = name.trim().length < 2;

  return (
    <>
      <Button type="button" variant="outline" size="sm" className={className} onClick={openDialog}>
        <Sparkles className="size-4" aria-hidden /> Rédiger avec l'IA
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Rédiger la description" description="Une proposition à relire. Rien n'est appliqué sans votre accord." size="lg" sheet>
        <div className="space-y-4">
          {loadingStatus && !status && <p className="text-sm text-ink-muted" aria-live="polite">Vérification de vos crédits IA…</p>}
          {unavailable && <Alert tone="info" title="Assistant indisponible">{status?.reason}</Alert>}
          {nameMissing && <Alert tone="warning">Indiquez d'abord le nom du produit dans le formulaire.</Alert>}

          <div className="rounded-[var(--radius-md)] bg-surface-2/60 px-4 py-3 text-sm ring-1 ring-inset ring-line">
            <p className="font-medium text-ink">{name.trim() || "Produit sans nom"}</p>
            {category && <p className="text-ink-muted">{category}</p>}
          </div>

          <Field id="ai-keywords" label="Mots-clés" hint="Matière, usage, occasion, origine, taille… Ce que vous écrivez ici est la seule source de l'IA.">
            {(p) => <Textarea {...p} value={keywords} onChange={(e) => setKeywords(e.target.value)} rows={3} maxLength={400} placeholder="Ex. : wax 100 % coton, cousu à Cotonou, idéal pour les cérémonies" />}
          </Field>
          <Checkbox checked={translate} onChange={(e) => setTranslate(e.target.checked)} label="Ajouter la traduction anglaise" description="2 crédits IA au lieu d'1." />

          <p className="flex items-start gap-2 text-[13px] text-ink-muted">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            L'assistant n'écrit jamais de prix, de stock, de délai ni de promesse : ces informations restent les vôtres.
            {status?.balance != null && <span className="tabular"> Solde : {status.balance} crédit{status.balance > 1 ? "s" : ""}.</span>}
          </p>

          {error && (
            <Alert tone="danger" title="Échec">
              {error}
            </Alert>
          )}

          {result && (
            <div className="space-y-3" aria-live="polite">
              <Proposal label="Description (français)" text={result.description} />
              {result.descriptionEn && <Proposal label="Description (anglais)" text={result.descriptionEn} lang="en" />}
              {result.highlights.length > 0 && (
                <ul className="flex flex-wrap gap-1.5" aria-label="Points forts suggérés">
                  {result.highlights.map((h) => (
                    <li key={h} className="rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-primary-deep ring-1 ring-inset ring-line">
                      {h}
                    </li>
                  ))}
                </ul>
              )}
              {result.removed.length > 0 && <Hint>{result.removed.length} phrase{result.removed.length > 1 ? "s" : ""} retirée{result.removed.length > 1 ? "s" : ""} car elle{result.removed.length > 1 ? "s" : ""} annonçai{result.removed.length > 1 ? "ent" : "t"} un prix, un stock ou un délai.</Hint>}
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Fermer
            </Button>
            {result ? (
              <>
                <Button variant="secondary" onClick={generate} loading={pending} disabled={unavailable || nameMissing}>
                  <RotateCcw className="size-4" aria-hidden /> Autre proposition
                </Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    onApply({ description: result.description, descriptionEn: result.descriptionEn });
                    toast.success("Texte inséré dans le formulaire", "Relisez-le puis enregistrez le produit.");
                    setOpen(false);
                  }}
                >
                  <Check className="size-4" aria-hidden /> Utiliser ce texte
                </Button>
              </>
            ) : (
              <Button variant="primary" onClick={generate} loading={pending} disabled={!!unavailable || nameMissing || (!status && loadingStatus)}>
                <Sparkles className="size-4" aria-hidden /> Proposer un texte
              </Button>
            )}
          </div>
        </div>
      </Dialog>
    </>
  );
}

function Proposal({ label, text, lang }: { label: string; text: string; lang?: string }) {
  return (
    <figure>
      <figcaption className="mb-1.5 text-sm font-medium text-ink">{label}</figcaption>
      <blockquote lang={lang} className="whitespace-pre-wrap rounded-[var(--radius-md)] bg-surface px-4 py-3 text-[15px] leading-relaxed text-ink ring-1 ring-inset ring-line-strong [overflow-wrap:anywhere]">
        {text}
      </blockquote>
    </figure>
  );
}
