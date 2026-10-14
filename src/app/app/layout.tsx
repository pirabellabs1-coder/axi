import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function AppRootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion?next=/app");
  if (!user.emailVerified) redirect("/verification?next=/app");
  return <div className="min-h-dvh bg-canvas">{children}</div>;
}
