import type { Metadata } from "next";
import { ShieldAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PageHeader } from "@/components/layout/page-header";
import { PartnerStats } from "@/components/dashboard/partner-stats";
import { FinanceStats } from "@/components/dashboard/finance-stats";
import { StockStats } from "@/components/dashboard/stock-stats";
import { OrderStats } from "@/components/dashboard/order-stats";
import { ROLE_LABELS } from "@/lib/roles";
import { requireStaff } from "@/server/auth/guards";

export const metadata: Metadata = { title: "Dashboard" };

/** Business dashboard only (D-076): deployment checks live under Settings → System. */
export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ forbidden?: string }>;
}) {
  const user = await requireStaff();
  const { forbidden } = await searchParams;

  return (
    <>
      <PageHeader title="Dashboard" description={`Signed in as ${user.name} · ${ROLE_LABELS[user.role]}`} />

      {forbidden && (
        <Alert variant="destructive">
          <ShieldAlert />
          <AlertTitle>No access</AlertTitle>
          <AlertDescription>Your role does not have access to that section.</AlertDescription>
        </Alert>
      )}

      <OrderStats />
      <StockStats />
      {user.role === "ADMIN" && <PartnerStats />}
      {user.role === "ADMIN" && <FinanceStats />}
    </>
  );
}
