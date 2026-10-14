import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

/** Note sur 5 (lecture seule). Étoiles décoratives, valeur exposée en texte aux lecteurs d'écran. */
export function Stars({ value, size = "md", tone = "default", className }: { value: number; size?: "sm" | "md"; tone?: "default" | "light"; className?: string }) {
  const v = Math.max(0, Math.min(5, value));
  const dim = size === "sm" ? "size-3.5" : "size-[18px]";
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)}>
      <span className="sr-only">{`Note : ${v.toFixed(1).replace(".", ",")} sur 5`}</span>
      {Array.from({ length: 5 }).map((_, i) => {
        const fill = Math.max(0, Math.min(1, v - i));
        return (
          <span key={i} className={cn("relative inline-flex", dim)} aria-hidden>
            <Star className={cn(dim, tone === "light" ? "text-white/40" : "text-line-strong")} fill="currentColor" strokeWidth={0} />
            {fill > 0 && (
              <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
                <Star className={cn(dim, "text-[#E8A317]")} fill="currentColor" strokeWidth={0} />
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}
