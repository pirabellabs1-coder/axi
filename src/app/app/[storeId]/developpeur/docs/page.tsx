import type { Metadata } from "next";
import { DevLink } from "@/app/app/[storeId]/developpeur/_components/dev-link";
import { BookOpen } from "lucide-react";
import { DOC_PAGES, DocTitle } from "./_ui";

export const metadata: Metadata = { title: "Documentation" };

export default function DocsIndexPage() {
  return (
    <>
      <DocTitle
        title="Documentation développeur"
        lead="Une application Axi est un service web que VOUS hébergez (Vercel, Render, un VPS…). Elle se connecte à une boutique par OAuth, lit et écrit ses données par l'API, reçoit ses événements par webhook et peut s'afficher dans l'admin du marchand."
      />
      <ul className="grid max-w-4xl grid-cols-1 gap-3 sm:grid-cols-2">
        {DOC_PAGES.map((d, i) => (
          <li key={d.slug}>
            <DevLink to={`/docs/${d.slug}`} className="flex h-full gap-3 rounded-[var(--radius-lg)] bg-surface p-4 ring-1 ring-line transition-shadow hover:ring-primary/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
              <BookOpen className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
              <span>
                <span className="block font-medium text-ink">{i + 1}. {d.title}</span>
                <span className="block text-sm text-ink-muted">{d.description}</span>
              </span>
            </DevLink>
          </li>
        ))}
      </ul>
    </>
  );
}
