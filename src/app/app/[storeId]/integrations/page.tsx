import { redirect } from "next/navigation";

/** Intégrations : section unique pour l'instant (Connecteurs IA). */
export default async function IntegrationsPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  redirect(`/app/${storeId}/integrations/ia`);
}
