import "server-only";
import { headers } from "next/headers";
import { db, type Tx } from "@/lib/db";

export async function audit(
  params: { storeId?: string | null; actorId?: string | null; action: string; target?: string; metadata?: Record<string, unknown> },
  tx: Tx | typeof db = db,
) {
  let ip: string | null = null;
  try {
    const h = await headers();
    ip = (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || null;
  } catch {
    // hors contexte requête (worker)
  }
  await tx.auditLog.create({
    data: {
      storeId: params.storeId ?? null,
      actorId: params.actorId ?? null,
      action: params.action,
      target: params.target,
      metadata: params.metadata ? JSON.parse(JSON.stringify(params.metadata)) : undefined,
      ip,
    },
  });
}
