import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { safeNext } from "@/lib/auth/redirect";
import { Alert } from "@/components/ui/misc";
import { AuthHeading } from "../auth-heading";
import { VerifyForm } from "./verify-form";

export const metadata: Metadata = { title: "Vérification" };

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next, "") || undefined;
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");
  if (user.emailVerified) redirect(next ?? "/app");
  return (
    <div className="animate-fade-up motion-reduce:animate-none">
      <AuthHeading title="Vérifiez votre e-mail.">
        Saisissez le code à 6 chiffres envoyé à <span className="font-medium text-ink [overflow-wrap:anywhere]">{user.email}</span>.
      </AuthHeading>
      {process.env.EMAIL_PROVIDER !== "resend" && (
        <Alert tone="warning" className="mt-5">
          Mode développement : le code s&apos;affiche dans le terminal du serveur.
        </Alert>
      )}
      <div className="mt-8">
        <VerifyForm next={next} />
      </div>
    </div>
  );
}
