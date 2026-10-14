"use client";

/**
 * Lot 4 §7 : extraction des couleurs du logo DANS LE NAVIGATEUR (canvas).
 * Le serveur ne reçoit que des hex, qu'il revalide (`brandKitSchema`) : aucune analyse d'image côté serveur.
 * L'image est réduite à 128 px avant lecture des pixels (rapide, suffisant pour une palette).
 */
import { extractPalette } from "./extract";

const ANALYSIS_SIZE = 128;

async function toBitmap(src: Blob | string): Promise<{ width: number; height: number; draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void; close: () => void }> {
  if (typeof src !== "string" && typeof createImageBitmap === "function") {
    const bmp = await createImageBitmap(src);
    return { width: bmp.width, height: bmp.height, draw: (ctx, w, h) => ctx.drawImage(bmp, 0, 0, w, h), close: () => bmp.close() };
  }
  const url = typeof src === "string" ? src : URL.createObjectURL(src);
  const img = new Image();
  // Même origine ou CORS : sans cela le canvas serait « teinté » et getImageData échouerait.
  img.crossOrigin = "anonymous";
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("image"));
      img.src = url;
    });
  } finally {
    if (typeof src !== "string") setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  return { width: img.naturalWidth, height: img.naturalHeight, draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h), close: () => {} };
}

/**
 * Couleurs dominantes d'un logo (fichier ou URL de même origine). `count` couleurs au maximum.
 * Lève une erreur lisible si l'image ne peut pas être lue (format, CORS).
 */
export async function extractLogoColors(src: Blob | string, count = 5): Promise<string[]> {
  const bmp = await toBitmap(src);
  try {
    const ratio = Math.min(1, ANALYSIS_SIZE / Math.max(1, bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * ratio));
    const h = Math.max(1, Math.round(bmp.height * ratio));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("canvas");
    ctx.clearRect(0, 0, w, h);
    bmp.draw(ctx, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    const colors = extractPalette(data, { count });
    if (!colors.length) throw new Error("empty");
    return colors;
  } catch {
    throw new Error("Impossible de lire les couleurs de ce logo. Essayez un PNG ou un JPEG importé depuis votre appareil.");
  } finally {
    bmp.close();
  }
}
