import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AuthHeading } from "../auth-heading";
import { ResetFlow } from "./reset-flow";

export const metadata: Metadata = { title: "Mot de passe oublié" };

export default function ForgotPage() {
  return (
    <div className="animate-fade-up motion-reduce:animate-none">
      <AuthHeading title="Mot de passe oublié ?">Indiquez votre e-mail : nous vous envoyons un code pour en choisir un nouveau.</AuthHeading>
      <div className="mt-8">
        <ResetFlow />
      </div>
      <p className="mt-8 text-center text-sm">
        <Link href="/connexion" className="inline-flex min-h-11 items-center gap-1.5 font-medium text-primary underline-offset-4 hover:underline">
          <ArrowLeft className="size-4" aria-hidden /> Retour à la connexion
        </Link>
      </p>
    </div>
  );
}
