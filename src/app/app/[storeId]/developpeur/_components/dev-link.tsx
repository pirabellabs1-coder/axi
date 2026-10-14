"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Base courante du portail, déduite de l'URL (/app/<storeId>/developpeur). */
export function useDevBase(): string {
  const pathname = usePathname();
  return /^\/app\/[^/]+\/developpeur/.exec(pathname)?.[0] ?? "/app";
}

/** Lien relatif au portail : `to="/apps"` → /app/<storeId>/developpeur/apps. */
export function DevLink({ to, ...props }: Omit<React.ComponentProps<typeof Link>, "href"> & { to: string }) {
  const base = useDevBase();
  return <Link href={`${base}${to}`} {...props} />;
}
