/** Limites partagées client / serveur du téléversement des médias. */

/** Taille maximale acceptée par le serveur. Le navigateur compresse déjà à ~300 Ko avant l'envoi. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export const UPLOAD_PURPOSES = ["product", "collection", "theme"] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

export const ACCEPTED_IMAGE_TYPES = "image/jpeg,image/png,image/webp,image/avif,image/gif";
