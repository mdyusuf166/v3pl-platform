import { AdminShell } from "@/components/layout/admin-shell";
import { NotificationBell } from "@/components/layout/notification-bell";
import { SupportButton } from "@/components/layout/support-button";
import { supportDestination } from "@/lib/validation/support";
import { getSupportSettings } from "@/server/services/support-settings";
import { navForRole } from "@/config/navigation";
import { ROLE_LABELS } from "@/lib/roles";
import { requireStaff } from "@/server/auth/guards";

export const dynamic = "force-dynamic";

/**
 * Protected admin area. requireStaff() verifies the session cookie, loads the
 * ACTIVE user from the database and rejects non-staff roles — server-side,
 * before anything renders.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireStaff();
  // Support button (SUP-01) for WAREHOUSE / SALES only — never on the ADMIN dashboard.
  const support = user.role === "ADMIN" ? null : supportDestination(await getSupportSettings());

  return (
    <AdminShell
      user={{ name: user.name, email: user.email, roleLabel: ROLE_LABELS[user.role] }}
      sections={navForRole(user.role)}
      topRight={user.role === "ADMIN" ? <NotificationBell /> : undefined}
    >
      {children}
      {user.role !== "ADMIN" && <SupportButton destination={support} />}
    </AdminShell>
  );
}
