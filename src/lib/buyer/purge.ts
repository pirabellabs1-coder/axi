import "server-only";
import { db } from "@/lib/db";
import { OTP_IP_RETENTION_DAYS } from "./otp";

/**
 * Purge des données de connexion acheteur (§8, job `otp.purge`, appelé par le balayage de /api/jobs/run) :
 *  - IP des codes effacée à 30 jours ; codes expirés depuis plus de 30 jours supprimés (plus aucune utilité) ;
 *  - IP des sessions effacée 30 jours après leur création (une session vit jusqu'à 90 jours) ;
 *  - sessions expirées ou révoquées depuis plus de 30 jours supprimées (agent utilisateur avec elles).
 * Idempotent, sans effet de bord sur les sessions actives.
 */
export async function purgeBuyerAuthData(now = new Date()): Promise<{ otpIps: number; otps: number; sessionIps: number; sessions: number }> {
  const before = new Date(now.getTime() - OTP_IP_RETENTION_DAYS * 86_400_000);
  const otpIps = await db.customerOtp.updateMany({ where: { createdAt: { lt: before }, ip: { not: null } }, data: { ip: null } });
  const otps = await db.customerOtp.deleteMany({ where: { expiresAt: { lt: before } } });
  const sessionIps = await db.customerSession.updateMany({ where: { createdAt: { lt: before }, ip: { not: null } }, data: { ip: null } });
  const sessions = await db.customerSession.deleteMany({ where: { OR: [{ expiresAt: { lt: before } }, { revokedAt: { lt: before } }] } });
  return { otpIps: otpIps.count, otps: otps.count, sessionIps: sessionIps.count, sessions: sessions.count };
}
