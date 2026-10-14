import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { safeNext } from "@/lib/auth/redirect";
import { PLANS, TRIAL_DAYS, TRIAL_PLAN } from "@/config/plans";
import { AuthHeading } from "../auth-heading";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Créer ma boutique" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next, "") || undefined;
  const user = await getCurrentUser();
  if (user) redirect("/app");
  return (
    <div className="animate-fade-up motion-reduce:animate-none">
      <AuthHeading title="Créez votre boutique.">
        {TRIAL_DAYS} jours du plan {PLANS[TRIAL_PLAN].name} offerts, sans carte bancaire. 0 % de commission sur vos ventes.
      </AuthHeading>
      <div className="mt-8">
        <SignupForm next={next} />
      </div>
      <p className="mt-8 text-center text-sm text-ink-muted">
        Déjà un compte ?{" "}
        <Link href={`/connexion${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline">
          Se connecter
        </Link>
      </p>
    </div>
  );
}
