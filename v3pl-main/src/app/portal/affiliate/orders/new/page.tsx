import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { OrderForm } from "@/components/orders/order-form";
import { requireAffiliate } from "@/server/auth/guards";
import { listWarehouses } from "@/server/services/warehouses";

export const metadata: Metadata = { title: "New sale" };

export default async function AffiliateNewOrderPage() {
  await requireAffiliate();
  const warehouses = await listWarehouses();
  return (
    <>
      <PageHeader title="New sale" description="Enter the customer and the products you sold. Stock is reserved immediately and your commission is recorded with the rule in force today." />
      <OrderForm mode="affiliate" warehouses={warehouses} successPath="/portal/affiliate/orders" />
    </>
  );
}
