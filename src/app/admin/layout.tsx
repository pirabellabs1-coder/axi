import type { Metadata } from "next";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { getAdminContext } from "@/lib/admin/context";
import { PLATFORM_ROLE_LABEL } from "@/lib/admin/roles";
import { AdminShell } from "@/components/app/admin-shell";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Console", template: "%s · Console Axi" },
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAdminContext();
  const [tickets, jobs, invoices, addons, reports, jar] = await Promise.all([
    db.supportTicket.count({ where: { status: { in: ["OPEN", "PENDING"] } } }),
    db.job.count({ where: { status: { in: ["FAILED", "DEAD"] } } }),
    db.invoice.count({ where: { status: "OPEN", dueAt: { lt: new Date() } } }),
    db.addOnPurchase.count({ where: { status: "PENDING" } }),
    db.storeReport.count({ where: { status: { in: ["OPEN", "REVIEWING"] } } }),
    cookies(),
  ]);
  return (
    <AdminShell
      user={{ name: ctx.user.name, email: ctx.user.email }}
      counts={{ tickets, jobs, invoices, addons, reports }}
      roleLabel={PLATFORM_ROLE_LABEL[ctx.role]}
      mfaWarning={!ctx.mfaEnabled}
      initialCollapsed={jar.get("axi_admin_sidebar")?.value === "collapsed"}
    >
      {children}
    </AdminShell>
  );
}
