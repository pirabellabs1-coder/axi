import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { safeNext } from "@/lib/auth/redirect";
import { AuthHeading } from "../auth-heading";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Connexion" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next, "") || undefined;
  const user = await getCurrentUser();
  if (user) redirect(next ?? (user.isPlatformAdmin ? "/admin" : "/app"));
  return (
    <div className="animate-fade-up motion-reduce:animate-none">
      <AuthHeading title="Bon retour parmi nous.">Connectez-vous pour retrouver vos boutiques et vos commandes.</AuthHeading>
      <div className="mt-8">
        <LoginForm next={next} />
      </div>
      <p className="mt-8 text-center text-sm text-ink-muted">
        Pas encore de compte ?{" "}
        <Link href={`/inscription${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline">
          Créer ma boutique (14 jours d&apos;essai gratuit)
        </Link>
      </p>
    </div>
  );
}
