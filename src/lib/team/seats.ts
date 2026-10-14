import "server-only";
import { db, type Tx } from "@/lib/db";
import { PLANS, PLAN_ORDER, getAddOn, planRank, type PlanId } from "@/config/plans";
import { effectiveLimits } from "@/lib/addons/service";

export type TeamSeats = {
  /** Membres actifs (hors accès SUPPORT d'Axi). */
  members: number;
  /** Invitations en attente (non acceptées, non révoquées, non expirées) : elles réservent une place. */
  pending: number;
  used: number;
  /** null = illimité. Inclut les places achetées en option. */
  limit: number | null;
  extraMembers: number;
  allowed: boolean;
};

/** Places d'équipe : limite effective (plan + option EXTRA_MEMBER) et occupation. */
export async function teamSeats(storeId: string, planId: PlanId, tx: Tx | typeof db = db): Promise<TeamSeats> {
  const now = new Date();
  const [limits, members, pending] = await Promise.all([
    effectiveLimits(storeId, planId, tx),
    tx.membership.count({ where: { storeId, role: { not: "SUPPORT" } } }),
    tx.invitation.count({ where: { storeId, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } } }),
  ]);
  const used = members + pending;
  return { members, pending, used, limit: limits.members, extraMembers: limits.extraMembers, allowed: limits.members == null || used < limits.members };
}

/** Plan supérieur le plus proche qui offre plus de membres. */
export function nextPlanForMembers(planId: PlanId): PlanId {
  const current = PLANS[planId].limits.members;
  return PLAN_ORDER.find((id) => planRank(id) > planRank(planId) && (PLANS[id].limits.members == null || (current != null && PLANS[id].limits.members! > current))) ?? "ENTERPRISE";
}

/** L'option « Membre d'équipe en plus » est-elle disponible pour ce plan ? */
export function canBuyExtraMember(planId: PlanId): boolean {
  return getAddOn("EXTRA_MEMBER")?.plans.includes(planId) ?? false;
}

export function seatsMessage(s: TeamSeats, planId: PlanId): string {
  const base = `Limite de membres atteinte : ${s.used} sur ${s.limit} (membres et invitations en attente).`;
  return canBuyExtraMember(planId)
    ? `${base} Ajoutez l'option « Membre d'équipe en plus » ou passez au plan ${PLANS[nextPlanForMembers(planId)].name}.`
    : `${base} Passez au plan ${PLANS[nextPlanForMembers(planId)].name} pour inviter plus de personnes.`;
}
