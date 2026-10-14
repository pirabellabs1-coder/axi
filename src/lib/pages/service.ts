import "server-only";
import { db } from "@/lib/db";

/** Pages publiées d'une boutique, dans l'ordre choisi (pour le menu / pied de page de la boutique publique). */
export function listPublishedPages(storeId: string) {
  return db.storePage.findMany({ where: { storeId, published: true }, orderBy: [{ position: "asc" }, { title: "asc" }], select: { slug: true, title: true } });
}

/** Une page publiée par son adresse ; rendre `body` avec renderMarkdown() de ./markdown. */
export function getPublishedPage(storeId: string, slug: string) {
  return db.storePage.findFirst({ where: { storeId, slug, published: true }, select: { title: true, slug: true, body: true, updatedAt: true } });
}
