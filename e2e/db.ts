import { PrismaClient } from "@prisma/client";

/** Accès direct à la base pour préparer et nettoyer les données de test (jamais les données réelles). */
export const db = new PrismaClient();

export const E2E_DOMAIN = "e2e.test";
export const E2E_PASSWORD = "Recette-E2E-2026";

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@${E2E_DOMAIN}`;
}

/** Les limites de débit protègent la prod ; en recette on repart d'un compteur vide. */
export async function clearRateLimits() {
  await db.rateLimit.deleteMany({});
}

/** Marque l'e-mail d'un compte de test comme vérifié (le code part dans la console du serveur). */
export async function verifyEmail(email: string) {
  await db.user.update({ where: { email }, data: { emailVerifiedAt: new Date() } });
}

/** Supprime tout ce qui a été créé par les tests (comptes @e2e.test et leurs boutiques). */
export async function cleanupE2E() {
  const users = await db.user.findMany({ where: { email: { endsWith: `@${E2E_DOMAIN}` } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (ids.length) {
    const owned = await db.membership.findMany({ where: { userId: { in: ids }, role: "OWNER" }, select: { storeId: true } });
    const storeIds = owned.map((m) => m.storeId);
    if (storeIds.length) await db.store.deleteMany({ where: { id: { in: storeIds } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }
  // Commandes de test passées sur les boutiques de démo
  await db.order.deleteMany({ where: { customerName: { startsWith: "E2E " } } });
  await db.customer.deleteMany({ where: { name: { startsWith: "E2E " } } });
}
