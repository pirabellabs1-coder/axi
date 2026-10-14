import { NextResponse, type NextRequest } from "next/server";
import { loadStoreContext } from "@/lib/auth/permissions";
import { unseenCount } from "@/lib/notifications/service";

export const dynamic = "force-dynamic";

/** Compteur de la cloche (polling léger, 30 s). Session du marchand obligatoire. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const ctx = await loadStoreContext(storeId);
  if (!ctx || !ctx.user.emailVerified) return NextResponse.json({ error: "Non autorisé" }, { status: 401, headers: { "cache-control": "no-store" } });
  const unseen = await unseenCount(ctx.store.id, ctx.user.id);
  return NextResponse.json({ unseen }, { headers: { "cache-control": "private, no-store" } });
}
