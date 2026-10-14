"use client";

import { useState } from "react";
import { Check, Link2 } from "lucide-react";

/** Bouton « Copier le lien » du bloc Partager d'un article (amélioration progressive : les liens de partage marchent sans JS). */
export function CopyLinkButton({ url, className }: { url: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <>
      <button
        type="button"
        className={className}
        aria-label={copied ? "Lien copié" : "Copier le lien de l'article"}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url === "#" ? window.location.href : url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          } catch {
            /* presse-papiers indisponible */
          }
        }}
      >
        {copied ? <Check className="size-[18px]" aria-hidden /> : <Link2 className="size-[18px]" aria-hidden />}
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {copied ? "Lien copié" : ""}
      </span>
    </>
  );
}
