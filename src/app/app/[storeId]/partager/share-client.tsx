"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { Download, Printer, ExternalLink, MessageCircle, QrCode, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, Bezel } from "@/components/ui/card";
import { CopyButton } from "@/components/app/action-controls";
import { toast } from "@/components/ui/toast";

type Message = { key: string; title: string; hint: string; text: string };

function download(name: string, blob: Blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** PNG net (modules entiers, sans lissage) dessiné localement à partir de la matrice. */
function pngFromRows(rows: string[], scale = 16, border = 4): Promise<Blob | null> {
  const size = rows.length + border * 2;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size * scale;
  const g = canvas.getContext("2d");
  if (!g) return Promise.resolve(null);
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = "#000000";
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === "1") g.fillRect((x + border) * scale, (y + border) * scale, scale, scale);
  });
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}

export function ShareClient({
  storeName,
  tagline,
  url,
  display,
  svg,
  rows,
  slug,
  whatsapp,
  catalogue,
  messages,
  settingsHref,
}: {
  storeName: string;
  tagline: string;
  url: string;
  display: string;
  svg: string;
  rows: string[];
  slug: string;
  whatsapp: string | null;
  catalogue: string | null;
  messages: Message[];
  settingsHref: string;
}) {
  // Partage natif (mobile) : détecté après l'hydratation, sans écart serveur / client.
  const canShare = useSyncExternalStore(
    () => () => {},
    () => typeof navigator.share === "function",
    () => false,
  );
  const svgData = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

  return (
    <>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)] lg:items-start print:hidden">
        <div className="min-w-0 space-y-6">
          <Bezel coreClassName="p-5 sm:p-6">
            <p className="text-[13px] font-medium text-ink-muted">Lien de votre boutique</p>
            <p className="mt-2 break-all font-mono text-[15px] text-ink sm:text-base">{display}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <CopyButton value={url} label="Copier le lien" className="h-11 rounded-full px-4 sm:h-9" />
              <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center gap-1.5 rounded-full px-4 text-sm font-medium text-ink ring-1 ring-inset ring-line-strong transition-colors hover:bg-surface-2 sm:h-9">
                <ExternalLink className="size-4" aria-hidden /> Ouvrir
              </a>
              {canShare && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-11 sm:h-9"
                  onClick={() => navigator.share({ title: storeName, text: tagline, url }).catch(() => {})}
                >
                  <Share2 className="size-4" aria-hidden /> Partager
                </Button>
              )}
            </div>
          </Bezel>

          <section aria-labelledby="msgs-title">
            <h2 id="msgs-title" className="mb-3 text-lg font-semibold tracking-[-0.02em] text-ink">
              Messages prêts à copier
            </h2>
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {messages.map((m) => (
                <li key={m.key}>
                  <Card className="flex h-full flex-col p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="font-medium text-ink">{m.title}</h3>
                        <p className="text-[13px] text-ink-muted">{m.hint}</p>
                      </div>
                      <CopyButton value={m.text} className="h-11 rounded-full sm:h-9" />
                    </div>
                    <p className="mt-3 whitespace-pre-wrap rounded-[var(--radius-md)] bg-surface-2/60 px-3.5 py-3 text-sm leading-relaxed text-ink ring-1 ring-inset ring-line [overflow-wrap:anywhere]">{m.text}</p>
                  </Card>
                </li>
              ))}
            </ul>
          </section>

          <Card className="p-5">
            <div className="flex items-start gap-3">
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-primary-deep ring-1 ring-inset ring-line">
                <MessageCircle className="size-[18px]" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="font-medium text-ink">Lien « catalogue » WhatsApp</h2>
                {catalogue ? (
                  <>
                    <p className="mt-0.5 text-[13px] text-ink-muted">Ouvre une discussion avec vous ({whatsapp}) avec un message prérempli qui contient le lien de la boutique. À mettre dans vos publicités et votre profil WhatsApp Business.</p>
                    <p className="mt-3 break-all rounded-[var(--radius-md)] bg-surface-2/60 px-3.5 py-2.5 font-mono text-xs text-ink ring-1 ring-inset ring-line">{catalogue}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <CopyButton value={catalogue} label="Copier le lien" className="h-11 rounded-full px-4 sm:h-9" />
                      <a href={catalogue} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center gap-1.5 rounded-full px-4 text-sm font-medium text-ink ring-1 ring-inset ring-line-strong hover:bg-surface-2 sm:h-9">
                        <ExternalLink className="size-4" aria-hidden /> Tester
                      </a>
                    </div>
                  </>
                ) : (
                  <p className="mt-0.5 text-[13px] text-ink-muted">
                    Ajoutez d'abord votre numéro WhatsApp dans les{" "}
                    <Link href={settingsHref} className="font-medium text-primary underline-offset-4 hover:underline">
                      paramètres de la boutique
                    </Link>
                    .
                  </p>
                )}
              </div>
            </div>
          </Card>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-6">
          <Bezel coreClassName="p-5">
            <div className="flex items-center gap-2">
              <QrCode className="size-4 text-ink-muted" aria-hidden />
              <h2 className="text-[15px] font-semibold tracking-tight text-ink">QR code</h2>
            </div>
            <p className="mt-1 text-[13px] text-ink-muted">À coller sur votre comptoir, vos sacs, vos cartes de visite.</p>
            {/* Toujours sur fond blanc, même en thème sombre : les lecteurs de QR en ont besoin. */}
            <div className="mx-auto mt-4 aspect-square w-full max-w-[280px] overflow-hidden rounded-[var(--radius-md)] bg-white ring-1 ring-line">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={svgData} alt={`QR code menant à ${display}`} className="size-full [image-rendering:pixelated]" />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-11 sm:h-9"
                onClick={async () => {
                  const b = await pngFromRows(rows);
                  if (b) download(`qr-${slug}.png`, b);
                  else toast.error("Téléchargement impossible sur ce navigateur.");
                }}
              >
                <Download className="size-4" aria-hidden /> PNG
              </Button>
              <Button variant="outline" size="sm" className="h-11 sm:h-9" onClick={() => download(`qr-${slug}.svg`, new Blob([svg], { type: "image/svg+xml" }))}>
                <Download className="size-4" aria-hidden /> SVG
              </Button>
            </div>
            <Button variant="primary" className="mt-2 w-full" onClick={() => window.print()}>
              <Printer className="size-4" aria-hidden /> Imprimer l'affiche A5
            </Button>
          </Bezel>

          <div className="hidden lg:block">
            <p className="mb-2 text-[13px] font-medium text-ink-muted">Aperçu de l'affiche</p>
            <div className="origin-top-left overflow-hidden rounded-[var(--radius-md)] ring-1 ring-line">
              <Poster storeName={storeName} tagline={tagline} display={display} svgData={svgData} whatsapp={whatsapp} compact />
            </div>
          </div>
        </aside>
      </div>

      {/* Affiche imprimable (seule visible à l'impression) */}
      <div id="axi-poster" className="hidden print:block">
        <Poster storeName={storeName} tagline={tagline} display={display} svgData={svgData} whatsapp={whatsapp} />
      </div>
      <style>{`
        @media print {
          @page { size: A5 portrait; margin: 0; }
          body * { visibility: hidden !important; }
          #axi-poster, #axi-poster * { visibility: visible !important; }
          #axi-poster { position: fixed; inset: 0; display: block !important; }
        }
      `}</style>
    </>
  );
}

function Poster({ storeName, tagline, display, svgData, whatsapp, compact = false }: { storeName: string; tagline: string; display: string; svgData: string; whatsapp: string | null; compact?: boolean }) {
  return (
    <div data-theme="light" className={compact ? "aspect-[148/210] w-full bg-white p-6 text-center text-ink" : "flex h-[210mm] w-[148mm] flex-col items-center justify-center bg-white px-[14mm] text-center text-ink"}>
      <div className={compact ? "flex h-full flex-col items-center justify-center" : "contents"}>
        <p className={compact ? "text-[11px] font-medium uppercase tracking-[0.14em] text-ink-muted" : "text-[11pt] font-medium uppercase tracking-[0.14em] text-ink-muted"}>Commandez en ligne</p>
        <h2 className={compact ? "mt-2 text-xl font-semibold leading-tight tracking-[-0.03em]" : "mt-[4mm] text-[30pt] font-semibold leading-[1.05] tracking-[-0.03em]"}>{storeName}</h2>
        {tagline && <p className={compact ? "mt-1 line-clamp-2 text-xs text-ink-muted" : "mt-[3mm] max-w-[110mm] text-[12pt] leading-snug text-ink-muted"}>{tagline}</p>}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={svgData} alt="" className={compact ? "mt-4 aspect-square w-3/5 [image-rendering:pixelated]" : "mt-[8mm] aspect-square w-[92mm] [image-rendering:pixelated]"} />
        <p className={compact ? "mt-3 text-sm font-semibold" : "mt-[6mm] text-[16pt] font-semibold"}>Scannez pour voir nos produits</p>
        <p className={compact ? "mt-1 break-all font-mono text-[10px] text-ink-muted" : "mt-[2mm] break-all font-mono text-[10pt] text-ink-muted"}>{display}</p>
        {whatsapp && <p className={compact ? "mt-1 text-[11px] text-ink-muted" : "mt-[4mm] text-[11pt] text-ink-muted"}>WhatsApp : {whatsapp}</p>}
      </div>
    </div>
  );
}
