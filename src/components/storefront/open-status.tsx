import { cn } from "@/lib/utils";

/** Statut ouvert / fermé : texte + pastille (jamais la couleur seule). */
export function OpenStatus({ open, compact, className, onDark }: { open: boolean; compact?: boolean; className?: string; onDark?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", onDark ? "text-white/90" : open ? "text-[#0f6b3f]" : "text-ink-muted", className)}>
      <span className="relative inline-flex size-2" aria-hidden>
        {open && <span className="absolute inset-0 animate-ping rounded-full bg-[#1fa463] opacity-40 motion-reduce:hidden" />}
        <span className={cn("relative size-2 rounded-full", open ? "bg-[#1fa463]" : onDark ? "bg-white/60" : "bg-ink-faint")} />
      </span>
      {open ? (compact ? "Ouvert" : "Ouvert maintenant") : compact ? "Fermé" : "Fermé pour le moment"}
    </span>
  );
}
