"use client";

import * as React from "react";
import Link from "next/link";
import { Lock, MousePointerClick, Sparkles, Wand2 } from "lucide-react";
import { runDesignAssistant } from "@/lib/ai/design/actions";
import { cn } from "@/lib/utils";

/**
 * Lot 4 §10 : assistant de design conversationnel dans l'éditeur, et §8 : interrupteur « Modifier dans l'aperçu ».
 * L'assistant renvoie des OPÉRATIONS déjà validées côté serveur ; l'éditeur les applique au brouillon
 * en UNE entrée d'historique (annulable en un clic), avec aperçu immédiat.
 */
export function DesignAssistantPanel({
  storeId,
  template,
  selection,
  docJson,
  enabled,
  onApply,
}: {
  storeId: string;
  template: string;
  selection: string | null;
  docJson: string;
  /** Plan Business et plus (contrôle serveur également). */
  enabled: boolean;
  onApply: (operations: unknown[], explanation: string) => boolean;
}) {
  const [value, setValue] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [answer, setAnswer] = React.useState<{ tone: "info" | "error"; text: string } | null>(null);

  const send = async () => {
    const instruction = value.trim();
    if (instruction.length < 3) return;
    setBusy(true);
    setAnswer(null);
    const r = await runDesignAssistant({ storeId, instruction, docJson, template, selection });
    setBusy(false);
    if (!r.ok) {
      setAnswer({ tone: "error", text: r.error });
      return;
    }
    const d = r.data!;
    if (d.refused || !d.operations.length) {
      setAnswer({ tone: "error", text: d.explanation });
      return;
    }
    const ok = onApply(d.operations, d.explanation);
    setAnswer({ tone: ok ? "info" : "error", text: ok ? d.explanation : "Modification refusée par l'éditeur : rien n'a été changé." });
    if (ok) setValue("");
  };

  const generateLink = (
    <Link
      href={`/app/${storeId}/apparence/generer`}
      className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 text-[12.5px] font-medium text-primary hover:underline lg:min-h-9"
    >
      <Wand2 className="size-3.5" aria-hidden /> Générer la boutique avec l&apos;IA
    </Link>
  );

  if (!enabled) {
    return (
      <div className="border-t border-line p-2">
        <p className="flex items-start gap-2 rounded-[10px] bg-surface-2 p-2.5 text-[12.5px] text-ink-muted">
          <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            L&apos;assistant de design (« Rends l&apos;accueil plus luxe ») est inclus à partir du plan Business.
          </span>
        </p>
        {generateLink}
      </div>
    );
  }

  return (
    <div className="border-t border-line p-2">
      <label htmlFor="design-assistant" className="mb-1 flex items-center gap-1.5 text-[12.5px] font-medium text-ink">
        <Sparkles className="size-3.5 text-primary" aria-hidden /> Dites ce que vous voulez changer
      </label>
      <textarea
        id="design-assistant"
        rows={2}
        maxLength={500}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void send();
          }
        }}
        placeholder="Rends l'accueil plus luxe, ajoute une FAQ sur la livraison…"
        className="w-full resize-y rounded-[12px] bg-surface-2 px-3 py-2 text-[13px] text-ink ring-1 ring-inset ring-line placeholder:text-ink-faint focus-visible:outline-2 focus-visible:outline-primary"
        aria-describedby="design-assistant-hint"
      />
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <p id="design-assistant-hint" className="text-[11.5px] text-ink-muted">
          2 crédits IA par instruction
        </p>
        <button
          type="button"
          onClick={() => void send()}
          disabled={busy || value.trim().length < 3}
          className="inline-flex h-11 items-center gap-1.5 rounded-full bg-primary px-3.5 text-[13px] font-medium text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-50 lg:h-9"
        >
          {busy ? "En cours…" : "Appliquer"}
        </button>
      </div>
      {answer && (
        <p role="status" className={cn("mt-2 rounded-[10px] p-2 text-[12.5px]", answer.tone === "error" ? "bg-danger-soft text-danger" : "bg-primary-soft text-primary-deep")}>
          {answer.text}
        </p>
      )}
      {generateLink}
    </div>
  );
}

/** §8 : interrupteur « Modifier dans l'aperçu » (édition en place, désactivée par défaut). */
export function InlineEditToggle({ checked, onChange, enabled }: { checked: boolean; onChange: (v: boolean) => void; enabled: boolean }) {
  if (!enabled) return null;
  return (
    <label className="inline-flex h-11 max-w-full cursor-pointer select-none items-center gap-1.5 rounded-full bg-surface px-3.5 text-[13px] font-medium text-ink shadow-[var(--shadow-md)] ring-1 ring-line transition-[background-color,transform] duration-150 hover:bg-surface-2 active:scale-[0.97] sm:h-9">
      <input type="checkbox" className="size-4 shrink-0 accent-[var(--c-primary)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <MousePointerClick className="size-3.5 text-ink-muted" aria-hidden />
      <span className="truncate">Modifier dans l&apos;aperçu</span>
    </label>
  );
}
