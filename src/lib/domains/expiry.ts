/** Domaines personnalisés non vérifiés : libérés après ce délai (évite le squat d'un nom d'hôte). */
export const UNVERIFIED_DOMAIN_TTL_DAYS = 7;
const DAY_MS = 86_400_000;

export function domainExpired(d: { verified: boolean; createdAt: Date }, now = new Date()): boolean {
  return !d.verified && now.getTime() - d.createdAt.getTime() > UNVERIFIED_DOMAIN_TTL_DAYS * DAY_MS;
}

/** Date limite de vérification d'un domaine en attente. */
export function domainVerifyDeadline(d: { createdAt: Date }): Date {
  return new Date(d.createdAt.getTime() + UNVERIFIED_DOMAIN_TTL_DAYS * DAY_MS);
}

/** Filtre Prisma des domaines non vérifiés expirés. */
export function expiredDomainsWhere(now = new Date()) {
  return { verified: false, createdAt: { lt: new Date(now.getTime() - UNVERIFIED_DOMAIN_TTL_DAYS * DAY_MS) } };
}
