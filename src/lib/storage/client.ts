/**
 * Côté navigateur : compression des images (inchangée depuis le MVP, mais produit un Blob au lieu
 * d'une data-URL) et envoi au serveur (POST /api/stores/{storeId}/media) avec progression.
 * Aucune donnée n'est stockée en base64 : la base ne reçoit que l'URL renvoyée.
 */
import type { UploadPurpose } from "./limits";

/** Cible de compression (identique au MVP). */
export const COMPRESSED_MAX_BYTES = 300 * 1024;

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Photos produit / collections : JPEG sur fond blanc, dimensions puis qualité jusqu'à passer sous 300 Ko. */
export async function compressPhoto(file: File | Blob, maxBytes = COMPRESSED_MAX_BYTES): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    for (const max of [1600, 1280, 1024, 800]) {
      const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas indisponible");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const q of [0.85, 0.75, 0.65, 0.55]) {
        const blob = await canvasBlob(canvas, "image/jpeg", q);
        if (blob && blob.size <= maxBytes) return blob;
      }
    }
  } finally {
    bitmap.close();
  }
  throw new Error("Image trop lourde même après compression");
}

/** Éditeur de thème : WebP (repli JPEG) avec transparence conservée, 1600 px max, sous 300 Ko. */
export async function compressThemeImage(file: File | Blob, maxSide = 1600, maxBytes = COMPRESSED_MAX_BYTES): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    let side = Math.min(maxSide, Math.max(bitmap.width, bitmap.height));
    for (let attempt = 0; attempt < 6; attempt++) {
      const scale = side / Math.max(bitmap.width, bitmap.height);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * Math.min(1, scale)));
      canvas.height = Math.max(1, Math.round(bitmap.height * Math.min(1, scale)));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas indisponible");
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const q of [0.86, 0.74, 0.6, 0.45]) {
        let blob = await canvasBlob(canvas, "image/webp", q);
        if (!blob || blob.type !== "image/webp") blob = await canvasBlob(canvas, "image/jpeg", q);
        if (blob && blob.size <= maxBytes) return blob;
      }
      side = Math.round(side * 0.75);
    }
  } finally {
    bitmap.close();
  }
  throw new Error("Image trop lourde même après compression.");
}

export class UploadFailedError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type UploadedImage = { url: string; key: string; bytes: number; deduplicated: boolean };

/**
 * Envoie une image compressée. XMLHttpRequest (et non fetch) pour suivre la progression de l'envoi.
 * `onProgress` reçoit une fraction 0..1.
 */
export function uploadImage(storeId: string, purpose: UploadPurpose, blob: Blob, opts: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {}): Promise<UploadedImage> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/stores/${encodeURIComponent(storeId)}/media?purpose=${purpose}`);
    xhr.setRequestHeader("Content-Type", blob.type && blob.type.startsWith("image/") ? blob.type : "application/octet-stream");
    xhr.responseType = "json";
    xhr.timeout = 60_000;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress?.(Math.min(1, e.loaded / e.total));
    };
    xhr.onload = () => {
      const body = xhr.response as { url?: string; key?: string; bytes?: number; deduplicated?: boolean; error?: { code?: string; message?: string } } | null;
      if (xhr.status >= 200 && xhr.status < 300 && body?.url) {
        opts.onProgress?.(1);
        resolve({ url: body.url, key: body.key ?? "", bytes: body.bytes ?? blob.size, deduplicated: !!body.deduplicated });
      } else {
        const message = body?.error?.message ?? (xhr.status === 413 ? "Image trop lourde." : "L'envoi de l'image a échoué. Réessayez.");
        reject(new UploadFailedError(message, body?.error?.code ?? "http_error", xhr.status));
      }
    };
    xhr.onerror = () => reject(new UploadFailedError("Connexion perdue pendant l'envoi. Vérifiez votre réseau et réessayez.", "network", 0));
    xhr.ontimeout = () => reject(new UploadFailedError("L'envoi a pris trop de temps. Réessayez avec une connexion plus stable.", "timeout", 0));
    xhr.onabort = () => reject(new UploadFailedError("Envoi annulé.", "aborted", 0));
    opts.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(blob);
  });
}

export type UploadedFile = {
  asset: { id: string; name: string; variantId: string | null; bytes: number; mime: string; version: number; position: number };
  deduplicated: boolean;
  replaced: boolean;
};

/**
 * Vague 2 — envoie un FICHIER VENDU (produit numérique) à `POST /api/stores/{id}/files`.
 * Aucune compression (le fichier doit être remis tel quel) ; jusqu'à 50 Mo, progression suivie par XHR.
 * `assetId` = remplacement (nouvelle version du même fichier). Aucune URL publique n'est renvoyée :
 * le fichier n'est accessible qu'au travers d'un accès de téléchargement.
 */
export function uploadFile(
  storeId: string,
  file: File | Blob,
  opts: { productId: string; variantId?: string | null; assetId?: string | null; name?: string; onProgress?: (fraction: number) => void; signal?: AbortSignal },
): Promise<UploadedFile> {
  return new Promise((resolve, reject) => {
    const qs = new URLSearchParams({ productId: opts.productId });
    if (opts.variantId) qs.set("variantId", opts.variantId);
    if (opts.assetId) qs.set("assetId", opts.assetId);
    if (opts.name) qs.set("name", opts.name.slice(0, 120));
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/stores/${encodeURIComponent(storeId)}/files?${qs.toString()}`);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.responseType = "json";
    // 50 Mo sur une connexion mobile : minuterie large (10 min).
    xhr.timeout = 600_000;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress?.(Math.min(1, e.loaded / e.total));
    };
    xhr.onload = () => {
      const body = xhr.response as (UploadedFile & { error?: { code?: string; message?: string } }) | null;
      if (xhr.status >= 200 && xhr.status < 300 && body?.asset) {
        opts.onProgress?.(1);
        resolve({ asset: body.asset, deduplicated: !!body.deduplicated, replaced: !!body.replaced });
      } else {
        const message = body?.error?.message ?? (xhr.status === 413 ? "Fichier trop lourd (50 Mo maximum)." : "L'envoi du fichier a échoué. Réessayez.");
        reject(new UploadFailedError(message, body?.error?.code ?? "http_error", xhr.status));
      }
    };
    xhr.onerror = () => reject(new UploadFailedError("Connexion perdue pendant l'envoi. Vérifiez votre réseau et réessayez.", "network", 0));
    xhr.ontimeout = () => reject(new UploadFailedError("L'envoi a pris trop de temps. Réessayez avec une connexion plus stable.", "timeout", 0));
    xhr.onabort = () => reject(new UploadFailedError("Envoi annulé.", "aborted", 0));
    opts.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}
