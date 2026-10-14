"use client";

import { useRef, useState } from "react";
import { Download, Share2 } from "lucide-react";
import { encodeText } from "@/lib/qr/encoder";

/**
 * Partage en statut WhatsApp (lot 4 §15) : visuel 1080 × 1920 composé ENTIÈREMENT côté client (canvas),
 * puis partagé par la Web Share API niveau 2 (fichier) ou, à défaut, téléchargé.
 *
 * Contenu : photo du produit, nom, prix déjà formaté par le serveur, logo de la boutique, QR vers la fiche
 * et couleurs du kit de marque. Aucune donnée n'est envoyée au serveur ; rien n'est stocké.
 * Accessibilité : un seul bouton de 44 px, état annoncé par `aria-live`, aucune animation.
 */

export type StatusShareProps = {
  productName: string;
  /** Prix déjà formaté (devise d'affichage du visiteur). */
  priceLabel: string;
  /** Prix barré formaté, s'il y a une promotion. */
  compareLabel?: string | null;
  imageUrl: string | null;
  logoUrl: string | null;
  storeName: string;
  /** Lien absolu de la fiche. Par défaut, l'adresse de la page courante. */
  shareUrl?: string;
  /** Mention Axi discrète (plan Gratuit). */
  showPoweredBy?: boolean;
  className?: string;
};

type Brand = { primary: string; primaryText: string; background: string; text: string };

/**
 * Couleurs du kit de marque, lues sur les variables CSS du thème déjà appliquées à la page
 * (`--store-primary`, `--store-primary-contrast`, `--store-bg`, `--store-text`) : le visuel reprend
 * exactement les couleurs de la boutique, sans les dupliquer dans les props.
 */
function brandColors(): Brand {
  const fallback: Brand = { primary: "#111412", primaryText: "#ffffff", background: "#ffffff", text: "#111412" };
  const root = document.querySelector("[data-store-root]") ?? document.documentElement;
  const cs = getComputedStyle(root);
  const read = (name: string, def: string) => {
    const v = cs.getPropertyValue(name).trim();
    return /^(#[0-9a-f]{3,8}|rgb|hsl)/i.test(v) ? v : def;
  };
  return {
    primary: read("--store-primary", fallback.primary),
    primaryText: read("--store-primary-contrast", fallback.primaryText),
    background: read("--store-bg", fallback.background),
    text: read("--store-text", fallback.text),
  };
}

const W = 1080;
const H = 1920;

function utmUrl(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set("utm_source", "whatsapp_status");
    u.searchParams.set("utm_medium", "social");
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Charge une image utilisable sur le canvas. `crossOrigin` n'est posé que pour une autre origine :
 * les médias de la boutique (`/media/…`) sont servis sans en-tête CORS, et le demander ferait échouer
 * leur chargement. Une image qui échoue est simplement ignorée (visuel sans photo plutôt qu'aucun visuel).
 */
function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new window.Image();
    const sameOrigin = src.startsWith("/") || src.startsWith(window.location.origin);
    if (!sameOrigin) img.crossOrigin = "anonymous";
    img.decoding = "sync";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function drawCover(g: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  g.restore();
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Texte coupé sur 2 lignes maximum, avec points de suspension. */
function drawTitle(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number): number {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const next = current ? `${current} ${w}` : w;
    if (g.measureText(next).width > maxWidth && current) {
      lines.push(current);
      current = w;
      if (lines.length === 2) break;
    } else {
      current = next;
    }
  }
  if (lines.length < 2 && current) lines.push(current);
  if (lines.length === 2 && g.measureText(lines[1]).width > maxWidth) {
    let s = lines[1];
    while (s.length > 1 && g.measureText(`${s}…`).width > maxWidth) s = s.slice(0, -1);
    lines[1] = `${s}…`;
  }
  lines.forEach((l, i) => g.fillText(l, x, y + i * lineHeight));
  return y + (lines.length - 1) * lineHeight;
}

function drawQr(g: CanvasRenderingContext2D, value: string, x: number, y: number, size: number) {
  const qr = encodeText(value, { ecc: "M" });
  const quiet = 2;
  const modules = qr.size + quiet * 2;
  const cell = size / modules;
  g.fillStyle = "#ffffff";
  roundRect(g, x, y, size, size, 24);
  g.fill();
  g.fillStyle = "#000000";
  for (let row = 0; row < qr.size; row++) {
    for (let col = 0; col < qr.size; col++) {
      if (qr.modules[row][col]) g.fillRect(x + (col + quiet) * cell, y + (row + quiet) * cell, Math.ceil(cell), Math.ceil(cell));
    }
  }
}

export function StatusShare(props: StatusShareProps) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const cache = useRef<Blob | null>(null);

  const shareUrl = () => props.shareUrl ?? window.location.href.split("#")[0];

  const compose = async (): Promise<Blob> => {
    if (cache.current) return cache.current;
    const brand = brandColors();
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext("2d");
    if (!g) throw new Error("canvas");

    g.fillStyle = brand.background;
    g.fillRect(0, 0, W, H);

    // Photo du produit (haut) ; sans photo, bandeau de la couleur de marque.
    const photoH = 1180;
    const img = props.imageUrl ? await loadImage(props.imageUrl) : null;
    if (img) drawCover(g, img, 0, 0, W, photoH);
    else {
      g.fillStyle = brand.primary;
      g.fillRect(0, 0, W, photoH);
    }

    // Dégradé bas de photo pour que le nom de la boutique reste lisible.
    const grad = g.createLinearGradient(0, photoH - 320, 0, photoH);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, "rgba(0,0,0,0.55)");
    g.fillStyle = grad;
    g.fillRect(0, photoH - 320, W, 320);

    // Logo + nom de la boutique en surimpression.
    const logo = props.logoUrl ? await loadImage(props.logoUrl) : null;
    let nameX = 64;
    if (logo) {
      const s = 108;
      g.save();
      roundRect(g, 64, photoH - 180, s, s, 28);
      g.fillStyle = "#ffffff";
      g.fill();
      g.clip();
      drawCover(g, logo, 64, photoH - 180, s, s);
      g.restore();
      nameX = 64 + s + 24;
    }
    g.fillStyle = "#ffffff";
    g.font = "600 44px system-ui, sans-serif";
    g.textBaseline = "middle";
    g.fillText(props.storeName.slice(0, 28), nameX, photoH - 126);

    /*
     * Bloc texte : nom (2 lignes au maximum) puis prix. Les positions sont fixes et laissent toujours
     * de la place au bouton et au QR : aucun chevauchement, quelle que soit la longueur du nom.
     */
    g.textBaseline = "top";
    g.fillStyle = brand.text;
    g.font = "700 76px system-ui, sans-serif";
    const titleTop = photoH + 70;
    drawTitle(g, props.productName, 64, titleTop, W - 128 - 300, 92);

    const priceTop = titleTop + 230;
    g.font = "700 84px system-ui, sans-serif";
    g.fillStyle = brand.primary;
    g.fillText(props.priceLabel, 64, priceTop);
    if (props.compareLabel) {
      const px = 64 + g.measureText(props.priceLabel).width + 28;
      g.font = "500 52px system-ui, sans-serif";
      g.fillStyle = brand.text;
      g.globalAlpha = 0.55;
      g.fillText(props.compareLabel, px, priceTop + 28);
      const w = g.measureText(props.compareLabel).width;
      g.fillRect(px, priceTop + 58, w, 4);
      g.globalAlpha = 1;
    }

    // Bouton « Commander » + QR vers la fiche.
    const btnY = H - 280;
    g.fillStyle = brand.primary;
    roundRect(g, 64, btnY, 560, 132, 66);
    g.fill();
    g.fillStyle = brand.primaryText;
    g.font = "700 48px system-ui, sans-serif";
    g.textBaseline = "middle";
    g.fillText("Commander", 110, btnY + 68);

    drawQr(g, utmUrl(shareUrl()), W - 64 - 280, btnY - 60, 280);
    g.fillStyle = brand.text;
    g.globalAlpha = 0.6;
    g.font = "500 32px system-ui, sans-serif";
    g.textAlign = "center";
    g.fillText("Scannez pour voir", W - 64 - 140, btnY + 236);
    if (props.showPoweredBy) g.fillText("Propulsé par Axi", W / 2, H - 46);
    g.globalAlpha = 1;
    g.textAlign = "left";

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("export");
    cache.current = blob;
    return blob;
  };

  const share = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const blob = await compose();
      const slug = props.productName
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40);
      const file = new File([blob], `${slug || "produit"}-statut.png`, { type: "image/png" });
      const text = `${props.productName} — ${props.priceLabel}\n${utmUrl(shareUrl())}`;
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text, title: props.productName });
        setMessage("Visuel prêt à publier en statut.");
        return;
      }
      // Repli : téléchargement, puis le visiteur le publie depuis sa galerie.
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      await navigator.clipboard?.writeText(text).catch(() => {});
      setMessage("Image téléchargée et texte copié : publiez-la en statut WhatsApp.");
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === "AbortError";
      if (!aborted) setMessage("Visuel impossible à créer sur ce navigateur.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className={props.className}>
      <button
        type="button"
        onClick={share}
        disabled={busy}
        className="inline-flex min-h-11 items-center gap-2 rounded-full bg-surface px-4 text-sm font-semibold text-ink ring-1 ring-inset ring-line transition-colors hover:bg-surface-2 disabled:opacity-60"
      >
        {busy ? <Download className="size-4 shrink-0" aria-hidden /> : <Share2 className="size-4 shrink-0" aria-hidden />}
        {busy ? "Création du visuel…" : "Partager en statut"}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {message}
      </span>
      {message && <span className="mt-1 block text-xs text-ink-muted">{message}</span>}
    </span>
  );
}
