import type { Metadata } from "next";
import Link from "next/link";
import { Plus, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { EarningsTiles } from "@/components/affiliates/earnings-tiles";
import { OrdersTable } from "@/components/orders/orders-table";
import { requireAffiliate } from "@/server/auth/guards";
import { affiliateEarnings, affiliateOrders } from "@/server/services/affiliates";

export const metadata: Metadata = { title: "Salesman Portal" };

export default async function AffiliateHome() {
  const user = await requireAffiliate();
  const [earnings, orders] = await Promise.all([affiliateEarnings(user.affiliateId), affiliateOrders(user.affiliateId, { pageSize: 5 })]);
  return (
    <>
      <PageHeader
        title={`Welcome, ${user.name}`}
        description="Your sales, customers and commissions. Only orders you placed and products assigned to you appear here."
        actions={
          <Button render={<Link href="/portal/affiliate/orders/new" />}>
            <Plus /> New sale
          </Button>
        }
      />
      <EarningsTiles e={earnings} />
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Recent orders</h2>
          <Link href="/portal/affiliate/orders" className="text-sm underline underline-offset-4">
            All orders
          </Link>
        </div>
        {orders.items.length === 0 ? <EmptyState icon={ShoppingCart} title="No sales yet" description="Create your first sale from the products assigned to you." /> : <OrdersTable rows={orders.items} basePath="/portal/affiliate/orders" scoped showLines />}
      </section>
    </>
  );
}
