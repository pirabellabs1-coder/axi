"use client";

import { useEffect } from "react";
import { RotateCw } from "lucide-react";

export default function DownloadError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[telechargement]", error);
  }, [error]);
  return (
    <div data-theme="light" className="flex min-h-dvh items-center justify-center bg-[#f6f6f3] px-4">
      <div className="w-full max-w-md rounded-[20px] bg-white px-6 py-12 text-center ring-1 ring-black/5">
        <h1 className="text-xl font-semibold tracking-[-0.02em] text-[#111412]">Vos fichiers n&apos;ont pas pu s&apos;afficher</h1>
        <p className="mt-2 text-sm text-[#575e59]">Vérifiez votre connexion puis réessayez. Votre accès et vos téléchargements restants ne sont pas affectés.</p>
        <button type="button" onClick={reset} className="mt-6 inline-flex h-12 items-center gap-2 rounded-full bg-[#0d3b2e] px-6 text-sm font-semibold text-white active:scale-[0.98]">
          <RotateCw className="size-4" aria-hidden /> Réessayer
        </button>
      </div>
    </div>
  );
}
