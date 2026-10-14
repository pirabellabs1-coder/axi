import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { isAppCategory } from "./types";

/** Lectures du catalogue d'apps et des installations d'une boutique. Les installations sont TOUJOURS filtrées par `storeId`. */

export type CatalogFilter = { category?: string; q?: string };

/** Catalogue public : apps publiées ET listées, triées par popularité (installCount décroissant). */
export async function listCatalog(filter: CatalogFilter = {}) {
  const where: Prisma.AppWhereInput = { status: "PUBLISHED", listed: true };
  if (filter.category && isAppCategory(filter.category)) where.category = filter.category;
  const q = filter.q?.trim();
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { tagline: { contains: q, mode: "insensitive" } },
      { developerName: { contains: q, mode: "insensitive" } },
    ];
  }
  return db.app.findMany({ where, orderBy: [{ installCount: "desc" }, { name: "asc" }] });
}

/** Fiche d'une app par slug (publiée uniquement : une app en brouillon n'est pas consultable au catalogue). */
export async function getAppBySlug(slug: string) {
  const app = await db.app.findUnique({ where: { slug } });
  return app && app.status === "PUBLISHED" ? app : null;
}

/** Installations d'une boutique (app jointe), hors désinstallées, de la plus récente à la plus ancienne. */
export async function listStoreInstallations(storeId: string) {
  return db.appInstallation.findMany({
    where: { storeId, status: { not: "UNINSTALLED" } },
    include: { app: true },
    orderBy: { installedAt: "desc" },
  });
}

/** Vrai si l'app est installée ACTIVE sur la boutique (filtre storeId strict). */
export async function isInstalled(storeId: string, appId: string): Promise<boolean> {
  const row = await db.appInstallation.findFirst({ where: { storeId, appId, status: "ACTIVE" }, select: { id: true } });
  return row !== null;
}

/**
 * Installation ACTIVE d'une app (par slug) sur la boutique, avec l'app — pour la page embarquée. Filtre storeId
 * strict ; l'app peut ne plus être publiée (une app retirée du catalogue reste ouvrable tant qu'elle est installée).
 */
export async function getActiveInstallationBySlug(storeId: string, slug: string) {
  const app = await db.app.findUnique({ where: { slug }, select: { id: true } });
  if (!app) return null;
  return db.appInstallation.findFirst({
    where: { storeId, appId: app.id, status: "ACTIVE" },
    include: { app: { select: { id: true, slug: true, name: true, iconUrl: true, category: true, appUrl: true, oauthClientId: true, status: true } } },
  });
}
