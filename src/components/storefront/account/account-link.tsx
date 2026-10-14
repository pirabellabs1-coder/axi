import Link from "next/link";
import { UserRound } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Icône « Compte » de l'en-tête (branchée par l'équipe E selon `header.showAccount`).
 * Connecté ou non, le lien mène à /compte : la page redirige vers /compte/connexion si besoin.
 */
export function AccountLink({ slug, loggedIn = false, className }: { slug: string; loggedIn?: boolean; className?: string }) {
  return (
    <Link
      href={`/s/${slug}/compte`}
      aria-label={loggedIn ? "Mon compte" : "Se connecter à mon compte"}
      className={cn("relative inline-flex size-11 items-center justify-center rounded-full text-current transition-colors hover:bg-[color-mix(in_srgb,currentColor_8%,transparent)]", className)}
    >
      <UserRound className="size-5" aria-hidden />
      {loggedIn && <span className="absolute right-2 top-2 size-2 rounded-full bg-[var(--store-primary)] ring-2 ring-[var(--c-surface,white)]" aria-hidden />}
    </Link>
  );
}
