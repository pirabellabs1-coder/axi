/**
 * Seed de la bibliothèque de sections (appelé par prisma/seed.ts). Idempotent : upsert par `slug`.
 * Les positions démarrent après les éléments existants (ex. « nos-engagements » du seed de schéma).
 * Imports relatifs uniquement (exécuté par tsx hors Next).
 */
import type { PrismaClient } from "@prisma/client";
import { DEMO_LIBRARY_ITEMS } from "./demo-items";

export async function seedLibrary(db: PrismaClient): Promise<number> {
  const base = 10;
  for (const [i, it] of DEMO_LIBRARY_ITEMS.entries()) {
    const data = {
      name: it.name,
      description: it.description,
      category: it.category,
      sectionType: String(it.payload.type),
      payload: it.payload as object,
      premium: it.premium,
      minPlan: it.minPlan,
      tags: it.tags,
      published: true,
      position: base + i,
    };
    await db.sectionLibraryItem.upsert({ where: { slug: it.slug }, create: { slug: it.slug, ...data }, update: data });
  }
  return DEMO_LIBRARY_ITEMS.length;
}
