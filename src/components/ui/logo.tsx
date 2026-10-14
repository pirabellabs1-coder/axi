import Link from "next/link";
import { cn } from "@/lib/utils";

/** Marque Axi : un « a » en arches d'étal de marché, forêt + point lime. Couleurs fixes, lisibles sur les deux thèmes. */
export function AxiMark({ className, size = 32 }: { className?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden className={cn("shrink-0", className)}>
      <rect width="32" height="32" rx="10" fill="#0d3b2e" />
      <rect x="0.5" y="0.5" width="31" height="31" rx="9.5" stroke="#ffffff" strokeOpacity="0.12" />
      <path d="M8 22.5v-7.2C8 11.8 10.4 9.5 13.3 9.5c1.9 0 3.3.9 4.2 2.4.9-1.5 2.3-2.4 4.2-2.4 1.9 0 3.3 1.1 3.3 3.2" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M13.3 22.5v-5c0-1.7 1-2.8 2.4-2.8s2.3 1.1 2.3 2.8v5M21.3 22.5v-5" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="25.4" cy="21.8" r="1.9" fill="#b8f06a" />
    </svg>
  );
}

export function Logo({ href = "/", className, light = false, size = 30 }: { href?: string; className?: string; light?: boolean; size?: number }) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-2", className)} aria-label="Axi, accueil">
      <AxiMark size={size} />
      <span className={cn("text-[21px] font-semibold tracking-[-0.04em]", light ? "text-white" : "text-ink")} style={{ lineHeight: 1 }}>
        axi
      </span>
    </Link>
  );
}
