import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { readMfaChallenge } from "@/lib/admin/mfa-server";
import { AuthHeading } from "../auth-heading";
import { MfaForm } from "./mfa-form";

export const metadata: Metadata = { title: "Double authentification", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function MfaPage() {
  const pending = await readMfaChallenge();
  if (!pending) redirect("/connexion");
  const minutes = Math.max(1, Math.round((pending.exp - Date.now()) / 60_000));
  return (
    <div className="animate-fade-up motion-reduce:animate-none">
      <span className="mb-6 inline-flex size-12 items-center justify-center rounded-2xl bg-primary-soft text-primary ring-1 ring-inset ring-primary/10">
        <ShieldCheck className="size-6" aria-hidden />
      </span>
      <AuthHeading title="Une dernière vérification.">
        Ouvrez votre application d&apos;authentification et saisissez le code à 6 chiffres affiché pour Axi.
      </AuthHeading>
      <div className="mt-8">
        <MfaForm />
      </div>
      <p className="mt-6 text-center text-xs text-ink-muted">Cette étape expire dans {minutes} minute{minutes > 1 ? "s" : ""}.</p>
    </div>
  );
}
