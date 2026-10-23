import type { Metadata } from "next";
import Link from "next/link";
import { Plus, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/empty-state";
import { NativeSelect } from "@/components/common/native-select";
import { Pagination } from "@/components/common/pagination";
import { SearchFilterBar } from "@/components/common/search-filter-bar";
import { PageHeader } from "@/components/layout/page-header";
import { OrdersTable } from "@/components/orders/orders-table";
import { requireAffiliate } from "@/server/auth/guards";
import { affiliateOrders } from "@/server/services/affiliates";

export const metadata: Metadata = { title: "My orders" };

export default async function AffiliateOrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireAffiliate();
  const sp = await searchParams;
  const q = typeof sp.q === "string" && sp.q ? sp.q : undefined;
  const status = (["OPEN", "COMPLETED", "CANCELLED", "ALL"].includes(String(sp.status)) ? String(sp.status) : "ALL") as "OPEN" | "COMPLETED" | "CANCELLED" | "ALL";
  const page = Number(sp.page) || 1;
  const result = await affiliateOrders(user.affiliateId, { q, status, page });
  const hrefFor = (p: number) => `/portal/affiliate/orders?status=${status}${q ? `&q=${encodeURIComponent(q)}` : ""}${p > 1 ? `&page=${p}` : ""}`;
  return (
    <>
      <PageHeader
        title="My orders"
        description="Every sale you placed and its shipping status."
        actions={
          <Button render={<Link href="/portal/affiliate/orders/new" />}>
            <Plus /> New sale
          </Button>
        }
      />
      <SearchFilterBar q={q} placeholder="Order #, customer, SKU…">
        <NativeSelect name="status" defaultValue={status} className="w-40" aria-label="Status">
          <option value="ALL">All</option>
          <option value="OPEN">Open</option>
          <option value="COMPLETED">Completed</option>
          <option value="CANCELLED">Cancelled</option>
        </NativeSelect>
      </SearchFilterBar>
      {result.items.length === 0 ? <EmptyState icon={ShoppingCart} title="No orders yet" description="Sales you submit appear here." /> : <OrdersTable rows={result.items} basePath="/portal/affiliate/orders" scoped showLines />}
      <Pagination page={result.page} pageCount={result.pageCount} total={result.total} pageSize={result.pageSize} hrefFor={hrefFor} />
    </>
  );
}
